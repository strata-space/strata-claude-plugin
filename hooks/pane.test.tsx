import type { ToolCallArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'

import { parseReadResult } from './markdown'
import { BLOCKS_MAX, fetchedView, occurrencesIn, snapshotView, viewOf } from './pane'

/** The pane's draft field as drawn, if any: its key names the draft and the field's generation. */
async function fieldOf(pane: { find: (query: { type: string }) => Promise<FoundElement | undefined> }): Promise<FoundElement | undefined> {
  return pane.find({ type: 'Input' })
}

/** The draft field's key, for typing into it; empty with none drawn. */
async function fieldKey(pane: { find: (query: { type: string }) => Promise<FoundElement | undefined> }): Promise<string> {
  return (await fieldOf(pane))?.key ?? ''
}

// The kit runs a test on the host's runtime, which has timers; the module's
// own environment has none, so the types declare none. A post runs on after
// the field's event settled (the hook waits on the state step, not the
// write), so a check on what it wrote waits on the host's clock until it holds.
declare const setTimeout: (fn: () => void, ms: number) => unknown

/** Waits on the host's clock until `check` holds, two seconds at most. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await check()) return
    await new Promise<void>(resolve => {
      setTimeout(resolve, 10)
    })
  }
}

const PANE = {
  plugin: 'strata',
  component: 'Pane',
  requestId: 'strata-doc',
  props: {
    title: 'Strata',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'strata',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const READ = JSON.stringify({
  documentId: 'doc_1',
  title: 'Lighthouse rollout plan',
  format: 'markdown',
  documentVersion: 214,
  content: '# Plan\n\nIntro.\n\n## Risks\n\nThe gate reads p95 alone.\n\n## Rollback\n\nManual.\n',
})

test('a read fills the pane and the band, on the terminal and the desktop', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // Beneath the plugins, the engine draws nothing for a band the module passes on.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  let isPaneListed = true
  on('ui.panes', () => ({ value: isPaneListed ? [{ id: 'strata-doc', title: 'Plan', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Text', text: /Lighthouse/ }))?.text).toBe('Lighthouse rollout plan')
    expect((await pane.find({ type: 'Text', text: /v214/ }))?.text).toBe('v214')
    // The outline strip: one button per heading, the whole document first.
    expect(await pane.find({ key: 'h1' })).toBeDefined()
    expect(await pane.find({ key: 'top' })).toBeDefined()
    await pane.unmount()

    // With the pane in view and nothing stale, the band leaves the prompt its row.
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /Lighthouse/ })).toBeUndefined()
    await band.unmount()
  }
  // With no pane in view, the band names what Claude read and offers the pane.
  isPaneListed = false
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Lighthouse/ }))?.text).toContain('v214')
  expect(await band.find({ key: 'open-pane' })).toBeDefined()
  expect(await band.find({ key: 'refresh-stale' })).toBeUndefined()
  await band.unmount()
})

test('a read of another document gives the open pane that document\'s title', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  const titles: string[] = []
  on('ui.open', (_, e) => {
    titles.push(e.title ?? '')
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let text = READ
  on('tool.call', () => ({ result: {}, text }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  expect(titles).toEqual(['Lighthouse rollout plan'])
  text = JSON.stringify({ documentId: 'doc_2', title: 'Runbook', format: 'markdown', documentVersion: 3, content: '# Runbook\n\nSteps.\n' })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_2' } as unknown as ToolCallArgs)
  // Opened again where it is drawn: the engine retitles a pane already open.
  expect(titles.at(-1)).toBe('Runbook')
})

test('picking a section shows that section alone', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'h2' })
  const body = await pane.find({ type: 'Markdown' })
  const text = String((body?.props as { text?: unknown } | undefined)?.text ?? '')
  expect(text.startsWith('## Rollback')).toBe(true)
  expect(text).not.toContain('## Risks')
  await pane.unmount()
})

test('the cursor walks the blocks; q quotes the block, c posts a comment on it', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  const calls: { tool: string; args: unknown }[] = []
  on('mcp.call', (_, e) => {
    calls.push({ tool: e.tool, args: e.args })
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    if (e.tool === 'create_comment') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ id: 'cmt_1' }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Two steps down: past the title onto "Intro.", the paragraph under "Plan".
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  expect((await pane.find({ key: 'b1' }))?.props.borderStyle).toBe('round')
  expect((await pane.find({ key: 'b0' }))?.props.borderStyle).toBeUndefined()
  await pane.press({ key: 'quote' })
  expect(filled[0]).toBe('\n> Intro.\n\n')
  await pane.press({ key: 'comment' })
  expect(await fieldOf(pane)).toBeDefined()
  // While the field is up the hotkeys rest, so typing a "j" stays in the field.
  expect(await pane.find({ key: 'next' })).toBeUndefined()
  // Two Enters at once post once.
  const key = await fieldKey(pane)
  await Promise.all([pane.input({ key, text: 'Why only an intro?' }), pane.input({ key, text: 'Why only an intro?' })])
  await until(() => calls.some(call => call.tool === 'create_comment'))
  const created = calls.filter(call => call.tool === 'create_comment')
  expect(created.length).toBe(1)
  const args = created[0]?.args as Record<string, unknown> | undefined
  expect(args?.body).toBe('Why only an intro?')
  expect(args?.quotedText).toBe('Intro.')
  expect(args?.headingContext).toEqual(['Plan'])
  expect(await fieldOf(pane)).toBeUndefined()
  await pane.unmount()
})

test('a section read after a whole read keeps the older revision until a refresh re-reads it all', async ($, on) => {
  const clock = mock.clock(on)
  // Beneath the plugins, the engine draws nothing for a band the module passes on.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const section = JSON.stringify({
    documentId: 'doc_1',
    title: 'Lighthouse rollout plan',
    format: 'markdown',
    documentVersion: 215,
    content: '## Risks\n\nThe gate reads p95 and errors.\n',
    sectionsReturned: ['Plan > Risks'],
  })
  const whole = JSON.stringify({
    documentId: 'doc_1',
    title: 'Lighthouse rollout plan',
    format: 'markdown',
    documentVersion: 215,
    content: '# Plan\n\nIntro.\n\n## Risks\n\nThe gate reads p95 and errors.\n\n## Rollback\n\nManual.\n',
  })
  let reads = 0
  on('tool.call', () => {
    reads += 1
    return { result: {}, text: reads === 1 ? READ : section }
  })
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: whole }], isError: false } }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await $.tool.call({
    tool: 'mcp__strata__read_document',
    documentId: 'doc_1',
    sections: ['Plan > Risks'],
  } as unknown as ToolCallArgs)

  // The model still holds the whole document from v214, so that is the revision it rests on.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Lighthouse/ }))?.text).toContain('v214')
  expect((await band.find({ type: 'Text', text: /changed/ }))?.text).toContain('v215')
  await band.press({ key: 'refresh-stale' })
  await clock.settle()
  await band.redraw()
  // Refreshed, with the pane in view: nothing left to say, and the band leaves the prompt its row.
  expect(await band.find({ type: 'Text', text: /changed/ })).toBeUndefined()
  expect(await band.find({ key: 'refresh-stale' })).toBeUndefined()
  await band.unmount()
})

test('a snapshot drops the cursor when its twin past the drawn cut would take its place', async () => {
  // A heading, the cursor's paragraph, filler past the cut, and a twin of the
  // paragraph just past it: as many blocks as the pane draws, plus one.
  const filler = Array.from({ length: BLOCKS_MAX - 2 }, (_, at) => `Filler ${String(at)}.`)
  const before = ['# Plan', 'Same words.', ...filler, 'Same words.'].join('\n\n')
  const after = ['# Plan', ...filler, 'Same words.'].join('\n\n')
  const result = parseReadResult(
    JSON.stringify({ documentId: 'doc_1', title: 'Plan', format: 'markdown', documentVersion: 1, content: before }),
  )
  expect(result).not.toBe(null)
  if (result === null) return
  const view = { ...viewOf(result, 'strata', null, { nav: 1 }), cursor: 1 }
  // Deleting the cursor's paragraph brings the twin into the drawing with the same count among drawn blocks.
  const next = snapshotView(view, { title: 'Plan', documentVersion: 2, markdown: after })
  expect(next.version).toBe(2)
  expect(next.cursor).toBe(null)
  // An edit elsewhere keeps the cursor on its own paragraph.
  const edited = snapshotView(view, { title: 'Plan', documentVersion: 2, markdown: before.replace('Filler 0.', 'Filler 0, edited.') })
  expect(edited.cursor).toBe(1)
})

test('an older section answer moves the pane to that section only where the text held has it', async () => {
  const outline = [
    { level: 2, title: 'A', path: 'A' },
    { level: 2, title: 'B', path: 'B' },
  ]
  // The pane holds section A at v2, with the whole outline beside it.
  const held = { id: 'doc_1', title: 'Plan', version: 2, format: 'markdown' as const, markdown: '## A\n\nA text.', outline, sectionsReturned: ['A'] }
  const view = { ...viewOf(held, 'strata', null, { nav: 1 }), section: 'A' }
  // B's answer at v1, from before the refresh: the outline lists B, the text held does not have it.
  const olderB = { ...held, version: 1, markdown: '## B\n\nB text.', sectionsReturned: ['B'] }
  const moved = fetchedView(view, olderB, 'B')
  expect(moved.section).toBe(null)
  expect(moved.markdown).toBe('## A\n\nA text.')
  expect(moved.version).toBe(2)
  // A's own older answer keeps A, which the text held has.
  expect(fetchedView(view, { ...held, version: 1 }, 'A').section).toBe('A')
  // With the whole document held, B is there to move to.
  const whole = viewOf({ ...held, markdown: '## A\n\nA text.\n\n## B\n\nB text.', sectionsReturned: [] }, 'strata', null, { nav: 1 })
  expect(fetchedView(whole, olderB, 'B').section).toBe('B')
})

test('a pane with nothing read says so', async $ => {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /No Strata document/ }))?.text).toContain('No Strata document')
  await pane.unmount()
})

test('a read with comments folded in draws but refuses to anchor until r fetches the plain text', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__strata__read_document',
    documentId: 'doc_1',
    includeComments: true,
  } as unknown as ToolCallArgs)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /annotated read/ })).toBeDefined()
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'comment' })
  expect(await fieldOf(pane)).toBeUndefined()
  expect(toasts.some(text => text.includes('folded in'))).toBe(true)
  // r fetches the document's own text; a comment anchors to that.
  await pane.press({ key: 'refresh' })
  expect(await pane.find({ type: 'Text', text: /annotated read/ })).toBeUndefined()
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'comment' })
  expect(await fieldOf(pane)).toBeDefined()
  await pane.unmount()
})

test('typing on while a comment posts keeps what came after the posted text, for a post of its own', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  const bodies: string[] = []
  let release: () => void = () => undefined
  on('mcp.call', async (_, e) => {
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    if (e.tool === 'create_comment') {
      bodies.push(String((e.args as { body?: unknown }).body))
      // The first post is held until the test lets it land.
      if (bodies.length === 1) {
        await new Promise<void>(resolve => {
          release = resolve
        })
      }
      return { value: { content: [{ type: 'text', text: JSON.stringify({ id: `cmt_${String(bodies.length)}` }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'comment' })
  await pane.input({ key: await fieldKey(pane), text: 'First', kind: 'change' })
  // Enter, then typing on while the post is held.
  const posting = pane.input({ key: await fieldKey(pane), text: 'First' })
  await pane.input({ key: await fieldKey(pane), text: 'First\nSecond', kind: 'change' })
  release()
  await posting
  expect(bodies).toEqual(['First'])
  // The draft stays open with what came after, and posts that on its own.
  const field = await fieldOf(pane)
  expect(field).toBeDefined()
  expect(field?.props.value).toBe('Second')
  await pane.input({ key: await fieldKey(pane), text: 'Second' })
  expect(bodies).toEqual(['First', 'Second'])
  expect(await fieldOf(pane)).toBeUndefined()
  await pane.unmount()
})

test('an Enter held up in the input chain while typing went on posts what it carried and keeps the rest', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  const bodies: string[] = []
  on('mcp.call', (_, e) => {
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    if (e.tool === 'create_comment') {
      bodies.push(String((e.args as { body?: unknown }).body))
      return { value: { content: [{ type: 'text', text: JSON.stringify({ id: `cmt_${String(bodies.length)}` }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'comment' })
  // An Enter held up in the engine's input chain while typing went on reaches
  // the module after the change did, carrying the older text: as the module
  // sees it, the field's stored text goes on from the value Enter came with.
  await pane.input({ key: await fieldKey(pane), text: 'First', kind: 'change' })
  await pane.input({ key: await fieldKey(pane), text: 'First\nSecond', kind: 'change' })
  await pane.input({ key: await fieldKey(pane), text: 'First' })
  expect(bodies).toEqual(['First'])
  expect((await fieldOf(pane))?.props.value).toBe('Second')
  // Typing that changed the text Enter carried, rather than going on from it, stays whole.
  await pane.input({ key: await fieldKey(pane), text: 'Edited second\nThird', kind: 'change' })
  await pane.input({ key: await fieldKey(pane), text: 'Second' })
  expect(bodies).toEqual(['First', 'Second'])
  expect((await fieldOf(pane))?.props.value).toBe('Edited second\nThird')
  // A line break the field adds at Enter alone is no typing: the post closes the draft.
  await pane.input({ key: await fieldKey(pane), text: 'Edited second\nThird\n' })
  expect(bodies).toEqual(['First', 'Second', 'Edited second\nThird'])
  expect(await fieldOf(pane)).toBeUndefined()
  await pane.unmount()
})

test('an emptied replacement proposes a deletion; an empty comment closes its draft', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  let release: () => void = () => undefined
  on('mcp.call', async (_, e) => {
    calls.push({ tool: e.tool, args: e.args as Record<string, unknown> })
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    if (e.tool === 'propose_suggestion') {
      // The first proposal is held until the test lets it land.
      if (calls.filter(call => call.tool === 'propose_suggestion').length === 1) {
        await new Promise<void>(resolve => {
          release = resolve
        })
      }
      return { value: { content: [{ type: 'text', text: JSON.stringify({ suggestionId: 'sg_1' }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'suggest' })
  expect((await fieldOf(pane))?.props.value).toBe('Intro.')
  // The selected text, cleared from the field, is proposed for deletion.
  const oldKey = await fieldKey(pane)
  await pane.input({ key: oldKey, text: '', kind: 'change' })
  const posting = pane.input({ key: oldKey, text: '' })
  // Typing on while the deletion posts: a replacement after all.
  await pane.input({ key: oldKey, text: 'Intro, revised.', kind: 'change' })
  release()
  await posting
  const proposed = calls.filter(call => call.tool === 'propose_suggestion')
  expect(proposed.length).toBe(1)
  expect(proposed[0]?.args.originalText).toBe('Intro.')
  expect(proposed[0]?.args.replacementText).toBe('')
  // The draft stays open with what was typed, under a new generation (the
  // kit types only into the field as drawn now; an empty Enter from the old
  // drawing, carrying the old generation, is refused by the submit step).
  expect((await fieldOf(pane))?.props.value).toBe('Intro, revised.')
  expect(await fieldKey(pane)).not.toBe(oldKey)
  await pane.input({ key: await fieldKey(pane), text: 'Intro, revised.' })
  const revised = calls.filter(call => call.tool === 'propose_suggestion')
  expect(revised.length).toBe(2)
  expect(revised[1]?.args.replacementText).toBe('Intro, revised.')
  expect(await fieldOf(pane)).toBeUndefined()
  // An empty comment is no comment: Enter closes the draft and posts nothing.
  await pane.press({ key: 'comment' })
  expect(await fieldOf(pane)).toBeDefined()
  await pane.input({ key: await fieldKey(pane), text: '' })
  expect(calls.some(call => call.tool === 'create_comment')).toBe(false)
  expect(await fieldOf(pane)).toBeUndefined()
  await pane.unmount()
})

test('a read too large for the context, which the engine saved to a file, still fills the pane from that file', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }))
  // The model's first read lands whole; the next is too large, and the engine
  // hands the model its error text instead, naming the file: the path runs
  // to the end of its line, a space or a drive letter and all.
  let calls = 0
  let savedAt = '/home/Jane Doe/.claude/projects/p/tool-results/mcp-strata-read_document-1.txt'
  on('tool.call', () => {
    calls += 1
    return calls === 1
      ? { result: {}, text: READ }
      : {
          result: {},
          isError: true,
          text: `Error: result (62,907 characters) exceeds maximum allowed tokens. Output has been saved to ${savedAt}.\nFormat: JSON with schema: {documentId: string, ...}`,
        }
  })
  const reads: string[] = []
  on('fs.read', (_, e) => {
    reads.push(e.path)
    return { value: READ.replace('"documentVersion":214', '"documentVersion":215') }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  expect(reads).toEqual(['/home/Jane Doe/.claude/projects/p/tool-results/mcp-strata-read_document-1.txt'])
  savedAt = 'C:\\Users\\Jane\\.claude\\projects\\p\\tool-results\\mcp-strata-read_document-2.txt'
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  // Handed over whole (the kit resolves a path that is not absolute here against the working directory).
  expect(reads[1]?.endsWith('C:\\Users\\Jane\\.claude\\projects\\p\\tool-results\\mcp-strata-read_document-2.txt')).toBe(true)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /Lighthouse/ }))?.text).toBe('Lighthouse rollout plan')
  expect((await pane.find({ type: 'Text', text: /v215/ }))?.text).toBe('v215')
  await pane.unmount()
  // The model holds the file, not the text: its read stays at v214, with v215 known as newer.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Lighthouse/ }))?.text).toContain('v214')
  expect(await band.find({ key: 'refresh-stale' })).toBeDefined()
  await band.unmount()
})

test('a quote is counted under its heading alone: a long repeat under another costs nothing', async () => {
  const text = `# A\n\n${'a'.repeat(30000)}\n\n# B\n\n${'a'.repeat(2000000)}`
  const started = Date.now()
  expect(occurrencesIn(text, [], 'a'.repeat(30000), ['A'])).toBe(1)
  expect(occurrencesIn('# A\n\nx y x\n\n# B\n\nx', [], 'x', ['A'])).toBe(2)
  expect(occurrencesIn('x\n\n# B\n\nx', [], 'x', [])).toBe(1)
  expect(Date.now() - started).toBeLessThan(2000)
})
