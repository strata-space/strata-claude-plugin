// The Strata mod: a document pane that opens when Claude reads a Strata
// document, a band above the prompt that knows when a document moved since
// the read, an explorer with a review queue, and /strata. Every write to
// Strata follows a press or the model's own tool call.
//
// How the module keeps its state straight. Every change to the state goes
// through one queue of steps (`step`), one step after another: a step reads
// the atoms, decides, writes and returns, and waits on nothing else (no tool
// call, no process, no question). So a step sees the state as the last step
// left it, no write races another, and `update` never has to run a step's
// function twice. Work that waits (a fetch, a post, a probe, the watch's
// child) runs outside the queue and brings its answer in as a step, which
// judges it against the state then: the pane's navigation count (`nav`, in
// the view) for a fetch, the watch's own identity for its events, the
// draft's tag and the field's generation for a post. The engine's pane, the
// CLI's watch and the thread listings are each brought into line with the
// state by a runner that runs once at a time and once more when asked while
// running (`settlePane`, `syncWatch`, `requestThreads`), reading the state
// afresh each pass, so the last ask always has its say.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  StrataDocView,
  StrataDraft,
  StrataExplorerResult,
  StrataExplorerView,
  StrataLoadedDoc,
  StrataOutlineEntry,
  StrataReviewItem,
  StrataThread,
  StrataTier,
} from '../types'
import { degradeHtml, outlineOf, parseReadResult, placeThreads, rebaseOutline, shownText, tableLayout } from './markdown'
import type { ReadResult } from './markdown'
import {
  DRAFT_MAX,
  FENCES_MAX,
  OUTLINE_MAX,
  QUERY_MAX,
  THREADS_MAX,
  anchoredOf,
  becomesStale,
  cutOf,
  draftOf,
  draftTitle,
  drawable,
  drawnSize,
  fetchedView,
  lineOf,
  forward,
  headingContextOf,
  isRowOf,
  loadingView,
  occurrencesIn,
  occurrencesUnder,
  quotedOf,
  reconcile,
  remember,
  selectionOf,
  shownOf,
  snapshotView,
  viewOf,
} from './pane'
import { clip, deploymentOf, idIn, infoOf, mentionSpans, quoteForPrompt, searchResults, serverOf, textOf, threadsOf, toolOf } from './strata'
import { describeRoster, parseWatchEvent, takeLines, withArrival, withDeparture } from './watch'
import type { WatchEvent } from './watch'

const DOC_PANE = 'strata-doc'
const EXPLORER_PANE = 'strata-space'
const REVIEW_LIMIT = 50
/** How often the band checks whether a document in the ledger moved. */
const POLL_MS = 10_000
/** How many ledger documents one check asks about: the most recently read. */
const POLL_DOCS = 5
/** The token budget a fetch of the pane's asks for, so the whole text comes back. */
const WHOLE_READ_TOKENS = 400_000
/** The server the public plugin bundles, for a call made before any Strata tool ran. */
const DEFAULT_SERVER = 'strata'
/** How many `@strata:` mentions one prompt expands. */
const MENTION_LIMIT = 5
/** How many search answers the mention typeahead keeps. */
const MENTION_CACHE = 50
/** How many documents' first offering servers are kept for the session's mentions. */
const MENTION_SERVERS_MAX = 5_000
/** How many ledger rows the system prompt's Strata section names. */
const LEDGER_NOTE = 8
/** Past these, the engine hands the model a head and a file path instead of a `prompt.submit` context entry (one entry; all together). */
const CONTEXT_ENTRY_MAX = 100_000
const CONTEXT_TOTAL_MAX = 200_000

// Shape tags: change one when its value's fields change, so a reload declines
// what an earlier version stored.
const ledger = atom({ plugin: 'strata', key: 'ledger' } as const, [] as StrataLoadedDoc[], {
  shape: 'ledger-2',
})
const doc = atom({ plugin: 'strata', key: 'doc' } as const, null as StrataDocView | null, {
  shape: 'doc-8',
})
const review = atom({ plugin: 'strata', key: 'review' } as const, [] as StrataReviewItem[], {
  shape: 'review-1',
})
const explorer = atom(
  { plugin: 'strata', key: 'explorer' } as const,
  { query: '', results: [], server: null, isSearching: false, error: null } as StrataExplorerView,
  { shape: 'explorer-2' },
)
const server = atom({ plugin: 'strata', key: 'server' } as const, null as string | null)
const tier = atom({ plugin: 'strata', key: 'tier' } as const, 'unknown' as StrataTier)
const liveOverride = atom({ plugin: 'strata', key: 'liveOverride' } as const, null as 'on' | 'off' | null)
const mentionServers = atom({ plugin: 'strata', key: 'mentionServers' } as const, {} as Record<string, string>, {
  shape: 'mentions-1',
})
const isBandHidden = atom({ plugin: 'strata', key: 'isBandHidden' } as const, false)
const paneState = atom({ plugin: 'strata', key: 'pane' } as const, 'unopened' as 'unopened' | 'open' | 'closed')

type Engine = EngineInterface
const noop = (): void => undefined

/** A word to the person, as one line the engine takes: a document's title in it may hold what the engine refuses. */
function toast($: Engine, text: string): void {
  $.ui.toast(lineOf(text))
}

// ---- The queue of steps -------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()

/**
 * Run `work` after every step before it: the one place the state changes.
 * `work` reads and writes the atoms and returns; it waits on nothing else.
 */
function step<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.then(noop, noop)
  return run
}

/** The pane's navigation count, as the view carries it; 0 with no view. */
function navOf(view: StrataDocView | null): number {
  return view === null ? 0 : view.nav
}

/**
 * A document as the module tells documents apart: its id through one MCP
 * server. Two servers may each hold a document of the same id, and nothing
 * of the one (its threads, its revisions, its watch, its queue rows) is the
 * other's.
 */
type DocumentRef = { id: string; server: string }

/** Whether the pane's view is the document `ref` names. */
function isViewOf(view: StrataDocView, ref: DocumentRef): boolean {
  return view.id === ref.id && view.server === ref.server
}

// ---- The options, and what one hook at a time holds ---------------------

let cliPath = 'strata'
let isLiveWanted = true
let isAutoOpenWanted = true
/** True once the session is ending: no watch is wanted then, whatever the state says. */
let isEnding = false
/**
 * True while a session's end is being dispatched (the hooks beneath this
 * module's still running): no watch starts then, the state being the ending
 * session's until they are done, whatever a probe or a read landing
 * meanwhile asks.
 */
let isSessionEnding = false
/**
 * Which session the module serves, counted from the process's first: one
 * more each time a session ends (after a `/clear` or a resume the process
 * goes on under another, with the state started over). Work that waited
 * across the change (a fetch, a refresh's read, a post, a listing, a poll)
 * takes the count when it begins and brings nothing into a later session:
 * the state is that session's, and a note for the model would land in the
 * wrong conversation. Bumped in a step, so no step sees it move midway.
 */
let sessionSeq = 0

/** The server's own link for each document it has named one for this session, by server and document: restored on a re-read or a reopen; a watched one is asked about once. */
const knownUrls = new Map<string, string>()
const urlKey = (via: string, id: string): string => `${via}\u0000${id}`
const knownUrl = (via: string, id: string): string | null => knownUrls.get(urlKey(via, id)) ?? null
/** Where the next revision poll's batch starts in the ledger. */
let pollOffset = 0

// ---- The engine's pane, brought into line with `paneState` --------------

/**
 * What the engine shows of the document pane, as this module's own opens
 * and closes and the person's closes told it; unknown until the first of
 * them (a reload starts the module over while the engine keeps its panes),
 * and an unknown never agrees, so the first pass opens or closes outright.
 */
let paneDrawn: 'open' | 'closed' | 'unknown' = 'unknown'
/** How many times the state was marked open, so a close that waited can tell whether an open landed meanwhile (the newer action). */
let paneOpens = 0
type PaneOpened = Awaited<ReturnType<Engine['ui']['open']>>
let paneSettling: Promise<PaneOpened | null> | null = null
let paneSettleAgain = false
/** Asks gathered for the next pass: an open even when the pane is drawn (a title, a pane the engine could not place), and focus with it. */
let paneForce = false
let paneFocus = false
/**
 * An open made from the hook of the person's own ask for the pane (`/strata
 * doc`, the band's button), kept for the pass that opens: such an open is
 * one the person asked for, which the engine seats at any width, where one
 * made from a read's hook is unasked and waits for a wide terminal.
 */
type PaneOpen = (args: Parameters<Engine['ui']['open']>[0]) => Promise<PaneOpened>
let paneOpenAsked: PaneOpen | null = null

/**
 * Bring what the engine shows into line with `paneState`: every open and
 * close of the document pane goes through here, one pass at a time, each
 * reading the state afresh after the last open or close landed, until the
 * two agree. A call during a run asks for another pass, and what it asked
 * (`force`: open the pane again though drawn, for its title or because the
 * engine could not place it before; `focus`; `byPerson`: the open is the
 * person's own, made from their hook) is gathered for that pass, never
 * dropped; the call does not wait on the run, which another hook may be
 * driving (a wait on it would be on a plain promise, paid from the caller's
 * own budget). Answers the last open's result of the run it made, or null
 * when it made none or joined one.
 */
function settlePane(
  $: Engine,
  options: { force?: boolean; focus?: boolean; byPerson?: boolean } = {},
): Promise<PaneOpened | null> {
  if (options.force === true) paneForce = true
  if (options.focus === true) paneFocus = true
  if (options.byPerson === true) paneOpenAsked = args => $.ui.open(args)
  if (paneSettling !== null) {
    paneSettleAgain = true
    return Promise.resolve(null)
  }
  paneSettling = (async () => {
    let last: PaneOpened | null = null
    // Whether the run ended with work possibly left over (the passes ran out
    // with the state still changing under them, or the engine refused an
    // open or a close): asks gathered meanwhile get a run of their own.
    let isCut = false
    try {
      for (let pass = 0; pass < 6; pass += 1) {
        paneSettleAgain = false
        const isForced = paneForce || paneFocus
        const isFocus = paneFocus
        const open: PaneOpen = paneOpenAsked ?? (args => $.ui.open(args))
        paneForce = false
        paneFocus = false
        paneOpenAsked = null
        const want = (await read($, paneState)) === 'open' ? 'open' : 'closed'
        // What the engine shows, when this module does not know (its first
        // pass, a reload, a close of the person's): the engine's own record,
        // where it can be asked; a pass with no answer opens or closes outright.
        if (paneDrawn === 'unknown') paneDrawn = await drawnPane($)
        if (want === paneDrawn && !isForced) {
          if (!paneSettleAgain) return last
          continue
        }
        // What the engine shows is recorded only once it answered; an open or
        // close it refused leaves that unknown (so the next call tries again)
        // and says why, and this pass ends rather than ask again at once.
        try {
          if (want === 'open') {
            const current = await read($, doc)
            // One line, as the engine takes a title: a document's title may hold what it refuses.
            const title = lineOf(current === null ? 'Strata' : clip(current.title, 40))
            last = await open({ id: DOC_PANE, title, ...(isFocus ? { focus: true } : {}) })
            paneDrawn = 'open'
          } else {
            await $.ui.close({ id: DOC_PANE })
            // A hook of another plugin may answer a close without passing it on,
            // and the pane stays up: the engine's record says, and this pass
            // ends as a refused one does, for a new ask to try again.
            if ((await drawnPane($)) === 'open') {
              paneDrawn = 'unknown'
              toast($, 'Strata: the pane stayed open; another plugin kept it')
              isCut = true
              return last
            }
            paneDrawn = 'closed'
          }
        } catch (error) {
          paneDrawn = 'unknown'
          toast($, `Strata: the pane could not be ${want === 'open' ? 'opened' : 'closed'}: ${error instanceof Error ? error.message : String(error)}`)
          // This pass ends rather than ask the engine again at once; an ask
          // that came during it (the person's own open, say) still gets its run.
          isCut = true
          return last
        }
      }
      isCut = true
      return last
    } finally {
      paneSettling = null
      // A call that came during the last pass, or asks gathered for a pass
      // that never ran, are not dropped at the limit or at a refusal: another
      // bounded run takes them. Nothing asked anew, and a refused operation is
      // not tried again until something asks.
      if (isCut && (paneSettleAgain || paneForce || paneFocus || paneOpenAsked !== null)) void settlePane($).catch(noop)
    }
  })()
  return paneSettling
}

/** Whether the engine shows the document pane now, by its own record of this plugin's panes; unknown where it cannot be asked. */
async function drawnPane($: Engine): Promise<'open' | 'closed' | 'unknown'> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === DOC_PANE) ? 'open' : 'closed'
  } catch {
    return 'unknown'
  }
}

/**
 * Mark the pane open and show it as the person's own open, with focus when
 * asked; the document is followed again where the CLI can. Answers the
 * open's result, or null when a run of the reconciler another hook drives
 * will make the open.
 */
async function openPane($: Engine, focus: boolean): Promise<PaneOpened | null> {
  await step(async () => {
    paneOpens += 1
    await update($, paneState, () => 'open')
  })
  // Opened again even when drawn: the engine may not have placed it before (a narrow terminal).
  const opened = await settlePane($, { force: true, focus, byPerson: true })
  void syncWatch($, true).catch(noop)
  return opened
}

/**
 * Whether the person sees the document pane now: the engine's record, where
 * it can be asked (the pane placed on a surface and shown, not behind
 * another tab); else the state's word, drawn or not known to be down.
 */
async function isDocPaneShown($: Engine): Promise<boolean> {
  try {
    const pane = (await $.ui.panes()).find(one => one.id === DOC_PANE)
    return pane !== undefined && pane.isPlaced && pane.isShown
  } catch {
    return (await read($, paneState)) === 'open' && paneDrawn !== 'closed'
  }
}

/** Give the engine's pane the document's title as the view now has it, where the pane is open: a pass of the reconciler with an open asked. */
async function retitlePane($: Engine): Promise<void> {
  if ((await read($, paneState)) !== 'open') return
  await settlePane($, { force: true })
}

/**
 * Mark the pane closed: pending fetches apply nothing after this, and the
 * watch stops. Given `unlessOpenedSince` (the count of opens when the close
 * began), a close that waited marks nothing once an open landed meanwhile,
 * that being the newer action; answers whether it marked.
 */
async function closePane($: Engine, unlessOpenedSince?: number, sessionAt?: number): Promise<boolean> {
  return step(async () => {
    if (unlessOpenedSince !== undefined && paneOpens !== unlessOpenedSince) return false
    // A close begun in a session since ended marks nothing of the next session's pane.
    if (sessionAt !== undefined && sessionAt !== sessionSeq) return false
    await update($, paneState, () => 'closed')
    await update($, doc, view => (view === null ? view : { ...view, nav: view.nav + 1, isLoading: false }))
    return true
  })
}

// ---- The pane's document ------------------------------------------------

/**
 * What the model's read becomes: the ledger's row (a read the engine saved
 * to a file only moves a row's revision forward: the model holds the file,
 * not the text), the pane's view, and the pane's first unasked open. The
 * read is a navigation: a fetch out for the pane applies nothing after it.
 * Answers whether this read opened the pane.
 */
async function installRead(
  $: Engine,
  result: ReadResult,
  via: string,
  requested: readonly string[],
  now: number,
  options: { isFromFile: boolean; isAnnotated: boolean; canOpen: boolean; sessionAt: number },
): Promise<'opened' | 'installed' | 'discarded'> {
  return step(async () => {
    // The session ended while the read was out (its text in a file the engine saved): the next session's pane is not its.
    if (options.sessionAt !== sessionSeq) return 'discarded'
    await update($, server, () => via)
    // The pane may already hold a newer revision of this document (a live
    // snapshot landed while the read was out): the row's current revision
    // starts no lower, so the read shows stale at once.
    const held = await read($, doc)
    const known = held !== null && held.id === result.id && held.server === via ? Math.max(held.version, held.newerVersion ?? 0) : 0
    await update($, ledger, list =>
      forward(
        options.isFromFile ? forward(list, via, result.id, result.version, result.title) : remember(list, result, via, now, requested),
        via,
        result.id,
        known,
        '',
      ),
    )
    const view = await read($, doc)
    const nav = navOf(view) + 1
    // A read older than what the pane holds (a watch snapshot landed first)
    // of the pane's own document, through its server, leaves the pane's text
    // alone; it is still the latest navigation.
    const next =
      view !== null && view.id === result.id && view.server === via && result.version < view.version
        ? { ...view, nav, isLoading: false }
        : viewOf(result, via, view, { nav, isAnnotated: options.isAnnotated, url: knownUrl(via, result.id) })
    await update($, doc, () => next)
    if (!options.canOpen || !isAutoOpenWanted || (await read($, paneState)) !== 'unopened') return 'installed'
    paneOpens += 1
    await update($, paneState, () => 'open')
    return 'opened'
  })
}

/**
 * Take the pane's next navigation count for a fetch of `documentId`, with
 * the loading mark on the pane's document, or a placeholder for another
 * (`title` names it while the pane holds no text of it yet). Called inside
 * the step that decided on the fetch, so nothing comes between the decision
 * and the count: a close or a read queued behind that step moves the count
 * on, and the fetch's answer then applies nothing.
 */
async function reserveFetch($: Engine, view: StrataDocView | null, via: string, documentId: string, title: string): Promise<number> {
  const nav = navOf(view) + 1
  // The pane's own document, through the same server: its view is kept with
  // the loading mark on. Through another server, the document is set up anew
  // on that server: what the pane holds and every call it makes from here
  // (a comment, a suggestion, a refresh) go through the server that fetched.
  // A navigation: the draft goes with it here, as the text will; one opened
  // while the fetch is out is kept when the answer lands.
  await update($, doc, () =>
    view !== null && view.id === documentId && view.server === via
      ? { ...view, nav, isLoading: true, error: null, draft: null }
      : loadingView(documentId, title || view?.title || documentId, via, nav, knownUrl(via, documentId)),
  )
  return nav
}

/**
 * Read `path` of `documentId` (the whole document for null) from `via` into
 * the pane and show it: the navigation reserved in a step of its own, then
 * the fetch.
 */
async function fetchInto($: Engine, via: string, documentId: string, path: string | null, title = ''): Promise<void> {
  const mine = await step(async () => reserveFetch($, await read($, doc), via, documentId, title))
  await fetchReserved($, via, documentId, path, mine)
}

/** What came of a fetch: applied to the pane; failed, with the reason shown; stale, the pane having moved on. */
type Fetched = { outcome: 'applied' | 'stale' } | { outcome: 'failed'; reason: string }

/** Read what the pane shows again, the navigation reserved on the pane's document as the step sees it; null with no document. */
async function refreshPane($: Engine): Promise<{ view: StrataDocView; fetched: Fetched } | null> {
  const reserved = await step(async () => {
    const view = await read($, doc)
    if (view === null) return null
    return { view, nav: await reserveFetch($, view, view.server, view.id, view.title) }
  })
  if (reserved === null) return null
  const fetched = await fetchReserved($, reserved.view.server, reserved.view.id, reserved.view.section, reserved.nav)
  return { view: reserved.view, fetched }
}

/**
 * The fetch itself, under the navigation count `mine` already taken: its
 * answer is judged against the count when it lands, so a read of the
 * model's or another fetch begun after it wins. Answers what came of it.
 */
async function fetchReserved($: Engine, via: string, documentId: string, path: string | null, mine: number): Promise<Fetched> {
  const sessionAt = sessionSeq
  // The pane's document changed with the reservation, perhaps: the watch
  // follows it from here, whatever comes of the fetch, so a watch on the
  // document left behind does not keep its revisions from the polls.
  void syncWatch($, true).catch(noop)
  let landed: ReadResult | null = null
  let failure: string | null = null
  try {
    // The whole budget: an explicit fetch is for the text, not an outline.
    const args: Record<string, unknown> = { documentId, maxTokens: WHOLE_READ_TOKENS }
    if (path !== null) args.sections = [path]
    const answer = await $.mcp.call(via, 'read_document', args)
    const text = textOf(answer)
    if (answer.isError) throw new Error(text || 'the read failed')
    landed = parseReadResult(text)
    if (landed === null) throw new Error('the read answered no document')
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  const result = landed
  const outcome = await step(async (): Promise<'applied' | 'failed' | 'stale'> => {
    // The session ended under the fetch: the next session's pane is not this fetch's to fill.
    if (sessionAt !== sessionSeq) return 'stale'
    const view = await read($, doc)
    // The pane moved on (a read of the model's, a later fetch, a close): this answer says nothing now.
    if (view === null || view.nav !== mine) return 'stale'
    if (result === null) {
      await update($, doc, () => ({ ...view, isLoading: false, error: failure }))
      return 'failed'
    }
    await update($, doc, () =>
      view.id === result.id && view.server === via
        ? fetchedView(view, result, path)
        : viewOf(result, via, view, { nav: mine, url: knownUrl(via, result.id) }),
    )
    // The revision fetched is known: a ledger row of the document now marks the model's read stale if it is older.
    await update($, ledger, list => forward(list, via, result.id, result.version, result.title))
    paneOpens += 1
    await update($, paneState, () => 'open')
    return 'applied'
  })
  if (outcome === 'failed') {
    const reason = failure ?? 'the read failed'
    toast($, `Strata: ${reason}`)
    return { outcome, reason }
  }
  if (outcome !== 'applied' || result === null) return { outcome: 'stale' }
  // Opened again even when drawn: the engine may not have placed it before.
  void settlePane($, { force: true }).catch(noop)
  void requestThreads($, via, result.id).catch(noop)
  void syncWatch($, true).catch(noop)
  // The cursor was cleared with the text: collaborators see no section until it moves again.
  void shareCursor($).catch(noop)
  return { outcome }
}

/** Show `path` from what the pane holds, fetching it when it holds no such section. */
async function showSection($: Engine, onDocument: DocumentRef, path: string | null): Promise<void> {
  const fetch = await step(async (): Promise<{ via: string; id: string; nav: number } | null> => {
    const view = await read($, doc)
    // The press is for the document its button was drawn on, through its server: the pane may show another by now.
    if (view === null || !isViewOf(view, onDocument)) return null
    // Named as the whole document names them: text held as sections has its
    // headings' paths rebased through those sections.
    const local = outlineOf(view.markdown)
    const named = !view.isWhole && view.sectionsHeld.length > 0 ? rebaseOutline(local, view.sectionsHeld) : local
    const held = view.markdown !== '' && (path === null ? view.isWhole : named.some(entry => entry.path === path))
    // A section not held is fetched, its navigation reserved here, in the step that decided it.
    if (!held) return { via: view.server, id: view.id, nav: await reserveFetch($, view, view.server, view.id, view.title) }
    // A local move is a navigation too: an older fetch answering after it applies nothing, and the draft goes with the text.
    await update($, doc, () => ({
      ...view,
      nav: view.nav + 1,
      section: path,
      revealed: [],
      error: null,
      isLoading: false,
      cursor: null,
      anchor: null,
      draft: null,
    }))
    return null
  })
  if (fetch === null) {
    // The cursor was cleared: collaborators see no section until it moves again.
    void shareCursor($).catch(noop)
    return
  }
  await fetchReserved($, fetch.via, fetch.id, path, fetch.nav)
}

async function toggleFence($: Engine, onDocument: DocumentRef, drawnText: string, inSection: string | null, index: number): Promise<void> {
  await step(() =>
    update($, doc, view => {
      // The fence the button was drawn for: numbered in the very text it was
      // drawn from (the held text and the section shown of it, of the
      // document on its own server); other text, even of the same document
      // and revision, numbers its fences afresh.
      if (view === null || !isViewOf(view, onDocument) || view.markdown !== drawnText || view.section !== inSection) return view
      const revealed = view.revealed.includes(index) ? view.revealed.filter(one => one !== index) : [...view.revealed, index]
      // The blocks are cut afresh with the fence shown or folded (a large one
      // can push the pane's cut before the selection): the cursor drops rather
      // than land on another paragraph.
      return { ...view, revealed, cursor: null, anchor: null }
    }),
  )
  void shareCursor($).catch(noop)
}

/**
 * Mark the pane's document as newer on the server than what it draws, when
 * `info` says so, and take the server's own link for it either way (a pane
 * opened from the explorer starts with a guessed one).
 */
async function markNewer(
  $: Engine,
  via: string,
  id: string,
  info: { version: number; url: string | null },
  sessionAt: number,
): Promise<void> {
  if (info.url !== null) {
    const wasKnown = knownUrls.has(urlKey(via, id))
    knownUrls.set(urlKey(via, id), info.url)
    // A link first learned here (a poll's, after a lookup that failed at a
    // watch's start) may make the document one the CLI can follow: the
    // watch is reconciled, not waited on.
    if (!wasKnown) void syncWatch($, true).catch(noop)
  }
  const stale = await step(async () => {
    // The revision is known of the document wherever it is held: a ledger row
    // of it moves forward too, and one that turns stale by it says so once.
    let turned: StrataLoadedDoc | null = null
    if (sessionAt === sessionSeq) {
      const rows = await read($, ledger)
      if (becomesStale(rows, via, id, info.version)) turned = rows.find(row => isRowOf(row, via, id)) ?? null
      await update($, ledger, () => forward(rows, via, id, info.version, ''))
    }
    await update($, doc, view => {
      // Nothing of a session ended since the poll began, nor of the document through another server.
      if (sessionAt !== sessionSeq || view === null || view.id !== id || view.server !== via) return view
      const url = info.url ?? view.url
      // The latest revision known: an older poll's answer, landing later, lowers nothing.
      const newerVersion = info.version > view.version ? Math.max(info.version, view.newerVersion ?? 0) : view.newerVersion
      return url === view.url && newerVersion === view.newerVersion ? view : { ...view, url, newerVersion }
    })
    return turned
  })
  if (stale !== null) {
    toast($, `Strata: "${clip(stale.title, 32)}" changed since Claude read it (v${String(stale.versionAtRead)} → v${String(info.version)})`)
  }
}

// ---- The cursor and the draft -------------------------------------------

/** Move the cursor `delta` blocks, onto the first or last when it rests nowhere, and scroll to it. */
async function moveCursor($: Engine, delta: number): Promise<void> {
  const landed = await step(async (): Promise<number | null> => {
    const view = await read($, doc)
    if (view === null) return null
    const count = shownOf(view).blocks.length
    if (count === 0) return null
    const cursor = view.cursor === null ? (delta < 0 ? count - 1 : 0) : Math.max(0, Math.min(count - 1, view.cursor + delta))
    await update($, doc, () => ({ ...view, cursor }))
    return cursor
  })
  if (landed === null) return
  void shareCursor($).catch(noop)
  await $.ui.scroll({ to: { key: `b${String(landed)}` }, in: DOC_PANE, block: 'nearest' }).catch(noop)
}

/** Start extending the selection from the cursor, or go back to one block. */
async function toggleAnchor($: Engine): Promise<void> {
  await step(() =>
    update($, doc, view => {
      if (view === null) return view
      const cursor = view.cursor ?? 0
      return { ...view, cursor, anchor: view.anchor === null ? cursor : null }
    }),
  )
}

/** Clear the cursor, and any draft with it: nothing reopens after a clear. */
async function clearCursor($: Engine): Promise<void> {
  await step(() => update($, doc, view => (view === null ? view : { ...view, cursor: null, anchor: null, draft: null })))
  void shareCursor($).catch(noop)
}

/** Close the draft the cancel was drawn for, and no other: one opened since stays, with its text. */
async function cancelDraft($: Engine, id: string, draftId: string): Promise<void> {
  await step(() =>
    update($, doc, view =>
      view === null || view.id !== id || view.draft === null || view.draft.id !== draftId ? view : { ...view, draft: null },
    ),
  )
}

/**
 * Keep what the person typed in the draft `draftId` of document `id`, so a
 * redraw (a snapshot, a roster change) draws the field with it. Typing meant
 * for another draft, delivered late, changes nothing. Text the draft posted
 * already (the person typed on while the post was in flight) is dropped
 * from what the older field hands over, by its generation.
 */
async function keepDraftText($: Engine, draftId: string, field: number, value: string): Promise<void> {
  // The field holds only so much as drawn (the pane must stay drawable with
  // it): a paste past that is not taken, and says so.
  if (drawnSize(value) > DRAFT_MAX) {
    toast($, `Strata: the field holds at most ${String(DRAFT_MAX)} characters; the paste was not taken`)
    // A fresh value, the same draft: the redraw puts the field back to it.
    await step(() => update($, doc, view => (view === null ? view : { ...view })))
    return
  }
  await step(async () => {
    const view = await read($, doc)
    const draft = view === null ? null : view.draft
    if (view === null || draft === null || draft.id !== draftId) return
    // A value from the field as drawn before the last post's redraw carries
    // the posted text in front, which `posted` remembers; one from before an
    // earlier post's redraw carries more than that, and one arriving after
    // the redrawn field has spoken (an edit at its generation cleared the
    // posted text) is behind that edit. Either would put posted text back.
    if (field !== draft.field && (field !== draft.field - 1 || draft.posted === null)) return
    const kept = reconcile(draft, field, value)
    if (draft.isClosed) {
      // The field of a draft a post just closed, still drawn until its
      // redraw: typing into it reopens the draft with what came after the
      // posted text. The posted text stays known: the old field may hand
      // over more values before it is redrawn.
      if (kept.trim() === '') return
      await update($, doc, () => ({ ...view, draft: { ...draft, text: kept, isClosed: false } }))
      return
    }
    // A value from the field as last drawn: the posted text is behind the field now.
    const posted = field === draft.field ? null : draft.posted
    if (draft.text === kept && draft.posted === posted) return
    await update($, doc, () => ({ ...view, draft: { ...draft, text: kept, posted } }))
  })
}

/** Open the pane's field for a comment, a reply, a suggestion or a question, and put the focus on it. */
async function openDraft(
  $: Engine,
  kind: StrataDraft['kind'],
  replyTo: string | null,
  onDocument: DocumentRef | null = null,
): Promise<void> {
  // The field's key, once the draft is placed: what the focus goes to.
  const placed = await step(async (): Promise<string | null> => {
    const view = await read($, doc)
    if (view === null) return null
    // A reply is to a thread of the document its button was drawn for, through
    // its server: the pane may show another by the time the press lands.
    if (onDocument !== null && !isViewOf(view, onDocument)) {
      toast($, 'Strata: the pane moved to another document; the thread is not on this one')
      return null
    }
    const { blocks, origin } = shownOf(view)
    const selection = selectionOf(view, blocks.length)
    // A question quotes what the pane shows; a comment or a suggestion anchors
    // to the document's own text, which must be one run the person saw whole.
    const quoted =
      selection === null ? '' : kind === 'ask' ? quotedOf(blocks, selection) : (anchoredOf(view, blocks, origin, selection) ?? '')
    if (kind !== 'reply' && quoted === '') {
      toast($, 
        selection === null
          ? 'Strata: move the cursor onto a paragraph first (j and k)'
          : 'Strata: pick one run of text with no html embed in it; a comment or suggestion anchors to the document as written',
      )
      return null
    }
    if ((kind === 'comment' || kind === 'suggest') && view.isAnnotated) {
      toast($, 'Strata: this text was read with comments or suggestions folded in; press r for the plain text, then anchor to it')
      return null
    }
    if ((kind === 'comment' || kind === 'suggest') && view.isAmbiguous) {
      toast($, 
        'Strata: these sections were read together and a heading could belong to either; press r for the whole document, then anchor to it',
      )
      return null
    }
    // A replacement starts as the selected text in the field, which holds only so much.
    if (kind === 'suggest' && drawnSize(quoted) > DRAFT_MAX) {
      toast($, 'Strata: the selection is too long to edit in the pane; pick a shorter run, or ask Claude for the change')
      return null
    }
    if (kind === 'reply' && replyTo === null) return null
    const first = selection === null ? undefined : blocks[selection.from]
    const heading = first === undefined ? [] : headingContextOf(view, origin, first)
    // The server anchors by the quoted text and the headings over it: the same
    // text twice under the same headings, and it could anchor to the other one.
    if ((kind === 'comment' || kind === 'suggest') && occurrencesUnder(view, quoted, heading) > 1) {
      toast($, 
        'Strata: this text appears more than once under the same heading, so the server could anchor to the other one; pick a longer run (v, then j or k) that appears once',
      )
      return null
    }
    // The draft goes on the document the selection came from, at the revision
    // it was read from. The field's text is the display copy of the selection
    // (what the field draws and hands back); the anchor keeps the text as written.
    const draft: StrataDraft = {
      id: Math.random().toString(36).slice(2, 10),
      kind,
      text: kind === 'suggest' ? drawable(quoted) : '',
      replyTo,
      quoted,
      heading,
      version: view.version,
      field: 0,
      posted: null,
      isPosting: false,
      isClosed: false,
    }
    await update($, doc, () => ({ ...view, draft }))
    return `draft-${draft.id}-${String(draft.field)}`
  })
  if (placed !== null) await $.ui.focus({ requestId: DOC_PANE, key: placed }).catch(noop)
}

/** Put the selection into the prompt as a blockquote, at the caret. */
async function quoteToPrompt($: Engine): Promise<void> {
  const view = await read($, doc)
  if (view === null) return
  const { blocks } = shownOf(view)
  const selection = selectionOf(view, blocks.length)
  const quoted = selection === null ? '' : quotedOf(blocks, selection)
  if (quoted === '') {
    toast($, 'Strata: move the cursor onto a paragraph first (j and k)')
    return
  }
  try {
    // On a line of its own, wherever the caret is: a quote that began
    // mid-line would not read as quoted lines to the mention expansion, and
    // an `@strata:` the document text spells could then read in a document
    // nobody asked for. A blank line after it: what is typed next is no
    // lazy run-on of the quote, and its mentions count. Every line ending
    // the mention scan reads (a CRLF, a bare carriage return, a line feed)
    // starts a quoted line, so no line of the text escapes the quote.
    const filled = await $.prompt.fill({
      text: quoteForPrompt(quoted),
      mode: 'insert',
    })
    if (!filled.isFilled) toast($, 'Strata: the prompt could not take the quote')
  } catch (error) {
    toast($, `Strata: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The draft after a post took `value` from its field (`isPosted`), or after
 * Enter on an empty field posted nothing: what was typed since stays in
 * the field, under a new generation for a post; nothing typed since, and
 * the draft is closed.
 */
function settled(draft: StrataDraft, value: string, isPosted: boolean): StrataDraft {
  // Leading newlines go, indentation stays: a replacement's line of code keeps its own.
  const rest = draft.text.startsWith(value) ? draft.text.slice(value.length).replace(/^\n+/, '') : draft.text
  const isKept = rest.trim() !== ''
  // The field is redrawn without the posted text: a new generation, so a
  // value the old field hands over is known to carry that text in front
  // (an empty replacement posted, a deletion, redraws it the same: an
  // Enter from the old drawing must not propose the deletion again). Enter
  // on an empty field posted nothing, and the field as redrawn holds what
  // the old one does: the generation stays, and nothing is remembered as posted.
  const field = isPosted ? draft.field + 1 : draft.field
  return { ...draft, text: rest, posted: isPosted ? value : null, field, isPosting: false, isClosed: !isKept }
}

/** What a post takes from the pane: the document, the draft as it stood, the text to send, the value Enter came with, and the session it was taken in. */
type Post = {
  id: string
  server: string
  title: string
  draft: StrataDraft
  text: string
  replacement: string
  value: string
  sessionAt: number
}

/**
 * Take what the pane's field holds for the draft `draftId` as a post: a
 * comment, a reply, a suggestion, or a question to Claude, judged and marked
 * in flight in one step; `completePost` then makes it. A submission meant
 * for another draft, delivered late, posts nothing; nor does a second one
 * for a draft whose post is still in flight. Answers the post to make, or
 * null for none.
 */
function submitDraft($: Engine, draftId: string, field: number, value: string): Promise<Post | null> {
  return step(async (): Promise<Post | null> => {
    const view = await read($, doc)
    const draft = view === null ? null : view.draft
    if (view === null || draft === null || draft.id !== draftId || draft.isClosed || draft.isPosting) return null
    // An Enter from the field as drawn before a post's settlement redrew it:
    // what it carries is part posted already, part not. The redrawn field
    // shows the rest, and Enter there posts it.
    if (field !== draft.field) {
      toast($, 'Strata: the field was redrawn after the post; press Enter again to post the rest')
      return null
    }
    if (drawnSize(value) > DRAFT_MAX) {
      toast($, `Strata: the field holds at most ${String(DRAFT_MAX)} characters; shorten the text to post it`)
      return null
    }
    const text = value.trim()
    // A replacement keeps its indentation (a line of code, a nested list item);
    // only the newlines a field adds at the end go.
    const replacement = value.replace(/\n+$/, '')
    // Enter on an empty field closes the draft, through the same settlement
    // as a post: typing that came since Enter stays in the field. A
    // suggestion is the exception: an empty replacement proposes a deletion.
    if (text === '' && draft.kind !== 'suggest') {
      await update($, doc, () => ({ ...view, draft: settled(draft, value, false) }))
      return null
    }
    // The anchor, judged again at the post: the text held may have changed
    // since the draft opened (a live snapshot keeps the draft), and the
    // passage may be gone from it, or occur twice under its heading now. The
    // field keeps what was typed either way.
    if (draft.quoted !== '' && (draft.kind === 'comment' || draft.kind === 'suggest')) {
      const count = occurrencesUnder(view, draft.quoted, draft.heading)
      if (count !== 1) {
        toast($, 
          count === 0
            ? 'Strata: the passage is no longer in the text held, so the post has nowhere to anchor; cancel the draft and open one on the passage as it reads now'
            : 'Strata: the passage now appears more than once under the same heading, so the server could anchor to the other one; cancel the draft and open one on a longer run that appears once',
        )
        return null
      }
    }
    if (draft.kind === 'suggest' && draft.quoted === '') {
      toast($, 'Strata: pick the paragraph to change first')
      return null
    }
    // Compared as the field holds the selection: its display copy, the
    // newlines a field adds at the end gone from both sides alike.
    if (draft.kind === 'suggest' && replacement === drawable(draft.quoted).replace(/\n+$/, '')) {
      toast($, 'Strata: the replacement is the same text')
      return null
    }
    // The field's text from here: the value Enter came with when the stored
    // text is that value apart from the line breaks a field adds at the end
    // (what no keystroke stored); else what the keystrokes stored, which an
    // Enter held up in the chain while typing went on must not undo, whether
    // the typing went on from the value or changed it. The settlement then
    // keeps what was typed beyond the value, or all of it.
    const trimmedEnd = (one: string): string => one.replace(/\n+$/, '')
    const held = trimmedEnd(draft.text) === trimmedEnd(value) ? value : draft.text
    await update($, doc, () => ({ ...view, draft: { ...draft, text: held, isPosting: true } }))
    // The session the post is of, taken in this step: a session's end queued behind it moves the count on, not this post.
    return { id: view.id, server: view.server, title: view.title, draft, text, replacement, value, sessionAt: sessionSeq }
  })
}

/** Make the post `submitDraft` took, and settle the draft after it: what was typed since stays in the field. */
async function completePost($: Engine, post: Post): Promise<void> {
  const { value, sessionAt } = post
  // The session ended between the taking and the making: nothing is written for it, nor into the next.
  if (sessionAt !== sessionSeq) return
  // What the draft was opened on, not what the pane shows now: a live edit
  // may have moved the blocks under the cursor since.
  const { draft, text, replacement } = post
  const quoted = draft.quoted
  const heading = draft.heading
  const context = heading.length > 0 ? { headingContext: heading } : {}
  let failure: string | null = null
  try {
    switch (draft.kind) {
      case 'comment':
      case 'reply': {
        const args =
          draft.kind === 'reply'
            ? { documentId: post.id, body: text, parentCommentId: draft.replyTo }
            : { documentId: post.id, body: text, ...(quoted !== '' ? { quotedText: quoted } : {}), ...context }
        const answer = await $.mcp.call(post.server, 'create_comment', args)
        if (answer.isError) throw new Error(textOf(answer) || 'the comment was refused')
        const made = idIn(textOf(answer), ['commentId', 'id'])
        if (made !== null && draft.kind === 'comment') {
          await recordReview($, {
            kind: 'comment',
            id: made,
            documentId: post.id,
            documentTitle: post.title,
            server: post.server,
            summary: clip(text.replace(/\s+/g, ' '), 60),
            status: 'pending',
            origin: 'pane',
          }, sessionAt)
        }
        toast($, draft.kind === 'reply' ? 'Strata: reply posted' : 'Strata: comment posted')
        break
      }
      case 'suggest': {
        // Anchored by the quoted text and its heading breadcrumbs, as the
        // model's own proposals are: the server takes a base version only
        // with a block anchor beside it, which the pane does not compute.
        const answer = await $.mcp.call(post.server, 'propose_suggestion', {
          documentId: post.id,
          originalText: quoted,
          replacementText: replacement,
          ...context,
          severity: 'improvement',
          rationale: 'Proposed from the Strata pane in Claude Code.',
        })
        if (answer.isError) throw new Error(textOf(answer) || 'the suggestion was refused')
        const made = idIn(textOf(answer), ['suggestionId', 'id'])
        if (made !== null) {
          await recordReview($, {
            kind: 'suggestion',
            id: made,
            documentId: post.id,
            documentTitle: post.title,
            server: post.server,
            summary: clip(replacement.split('\n').find(line => line.trim() !== '') ?? (replacement === '' ? '(deletion)' : text), 60),
            status: 'pending',
            origin: 'pane',
          }, sessionAt)
        }
        toast($, replacement === '' ? 'Strata: deletion proposed as a suggestion' : 'Strata: suggestion proposed')
        break
      }
      case 'ask': {
        const where = heading.length > 0 ? ` under "${heading.join(' > ')}"` : ''
        const quote =
          quoted === ''
            ? ''
            : `\n\n${quoted
                .split('\n')
                .map(line => `> ${line}`)
                .join('\n')}\n`
        const asked = await $.prompt.submit({
          // The server named with the document: two servers may each hold one of this id, and the model reads from the right one.
          text: `About this passage of the Strata document "${post.title}" (${post.id}, read with the ${readToolOf(post.server)} tool)${where}:${quote}\n${text}`,
        })
        // A question a hook beneath dropped never reached the conversation: the field keeps it.
        if (asked.drop !== undefined) throw new Error(`the question was not sent: ${String(asked.drop)}`)
        break
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  // The settlement: every keystroke that came before it is in the draft's
  // text already; one behind it hands over the older field's value, known by
  // its generation.
  const isKept = await step(async (): Promise<boolean> => {
    // The session ended under the post: the next session's pane holds no draft of this one's.
    if (sessionAt !== sessionSeq) return false
    const view = await read($, doc)
    const current = view === null ? null : view.draft
    if (view === null || current === null || current.id !== draft.id) return false
    const next = failure !== null ? { ...current, isPosting: false } : settled(current, value, true)
    await update($, doc, () => ({ ...view, draft: next }))
    return failure === null && !next.isClosed
  })
  if (failure !== null) {
    toast($, `Strata: ${failure}`)
    return
  }
  if (sessionAt !== sessionSeq) return
  if (isKept) toast($, 'Strata: posted; what you typed since stays in the field')
  if (draft.kind !== 'ask') void requestThreads($, post.server, post.id).catch(noop)
}

/** Resolve or reopen a thread from the pane. */
async function settleThread($: Engine, onDocument: DocumentRef, thread: StrataThread, resolved: boolean): Promise<void> {
  const sessionAt = sessionSeq
  const view = await read($, doc)
  if (view === null) return
  // The thread belongs to the document its button was drawn for, through its
  // server: the pane may show another by the time the press lands.
  if (!isViewOf(view, onDocument)) {
    toast($, 'Strata: the pane moved to another document; the thread is not on this one')
    return
  }
  try {
    const answer = await $.mcp.call(view.server, 'set_comment_resolved', {
      documentId: view.id,
      commentId: thread.id,
      resolved,
    })
    if (answer.isError) throw new Error(textOf(answer) || 'refused')
    if (sessionAt !== sessionSeq) return
    // The thread's row in the review queue is settled from the listing this
    // loads, which holds the server's state after this change and any later one.
    await requestThreads($, view.server, view.id)
  } catch (error) {
    toast($, `Strata: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** The server to call: the one last seen, else the public plugin's. */
async function serverFor($: Engine): Promise<string> {
  return (await read($, server)) ?? DEFAULT_SERVER
}

/** The model's read tool through `via`, as its tool list names it: what a prompt names so the model reads from the right server. */
function readToolOf(via: string): string {
  return `mcp__${via}__read_document`
}

// ---- The comment threads ------------------------------------------------

/** A listing in flight per document and server: asked for again while out, it lists once more after, so the last ask always sees a listing begun after it; an ask of a session ended since lists nothing. */
const threadsRuns = new Map<string, { again: boolean; sessionAt: number; done: Promise<void> }>()

/** Fetch the document's comment threads, through `via`, into the pane and the review queue. Settles once a listing begun after this ask is in. */
function requestThreads($: Engine, via: string, documentId: string): Promise<void> {
  const key = urlKey(via, documentId)
  const running = threadsRuns.get(key)
  if (running !== undefined) {
    running.again = true
    running.sessionAt = sessionSeq
    return running.done
  }
  const run = { again: true, sessionAt: sessionSeq, done: Promise.resolve() }
  threadsRuns.set(key, run)
  run.done = (async () => {
    try {
      while (run.again) {
        run.again = false
        const sessionAt = run.sessionAt
        if (sessionAt !== sessionSeq) break
        let answer
        try {
          answer = await $.mcp.call(via, 'list_comments', { documentId })
        } catch {
          continue
        }
        if (answer.isError) continue
        const threads = threadsOf(textOf(answer))
        await step(async () => {
          // The session ended under the listing: the next session's pane and
          // queue are not this listing's. Nor is the document through another
          // server: its threads are that server's.
          if (sessionAt !== sessionSeq) return
          await update($, doc, view =>
            view === null || view.id !== documentId || view.server !== via ? view : { ...view, threads },
          )
          // The listing is what the server holds: the review queue's rows for
          // these threads are settled from it, never from what a resolve or a
          // reopen asked. A thread the listing leaves out (deleted, or past
          // its truncation) keeps its row.
          const byId = new Map(threads.map(one => [one.id, one]))
          await update($, review, list =>
            list.map(row => {
              if (row.kind !== 'comment' || row.documentId !== documentId || row.server !== via) return row
              const listed = byId.get(row.id)
              if (listed === undefined) return row
              const status = listed.status === 'resolved' ? 'resolved' : 'pending'
              return row.status === status ? row : { ...row, status }
            }),
          )
        })
      }
    } finally {
      threadsRuns.delete(key)
    }
  })()
  return run.done
}

// ---- The revisions the band tracks --------------------------------------

let isPolling = false
let pollAgain = false
/** The servers that showed they predate `find` with `intent: 'info'`: not asked again this process; another server is asked all the same. */
const pollUnsupported = new Set<string>()

/** Check the revisions of the documents read and shown; one check at a time, and once more when asked during one. */
async function checkRevisions($: Engine): Promise<void> {
  if (isPolling) {
    pollAgain = true
    return
  }
  isPolling = true
  try {
    do {
      pollAgain = false
      await pollOnce($)
    } while (pollAgain)
  } finally {
    isPolling = false
  }
}

/**
 * Ask the server for the current revision of the most recently read
 * documents, and of the pane's document: when the model never read it (an
 * explorer pick), or read a newer revision than the pane draws (a mention),
 * the pane is marked on its own, apart from the model's ledger.
 */
async function pollOnce($: Engine): Promise<void> {
  const sessionAt = sessionSeq
  const list = await read($, ledger)
  // A bounded batch per tick, rotating through the ledger so every document
  // the model read is checked in turn, not the newest few over and over.
  const polled: StrataLoadedDoc[] = []
  if (list.length > 0) {
    const start = pollOffset % list.length
    for (let n = 0; n < Math.min(POLL_DOCS, list.length); n += 1) {
      const row = list[(start + n) % list.length]
      if (row !== undefined) polled.push(row)
    }
    pollOffset = (start + POLL_DOCS) % list.length
  }
  const shown = await read($, doc)
  // Whether the watch reports a document's revisions now: it follows the
  // pane's document and is connected. Starting, reconnecting or failed, it
  // reports nothing, and the polls cover the document meanwhile.
  const isLive = (via: string, id: string): boolean =>
    watching !== null &&
    watching.id === id &&
    watching.server === via &&
    shown !== null &&
    isViewOf(shown, { id, server: via }) &&
    shown.live === 'connected'
  if (shown !== null) {
    const isWatched = isLive(shown.server, shown.id)
    // Asked about on its own when the ledger polls below will not: not among
    // their rows (the document through the pane's own server), or followed by
    // the watch, which reports revisions but not the server's link for it
    // (asked once, then, until the link is known).
    const isPolledBelow = !isWatched && polled.some(row => row.id === shown.id && row.server === shown.server)
    if (!isPolledBelow && !(isWatched && knownUrls.has(urlKey(shown.server, shown.id))) && !pollUnsupported.has(shown.server)) {
      try {
        const answer = await $.mcp.call(shown.server, 'find', { intent: 'info', scope: { type: 'document', id: shown.id } })
        const info = answer.isError ? null : infoOf(textOf(answer))
        if (info !== null) await markNewer($, shown.server, shown.id, info, sessionAt)
      } catch {
        // Nothing to mark; the next poll asks again.
      }
    }
  }
  for (const row of polled) {
    // A connected watch reports this document's revisions itself; a server without `info` is not asked.
    if (isLive(row.server, row.id) || pollUnsupported.has(row.server)) continue
    let answer
    try {
      answer = await $.mcp.call(row.server, 'find', { intent: 'info', scope: { type: 'document', id: row.id } })
    } catch {
      // One document's failure (a transport error, a server that no longer
      // has it) does not starve the rest of the batch.
      continue
    }
    // The session ended under the poll: the next session's ledger is not this poll's to mark.
    if (sessionAt !== sessionSeq) return
    const text = textOf(answer)
    if (answer.isError) {
      // A server from before `info` on a document: not asked again.
      if (/intent|scope|invalid|unknown/i.test(text)) pollUnsupported.add(row.server)
      continue
    }
    const info = infoOf(text)
    if (info === null) continue
    const isStaleNow = await step(async () => {
      if (sessionAt !== sessionSeq) return false
      const rows = await read($, ledger)
      const becameStale = becomesStale(rows, row.server, row.id, info.version)
      await update($, ledger, () => forward(rows, row.server, row.id, info.version, info.title))
      if (info.url !== null) {
        const url = info.url
        await update($, doc, view =>
          view === null || view.id !== row.id || view.server !== row.server || view.url === url ? view : { ...view, url },
        )
      }
      return becameStale
    })
    if (isStaleNow) {
      toast($, `Strata: "${clip(row.title, 32)}" changed since Claude read it (v${String(row.versionAtRead)} → v${String(info.version)})`)
    }
    // The pane may draw an older revision than the ledger records (a mention
    // read since, which the pane does not follow): marked in the pane too,
    // when the pane holds the document through this row's server. After the
    // ledger's own step, which has already told of the change.
    if (shown !== null && row.id === shown.id && row.server === shown.server) await markNewer($, row.server, row.id, info, sessionAt)
  }
}

let isRefreshing = false

/** Re-read every stale document and hand the model the current text as a note; one run at a time. */
async function refreshStale($: Engine): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    await refreshOnce($)
  } finally {
    isRefreshing = false
  }
}

async function refreshOnce($: Engine): Promise<void> {
  const sessionAt = sessionSeq
  const stale = (await read($, ledger)).filter(row => row.versionNow > row.versionAtRead)
  const now = await $.clock.now()
  let refreshed = 0
  for (const row of stale) {
    // The session ended under the refresh: the next conversation is not handed the old one's documents.
    if (sessionAt !== sessionSeq) return
    // The pane's text is replaced only while the pane still shows what it
    // showed when this read began: a navigation since (a section picked,
    // another document opened) is the newer action, and the pane is left as
    // it is, while the ledger and the model's context are refreshed all the same.
    const navAt = navOf(await read($, doc))
    let answer
    try {
      answer = await $.mcp.call(row.server, 'read_document', {
        documentId: row.id,
        // The whole budget, so what the model held as text comes back as text.
        ...(row.coverage === 'outline' ? {} : { maxTokens: WHOLE_READ_TOKENS }),
        ...(row.sectionsRead.length > 0 ? { sections: row.sectionsRead } : {}),
      })
    } catch (error) {
      toast($, `Strata: could not re-read "${clip(row.title, 32)}": ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const text = textOf(answer)
    const result = answer.isError ? null : parseReadResult(text)
    if (result === null) {
      toast($, `Strata: could not re-read "${clip(row.title, 32)}"`)
      continue
    }
    // The note reaches the model first; only then is the read recorded, since
    // a refused note leaves the model with the old text. Not a model of a
    // later session: a read answering after a `/clear` hands it nothing.
    if (sessionAt !== sessionSeq) return
    const body = result.markdown !== '' ? result.markdown : JSON.stringify(result.outline)
    const note =
      `The Strata document "${result.title}" (${result.id}, read with the ${readToolOf(row.server)} tool) changed since you read it ` +
      `(revision ${row.versionAtRead} → ${result.version}). Its current text, as read_document returns it:\n\n${body}`
    const appended = await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: note }] },
    })
    if (appended.deny !== undefined) {
      toast($, `Strata: could not hand "${clip(row.title, 32)}" to the model: ${appended.deny}`)
      continue
    }
    // The row as stored is what the model reads: a hook beneath may have
    // rewritten it. The read is recorded only when the note is in it; else
    // the revision is known all the same, and the row stays marked stale.
    const isHeld = appended.message.content.some(block => block.type === 'text' && block.text === note)
    if (isHeld) refreshed += 1
    else toast($, `Strata: a hook rewrote the note handing "${clip(row.title, 32)}" to the model; it still holds the old text`)
    const isShown = await step(async () => {
      if (sessionAt !== sessionSeq) return false
      // The row's current revision starts no lower than the pane's own of the document.
      const held = await read($, doc)
      const known = held !== null && held.id === result.id && held.server === row.server ? Math.max(held.version, held.newerVersion ?? 0) : 0
      await update($, ledger, rows =>
        forward(
          isHeld
            ? remember(rows, result, row.server, now, row.sectionsRead, true)
            : forward(rows, row.server, result.id, result.version, result.title),
          row.server,
          result.id,
          known,
          '',
        ),
      )
      let isApplied = false
      await update($, doc, view => {
        if (
          view === null ||
          view.id !== result.id ||
          view.server !== row.server ||
          view.nav !== navAt ||
          result.version < view.version
        ) {
          return view
        }
        isApplied = true
        return viewOf(result, row.server, view, { nav: view.nav, url: knownUrl(row.server, result.id) })
      })
      return isApplied
    })
    if (!isShown) continue
    // The re-read text cleared the cursor: collaborators see that. The pane takes the title as re-read.
    void shareCursor($).catch(noop)
    void retitlePane($).catch(noop)
  }
  if (refreshed > 0) toast($, `Strata: re-read ${String(refreshed)} document${refreshed === 1 ? '' : 's'} for the model`)
}

// ---- The review queue ---------------------------------------------------

/**
 * Settlements that arrived before their item was in the queue (a
 * collaborator accepted a suggestion while its proposal's answer was still
 * on the way): applied when the item is recorded. Bounded.
 */
const earlySettled = new Map<string, StrataReviewItem['status']>()

/** A queue item as the module tells items apart: its kind, the server it was made through, and its id there. */
type ReviewRef = { kind: StrataReviewItem['kind']; server: string; id: string }
const reviewKey = (ref: ReviewRef): string => `${ref.kind}\u0000${ref.server}\u0000${ref.id}`
/** A queue item's address in the explorer's drawing: its kind, server and id, so two servers' items of one id are two controls. */
const addressOf = (ref: ReviewRef): string => `${ref.kind}-${ref.server}-${ref.id}`
const isItemOf = (one: StrataReviewItem, ref: ReviewRef): boolean => one.kind === ref.kind && one.server === ref.server && one.id === ref.id

/** Put `item` in the review queue, unless the session it was made in (`sessionAt`) has ended since. */
async function recordReview($: Engine, item: StrataReviewItem, sessionAt: number): Promise<void> {
  const isRecorded = await step(async () => {
    if (sessionAt !== sessionSeq) return false
    // A settlement kept for it, else the status a row for it has already (a listing's, a settlement's), else its own.
    const key = reviewKey(item)
    const early = earlySettled.get(key)
    earlySettled.delete(key)
    await update($, review, list => {
      const existing = list.find(one => isItemOf(one, item))
      const status = early ?? existing?.status ?? item.status
      return [...list.filter(one => !isItemOf(one, item)), { ...item, status }].slice(-REVIEW_LIMIT)
    })
    return true
  })
  // A comment thread's status is the server's: the listing that follows
  // settles the row, even for one resolved before the row landed.
  if (isRecorded && item.kind === 'comment') void requestThreads($, item.server, item.documentId).catch(noop)
}

/** Settle the queue's row for `id`, or keep the settlement for a row landing later; nothing of a session ended since `sessionAt`. */
async function settleReview($: Engine, ref: ReviewRef, status: StrataReviewItem['status'], sessionAt: number): Promise<void> {
  await step(async () => {
    if (sessionAt !== sessionSeq) return
    let isFound = false
    await update($, review, list => {
      isFound = list.some(one => isItemOf(one, ref))
      return isFound ? list.map(one => (isItemOf(one, ref) ? { ...one, status } : one)) : list
    })
    if (isFound) return
    // Kept for an item landing later; the newest kept, the oldest let go.
    const key = reviewKey(ref)
    earlySettled.delete(key)
    earlySettled.set(key, status)
    while (earlySettled.size > REVIEW_LIMIT) {
      const oldest = earlySettled.keys().next().value
      if (oldest === undefined) break
      earlySettled.delete(oldest)
    }
  })
}

// ---- The explorer -------------------------------------------------------

/** Keep what the person typed in the search field, so a redraw draws it back. */
async function keepQuery($: Engine, text: string): Promise<void> {
  // The field holds only so much (the explorer must stay drawable with it): a paste past that is not taken, and says so.
  if (drawnSize(text) > QUERY_MAX) {
    toast($, `Strata: a search holds at most ${String(QUERY_MAX)} characters; the paste was not taken`)
    // A fresh value, the same query: the redraw puts the field back to it.
    await step(() => update($, explorer, view => ({ ...view })))
    return
  }
  await step(() => update($, explorer, view => (view.query === text ? view : { ...view, query: text })))
}

/** The search asked for last while one was out, if any, with the session it was asked in; it runs once the one out is in, unless that session ended. */
let searchWanted: { query: string; sessionAt: number } | null = null
let isSearching = false

/** Search the person's Spaces and show the results in the explorer: one search at a time, the last one asked for always run. */
async function runSearch($: Engine, query: string): Promise<void> {
  // A value past what the field holds (a paste the field refused, still shown until the redraw) is not searched.
  if (drawnSize(query) > QUERY_MAX) {
    toast($, `Strata: a search holds at most ${String(QUERY_MAX)} characters; shorten it to search`)
    await step(() => update($, explorer, view => ({ ...view })))
    return
  }
  searchWanted = { query, sessionAt: sessionSeq }
  if (isSearching) return
  isSearching = true
  try {
    while (searchWanted !== null) {
      const wanted = searchWanted
      searchWanted = null
      // A search asked for in a session ended since is not run for the next.
      if (wanted.sessionAt !== sessionSeq) continue
      await searchOnce($, wanted.query, wanted.sessionAt)
    }
  } finally {
    isSearching = false
  }
}

async function searchOnce($: Engine, query: string, sessionAt: number): Promise<void> {
  // The field keeps what was typed (`keepQuery` owns it); only the request is trimmed, and bounded.
  const trimmed = query.trim().slice(0, QUERY_MAX)
  // Judged inside the step: a session's end queued before it has the say.
  await step(() =>
    update($, explorer, view =>
      sessionAt !== sessionSeq
        ? view
        : trimmed === ''
          ? { ...view, results: [], isSearching: false, error: null }
          : { ...view, isSearching: true, error: null },
    ),
  )
  if (trimmed === '') return
  const via = await serverFor($)
  let results: StrataExplorerResult[] | null = null
  let failure: string | null = null
  try {
    const answer = await $.mcp.call(via, 'find', { intent: 'search', scope: { type: 'all' }, query: trimmed, limit: 8 })
    const text = textOf(answer)
    if (answer.isError) throw new Error(text || 'the search failed')
    results = searchResults(text)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  // A search asked for since is the newer one: its answer is the one shown, not this; nor is a session's answer the next session's.
  if (searchWanted !== null) return
  const found = results
  await step(() =>
    update($, explorer, view =>
      // Kept with the server they came through: opening one reads from there,
      // whatever server a later tool call names. Judged inside the step: a
      // session's end queued before it has the say.
      sessionAt !== sessionSeq
        ? view
        : found !== null
          ? { ...view, results: found, server: via, isSearching: false }
          : { ...view, isSearching: false, error: failure },
    ),
  )
}

// ---- The live tier ------------------------------------------------------

/**
 * Whether the person wants the live watch now: their `/strata live on|off`
 * for this session when they gave one (kept in state, so a reload for an
 * option change does not undo it), else the `liveWatch` option.
 */
async function isLiveOn($: Engine): Promise<boolean> {
  const said = await read($, liveOverride)
  return said === null ? isLiveWanted : said === 'on'
}

/**
 * The deployment the CLI is signed into (`beta.strata.space`, say), from its
 * status; null until a probe said. A watch follows a document only when the
 * document's own link names the same deployment: the CLI watches by id on
 * the deployment it is signed into, and another deployment may hold a
 * document of that id.
 */
let cliDeployment: string | null = null

/** Whether the CLI can follow documents live: signed in, saying where, and new enough to have `doc watch`. */
async function probeTier($: Engine): Promise<StrataTier> {
  if (!(await isLiveOn($))) return 'mcp-poll'
  try {
    const status = await $.process.run([cliPath, 'status', '--json'], { timeoutMs: 8_000 })
    if (status.exitCode !== 0) return 'mcp-poll'
    const parsed = JSON.parse(status.stdout) as { status?: unknown; apiUrl?: unknown; sessionUsable?: unknown }
    // Signed in, or signed in with a token the CLI refreshes on its own (its
    // `status` then says `expired` while `sessionUsable` says the session serves).
    if (parsed.status !== 'logged_in' && parsed.sessionUsable !== true) return 'mcp-poll'
    // A CLI that does not say which deployment it is signed into cannot be matched to the pane's documents: it polls.
    const deployment = typeof parsed.apiUrl === 'string' ? deploymentOf(parsed.apiUrl) : null
    if (deployment === null) return 'mcp-poll'
    const help = await $.process.run([cliPath, 'doc', 'watch', '--help'], { timeoutMs: 8_000 })
    if (help.exitCode !== 0) return 'mcp-poll'
    cliDeployment = deployment
    return 'cli-stream'
  } catch {
    return 'mcp-poll'
  }
}

/**
 * The deployment a document's link in the web app points at, asked of its
 * server when the link is not known yet (the polls keep it once known);
 * null when it cannot be told, and no watch is started on it then.
 */
async function documentDeployment($: Engine, ref: DocumentRef): Promise<string | null> {
  const known = knownUrl(ref.server, ref.id)
  if (known !== null) return deploymentOf(known)
  if (pollUnsupported.has(ref.server)) return null
  const sessionAt = sessionSeq
  try {
    const answer = await $.mcp.call(ref.server, 'find', { intent: 'info', scope: { type: 'document', id: ref.id } })
    const info = answer.isError ? null : infoOf(textOf(answer))
    if (info === null) return null
    await markNewer($, ref.server, ref.id, info, sessionAt)
    return info.url === null ? null : deploymentOf(info.url)
  } catch {
    return null
  }
}

let probing: Promise<StrataTier> | null = null
let probeAgain = false

/** Probe the CLI and record the tier: one probe at a time, run once more when asked during one, so the last ask's answer stands. */
function probe($: Engine): Promise<StrataTier> {
  if (probing !== null) {
    probeAgain = true
    return probing
  }
  probing = (async () => {
    let mode: StrataTier = 'mcp-poll'
    try {
      // The tier is written inside the loop: an ask that comes while it is
      // being written is not dropped, and the last probe's answer is the one
      // that stands when the runner ends.
      do {
        probeAgain = false
        const sessionAt = sessionSeq
        mode = await probeTier($)
        const probed = mode
        // Judged inside the step: an answer for a session ended since is not
        // the next session's tier, and the CLI is probed again for that one.
        const isWritten = await step(async () => {
          if (sessionAt !== sessionSeq) return false
          await update($, tier, () => probed)
          probeWrites += 1
          return true
        })
        if (!isWritten) probeAgain = true
      } while (probeAgain)
    } finally {
      probing = null
    }
    return mode
  })()
  return probing
}

/**
 * A private path for the watch's control channel: a Unix socket, or a named
 * pipe on Windows. One per module load, since one watch runs at a time: the
 * CLI keeps a lock file beside a socket for good, so a fresh path per watch
 * would leave one behind each time.
 */
let controlTag: string | null = null
async function controlPath($: Engine): Promise<string> {
  controlTag ??= Math.random().toString(36).slice(2, 10)
  if ((await $.env.get('OS')) === 'Windows_NT') return `\\\\.\\pipe\\strata-claude-${controlTag}`
  const dir = (await $.env.get('XDG_RUNTIME_DIR')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
  return `${dir.replace(/\/+$/, '')}/strata-claude-${controlTag}.sock`
}

/**
 * The watch now running: which document, its control socket, its stream (to
 * close), when its loop ended, the cursor sends in flight on its socket, and
 * the position waiting to go after them. Its identity is what its events
 * and sends are judged by: an event of a watch that is no longer `watching`
 * draws nothing.
 */
type Watch = {
  id: string
  /** The MCP server the pane holds the document through: the watch is that document's, not another server's of the same id. */
  server: string
  control: string | null
  close: () => void
  done: Promise<void>
  sends: Set<Promise<void>>
  /** The section to post once the send in flight settles; undefined for none. A newer position replaces an older one waiting. */
  pending: string | null | undefined
  isSending: boolean
  /** Which cursor share was asked for last: an older one's read, answering later, posts nothing. */
  cursorSeq: number
  /** The count of probe writes when the watch began: a signed-out error of the watch's undoes no probe that wrote since. */
  probeAt: number
}
let watching: Watch | null = null
/** The document whose watch ended on its own (the child left): not followed again until something asks for it anew. */
let watchEnded: DocumentRef | null = null
/** Settles once every stopped watch has fully ended (its loop and its leave request): the socket path is free then. */
let watchShutdown: Promise<void> = Promise.resolve()
let watchSync: Promise<void> | null = null
let watchSyncAgain = false
/** The session the last ask for the watch came in: an ask from a session later than a run's is not dropped with that run. */
let watchAskedIn = 0
/** What the last failed run of the watch reconciler said, so the same cause is said once. */
let watchFailure: string | null = null
/** How many times a probe wrote the tier: a watch remembers the count it began under, and an error of its own undoes no probe since. */
let probeWrites = 0

/**
 * The document the watch should follow now, if any: read as one step, so no
 * write comes between the reads. Asked for a start begun in session
 * `sessionAt`, none once that session ended: its state is still the ending
 * session's until the engine starts the next one over.
 */
function wantedWatch($: Engine, sessionAt?: number): Promise<DocumentRef | null> {
  return step(() => wantedNow($, sessionAt))
}

/**
 * The body of `wantedWatch`, for a step of the caller's own: the gates (the
 * session ending, its end being dispatched, a session ended since
 * `sessionAt`) are read before the state and again after it, since an end
 * may begin under the reads, outside any step.
 */
async function wantedNow($: Engine, sessionAt?: number): Promise<DocumentRef | null> {
  const isGated = (): boolean => isEnding || isSessionEnding || (sessionAt !== undefined && sessionAt !== sessionSeq)
  if (isGated() || !(await isLiveOn($)) || (await read($, tier)) !== 'cli-stream') return null
  if ((await read($, paneState)) === 'closed') return null
  const view = await read($, doc)
  if (view === null || (watchEnded !== null && isViewOf(view, watchEnded))) return null
  if (isGated()) return null
  return { id: view.id, server: view.server }
}

/**
 * Bring the watch into line with the state: one pass at a time, each
 * reading afresh what is wanted, stopping a watch on another document and
 * starting one on the pane's, until they agree. A call during a run asks
 * for another pass. `restart` lets a document whose watch ended on its own
 * be followed again (a read, an open, `/strata live on` ask for that).
 */
function syncWatch($: Engine, restart = false): Promise<void> {
  if (restart) watchEnded = null
  watchAskedIn = sessionSeq
  if (watchSync !== null) {
    watchSyncAgain = true
    return watchSync
  }
  watchSync = (async () => {
    const runSessionAt = sessionSeq
    let isSettled = false
    // Whether the run ended with the session: no run again against the
    // ending session's state, unless a later session asked meanwhile.
    let isRunEnded = false
    // Whether the run failed (an engine call refused, a path that could not
    // be made): no run again until a new ask, or the engine would be asked
    // the same thing without end.
    let isFailed = false
    try {
      for (let pass = 0; pass < 8 && !isSettled; pass += 1) {
        watchSyncAgain = false
        // A session the module never saw start (the process went on under a
        // new one after a `/clear`) has no tier yet: the CLI is probed here,
        // once, before the watch is judged.
        if ((await read($, tier)) === 'unknown' && (await isLiveOn($))) await probe($)
        const wanted = await wantedWatch($)
        if (watching !== null && (wanted === null || watching.id !== wanted.id || watching.server !== wanted.server)) {
          await stopWatch($)
        } else if (watching === null && wanted !== null) {
          // A start declined (the document is not of the CLI's deployment, or
          // cannot be placed) settles the pass; one the state moved under tries
          // again; one the session ended under ends the run, which the next
          // session's own asks begin anew.
          const started = await startWatch($, wanted)
          if (started === 'declined') isSettled = !watchSyncAgain
          else if (started === 'ended') {
            isRunEnded = true
            return
          }
        } else isSettled = !watchSyncAgain
      }
    } catch (error) {
      isFailed = true
      // Said once per cause: every read and open asks for the watch again.
      const message = error instanceof Error ? error.message : String(error)
      if (message !== watchFailure) {
        watchFailure = message
        toast($, `Strata: the live watch could not be brought up: ${message}`)
      }
    } finally {
      watchSync = null
      // A run cut short runs again; one ended with its session runs again
      // only for an ask that came from a later session, whose state is its
      // own; one that failed runs again only for an ask that came meanwhile.
      const runsAgain = isFailed ? watchSyncAgain : !isSettled && (!isRunEnded || watchAskedIn !== runSessionAt)
      if (runsAgain) void syncWatch($).catch(noop)
    }
  })()
  return watchSync
}

/**
 * End the watch: tell it to leave over its control channel, and close its
 * stream, which kills the child even when the channel is not up yet. The
 * loop and the leave request join the shutdown barrier the next start waits
 * on, so the socket path is reused only once free.
 */
async function stopWatch($: Engine): Promise<void> {
  const current = watching
  if (current === null) return
  watching = null
  const left =
    current.control === null
      ? Promise.resolve()
      : $.http.fetch('http://strata-watch/leave', { method: 'POST', socketPath: current.control }).then(noop, noop)
  current.close()
  watchShutdown = Promise.all([watchShutdown, left, current.done, ...current.sends]).then(noop)
  // The pane's live state comes down with the watch; the loop's own events, judged against `watching`, draw nothing more.
  await step(() =>
    update($, doc, (view): StrataDocView | null =>
      view === null || !isViewOf(view, current) ? view : { ...view, live: 'off', liveNote: null, presence: [] },
    ),
  )
}

/**
 * Start a watch on `wanted`, once the socket path is free and it is still
 * wanted, and only on a document of the deployment the CLI is signed into.
 * Answers what came of it: started; declined, for a document the CLI
 * cannot follow; moved, for a state that changed under the start; ended,
 * for a session that ended under it (a `/clear`, a resume), whose state is
 * not the next session's to start a watch on.
 */
async function startWatch($: Engine, wanted: DocumentRef): Promise<'started' | 'declined' | 'moved' | 'ended'> {
  const { id, server } = wanted
  const sessionAt = sessionSeq
  const control = await controlPath($)
  await watchShutdown
  const isStillWanted = async (): Promise<boolean> => {
    const still = await wantedWatch($, sessionAt)
    return watching === null && still !== null && still.id === id && still.server === server
  }
  if (!(await isStillWanted())) return sessionAt === sessionSeq ? 'moved' : 'ended'
  // The CLI watches by id on its own deployment: a document of another
  // deployment (the pane's server points elsewhere, as the document's link
  // says) is not followed, or the watch would carry that other document.
  const deployment = await documentDeployment($, wanted)
  if (deployment === null || deployment !== cliDeployment) return 'declined'
  const handle: { close: () => void } = { close: noop }
  let finish: () => void = noop
  const done = new Promise<void>(resolve => {
    finish = resolve
  })
  const watch: Watch = {
    id,
    server,
    control,
    close: () => handle.close(),
    done,
    sends: new Set(),
    pending: undefined,
    isSending: false,
    cursorSeq: 0,
    probeAt: probeWrites,
  }
  // Published in the step that judges it still wanted, the gates read again
  // after the state: no session's end can begin between the judgment and
  // the publish, and one that began under the reads is seen.
  const isPublished = await step(async () => {
    const still = await wantedNow($, sessionAt)
    if (watching !== null || still === null || still.id !== id || still.server !== server) return false
    // The gates once more, in the same turn as the publish: a session's
    // end may have begun between the judgment's answer and this line, and
    // a probe meanwhile may have signed the CLI into another deployment.
    if (isEnding || isSessionEnding || sessionAt !== sessionSeq || cliDeployment !== deployment) return false
    watching = watch
    return true
  })
  if (!isPublished) return sessionAt === sessionSeq ? 'moved' : 'ended'
  // The starting mark lands before the child's first line can (a presence
  // event would set `connected`, which the mark must not then undo).
  try {
    await step(() =>
      update($, doc, (view): StrataDocView | null =>
        watching !== watch || view === null || !isViewOf(view, watch) ? view : { ...view, live: 'starting', liveNote: null, presence: [] },
      ),
    )
  } catch (error) {
    // A mark the state refused: the watch never runs. Its identity goes
    // (unless a stop meanwhile took it) and its end is marked, or the next
    // start would wait on it without end.
    if (watching === watch) watching = null
    finish()
    throw error
  }
  void runWatch($, watch, handle)
    .catch(noop)
    .finally(() => finish())
  return 'started'
}

/** The watch's life: one `strata doc watch` child, its lines applied as they come while the watch is the current one. */
async function runWatch($: Engine, watch: Watch, handle: { close: () => void }): Promise<void> {
  const argv = [cliPath, 'doc', 'watch', watch.id, '--json', ...(watch.control === null ? [] : ['--control', watch.control])]
  let rest = ''
  try {
    const child = $.process.spawn({ argv })
    handle.close = () => {
      void child.return({ code: null, signal: 'SIGTERM' }).catch(noop)
    }
    // A stop that landed before the child was up found nothing to close: the child is ended here, before its first line.
    if (watching !== watch) {
      handle.close()
      return
    }
    for await (const chunk of child) {
      if (watching !== watch) break
      if (chunk.stream !== 'stdout') continue
      const taken = takeLines(rest + chunk.text)
      rest = taken.rest
      for (const line of taken.lines) {
        // Checked per event, not per piece: a stop during one event must not let the next one draw.
        if (watching !== watch) break
        const event = parseWatchEvent(line)
        if (event !== null && event.documentId === watch.id) await applyWatchEvent($, watch, event)
      }
      if (watching !== watch) break
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await patchLive($, watch, { live: 'error', liveNote: message }).catch(noop)
  }
  // The child ended on its own: the pane falls back to the revision polls,
  // and the document is not followed again until something asks for it. A
  // watch stopped by `stopWatch` is not `watching` here, and was taken down
  // there. The cursor sends still in flight on this socket join the barrier.
  if (watching !== watch) return
  watchShutdown = Promise.all([watchShutdown, ...watch.sends]).then(noop)
  watching = null
  watchEnded = { id: watch.id, server: watch.server }
  try {
    await step(() =>
      update($, doc, (view): StrataDocView | null =>
        view === null || !isViewOf(view, watch) ? view : { ...view, live: view.live === 'error' ? 'error' : 'off', presence: [] },
      ),
    )
  } catch {
    // The session ended under the watch: nothing left to draw.
  }
}

/** Change the pane's live fields for `watch`, while it is the current watch on the pane's document. */
function patchLive($: Engine, watch: Watch, patch: Partial<StrataDocView>): Promise<void> {
  return step(() =>
    update($, doc, view => (watching !== watch || view === null || !isViewOf(view, watch) ? view : { ...view, ...patch })),
  ).then(noop)
}

/** One event of the watch, applied to the pane, the ledger and the review queue; nothing of a watch no longer current. */
async function applyWatchEvent($: Engine, watch: Watch, event: WatchEvent): Promise<void> {
  if (watching !== watch) return
  switch (event.event) {
    case 'snapshot': {
      const landed = await step(async () => {
        const view = await read($, doc)
        if (watching !== watch || view === null || !isViewOf(view, watch)) return null
        const next = snapshotView(view, event)
        await update($, doc, () => next)
        const rows = await read($, ledger)
        const becameStale = becomesStale(rows, watch.server, watch.id, event.documentVersion)
        await update($, ledger, () => forward(rows, watch.server, watch.id, event.documentVersion, event.title))
        return { isStaleNow: becameStale, isRetitled: next.title !== view.title }
      })
      if (landed === null) break
      // The cursor may have moved or gone with the text: collaborators see where it is now.
      void shareCursor($).catch(noop)
      // The document was renamed: the engine's pane says so too.
      if (landed.isRetitled) void retitlePane($).catch(noop)
      if (landed.isStaleNow) {
        toast($, `Strata: "${clip(event.title, 32)}" changed since Claude read it (now v${String(event.documentVersion)})`)
      }
      break
    }
    case 'presence':
      await patchLive($, watch, { presence: event.collaborators, live: 'connected' })
      break
    case 'collaboratorJoined':
      await step(() =>
        update($, doc, view =>
          watching !== watch || view === null || !isViewOf(view, watch)
            ? view
            : { ...view, presence: withArrival(view.presence, event.collaborator) },
        ),
      )
      break
    case 'collaboratorLeft':
      await step(() =>
        update($, doc, view =>
          watching !== watch || view === null || !isViewOf(view, watch)
            ? view
            : { ...view, presence: withDeparture(view.presence, event.entityId, event.clientKind) },
        ),
      )
      break
    case 'comment': {
      const view = await read($, doc)
      if (watching === watch && view !== null && isViewOf(view, watch)) void requestThreads($, watch.server, watch.id).catch(noop)
      break
    }
    case 'suggestion': {
      const status =
        event.change === 'accepted'
          ? 'accepted'
          : event.change === 'rejected'
            ? 'rejected'
            : event.change === 'withdrawn'
              ? 'withdrawn'
              : null
      if (status !== null) await settleReview($, { kind: 'suggestion', server: watch.server, id: event.suggestionId }, status, sessionSeq)
      break
    }
    case 'status':
      await patchLive($, watch, { live: event.state === 'connected' ? 'connected' : 'reconnecting', liveNote: event.reason })
      break
    case 'error': {
      // The pane's live mark and, for a signed-out CLI, the tier's fall back
      // in one step, while this watch is the current one and no probe wrote
      // the tier since it began: a probe since (a `/strata live on` that
      // found the CLI signed in) has the say over an error from before it.
      const isSignedOut = event.code === 'unauthorized'
      const isApplied = await step(async () => {
        if (watching !== watch) return false
        const view = await read($, doc)
        if (view !== null && isViewOf(view, watch)) {
          await update($, doc, (): StrataDocView | null => ({ ...view, live: 'error', liveNote: `${event.code}: ${event.message}` }))
        }
        if (!isSignedOut || probeWrites !== watch.probeAt) return false
        await update($, tier, () => 'mcp-poll')
        return true
      })
      if (isApplied) {
        toast($, 'Strata: the CLI is signed out (run strata login); the pane polls over MCP instead')
        void syncWatch($).catch(noop)
      }
      break
    }
  }
}

/**
 * Tell collaborators which section the cursor is in, through the watch's
 * control channel. The watch is re-checked after the read, and the send is
 * counted among the watch's own until it settles: a watch started since on
 * the same socket path must never receive another document's section.
 * Posts go one at a time per watch, the latest position only: a movement
 * waiting behind a post in flight is replaced by a newer one, so an older
 * section never lands after a newer one.
 */
async function shareCursor($: Engine): Promise<void> {
  const current = watching
  if (current === null || current.control === null) return
  const control = current.control
  // Numbered before the read: a share asked for earlier, whose read answers
  // later, must not put its older position behind a newer one.
  current.cursorSeq += 1
  const seq = current.cursorSeq
  const view = await read($, doc)
  if (view === null || view.id !== current.id || watching !== current || seq !== current.cursorSeq) return
  // The pane's document must be the watch's, through its server: another
  // server's document of the same id names no section to this watch's socket.
  if (!isViewOf(view, current)) return
  const { blocks, origin } = shownOf(view)
  // The cursor's own block, not the selection's first: an extended selection moves at the cursor end.
  const at = view.cursor === null || view.cursor >= blocks.length ? undefined : view.cursor
  const block = at === undefined ? undefined : blocks[at]
  // No section is named over text whose breadcrumbs are a guess.
  const path = block === undefined || view.isAmbiguous ? '' : headingContextOf(view, origin, block).join(' > ')
  current.pending = path === '' ? null : path
  if (current.isSending) return
  current.isSending = true
  const send = (async () => {
    while (current.pending !== undefined) {
      const section = current.pending
      current.pending = undefined
      await $.http
        .fetch('http://strata-watch/cursor', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ section }),
          socketPath: control,
        })
        .then(noop, noop)
    }
    current.isSending = false
  })()
  current.sends.add(send)
  await send
  current.sends.delete(send)
}

// ---- Reads the hooks make -----------------------------------------------

/** Read a mentioned document for the prompt; null when it cannot be read. */
async function readMention($: Engine, via: string, id: string): Promise<ReadResult | null> {
  try {
    const answer = await $.mcp.call(via, 'read_document', { documentId: id })
    return answer.isError ? null : parseReadResult(textOf(answer))
  } catch {
    return null
  }
}

export const register: Register = (on, options) => {
  cliPath = typeof options.cliPath === 'string' && options.cliPath.trim() !== '' ? options.cliPath.trim() : 'strata'
  isLiveWanted = options.liveWatch !== false
  isAutoOpenWanted = options.autoOpen !== false
  // Whether each surface drawing the band is fullscreen (can seat a pane),
  // learned from its band draws; a pane may open unasked while any surface
  // can seat one, or none has said yet. Per surface: a phone's band must
  // not speak for the terminal beside it.
  const isFullscreenBy = new Map<string, boolean>()
  const canOpenPane = (): boolean => isFullscreenBy.size === 0 || [...isFullscreenBy.values()].some(one => one)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'strata',
      description: 'Strata: the explorer and review queue, the document pane, the band, or the live watch',
      argumentHint: '[doc|close|refresh|band|live]',
    })
    $.clock.every(POLL_MS, () => {
      void checkRevisions($).catch(noop)
    })
    // A start is a reload too (an option changed, the module was edited): the
    // engine ended the previous module's child, so the live state it left in
    // the pane is taken down before the CLI is probed again, and so is the
    // work it had in flight (a fetch's loading mark, a post's mark, a
    // search), which nothing will settle now. The probe runs beside the
    // start; a document already in the pane is followed once it answers.
    await step(async () => {
      await update($, doc, (view): StrataDocView | null => {
        if (view === null) return view
        const draft = view.draft !== null && view.draft.isPosting ? { ...view.draft, isPosting: false } : view.draft
        return view.live === 'off' && !view.isLoading && draft === view.draft
          ? view
          : { ...view, live: 'off', liveNote: null, presence: [], isLoading: false, draft }
      })
      await update($, explorer, state => (state.isSearching ? { ...state, isSearching: false } : state))
    }).catch(noop)
    // The engine's pane brought into line with the state the previous module
    // left: an open pane takes the document's title (a forced pass), and any
    // other state gets a plain pass, which asks the engine's record and
    // closes a pane the state says closed (a `/strata close` the reload cut
    // off before its close reached the engine).
    void (async () => {
      if ((await read($, paneState)) === 'open') await retitlePane($)
      else await settlePane($)
    })().catch(noop)
    void probe($)
      .then(() => syncWatch($, true))
      .catch(noop)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // The session's watch ends with it. After a `/clear` or a resume the
    // process goes on under another session, with no `session.start` for
    // it: the watch may start again there when something asks. After an
    // exit, a logout or a signal nothing is wanted from here, and a start
    // still waiting on the barrier yields.
    if (e.reason !== 'clear' && e.reason !== 'resume') isEnding = true
    // What the engine shows of the pane under the next session is not known here: the first pass there asks outright.
    else paneDrawn = 'unknown'
    // No watch starts while the end is dispatched: the state is the ending
    // session's until the hooks beneath are done, and a watch started on
    // it would outlive the stop below.
    isSessionEnding = true
    void stopWatch($).catch(noop)
    // Work out across the change brings nothing into the next session: counted in a step, behind every step of this one.
    await step(async () => {
      sessionSeq += 1
    })
    try {
      return await next(e)
    } finally {
      isSessionEnding = false
      // An ask that came meanwhile was answered with no watch wanted: judged again now, against the next session's state.
      if (!isEnding) void syncWatch($).catch(noop)
    }
  })

  // The person's close of the pane (its close mark, ctrl+x x) is a close
  // too: the pane is marked closed (so a reload follows no pane nobody sees),
  // fetches out for it apply nothing, and the watch stops. A plugin's close
  // is `/strata close`'s, which did all this itself; an unload's pane is gone
  // before the hooks hear.
  on('ui.close', async ($, e, next) => {
    if (e.id !== DOC_PANE || e.origin.kind !== 'person') return next(e)
    // The opens so far and the session, taken before any wait: an open
    // landing after the person's close (a `/strata doc`, a read) is the
    // newer action, and a session ended meanwhile (a `/clear`) leaves the
    // next session's pane alone.
    const opensAt = paneOpens
    const sessionAt = sessionSeq
    const closed = await next(e)
    // A hook of another plugin beneath may have answered the person's close
    // for itself and kept the pane up: the engine's record says, and then
    // nothing here changes, or a close of this module's own would take the
    // pane down in the person's place, which that hook had refused.
    if ((await drawnPane($)) === 'open') return closed
    // The engine took the pane down. What it shows now is unknown here (an
    // open of this module's may have landed after that close): the
    // reconciler asks either way, after the state says closed, unless an
    // open landed meanwhile, which the state then keeps.
    paneDrawn = 'unknown'
    const isClosed = await closePane($, opensAt, sessionAt)
    void settlePane($).catch(noop)
    if (isClosed) void syncWatch($).catch(noop)
    return closed
  })

  on('command.run', { command: 'strata' }, async ($, e) => {
    const word = e.args.trim().split(/\s+/)[0] ?? ''
    switch (word) {
      case 'close': {
        await closePane($)
        // The watch is asked to stop (its claim goes at once; the CLI's leave
        // ends in its own time, not waited on here), the pane is brought into
        // line with the state, and the explorer closes with it. An open
        // landing meanwhile is the newer action, and the pane follows it.
        void syncWatch($).catch(noop)
        // A run of the reconciler another hook drives is asked for a pass, not waited on.
        void settlePane($).catch(noop)
        await $.ui.close({ id: EXPLORER_PANE })
        return { text: (await read($, paneState)) === 'closed' ? 'Strata panes closed.' : 'Strata pane opened again meanwhile.' }
      }
      case 'live': {
        const rest = e.args.trim().split(/\s+/)[1] ?? ''
        // A command waits on no runner another hook may be driving (the
        // session start's probe, a watch's start): such a wait is on a plain
        // promise, paid from this hook's own budget. It asks, and answers.
        if (rest === 'off') {
          await step(() => update($, liveOverride, () => 'off'))
          void syncWatch($).catch(noop)
          return { text: 'Strata live watch off for this session; the pane polls revisions over MCP.' }
        }
        if (rest === 'on') {
          await step(() => update($, liveOverride, () => 'on'))
          if (probing !== null) {
            void probe($)
              .then(() => syncWatch($, true))
              .catch(noop)
            return { text: 'Strata live watch on; the strata CLI is being probed, and the pane follows its document once it answers.' }
          }
          const probed = await probe($)
          if (probed !== 'cli-stream') {
            return { text: `Strata live watch unavailable: the strata CLI (${cliPath}) is not signed in or has no doc watch.` }
          }
          void syncWatch($, true).catch(noop)
          const shown = await read($, doc)
          return {
            text: shown === null ? 'Strata live watch on; it follows the next document the pane shows.' : `Strata live watch on for "${shown.title}".`,
          }
        }
        const mode = await read($, tier)
        const current = await read($, doc)
        const state = current === null ? 'no document in the pane' : `${current.live} on "${current.title}"`
        const who = current === null || current.presence.length === 0 ? '' : `; here: ${describeRoster(current.presence, 80)}`
        return {
          text:
            `Strata live watch: ${mode === 'cli-stream' ? 'available' : mode === 'mcp-poll' ? 'unavailable (polling over MCP)' : 'probing'}; ${state}${who}. ` +
            '/strata live on|off switches it.',
        }
      }
      case 'band': {
        // Toggled against the value the update sees, not one read before: two toggles at once are two toggles.
        let isHidden = false
        await step(() =>
          update($, isBandHidden, state => {
            isHidden = !state
            return isHidden
          }),
        )
        return { text: isHidden ? 'Strata band hidden for this session.' : 'Strata band shown.' }
      }
      case 'refresh': {
        const refreshed = await refreshPane($)
        if (refreshed === null) return { text: 'No Strata document is open in the pane.' }
        const { view, fetched } = refreshed
        switch (fetched.outcome) {
          case 'applied':
            return { text: `Refreshed "${view.title}".` }
          case 'failed':
            return { text: `Could not refresh "${view.title}": ${fetched.reason}` }
          case 'stale':
            return { text: 'Strata pane moved on meanwhile; nothing refreshed.' }
        }
      }
      case 'doc': {
        const opened = await openPane($, true)
        if (opened !== null && !opened.isPlaced) return { text: `Strata pane not shown: ${opened.reason}` }
        const current = await read($, doc)
        // An open another hook's run of the reconciler will make is asked for, not waited on.
        const verb = opened === null ? 'asked to open' : 'opened'
        return {
          text:
            current === null
              ? `Strata document pane ${verb}. It shows a document once Claude reads one.`
              : `Strata document pane ${verb} on "${current.title}" (v${current.version}).`,
        }
      }
      default: {
        const opened = await $.ui.open({ id: EXPLORER_PANE, title: 'Strata', focus: true })
        if (!opened.isPlaced) return { text: `Strata explorer not shown: ${opened.reason}` }
        const pending = (await read($, review)).filter(item => item.status === 'pending')
        const list = await read($, ledger)
        const mode = await read($, tier)
        return {
          text:
            `Strata explorer opened: ${list.length} document${list.length === 1 ? '' : 's'} read this session, ` +
            `${pending.length} item${pending.length === 1 ? '' : 's'} waiting for review` +
            (mode === 'cli-stream' ? '; live watch available.' : '.'),
        }
      }
    }
  })

  on('tool.call', { tool: /^mcp__.+__read_document$/ }, async ($, e, next) => {
    const sessionAt = sessionSeq
    const ran = await next(e)
    if (ran.deny !== undefined || typeof ran.text !== 'string') return ran
    // A subagent's read is its own: it does not say what the main conversation holds.
    if ((e as { agentId?: string }).agentId !== undefined) return ran
    let text = ran.text
    let result = parseReadResult(text)
    // True when the text came from the engine's file rather than the model's context.
    let isFromFile = false
    if (result === null) {
      // An answer too large for the model's context: the engine put it in a
      // file and told the model where. The pane reads it from there, so the
      // person sees the document the model was handed by file.
      // The path runs to the end of its line, whatever it holds (a space, a
      // drive letter), less the full stop the message ends it with.
      const saved = /Output has been saved to (.+?)\.?[ \t]*(?:\r?\n|$)/.exec(text)
      if (saved === null) return ran
      try {
        text = await $.fs.read(saved[1] ?? '')
      } catch {
        return ran
      }
      result = parseReadResult(text)
      isFromFile = true
    }
    const via = serverOf(String(e.tool))
    if (result === null || via === null) return ran
    const requested = Array.isArray((e as { sections?: unknown }).sections)
      ? ((e as { sections?: unknown[] }).sections ?? []).filter((one): one is string => typeof one === 'string')
      : []
    const now = await $.clock.now()
    // A read with comments or suggestions folded in draws, but is not the document's own text.
    const isAnnotated =
      (e as { includeComments?: unknown }).includeComments === true ||
      (e as { includeSuggestions?: unknown }).includeSuggestions === true
    const landed = await installRead($, result, via, requested, now, { isFromFile, isAnnotated, canOpen: canOpenPane(), sessionAt })
    if (landed === 'discarded') return ran
    const isFirstOpen = landed === 'opened'
    // The pane takes the document's title: opened now, the first time, or
    // opened again where it is drawn (the engine retitles a pane already open).
    if (isFirstOpen || (await read($, paneState)) === 'open') {
      const opened = await settlePane($, { force: true })
      if (isFirstOpen && opened !== null && !opened.isPlaced) {
        toast($, 'Strata: the document pane waits for a wider terminal; /strata doc shows it')
      }
    }
    void requestThreads($, via, result.id).catch(noop)
    void syncWatch($, true).catch(noop)
    // The new text cleared the cursor: collaborators on a watch already running see that.
    void shareCursor($).catch(noop)
    return ran
  }).catch(($, e, next) => next(e))

  // A Strata search the model ran names the server its results live on: a
  // mention typed after it (no completion picked) reads through that server.
  on('tool.call', { tool: /^mcp__.+__find$/ }, async ($, e, next) => {
    const sessionAt = sessionSeq
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || typeof ran.text !== 'string') return ran
    if ((e as { agentId?: string }).agentId !== undefined) return ran
    const via = serverOf(String(e.tool))
    // Only an answer in Strata's own shape: another server's `find` says nothing of where documents live.
    if (via === null || !searchResults(ran.text).some(row => /^doc_[A-Za-z0-9]+$/.test(row.id))) return ran
    await step(() => update($, server, state => (sessionAt !== sessionSeq ? state : via)))
    return ran
  }).catch(($, e, next) => next(e))

  // The review queue follows what the model makes and settles.
  on(
    'tool.call',
    { tool: /^mcp__.+__(propose_suggestion|create_comment|accept_suggestion|reject_suggestion|withdraw_suggestion|set_comment_resolved)$/ },
    async ($, e, next) => {
      const sessionAt = sessionSeq
      const ran = await next(e)
      if (ran.deny !== undefined || ran.isError === true || typeof ran.text !== 'string') return ran
      // The session ended while the call was out: the next session's queue is not this call's.
      if (sessionAt !== sessionSeq) return ran
      const via = serverOf(String(e.tool))
      const tool = toolOf(String(e.tool))
      const args = e as unknown as Record<string, unknown>
      const documentId = typeof args.documentId === 'string' ? args.documentId : null
      if (via === null || tool === null || documentId === null) return ran
      // A subagent's call names no server for the main conversation's mentions.
      if ((e as { agentId?: string }).agentId === undefined) {
        await step(() => update($, server, state => (sessionAt !== sessionSeq ? state : via)))
      }
      const documentTitle = (await read($, ledger)).find(row => isRowOf(row, via, documentId))?.title ?? documentId
      switch (tool) {
        case 'propose_suggestion': {
          const id = idIn(ran.text, ['suggestionId', 'id'])
          const replacement = typeof args.replacementText === 'string' ? args.replacementText : ''
          if (id !== null) {
            await recordReview($, {
              kind: 'suggestion',
              id,
              documentId,
              documentTitle,
              server: via,
              summary: clip(replacement.trim().split('\n').find(line => line.trim() !== '') ?? '', 60),
              status: 'pending',
              origin: 'model',
            }, sessionAt)
          }
          break
        }
        case 'create_comment': {
          const id = idIn(ran.text, ['commentId', 'id'])
          const body = typeof args.body === 'string' ? args.body : ''
          // A reply is part of its thread, which is reviewed as one: it
          // takes no row of its own (the listing names threads, not replies).
          const isReply = typeof args.parentCommentId === 'string' && args.parentCommentId !== ''
          if (id !== null && !isReply) {
            await recordReview($, {
              kind: 'comment',
              id,
              documentId,
              documentTitle,
              server: via,
              summary: clip(body.trim().replace(/\s+/g, ' '), 60),
              status: 'pending',
              origin: 'model',
            }, sessionAt)
          }
          break
        }
        case 'accept_suggestion':
        case 'reject_suggestion':
        case 'withdraw_suggestion': {
          const id = typeof args.suggestionId === 'string' ? args.suggestionId : null
          if (id !== null) {
            await settleReview(
              $,
              { kind: 'suggestion', server: via, id },
              tool === 'accept_suggestion' ? 'accepted' : tool === 'reject_suggestion' ? 'rejected' : 'withdrawn',
              sessionAt,
            )
          }
          break
        }
        case 'set_comment_resolved': {
          // The row is settled from the listing, the server's state after
          // this change and any later one: not from what the call asked. The
          // listing is asked for, not waited on: a run of it another hook
          // drives would spend this hook's budget, and the tool's result
          // owes the listing nothing.
          void requestThreads($, via, documentId).catch(noop)
          break
        }
        default:
          break
      }
      return ran
    },
  ).catch(($, e, next) => next(e))

  // `@strata:` mentions: a typeahead over the person's Spaces while typing,
  // and on submit the document's text as context for the model, the mention
  // rewritten to the title and id.
  // Keyed by the server the search went through as well as the query, and
  // each offered document remembers its server (in state, past a reload): a
  // mention is read from the server that offered it, whatever server a
  // later tool call names.
  const mentionCache = new Map<string, StrataExplorerResult[]>()

  on('prompt.autocomplete', { token: /^@strata:/ }, async ($, e, next) => {
    const sessionAt = sessionSeq
    const below = await next(e)
    const query = e.token.slice('@strata:'.length).trim()
    if (query.length < 2) return below
    const via = await serverFor($)
    const key = `${via}\u0000${query}`
    let results = mentionCache.get(key)
    if (results === undefined) {
      results = []
      // Kept only where the server answered: a search that failed is tried again when asked again.
      let isAnswered = false
      try {
        const answer = await $.mcp.call(via, 'find', { intent: 'search', scope: { type: 'all' }, query, limit: 6 })
        if (!answer.isError) {
          results = searchResults(textOf(answer))
          isAnswered = true
        }
      } catch {
        results = []
      }
      // A search of a session ended since offers nothing to the next, and is not kept for it.
      if (sessionAt !== sessionSeq) return below
      if (isAnswered) {
        mentionCache.set(key, results)
        if (mentionCache.size > MENTION_CACHE) {
          const oldest = mentionCache.keys().next().value
          if (oldest !== undefined) mentionCache.delete(oldest)
        }
      }
    }
    // What is offered is decided in one step, cache hit or miss: nothing of a
    // session ended since, and nothing whose id another server owns.
    const found = results
    const offerable = await step(async (): Promise<StrataExplorerResult[] | null> => {
      if (sessionAt !== sessionSeq) return null
      const known = await read($, mentionServers)
      // The first server that offered a document this session is the one a
      // mention of it is read from: a later offering of the same id through
      // another server is not offered at all, since its mention would read the
      // first server's document under this server's title. Kept for the
      // session, apart from the search cache's bound; only a session that was
      // offered thousands of documents lets the oldest go.
      const offered = found.filter(result => known[result.id] === undefined || known[result.id] === via)
      if (offered.some(result => known[result.id] === undefined)) {
        await update($, mentionServers, latest => {
          const entries = Object.entries(latest)
          for (const result of offered) if (!(result.id in latest)) entries.push([result.id, via])
          return Object.fromEntries(entries.slice(-MENTION_SERVERS_MAX))
        })
      }
      return offered
    })
    if (offerable === null) return below
    const mine = offerable.map(result => ({
      text: `@strata:${result.id} `,
      label: `@strata: ${clip(result.title, 48)}`,
      description: result.detail,
    }))
    return { suggestions: [...mine, ...below.suggestions] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    // Only a person's own typing carries mentions: not a prompt a plugin or
    // a schedule submitted. And only mentions standing on their own
    // (`mentionSpans`): not quoted lines (`> `), where document text the
    // pane put in the prompt could spell a mention nobody meant, nor code,
    // a pasted log or an address, where one is a literal to explain.
    const origin = (e as { origin?: { kind?: string } }).origin?.kind
    if (origin !== undefined && origin !== 'composer' && origin !== 'bridge') return next(e)
    const sessionAt = sessionSeq
    const spans = mentionSpans(e.text)
    const ids = [...new Set(spans.map(span => span.id))].slice(0, MENTION_LIMIT)
    if (ids.length === 0) return next(e)
    const via = await serverFor($)
    const now = await $.clock.now()
    const notes: string[] = []
    // Each mention's replacement, by its id, put in at the end at the very
    // spans the mentions were read from: a literal elsewhere stays as typed.
    const replacements = new Map<string, string>()
    const offered = await read($, mentionServers)
    const read_: { result: ReadResult; via: string; note: string }[] = []
    for (const id of ids) {
      // Read from the server that offered the mention, when one did.
      const from = offered[id] ?? via
      const result = await readMention($, from, id)
      // The server named with the document, as its read tool: two servers may
      // each hold a document of this id, and the model must tell which this is.
      const tool = readToolOf(from)
      if (result === null) {
        replacements.set(id, `the Strata document ${id} (it could not be read here; use the ${tool} tool)`)
        continue
      }
      replacements.set(id, `the Strata document "${result.title}" (${id}, read with the ${tool} tool)`)
      const body =
        result.markdown !== ''
          ? result.markdown
          : `Its outline (the document is long; read sections with the ${tool} tool):\n${JSON.stringify(result.outline)}`
      const note = `The Strata document "${result.title}" (${id}), revision ${String(result.version)}, as the ${tool} tool returns it:\n\n${body}`
      notes.push(note)
      read_.push({ result, via: from, note })
    }
    // Last span first, so the earlier offsets hold.
    let text = e.text
    for (const span of [...spans].reverse()) {
      const replacement = replacements.get(span.id)
      if (replacement !== undefined) text = text.slice(0, span.start) + replacement + text.slice(span.end)
    }
    // The session ended while the documents were read: the prompt was that
    // session's, and its documents are not handed to the next one's model.
    if (sessionAt !== sessionSeq) {
      return { drop: 'Strata: the session ended while the mentioned documents were being read; send the prompt again.' }
    }
    const sent = await next({ ...e, text, context: [...(e.context ?? []), ...notes] })
    // Recorded as read only once the prompt went through: a hook beneath
    // that dropped it left the model with nothing new.
    if (sent.drop !== undefined || read_.length === 0) return sent
    // Which notes the model reads as text, judged on the context as it
    // entered (a hook beneath may have added, dropped or reordered
    // entries): one past the engine's limit on an entry, or past its limit
    // on all of them together counting from the first, reaches the model
    // as a head and a file path; one dropped reaches it not at all.
    const heldAsText = new Set<string>()
    let used = 0
    for (const one of sent.context ?? []) {
      used += one.length
      if (one.length <= CONTEXT_ENTRY_MAX && used <= CONTEXT_TOTAL_MAX) heldAsText.add(one)
    }
    const installed = await step(async () => {
      const shown: { via: string; id: string }[] = []
      // The session ended while the reads were out: the next session's ledger and pane are not theirs.
      if (sessionAt !== sessionSeq) return shown
      await update($, server, () => via)
      for (const { result, via: from, note } of read_) {
        // The model holds the text, or a file, or nothing: a row the document has already only moves forward for the latter two.
        const held = await read($, doc)
        const known = held !== null && held.id === result.id && held.server === from ? Math.max(held.version, held.newerVersion ?? 0) : 0
        await update($, ledger, list =>
          forward(
            heldAsText.has(note) ? remember(list, result, from, now, []) : forward(list, from, result.id, result.version, result.title),
            from,
            result.id,
            known,
            '',
          ),
        )
        // An empty pane takes the document, set up as the other paths set a
        // document up: its threads loaded, and followed live where the CLI can.
        const view = await read($, doc)
        if (view !== null) continue
        await update($, doc, () => viewOf(result, from, null, { nav: 1, url: knownUrl(from, result.id) }))
        shown.push({ via: from, id: result.id })
      }
      return shown
    })
    for (const one of installed) void requestThreads($, one.via, one.id).catch(noop)
    if (installed.length > 0) {
      void syncWatch($, true).catch(noop)
      // A pane open on nothing takes the document's title.
      void retitlePane($).catch(noop)
    }
    return sent
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const list = await read($, ledger)
    // The pane's document is a referent for the model only while the person
    // sees the pane: one closed (`/strata close`, the person's close), never
    // opened (`autoOpen` off), waiting unplaced (a narrow terminal) or
    // behind the explorer's tab shows them nothing, and "the document" in
    // their words means no more than the ledger says. A pane opened from
    // the explorer shows a document the model never read: named all the
    // same, the ledger empty or not.
    const current = (await isDocPaneShown($)) ? await read($, doc) : null
    if (list.length === 0 && current === null) return composed
    const lines = list.slice(-LEDGER_NOTE).map(row => {
      const stale =
        row.versionNow > row.versionAtRead ? `, now v${String(row.versionNow)}: re-read it before relying on it` : ''
      const scope = row.sectionsRead.length > 0 ? ` (sections read: ${row.sectionsRead.join('; ')})` : ''
      return `- "${row.title}" (${row.id}, via ${readToolOf(row.server)}) read at v${String(row.versionAtRead)}${scope}${stale}`
    })
    const live =
      current === null || current.live === 'off'
        ? ''
        : ` The pane follows it live (${current.live})${current.presence.length === 0 ? '' : `; also on it now: ${describeRoster(current.presence, 120)}`}.`
    const pane =
      current === null
        ? ''
        : `\nThe person's Strata pane shows "${current.title}" (${current.id}, read with the ${readToolOf(current.server)} tool)${current.section === null ? '' : ` at "${current.section}"`}; "the document" or "this section" in their words likely means that.${live}`
    return {
      sections: [
        ...composed.sections,
        {
          id: 'strata:context',
          scope: 'session' as const,
          text: `Strata documents in this session's context (the Strata plugin tracks their revisions):\n${lines.length === 0 ? '- none read yet' : lines.join('\n')}${pane}`,
        },
      ],
    }
  })

  on('turn.complete', async ($, e, next) => {
    void checkRevisions($).catch(noop)
    return next(e)
  })

  // The typing into the pane's field and the explorer's is taken here, at
  // the module's own place in the input chain, where a field's events come
  // in the order they were typed: each is queued as a step before anything
  // beneath can hold it up, so a change and an Enter reach the state in that
  // order, which the elements' own closures (run after the chain, which a
  // hook beneath may hold back) could not promise. The field's key names the
  // draft and the field's generation. The work is waited on here, as the
  // engine waits on a closure's; the hooks beneath and the closure run after,
  // and a closure the redraw replaced meanwhile answers nothing more.
  // The module's own fields are answered here, without `next`: their
  // `onInput` and `onSubmit` closures do nothing, and by the time a step has
  // taken the typing the field may have been redrawn under a new key (a
  // post's settlement), so the engine would find no handler to run for the
  // old one and report the hook as failed. Another plugin's field passes on.
  on('ui.input', { requestId: DOC_PANE }, async ($, e, next) => {
    const field = e.plugin === 'strata' ? /^draft-([a-z0-9]+)-(\d+)$/.exec(e.element) : null
    if (field === null) return next(e)
    const draftId = field[1] ?? ''
    const generation = Number(field[2] ?? '0')
    // The step is waited on, the post itself not: typing goes on while a post is out.
    if (e.kind === 'submit') {
      const post = await submitDraft($, draftId, generation, e.value).catch(() => null)
      if (post !== null) void completePost($, post).catch(noop)
    } else {
      await keepDraftText($, draftId, generation, e.value).catch(noop)
    }
    return { element: e.element, value: e.value }
  })

  on('ui.input', { requestId: EXPLORER_PANE }, async ($, e, next) => {
    if (e.plugin !== 'strata' || e.element !== 'search') return next(e)
    // The step is waited on, the search itself not.
    if (e.kind === 'submit') void runSearch($, e.value).catch(noop)
    else await keepQuery($, e.value).catch(noop)
    return { element: e.element, value: e.value }
  })

  on('ui.render', { component: 'Pane', requestId: DOC_PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Link } = table
    // The mobile app draws no field yet: there the pane reads, and writes wait for a terminal.
    const Input = 'Input' in table ? table.Input : null
    const view = await read($, doc)
    if (view === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No Strata document yet. Ask Claude to read one, and it appears here.</Text>
        </Box>
      )
    }
    const row = (await read($, ledger)).find(one => isRowOf(one, view.server, view.id))
    const isStale = row !== undefined && row.versionNow > row.versionAtRead
    const folded = degradeHtml(cutOf(view), view.revealed)
    // The pane draws the blocks the cursor can reach, within the body's share
    // of the tree (`bodyBudgetOf`), the same rule the handlers use, so the
    // cursor reaches only drawn text; the rest waits for a section pick.
    const { blocks, isCut } = shownOf(view)
    const selection = selectionOf(view, blocks.length)
    const quoted = selection === null ? '' : quotedOf(blocks, selection)
    // The field's key names the draft it was drawn for and the field's
    // generation: the `ui.input` hook that takes its typing reads both from
    // it, so a late keystroke lands nowhere else, and a value from before a
    // settlement redrew the field is known for one.
    const draft = draftOf(view)
    const draftId = draft === null ? '' : draft.id
    const fieldKey = draft === null ? 'draft' : `draft-${draft.id}-${String(draft.field)}`
    // Each thread sits under the block its quoted text starts in; one found nowhere, or in two places, lists at the end.
    const { perBlock, loose } = placeThreads(folded.text, blocks, view.threads.slice(0, THREADS_MAX), view.markdown)
    // A table laid out for the pane's own width (the engine's Markdown draws
    // one for a wider screen, and its borders break): aligned columns where
    // they fit, else one card per row. Null for a block that is no table.
    // Never cut here: the body's budget charged the table the most it can draw.
    const tableOf = (text: string) => {
      const layout = tableLayout(text, Math.max(20, e.props.bodyColumns - 4))
      if (layout === null) return null
      if (layout.kind === 'grid') {
        return (
          <Box flexDirection="column">
            <Text bold>{drawable(layout.header)}</Text>
            <Text dimColor>{layout.rule}</Text>
            {layout.rows.length > 0 && <Text>{drawable(layout.rows.join('\n'))}</Text>}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          {layout.cards.map((card, at) => (
            <Box key={`card${String(at)}`} flexDirection="column" marginTop={at === 0 ? 0 : 1}>
              {card.map((entry, line) => (
                <Text key={`c${String(line)}`}>
                  <Text dimColor>{drawable(entry.label)}: </Text>
                  {drawable(entry.value)}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      )
    }
    // A thread under its paragraph: the author and the comment as one line
    // of prose (wrapping as prose does), its actions on a line of their own.
    const threadRow = (thread: StrataThread) => {
      const isResolved = thread.status === 'resolved'
      return (
        <Box key={`t-${thread.id}`} flexDirection="column" paddingLeft={2}>
          <Text dimColor={isResolved}>
            <Text color={isResolved ? undefined : 'cyan'}>{drawable(clip(thread.author, 40))}</Text>
            {'  '}
            {drawable(clip(thread.body.replace(/\s+/g, ' '), 160))}
            {isResolved ? '  (resolved)' : ''}
          </Text>
          <Box columnGap={2}>
            <Button key={`reply-${thread.id}`} plain dimColor onPress={() => void openDraft($, 'reply', thread.id, { id: view.id, server: view.server })}>
              reply
            </Button>
            <Button
              key={`settle-${thread.id}`}
              plain
              dimColor
              onPress={() => void settleThread($, { id: view.id, server: view.server }, thread, thread.status !== 'resolved')}
            >
              {isResolved ? 'reopen' : 'resolve'}
            </Button>
          </Box>
        </Box>
      )
    }
    // The outline as a list where there is nothing else to show (a document
    // too long to read whole), else as one compact row of sections that
    // leaves the pane to the text.
    const isOutlineOnly = view.markdown === ''
    const outlineButton = (entry: StrataOutlineEntry, index: number) => {
      const hotkey = index < 9 ? { hotkey: String(index + 1) } : {}
      return (
        <Button
          key={`h${index}`}
          plain
          dimColor={view.section !== entry.path}
          {...hotkey}
          onPress={() => void showSection($, { id: view.id, server: view.server }, entry.path)}
        >
          {isOutlineOnly ? '  '.repeat(Math.max(0, entry.level - 1)) : ''}
          {drawable(clip(entry.title, isOutlineOnly ? 80 : 28))}
        </Button>
      )
    }
    return (
      <Box flexDirection="column">
        <Box columnGap={1} flexWrap="wrap">
          <Text bold>{drawable(view.title)}</Text>
          {view.version > 0 && <Text dimColor>v{String(view.version)}</Text>}
          {isStale && row !== undefined && <Text color="yellow">Claude read v{String(row.versionAtRead)}</Text>}
          {!isStale && view.newerVersion !== null && (
            <Text color="yellow">changed: v{String(view.newerVersion)} (r refreshes)</Text>
          )}
          {view.isAnnotated && <Text dimColor>annotated read: r for the plain text</Text>}
          {view.isAmbiguous && <Text dimColor>sections read together, headings ambiguous: r for the whole document</Text>}
          {view.isLoading && <Text dimColor>loading…</Text>}
          {view.live === 'connected' && <Text color="green">live</Text>}
          {view.live === 'starting' && <Text dimColor>live: starting</Text>}
          {view.live === 'reconnecting' && (
            <Text color="yellow">live: reconnecting{view.liveNote === null ? '' : ` (${view.liveNote})`}</Text>
          )}
          {view.live === 'error' && <Text color="red">live: {view.liveNote ?? 'failed'}</Text>}
          {view.presence.length > 0 && (
            <Text color="magenta">
              {String(view.presence.length)} here: {describeRoster(view.presence, 60)}
            </Text>
          )}
        </Box>
        {view.outline.length > 0 && (
          <Box
            flexDirection={isOutlineOnly ? 'column' : 'row'}
            flexWrap={isOutlineOnly ? undefined : 'wrap'}
            columnGap={isOutlineOnly ? undefined : 2}
            marginBottom={1}
          >
            <Button
              key="top"
              plain
              hotkey="0"
              dimColor={view.section !== null}
              onPress={() => void showSection($, { id: view.id, server: view.server }, null)}
            >
              {isOutlineOnly ? 'whole document' : 'all'}
            </Button>
            {view.outline.slice(0, OUTLINE_MAX).map(outlineButton)}
            {view.outline.length > OUTLINE_MAX && (
              <Text dimColor>… {String(view.outline.length - OUTLINE_MAX)} more headings; read_document takes their paths</Text>
            )}
          </Box>
        )}
        {view.error !== null && <Text color="red">{drawable(view.error)}</Text>}
        {view.markdown === '' && !view.isLoading && view.error === null && (
          <Text dimColor>
            {view.outline.length > 0
              ? 'Too long to read whole: pick a section above, or press r to read the whole document.'
              : 'Nothing loaded yet: press r to read the document.'}
          </Text>
        )}
        {blocks.map((block, index) => {
          const isSelected = selection !== null && index >= selection.from && index <= selection.to
          return (
            <Box
              key={`b${String(index)}`}
              flexDirection="column"
              // A heading after text sets its section apart by a line, as a page does.
              marginTop={block.kind === 'heading' && index > 0 ? 1 : 0}
              borderStyle={isSelected ? 'round' : undefined}
              borderColor={isSelected ? 'cyan' : undefined}
            >
              {(block.kind === 'embed' || block.kind === 'code' ? null : tableOf(block.text)) ?? <Markdown text={drawable(shownText(block))} />}
              {(perBlock[index] ?? []).map(threadRow)}
            </Box>
          )
        })}
        {isCut && <Text dimColor>… the rest of this text is not drawn: pick a section above.</Text>}
        {/* A section shown alone: the comments on other sections are a count, not a list under the wrong text. */}
        {view.section !== null && loose.length > 0 && (
          <Text dimColor>
            {String(loose.length)} {loose.length === 1 ? 'comment' : 'comments'} in other sections · 0 shows the whole document
          </Text>
        )}
        {view.section === null && loose.length > 0 && (
          <Box marginTop={1}>
            <Text bold>Comments elsewhere in the document</Text>
          </Box>
        )}
        {view.section === null && loose.map(threadRow)}
        {draft !== null && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan">
              {draftTitle(draft, selection, draft.quoted)}
              {draft.isPosting ? <Text dimColor>  posting…</Text> : null}
            </Text>
            {Input !== null ? (
              <Input
                key={fieldKey}
                label={draft.kind === 'suggest' ? 'Replacement' : draft.kind === 'ask' ? 'Question' : 'Comment'}
                value={drawable(draft.text)}
                rows={draft.kind === 'suggest' ? 4 : 2}
                submitLabel={draft.kind === 'ask' ? 'ask' : 'post'}
                autoFocus
                // The typing is taken by the module's `ui.input` hook, in the order it was typed; the closures have nothing left to do.
                onInput={noop}
                onSubmit={noop}
              />
            ) : (
              <Text dimColor>This surface draws no field; write from the terminal or the desktop app.</Text>
            )}
            <Button key="draft-cancel" plain dimColor onPress={() => void cancelDraft($, view.id, draftId)}>
              cancel
            </Button>
          </Box>
        )}
        {draft === null && blocks.length > 0 && (
          <Box columnGap={2} flexWrap="wrap" marginTop={1}>
            <Text dimColor>
              {selection === null
                ? 'cursor:'
                : `¶${String(selection.from + 1)}${selection.to > selection.from ? `–${String(selection.to + 1)}` : ''}:`}
            </Text>
            <Button key="next" plain hotkey="j" onPress={() => void moveCursor($, 1)}>
              next
            </Button>
            <Button key="prev" plain hotkey="k" onPress={() => void moveCursor($, -1)}>
              prev
            </Button>
            <Button key="extend" plain hotkey="v" onPress={() => void toggleAnchor($)}>
              {view.anchor === null ? 'extend' : 'one block'}
            </Button>
            <Button key="comment" plain hotkey="c" onPress={() => void openDraft($, 'comment', null)}>
              comment
            </Button>
            <Button key="quote" plain hotkey="q" onPress={() => void quoteToPrompt($)}>
              quote
            </Button>
            <Button key="suggest" plain hotkey="s" onPress={() => void openDraft($, 'suggest', null)}>
              suggest
            </Button>
            <Button key="ask" plain hotkey="a" onPress={() => void openDraft($, 'ask', null)}>
              ask
            </Button>
            {selection !== null && (
              <Button key="clear" plain hotkey="x" onPress={() => void clearCursor($)}>
                clear
              </Button>
            )}
          </Box>
        )}
        <Box columnGap={2} flexWrap="wrap" marginTop={1}>
          <Button key="refresh" plain dimColor hotkey="r" onPress={() => void fetchInto($, view.server, view.id, null, view.title)}>
            refresh
          </Button>
          <Link href={view.url} label="open in browser" />
          {folded.fences.slice(0, FENCES_MAX).map(fence => (
            <Button
              key={`fence${fence.index}`}
              plain
              dimColor
              onPress={() => void toggleFence($, { id: view.id, server: view.server }, view.markdown, view.section, fence.index)}
            >
              {fence.isRevealed ? `fold ${fence.noun} ${fence.index + 1}` : `show ${fence.noun} ${fence.index + 1}`}
            </Button>
          ))}
          {folded.fences.length > FENCES_MAX && (
            <Text dimColor>(the first {String(FENCES_MAX)} of {String(folded.fences.length)} folded blocks)</Text>
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: EXPLORER_PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The mobile app draws no field yet: there the explorer lists without a search box.
    const Input = 'Input' in table ? table.Input : null
    const state = await read($, explorer)
    const pending = (await read($, review)).filter(item => item.status === 'pending').slice(-8).reverse()
    const recent = (await read($, ledger)).slice(-5).reverse()
    const via = await serverFor($)
    const settle = async (item: StrataReviewItem, action: 'accept' | 'reject') => {
      const sessionAt = sessionSeq
      const tool = action === 'accept' ? 'accept_suggestion' : 'reject_suggestion'
      try {
        const answer = await $.mcp.call(item.server, tool, { documentId: item.documentId, suggestionId: item.id })
        if (answer.isError) throw new Error(textOf(answer) || 'refused')
        await settleReview($, item, action === 'accept' ? 'accepted' : 'rejected', sessionAt)
        toast($, `Strata: suggestion ${action === 'accept' ? 'accepted' : 'rejected'} on "${clip(item.documentTitle, 32)}"`)
      } catch (error) {
        toast($, `Strata: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return (
      <Box flexDirection="column">
        {Input !== null ? (
          <Input
            key="search"
            label="Search"
            placeholder="your Spaces"
            value={state.query.slice(0, QUERY_MAX)}
            submitLabel="find"
            autoFocus
            // The typing is taken by the module's `ui.input` hook, in the order it was typed.
            onInput={noop}
            onSubmit={noop}
          />
        ) : (
          <Text dimColor>Search from the terminal or the desktop app; this surface draws no field.</Text>
        )}
        {state.isSearching && <Text dimColor>searching…</Text>}
        {state.error !== null && <Text color="red">{state.error}</Text>}
        {state.results.map((result, index) => (
          // One result: the title to open in the pane, a quiet action to hand
          // it to Claude, and the matching text under it, dim.
          <Box key={`result${index}`} flexDirection="column" marginTop={index === 0 ? 1 : 0}>
            <Box columnGap={2}>
              <Button key={`open${index}`} plain onPress={() => void fetchInto($, state.server ?? via, result.id, null, result.title)}>
                {drawable(clip(result.title, 56))}
              </Button>
              <Button
                key={`read${index}`}
                plain
                dimColor
                onPress={() =>
                  void $.prompt.submit({
                    // The server named with the tool: two servers may each hold a document of this id.
                    text: `Read the Strata document "${result.title}" (${result.id}) with the ${readToolOf(state.server ?? via)} tool and tell me what it says.`,
                  })
                }
              >
                give to Claude
              </Button>
            </Box>
            {result.detail !== '' && (
              <Box paddingLeft={2}>
                <Text dimColor wrap="truncate-end">
                  {drawable(result.detail)}
                </Text>
              </Box>
            )}
          </Box>
        ))}
        {state.query !== '' && !state.isSearching && state.error === null && state.results.length === 0 && (
          <Text dimColor>Nothing found for "{clip(state.query, 80)}".</Text>
        )}
        <Box marginTop={1}>
          <Text bold>Review</Text>
          <Text dimColor>  suggestions and comments made this session</Text>
        </Box>
        {pending.length === 0 && <Text dimColor>Nothing waiting.</Text>}
        {pending.map(item => (
          // One item: what it is and where, then its text, then its actions.
          <Box key={`item-${addressOf(item)}`} flexDirection="column">
            <Text>
              <Text color={item.kind === 'suggestion' ? 'green' : 'cyan'}>{item.kind === 'suggestion' ? 'Suggestion' : 'Comment'}</Text>
              <Text dimColor> on {drawable(clip(item.documentTitle, 40))}</Text>
            </Text>
            <Box paddingLeft={2} flexDirection="column">
              <Text wrap="truncate-end">{drawable(item.summary)}</Text>
              <Box columnGap={2}>
                {item.kind === 'suggestion' && (
                  <Button key={`accept-${addressOf(item)}`} variant="primary" onPress={() => void settle(item, 'accept')}>
                    Accept
                  </Button>
                )}
                {item.kind === 'suggestion' && (
                  <Button key={`reject-${addressOf(item)}`} onPress={() => void settle(item, 'reject')}>
                    Reject
                  </Button>
                )}
                <Button
                  key={`open-${addressOf(item)}`}
                  plain
                  dimColor
                  onPress={() => void fetchInto($, item.server, item.documentId, null, item.documentTitle)}
                >
                  open in pane
                </Button>
              </Box>
            </Box>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text bold>Recent</Text>
        </Box>
        {recent.length === 0 && <Text dimColor>No document read yet.</Text>}
        {recent.map(row => (
          <Button key={`recent-${row.server}-${row.id}`} plain onPress={() => void fetchInto($, row.server, row.id, null, row.title)}>
            {drawable(clip(row.title, 48))} <Text dimColor>v{String(row.versionNow)}</Text>
          </Button>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isFullscreen = e.viewport?.isFullscreen
    if (isFullscreen !== undefined) isFullscreenBy.set(e.surface, isFullscreen)
    const list = await read($, ledger)
    if (e.props.hasSurvey || list.length === 0 || (await read($, isBandHidden))) return next(e)
    const stale = list.filter(row => row.versionNow > row.versionAtRead)
    // The band stays out of the way: with the pane in view and nothing
    // changed since Claude read it, the pane says all there is, and the
    // prompt keeps its row. It shows when a read went stale, or when the
    // documents in context have no pane in view to say so.
    const isPaneShown = await isDocPaneShown($)
    if (stale.length === 0 && isPaneShown) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown = (stale.length > 0 ? stale : list).slice(-3).reverse()
    const width = Math.max(12, Math.floor((e.props.bodyColumns - 44) / Math.max(1, shown.length)))
    return (
      <Box columnGap={2} flexWrap="wrap">
        <Text dimColor>
          <Text color="cyan">strata</Text>
          {shown.map(row => (
            <Text key={`r-${row.server}-${row.id}`}>
              {'  '}
              {drawable(clip(row.title, width))} v{String(row.versionAtRead)}
              {row.versionNow > row.versionAtRead && <Text color="yellow"> → v{String(row.versionNow)} changed</Text>}
            </Text>
          ))}
          {list.length > shown.length && stale.length === 0 ? `  +${String(list.length - shown.length)}` : ''}
        </Text>
        {stale.length > 0 && (
          <Button key="refresh-stale" variant="primary" onPress={() => void refreshStale($)}>
            Refresh for Claude
          </Button>
        )}
        {!isPaneShown && (
          <Button key="open-pane" plain onPress={() => void openPane($, false)}>
            open pane
          </Button>
        )}
        <Button key="hide-band" plain dimColor onPress={() => void step(() => update($, isBandHidden, () => true))}>
          hide
        </Button>
      </Box>
    )
  })
}
