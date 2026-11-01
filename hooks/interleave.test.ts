// The pane under every ordering of what can be in flight at once: fetches
// held open until the ordering releases them, a read of the model's, a
// close. Each run drives the module itself through the kit, then reads the
// state and checks what must hold whatever the order: the pane shows the
// last navigation's document, whole and not loading, and a close after the
// last navigation keeps the pane closed.

import type { CommandRunInput, ToolCallArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// The kit runs a test on the host's runtime, which has timers; the module's
// own environment has none, so the types declare none. One run's deadline
// must not wait on the mocked clock, so it is the host's.
declare const setTimeout: (fn: () => void, ms: number) => unknown

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

const EXPLORER = { ...PANE, requestId: 'strata-space' } as const

const answer = (id: string, title: string, version: number, body: string): string =>
  JSON.stringify({ documentId: id, title, format: 'markdown', documentVersion: version, content: `# ${title}\n\n${body}\n` })

/** The model's first read of each run, the pane's own refresh of it, a later read of the model's, and another document. */
const FIRST = answer('doc_1', 'Plan', 214, 'Intro.')
const FRESH = answer('doc_1', 'Plan', 215, 'Intro, fresh.')
const MODEL = answer('doc_1', 'Plan', 216, 'Intro, as the model read it.')
const OTHER = answer('doc_2', 'Notes', 3, 'Other.')
const FOUND = JSON.stringify({ documents: [{ documentId: 'doc_2', title: 'Notes' }] })

/** A read held open: the test learns when it began and lets it answer when the ordering says. */
type Hold = { started: Promise<void>; markStarted: () => void; released: Promise<void>; release: () => void }
function hold(): Hold {
  let markStarted: () => void = () => undefined
  let release: () => void = () => undefined
  const started = new Promise<void>(resolve => {
    markStarted = resolve
  })
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  return { started, markStarted, released, release }
}

/** Every ordering of `events` in which each pair of `after` keeps its order. */
function orderings(events: readonly string[], after: ReadonlyArray<readonly [string, string]>): string[][] {
  const out: string[][] = []
  const permute = (rest: string[], chosen: string[]): void => {
    if (rest.length === 0) {
      out.push(chosen)
      return
    }
    for (const one of rest) {
      if (after.some(([first, second]) => second === one && rest.includes(first))) continue
      permute(
        rest.filter(other => other !== one),
        [...chosen, one],
      )
    }
  }
  permute([...events], [])
  return out
}

/** What a run left: the pane's title, revision and body as drawn, whether it is loading or holds a draft, and the engine's last open or close of it. */
type Outcome = { title: string | null; version: string | null; isLoading: boolean; hasDraft: boolean; body: string[]; lastShown: string | null }

/**
 * The engine beneath the module for these runs, and a driver: `run` plays
 * one ordering (`s1`: opening doc_1 again from the explorer's recent list;
 * `s2`: opening doc_2 from its search results; `r1`, `r2`: their reads
 * answering; `read`: the model reading doc_1 anew; `close`: `/strata close`)
 * from a fresh read, and answers what the pane drew after it.
 */
function harness($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  /** The engine's pane opens and closes, in order, by pane. */
  const shown: string[] = []
  on('ui.open', (_, e) => {
    shown.push(`open ${e.id}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    shown.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let modelText = FIRST
  on('tool.call', () => ({ result: {}, text: modelText }))
  let holds = new Map<string, Hold>()
  on('mcp.call', async (_, e) => {
    if (e.tool === 'read_document') {
      const id = String((e.args as { documentId?: unknown }).documentId)
      const held = holds.get(id)
      if (held !== undefined) {
        held.markStarted()
        await held.released
      }
      return { value: { content: [{ type: 'text', text: id === 'doc_1' ? FRESH : OTHER }], isError: false } }
    }
    if (e.tool === 'find') return { value: { content: [{ type: 'text', text: FOUND }], isError: false } }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
  })
  const command = (args: string) =>
    $.command.run({
      command: 'strata',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    } as unknown as CommandRunInput)

  const run = async (order: readonly string[]): Promise<Outcome> => {
    holds = new Map([
      ['doc_1', hold()],
      ['doc_2', hold()],
    ])
    shown.length = 0
    modelText = FIRST
    await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
    // The pane open, whatever the last run left it.
    await command('doc')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const explorer = await $.ui.mount({ ...EXPLORER, surface: 'terminal' })
    await explorer.input({ key: 'search', text: 'notes' })
    await explorer.redraw()
    expect(await explorer.find({ key: 'open0' }), 'the explorer lists doc_2').toBeDefined()
    expect(await explorer.find({ key: 'recent-strata-doc_1' }), 'the explorer lists doc_1 as read').toBeDefined()
    const kicks: Record<string, Promise<unknown>> = {}
    // A run that never settles names its ordering rather than the test's whole budget.
    const deadline = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`the ordering ${order.join(' ')} never settled`)), 1_500)
    })
    const guarded = async <T,>(work: Promise<T>): Promise<T> => Promise.race([work, deadline])
    for (const event of order) {
      switch (event) {
        case 's1': {
          // From the explorer's recent list, which names doc_1 whatever the pane shows by now (its refresh follows the pane).
          kicks.s1 = explorer.press({ key: 'recent-strata-doc_1' })
          await guarded(holds.get('doc_1')?.started ?? Promise.resolve())
          break
        }
        case 's2': {
          kicks.s2 = explorer.press({ key: 'open0' })
          await guarded(holds.get('doc_2')?.started ?? Promise.resolve())
          break
        }
        case 'r1': {
          holds.get('doc_1')?.release()
          await guarded(kicks.s1 ?? Promise.resolve())
          break
        }
        case 'r2': {
          holds.get('doc_2')?.release()
          await guarded(kicks.s2 ?? Promise.resolve())
          break
        }
        case 'read': {
          modelText = MODEL
          await guarded($.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs))
          break
        }
        case 'close': {
          await guarded(command('close'))
          break
        }
        default:
          throw new Error(`unknown event ${event}`)
      }
    }
    await guarded(Promise.all(Object.values(kicks)))
    await guarded(clock.settle())
    // What the pane draws from the state it ended in, and what the engine was last told to do with the pane.
    await pane.redraw()
    const title = (await pane.find({ type: 'Text', text: /^(Plan|Notes)$/ }))?.text ?? null
    const version = (await pane.find({ type: 'Text', text: /^v\d+$/ }))?.text ?? null
    const isLoading = (await pane.find({ type: 'Text', text: /loading/ })) !== undefined
    const hasDraft = (await pane.find({ key: 'draft' })) !== undefined
    const body = (await pane.findAll({ type: 'Markdown' })).map(block => String((block.props as { text?: unknown }).text ?? ''))
    const lastShown = shown.filter(one => one.endsWith('strata-doc')).at(-1) ?? null
    await explorer.unmount()
    await pane.unmount()
    return { title, version, isLoading, hasDraft, body, lastShown }
  }
  return { run }
}

/** What each document draws as once its fetch landed: the title, the revision, the blocks. */
const LANDED: Record<string, { title: string; version: string; body: string[] }> = {
  doc_1: { title: 'Plan', version: 'v215', body: ['# Plan', 'Intro, fresh.'] },
  doc_2: { title: 'Notes', version: 'v3', body: ['# Notes', 'Other.'] },
}

test('two fetches and a close, in every order: the pane ends on the last navigation, never loading', async ($, on) => {
  const { run } = harness($, on)
  const base = ['s1', 's2', 'r1', 'r2']
  const keeps: readonly (readonly [string, string])[] = [
    ['s1', 'r1'],
    ['s2', 'r2'],
  ]
  const orders = [...orderings(base, keeps), ...orderings([...base, 'close'], keeps)]
  expect(orders.length).toBe(36)
  for (const order of orders) {
    const at = (event: string): number => order.indexOf(event)
    const outcome = await run(order)
    const name = order.join(' ')
    expect(outcome.isLoading, name).toBe(false)
    expect(outcome.hasDraft, name).toBe(false)
    const last = at('s1') > at('s2') ? 'doc_1' : 'doc_2'
    const isClosedAfter = at('close') > at('s1') && at('close') > at('s2')
    if (isClosedAfter) {
      expect(outcome.lastShown, name).toBe('close strata-doc')
      continue
    }
    expect(outcome.lastShown, name).toBe('open strata-doc')
    expect(outcome.title, name).toBe(LANDED[last]?.title)
    expect(outcome.version, name).toBe(LANDED[last]?.version)
    expect(outcome.body, name).toEqual(LANDED[last]?.body)
  }
})

test('a fetch, a read of the model and a close, in every order: the revision never goes back, and a close after the last navigation holds', async ($, on) => {
  const { run } = harness($, on)
  const keeps: readonly (readonly [string, string])[] = [['s1', 'r1']]
  const orders = [...orderings(['s1', 'r1', 'read'], keeps), ...orderings(['s1', 'r1', 'read', 'close'], keeps)]
  expect(orders.length).toBe(15)
  for (const order of orders) {
    const at = (event: string): number => order.indexOf(event)
    const outcome = await run(order)
    const name = order.join(' ')
    // The model's read is the newest revision whatever lands last: the fetch's older answer never puts old text under it.
    expect(outcome.title, name).toBe('Plan')
    expect(outcome.version, name).toBe('v216')
    expect(outcome.body, name).toEqual(['# Plan', 'Intro, as the model read it.'])
    expect(outcome.isLoading, name).toBe(false)
    // The fetch applies only when nothing moved the pane between its start and its answer; a fetch that applies opens
    // the pane, and a read of the model's never reopens a closed one.
    const isFetchApplied = !order.slice(at('s1') + 1, at('r1')).some(event => event === 'read' || event === 'close')
    const isOpen = at('close') === -1 || (at('close') < at('s1') && isFetchApplied)
    expect(outcome.lastShown, name).toBe(isOpen ? 'open strata-doc' : 'close strata-doc')
  }
})
