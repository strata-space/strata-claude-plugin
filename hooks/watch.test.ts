import type { CommandRunInput, SessionEndInput, ToolCallArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { describeRoster, parseWatchEvent, takeLines, withArrival, withDeparture } from './watch'

// Lines as `strata doc watch --json` printed them against beta on 2026-11-01.
const STATUS = '{"event":"status","documentId":"doc_1","state":"connected"}'
const PRESENCE =
  '{"event":"presence","documentId":"doc_1","collaborators":[{"entityId":"usr_1","entityType":"human","displayName":"Priya","color":"hsl(98, 70%, 50%)","clientKind":"web"}]}'
const SNAPSHOT =
  '{"event":"snapshot","documentId":"doc_1","documentVersion":215,"walSeq":3,"title":"Lighthouse rollout plan","markdown":"# Plan\\n\\nIntro.\\n\\n## Risks\\n\\nThe gate reads p95 and errors.\\n","reason":"edit"}'

test('the watch lines parse into events, and unknown or broken lines into nothing', async () => {
  expect(parseWatchEvent(STATUS)).toEqual({ event: 'status', documentId: 'doc_1', state: 'connected', reason: null, attempt: null })
  const presence = parseWatchEvent(PRESENCE)
  expect(presence?.event).toBe('presence')
  if (presence?.event === 'presence') {
    expect(presence.collaborators).toEqual([{ entityId: 'usr_1', name: 'Priya', color: 'hsl(98, 70%, 50%)', kind: 'web' }])
  }
  const snapshot = parseWatchEvent(SNAPSHOT)
  if (snapshot?.event === 'snapshot') {
    expect(snapshot.documentVersion).toBe(215)
    expect(snapshot.markdown).toContain('p95 and errors')
  } else {
    expect(snapshot?.event).toBe('snapshot')
  }
  expect(
    parseWatchEvent('{"event":"collaboratorLeft","documentId":"doc_1","entityId":"usr_1","entityType":"human","clientKind":"terminal"}'),
  ).toEqual({ event: 'collaboratorLeft', documentId: 'doc_1', entityId: 'usr_1', clientKind: 'terminal' })
  expect(parseWatchEvent('{"event":"error","documentId":"doc_1","code":"unauthorized","message":"sign in"}')).toEqual({
    event: 'error',
    documentId: 'doc_1',
    code: 'unauthorized',
    message: 'sign in',
  })
  expect(parseWatchEvent('')).toBe(null)
  expect(parseWatchEvent('not json')).toBe(null)
  expect(parseWatchEvent('{"event":"weather","documentId":"doc_1"}')).toBe(null)
  expect(parseWatchEvent('{"event":"status","state":"connected"}')).toBe(null)
})

test('a roster keeps one row per person per client kind', async () => {
  const priya = { entityId: 'usr_1', name: 'Priya', color: '', kind: 'web' }
  const priyaTerminal = { ...priya, kind: 'terminal' }
  let roster = withArrival([], priya)
  roster = withArrival(roster, priyaTerminal)
  roster = withArrival(roster, { ...priya, name: 'Priya R.' })
  expect(roster.map(one => `${one.name}/${one.kind}`)).toEqual(['Priya/terminal', 'Priya R./web'])
  roster = withDeparture(roster, 'usr_1', 'web')
  expect(roster.map(one => one.kind)).toEqual(['terminal'])
  expect(describeRoster(roster, 40)).toBe('Priya (terminal)')
  expect(describeRoster([priya, priyaTerminal, { entityId: 'usr_2', name: 'Ada', color: '', kind: 'agent' }], 24)).toBe(
    'Priya (web), +2',
  )
  expect(describeRoster([], 40)).toBe('')
})

test('stream pieces split into whole lines with the tail kept', async () => {
  const first = takeLines('{"a":1}\n{"b":')
  expect(first.lines).toEqual(['{"a":1}'])
  expect(first.rest).toBe('{"b":')
  const second = takeLines(`${first.rest}2}\n`)
  expect(second.lines).toEqual(['{"b":2}'])
  expect(second.rest).toBe('')
})

const READ = JSON.stringify({
  documentId: 'doc_1',
  title: 'Lighthouse rollout plan',
  format: 'markdown',
  documentVersion: 214,
  content: '# Plan\n\nIntro.\n\n## Risks\n\nThe gate reads p95 alone.\n',
})

/** What `find` with intent info answers for the document: its link says which deployment it is of, which the watch needs to match the CLI's. */
const INFO = JSON.stringify({
  documentId: 'doc_1',
  title: 'Lighthouse rollout plan',
  documentVersion: 0,
  url: 'https://app.strata.space/w/acme/documents/doc_1/lighthouse-rollout-plan',
})

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

test('with the CLI signed in, a read starts a watch whose snapshot updates the pane and marks the read stale', { options: { cliPath: 'strata' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1' })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  on('mcp.call', (_, e) => ({
    value: { content: [{ type: 'text', text: e.tool === 'find' ? INFO : JSON.stringify({ comments: [] }) }], isError: false },
  }))
  on('process.run', (_, e) => {
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const spawned: string[][] = []
  // The child stays up (as a watch does) until the test lets it end.
  let release: () => void = () => undefined
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    yield { stream: 'stdout' as const, text: `${STATUS}\n${PRESENCE}\n${SNAPSHOT.slice(0, 40)}` }
    yield { stream: 'stdout' as const, text: `${SNAPSHOT.slice(40)}\n` }
    await new Promise<void>(resolve => {
      release = resolve
    })
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await clock.settle()

  expect(spawned[0]?.slice(0, 5)).toEqual(['strata', 'doc', 'watch', 'doc_1', '--json'])
  expect(spawned[0]?.[5]).toBe('--control')
  expect(spawned[0]?.[6]?.startsWith('/run/user/1/strata-claude-')).toBe(true)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /v215/ }))?.text).toBe('v215')
  expect((await pane.find({ type: 'Text', text: /^live$/ }))?.text).toBe('live')
  expect((await pane.find({ type: 'Text', text: /1 here/ }))?.text).toContain('Priya (web)')
  expect((await pane.find({ type: 'Text', text: /Claude read/ }))?.text).toContain('v214')

  // The child ends on its own: the live chip and the roster go, the text stays.
  release()
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /^live$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /1 here/ })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /v215/ }))?.text).toBe('v215')
  await pane.unmount()
})

test('a watch start the engine refuses is tried once per ask, not without end', { options: { cliPath: 'strata' } }, async ($, on) => {
  const clock = mock.clock(on)
  // The environment refuses: the control path cannot be made, and the start fails.
  let asked = 0
  on('env.get', () => {
    asked += 1
    throw new Error('env refused')
  })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  on('mcp.call', (_, e) => ({
    value: { content: [{ type: 'text', text: e.tool === 'find' ? INFO : JSON.stringify({ comments: [] }) }], isError: false },
  }))
  on('process.run', (_, e) => {
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const spawned: string[][] = []
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await clock.settle()
  // No watch, a bounded number of asks of the environment (one per run of
  // the reconciler, a run per ask that came while one ran), the cause said once.
  expect(spawned).toEqual([])
  const first = asked
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThanOrEqual(6)
  expect(toasts.filter(text => text.includes('could not be brought up')).length).toBe(1)
  // Another read asks again, as bounded, and the same cause is not said again.
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await clock.settle()
  expect(asked - first).toBeGreaterThan(0)
  expect(asked - first).toBeLessThanOrEqual(6)
  expect(toasts.filter(text => text.includes('could not be brought up')).length).toBe(1)
})

test('a snapshot drops a cursor whose text now sits under another heading', { options: { cliPath: 'strata' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1' })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const read = JSON.stringify({
    documentId: 'doc_1',
    title: 'Todo list',
    format: 'markdown',
    documentVersion: 7,
    content: '# Plan\n\n## A\n\nTODO.\n\n## B\n\nTODO.\n',
  })
  on('tool.call', () => ({ result: {}, text: read }))
  on('mcp.call', (_, e) => ({
    value: { content: [{ type: 'text', text: e.tool === 'find' ? INFO : JSON.stringify({ comments: [] }) }], isError: false },
  }))
  on('process.run', (_, e) => {
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Section A is deleted: B's identical paragraph now sits at A's old index.
  const snapshot = JSON.stringify({
    event: 'snapshot',
    documentId: 'doc_1',
    documentVersion: 8,
    walSeq: 1,
    title: 'Todo list',
    markdown: '# Plan\n\n## B\n\nTODO.\n',
    reason: 'edit',
  })
  let send: () => void = () => undefined
  let release: () => void = () => undefined
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: `${STATUS}\n` }
    await new Promise<void>(resolve => {
      send = resolve
    })
    yield { stream: 'stdout' as const, text: `${snapshot}\n` }
    await new Promise<void>(resolve => {
      release = resolve
    })
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await clock.settle()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Three steps down: the title, heading A, then A's paragraph.
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  expect((await pane.find({ key: 'b2' }))?.props.borderStyle).toBe('round')

  send()
  await clock.settle()
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /v8/ }))?.text).toBe('v8')
  // B's paragraph is at index 2 now, under another heading: no block is selected.
  expect((await pane.find({ key: 'b2' }))?.props.borderStyle).toBeUndefined()
  expect((await pane.findAll({ type: 'Box' })).some(box => box.props.borderStyle === 'round')).toBe(false)

  release()
  await clock.settle()
  await pane.unmount()
})

test('a read in a session the module never saw start (after a /clear) probes the CLI and follows the document', { options: { cliPath: 'strata' } }, async ($, on) => {
  mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1' })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {}, text: READ }))
  on('mcp.call', (_, e) => ({
    value: { content: [{ type: 'text', text: e.tool === 'find' ? INFO : JSON.stringify({ comments: [] }) }], isError: false },
  }))
  const probes: string[] = []
  on('process.run', (_, e) => {
    probes.push(e.argv.slice(1).join(' '))
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const spawned: string[][] = []
  let release: () => void = () => undefined
  let isEnded = false
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    yield { stream: 'stdout' as const, text: `${STATUS}\n` }
    await new Promise<void>(resolve => {
      release = resolve
    })
    isEnded = true
    return { value: { code: 0, signal: null } }
  })

  // No session.start: the tier is unknown, as it is after a /clear. With no
  // start there is no timer on the mock clock either, and the kit's acts then
  // wait on the child still running: the checks wait on the host's clock
  // instead, until they hold.
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await until(() => spawned.length > 0)
  expect(probes).toEqual(['status --json', 'doc watch --help'])
  expect(spawned[0]?.slice(0, 4)).toEqual(['strata', 'doc', 'watch', 'doc_1'])
  release()
  await until(() => isEnded)
})

test('a watch declined on a failed lookup starts once a poll learns the document\'s link', { options: { cliPath: 'strata' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1' })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  // The lookups of the document's link fail (the server refuses) until the test lets them answer.
  let isRefusing = true
  on('mcp.call', (_, e) => {
    if (e.tool === 'find') {
      if (isRefusing) return { value: { content: [{ type: 'text', text: 'refused' }], isError: true } }
      return { value: { content: [{ type: 'text', text: INFO }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
  })
  on('process.run', (_, e) => {
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const spawned: string[][] = []
  let release: () => void = () => undefined
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    yield { stream: 'stdout' as const, text: `${STATUS}\n` }
    await new Promise<void>(resolve => {
      release = resolve
    })
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await clock.settle()
  // Declined: the deployment could not be learned.
  expect(spawned).toEqual([])
  // The server answers again. The revision poll (every ten seconds) learns the link: the watch is reconciled, and starts.
  isRefusing = false
  await clock.advance(10_000)
  await clock.settle()
  expect(spawned.length).toBe(1)
  release()
  await clock.settle()
})

test('a signed-out error of the watch undoes no probe that signed the CLI in since', { options: { cliPath: 'strata' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1' })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  on('mcp.call', (_, e) => ({
    value: { content: [{ type: 'text', text: e.tool === 'find' ? INFO : JSON.stringify({ comments: [] }) }], isError: false },
  }))
  on('process.run', (_, e) => {
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const spawned: string[][] = []
  let emitError: () => void = () => undefined
  let release: () => void = () => undefined
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    yield { stream: 'stdout' as const, text: `${STATUS}\n` }
    await new Promise<void>(resolve => {
      emitError = resolve
    })
    yield { stream: 'stdout' as const, text: '{"event":"error","documentId":"doc_1","code":"unauthorized","message":"token expired"}\n' }
    await new Promise<void>(resolve => {
      release = resolve
    })
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  await clock.settle()
  expect(spawned.length).toBe(1)
  // The person turns the live watch on again: the CLI is probed, and answers signed in.
  await $.command.run({
    command: 'strata',
    args: 'live on',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  } as unknown as CommandRunInput)
  await clock.settle()
  // The watch's signed-out error, from before that probe, arrives now: the tier stays, the watch goes on.
  emitError()
  await clock.settle()
  expect(toasts.some(text => text.includes('signed out'))).toBe(false)
  expect(spawned.length).toBe(1)
  release()
  await clock.settle()
})

test('a probe landing while a /clear is dispatched starts no watch on the ending session\'s document', { options: { cliPath: 'strata' } }, async ($, on) => {
  mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1' })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  on('mcp.call', (_, e) => ({
    value: { content: [{ type: 'text', text: e.tool === 'find' ? INFO : JSON.stringify({ comments: [] }) }], isError: false },
  }))
  // The CLI's status answer is held: the session's probe is still out when the session ends.
  let statusCalls = 0
  let isStatusHeld = true
  let answerStatus: () => void = () => undefined
  on('process.run', async (_, e) => {
    if (e.argv[1] === 'status') {
      statusCalls += 1
      if (isStatusHeld) {
        await new Promise<void>(resolve => {
          answerStatus = resolve
        })
      }
    }
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const spawned: string[][] = []
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    return { value: { code: 0, signal: null } }
  })
  // The hooks beneath hold the end's dispatch until the test lets it go.
  let releaseEnd: () => void = () => undefined
  on('session.end', async (_, e) => {
    await new Promise<void>(resolve => {
      releaseEnd = resolve
    })
    return { sessionId: e.sessionId }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  // The end begins; the probe lands while it is dispatched, and is run again for the next session.
  const ending = $.session.end({ reason: 'clear', sessionId: 'session_1' } as SessionEndInput)
  isStatusHeld = false
  answerStatus()
  await until(() => statusCalls >= 2)
  await new Promise<void>(resolve => {
    setTimeout(resolve, 100)
  })
  // The watch the probe's answer asks for is not started on the ending session's document.
  expect(spawned).toEqual([])
  releaseEnd()
  await ending
})

// The kit runs a test on the host's runtime, which has timers; the module's
// own environment has none, so the types declare none.
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

test('a section fetch answered after a newer snapshot shows that section on the snapshot\'s text', { options: { cliPath: 'strata' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1' })
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The model read one section; the server's outline names another the pane does not hold.
  const sectioned = JSON.stringify({
    documentId: 'doc_1',
    title: 'Plan',
    format: 'markdown',
    documentVersion: 7,
    content: '## A\n\nFirst.\n',
    sectionsReturned: ['Plan > A'],
    outline: [
      { path: 'Plan', headingLevel: 1 },
      { path: 'Plan > A', headingLevel: 2 },
      { path: 'Plan > B', headingLevel: 2 },
    ],
  })
  on('tool.call', () => ({ result: {}, text: sectioned }))
  // The pane's fetch of section B is held until the test lets it answer, at the revision it was asked at.
  let begun: () => void = () => undefined
  const started = new Promise<void>(resolve => {
    begun = resolve
  })
  let answer: () => void = () => undefined
  on('mcp.call', async (_, e) => {
    if (e.tool === 'read_document') {
      begun()
      await new Promise<void>(resolve => {
        answer = resolve
      })
      const text = JSON.stringify({
        documentId: 'doc_1',
        title: 'Plan',
        format: 'markdown',
        documentVersion: 7,
        content: '## B\n\nSecond.\n',
        sectionsReturned: ['Plan > B'],
      })
      return { value: { content: [{ type: 'text', text }], isError: false } }
    }
    if (e.tool === 'find') return { value: { content: [{ type: 'text', text: INFO }], isError: false } }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
  })
  on('process.run', (_, e) => {
    const stdout = e.argv[1] === 'status' ? JSON.stringify({ status: 'logged_in', apiUrl: 'https://api.strata.space' }) : 'usage'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const snapshot = JSON.stringify({
    event: 'snapshot',
    documentId: 'doc_1',
    documentVersion: 8,
    walSeq: 1,
    title: 'Plan',
    markdown: '# Plan\n\n## A\n\nFirst.\n\n## B\n\nSecond, edited.\n',
    reason: 'edit',
  })
  let send: () => void = () => undefined
  let release: () => void = () => undefined
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: `${STATUS}\n` }
    await new Promise<void>(resolve => {
      send = resolve
    })
    yield { stream: 'stdout' as const, text: `${snapshot}\n` }
    await new Promise<void>(resolve => {
      release = resolve
    })
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1', sections: ['Plan > A'] } as unknown as ToolCallArgs)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // B is listed but not held: picking it fetches. The snapshot lands while the fetch is out, then the fetch answers.
  const picked = pane.press({ key: 'h2' })
  await started
  send()
  await clock.settle()
  answer()
  await picked
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /v8/ }))?.text).toBe('v8')
  expect(await pane.find({ type: 'Text', text: /loading/ })).toBeUndefined()
  const body = (await pane.findAll({ type: 'Markdown' })).map(block => String((block.props as { text?: unknown }).text ?? ''))
  expect(body).toEqual(['## B', 'Second, edited.'])

  release()
  await clock.settle()
  await pane.unmount()
})
