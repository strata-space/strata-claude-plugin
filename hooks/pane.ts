// The pane's pure side: what a read, a fetch or a live snapshot becomes in
// the pane, what the ledger records of a read, what of the held text is
// drawn and within what budget, what the cursor selects, and what a draft
// anchors to. No `$`, no state: each a function of its arguments, so each is
// tested on a table.

import type { StrataDocView, StrataDraft, StrataLoadedDoc, StrataOutlineEntry } from '../types'
import {
  blocksOf,
  degradeHtml,
  headingPathAt,
  headingPathsByLine,
  heldPathAt,
  heldHeadingsAmbiguous,
  heldSectionRange,
  outlineOf,
  rebaseOutline,
  sectionRange,
  tableCost,
  shownText,
} from './markdown'
import type { MarkdownBlock, ReadResult } from './markdown'
import { clip, docUrl } from './strata'

/** How many documents the ledger keeps: the most recently read. */
export const LEDGER_LIMIT = 20
/** Characters of Markdown the pane draws at most in one body. */
export const BODY_LIMIT = 60_000
/**
 * The engine refuses a drawn tree past 100,000 characters serialized. The
 * body's budget counts each block's descriptor (`BLOCK_OVERHEAD`: its box
 * with a key, a direction and, selected, a border and its colour, and the
 * Markdown it holds) with its text, and the outline, the threads and the
 * fence toggles are each bounded and counted with their own descriptors
 * (a heading's button with its key, hotkey, dimming and indentation; a
 * thread's row with its author, body, `resolved` label and two buttons,
 * each keyed by the thread's id), so that all of them, with the header,
 * stay under that together with room to spare for how the engine spells
 * them.
 */
export const BLOCK_OVERHEAD = 300
export const BLOCKS_MAX = 300
export const OUTLINE_MAX = 60
export const OUTLINE_OVERHEAD = 260
export const THREADS_MAX = 40
export const THREAD_OVERHEAD = 800
export const FENCES_MAX = 40
export const FENCE_OVERHEAD = 160
/** What the whole drawn tree may take, under the engine's 100,000; the header, the hotkey row and the wrappers are reserved first. */
export const TREE_LIMIT = 88_000
export const HEADER_RESERVE = 10_000
/** The most the draft field holds, as drawn: a paste past it is refused, and a selection past it is not opened as a suggestion. */
export const DRAFT_MAX = 30_000
/** The most the search field holds, as drawn; the query is drawn twice (the field, the empty answer's note). */
export const QUERY_MAX = 2_000

/** Whether a ledger row is the document `id` through the server `via`: a document is the pair, since two servers may each hold one of that id. */
export function isRowOf(row: StrataLoadedDoc, via: string, id: string): boolean {
  return row.id === id && row.server === via
}

/**
 * The ledger with `result` recorded: one row per document and server,
 * newest last. The row says what the model holds and how fresh that is: a
 * whole read replaces everything; a sectioned read adds to what was held, at
 * the oldest revision any of it came from; an outline adds no text. A
 * refresh (`isRefresh`) re-read exactly what the row covered, so the row is
 * fresh at the result.
 */
export function remember(
  list: StrataLoadedDoc[],
  result: ReadResult,
  via: string,
  now: number,
  requested: readonly string[],
  isRefresh = false,
): StrataLoadedDoc[] {
  const rest = list.filter(row => !isRowOf(row, via, result.id))
  const before = list.find(row => isRowOf(row, via, result.id))
  const kind: StrataLoadedDoc['coverage'] =
    result.format === 'outline' ? 'outline' : requested.length > 0 ? 'sections' : 'whole'
  let coverage = kind
  let sectionsRead = kind === 'sections' ? [...new Set(requested)] : []
  let versionAtRead = result.version
  // A refresh replaces the row only when it re-read what the row covers now:
  // a whole read since, or an outline where text was held, means the row's
  // text was not all refreshed, and the read merges like any other.
  const isWholeRefresh =
    isRefresh &&
    before !== undefined &&
    kind === before.coverage &&
    (kind !== 'sections' || before.sectionsRead.every(path => requested.includes(path)))
  if (!isWholeRefresh && before !== undefined) {
    if (kind === 'sections' && before.coverage === 'whole') {
      // The whole document is still held from before: this read adds nothing to it.
      coverage = 'whole'
      sectionsRead = []
      versionAtRead = Math.min(before.versionAtRead, result.version)
    } else if (kind === 'sections' && before.coverage === 'sections') {
      sectionsRead = [...new Set([...before.sectionsRead, ...requested])]
      versionAtRead = Math.min(before.versionAtRead, result.version)
    } else if (kind === 'outline' && before.coverage !== 'outline') {
      coverage = before.coverage
      sectionsRead = before.sectionsRead
      versionAtRead = before.versionAtRead
    }
  }
  const row: StrataLoadedDoc = {
    id: result.id,
    title: result.title,
    versionAtRead,
    versionNow: Math.max(result.version, before?.versionNow ?? 0),
    readAt: now,
    sectionsRead,
    coverage,
    server: via,
  }
  return [...rest, row].slice(-LEDGER_LIMIT)
}

/**
 * The ledger with a revision the server named for a document moved forward:
 * a row's `versionNow` only rises (an older answer landing later lowers
 * nothing), and a document with no row gets none (the model never read it).
 */
export function forward(list: StrataLoadedDoc[], via: string, id: string, version: number, title: string): StrataLoadedDoc[] {
  return list.map(row =>
    isRowOf(row, via, id) && version > row.versionNow ? { ...row, versionNow: version, title: title || row.title } : row,
  )
}

/** Whether a revision moved a ledger row from fresh to stale: `version` is past the read, and the row was not marked stale before. */
export function becomesStale(list: readonly StrataLoadedDoc[], via: string, id: string, version: number): boolean {
  const row = list.find(one => isRowOf(one, via, id))
  return row !== undefined && row.versionNow <= row.versionAtRead && version > row.versionAtRead
}

/**
 * The whole document's outline when the server sent one, else the text's
 * own, with a sectioned read's headings put back under their ancestors.
 */
export function outlineFor(result: ReadResult): StrataOutlineEntry[] {
  if (result.outline.length > 0) return result.outline
  return rebaseOutline(outlineOf(result.markdown), result.sectionsReturned)
}

/** What a newer revision mark becomes when the pane now holds `version`: kept while it is past that, else cleared. */
function newerPast(newerVersion: number | null, version: number): number | null {
  return newerVersion !== null && newerVersion > version ? newerVersion : null
}

/**
 * The pane's view of what a read answered, under navigation count `nav`.
 * `isAnnotated` when the read folded comments or suggestions into the text;
 * `url` the server's own link when one is known.
 */
export function viewOf(
  result: ReadResult,
  via: string,
  previous: StrataDocView | null,
  options: { nav: number; isAnnotated?: boolean; url?: string | null },
): StrataDocView {
  const outline = outlineFor(result)
  const isWhole = result.format === 'markdown' && result.sectionsReturned.length === 0
  // The same document through the same server: its threads, its draft, its
  // watch and its link carry over. Through another server it is set up anew.
  const same = previous !== null && previous.id === result.id && previous.server === via ? previous : null
  // A whole read keeps the section the pane showed, when it is still there;
  // a sectioned read shows what it returned: one section as that section,
  // several together.
  const keepsSection = isWhole && same !== null && same.section !== null && outline.some(entry => entry.path === same.section)
  return {
    id: result.id,
    title: result.title,
    version: result.version,
    server: via,
    nav: options.nav,
    markdown: result.markdown,
    outline,
    section: keepsSection ? same.section : result.sectionsReturned.length === 1 ? (result.sectionsReturned[0] ?? null) : null,
    isWhole,
    sectionsHeld: isWhole ? [] : [...result.sectionsReturned],
    source: 'read',
    isLoading: false,
    error: null,
    revealed: [],
    // The server's own link, once a poll has named it, outlives a re-read and a reopen.
    url: options.url ?? same?.url ?? docUrl(result.id),
    cursor: null,
    anchor: null,
    // A draft in the field survives a re-read of its document: it anchors by
    // the quote and revision it captured when it opened, not by the cursor.
    draft: same?.draft ?? null,
    threads: same?.threads ?? [],
    presence: same?.presence ?? [],
    live: same?.live ?? 'off',
    liveNote: same?.liveNote ?? null,
    isAnnotated: options.isAnnotated === true,
    // Sections read together whose headings could begin one or belong to the one before: a guess nothing anchors by.
    isAmbiguous: !isWhole && result.sectionsReturned.length > 1 && heldHeadingsAmbiguous(result.markdown, result.sectionsReturned),
    // A newer revision a poll found stays marked while it is past what this read brought.
    newerVersion: newerPast(same?.newerVersion ?? null, result.version),
  }
}

/** The pane while its first fetch of `id` is out: the title known, no text yet. */
export function loadingView(id: string, title: string, via: string, nav: number, url: string | null): StrataDocView {
  return {
    id,
    title,
    version: 0,
    server: via,
    nav,
    markdown: '',
    outline: [],
    section: null,
    isWhole: false,
    sectionsHeld: [],
    source: 'fetch',
    isLoading: true,
    error: null,
    revealed: [],
    url: url ?? docUrl(id),
    cursor: null,
    anchor: null,
    draft: null,
    threads: [],
    presence: [],
    isAnnotated: false,
    isAmbiguous: false,
    newerVersion: null,
    live: 'off',
    liveNote: null,
  }
}

/**
 * The pane's view of its own document with a fetch's answer in: the text
 * `path` names (the whole for null), the cursor off it. A draft is kept: the
 * one the fetch began under went with the reservation, and one opened while
 * the fetch was out anchors by its own quote, judged again at the post. An
 * answer older than what the pane holds (a live snapshot landed first) puts
 * no old text under the newer revision: it only ends the loading mark.
 */
export function fetchedView(view: StrataDocView, result: ReadResult, path: string | null): StrataDocView {
  if (result.version < view.version) {
    // The pane holds newer text than the answer (a live snapshot landed
    // first, or a refresh): the old text is not put under it, but what the
    // fetch was for still happens on the text held, which moves to the
    // section asked for when the text held has it (all of it, else: the
    // outline may list a section whose text is not held), the cursor and
    // the draft off it as on any navigation.
    const section = path !== null && sectionRangeOf({ ...view, section: path }) !== null ? path : null
    return { ...view, section, isLoading: false, error: null, revealed: [], cursor: null, anchor: null }
  }
  // A whole read brings the whole outline; a section's answer keeps the
  // pane's unless the server sent the whole one with it, or the pane had none.
  const outline =
    path === null || result.outline.length > 0 || view.outline.length === 0 ? outlineFor(result) : view.outline
  const version = Math.max(view.version, result.version)
  return {
    ...view,
    title: result.title,
    version,
    markdown: result.markdown,
    outline,
    section: path,
    isWhole: path === null && result.format === 'markdown',
    sectionsHeld: path === null ? [] : [...result.sectionsReturned],
    source: 'fetch',
    isLoading: false,
    error: null,
    revealed: [],
    cursor: null,
    anchor: null,
    isAnnotated: false,
    isAmbiguous: false,
    newerVersion: newerPast(view.newerVersion, version),
  }
}

/**
 * The pane's view with a live snapshot in: the whole document at its
 * revision, the section kept where the outline still has it, the cursor
 * following its block by text. A snapshot older than what the pane holds
 * (a read landed first) only says the watch is up.
 */
export function snapshotView(
  view: StrataDocView,
  event: { title: string; documentVersion: number; markdown: string },
): StrataDocView {
  if (event.documentVersion < view.version) return { ...view, live: 'connected', liveNote: null }
  const outline = outlineOf(event.markdown)
  const next: StrataDocView = {
    ...view,
    title: event.title || view.title,
    version: event.documentVersion,
    markdown: event.markdown,
    outline,
    section: view.section !== null && outline.some(entry => entry.path === view.section) ? view.section : null,
    isWhole: true,
    sectionsHeld: [],
    source: 'fetch',
    isLoading: false,
    error: null,
    live: 'connected',
    liveNote: null,
    isAnnotated: false,
    isAmbiguous: false,
    newerVersion: newerPast(view.newerVersion, event.documentVersion),
    // The html fences are numbered afresh in the new text: a revealed one would be another's.
    revealed: [],
  }
  const cursor = followCursor(view, next, view.cursor)
  return { ...next, cursor, anchor: cursor === null ? null : followCursor(view, next, view.anchor) }
}

/**
 * Where the block at `index` of `before`'s drawing stands in `after`'s: the
 * block with the same text under the same headings, since the blocks may
 * have moved. The old index is no shortcut (a deletion above shifts another
 * block's same text onto it). Among the blocks with the same text under the
 * same headings, the cursor's was the n-th: it stays the n-th while their
 * number holds; one gone or one more (its own deleted, with a twin
 * surviving) and the n-th may be another's, so the cursor drops. Null for
 * a block that is gone or ambiguous.
 */
export function followCursor(before: StrataDocView, after: StrataDocView, index: number | null): number | null {
  if (index === null) return null
  // The twins are counted over all of the shown section's blocks, drawn or
  // past the cut (the cut takes blocks off the end only, so a drawn block's
  // index is its index among them all): a twin just past the cut that a
  // deletion brings into the drawing would otherwise keep the count. The
  // headings over each block come from one pass over the held text per
  // view, not a scan per block: a long text of many twins stays quick.
  const allBefore = blocksOfView(before)
  const was = allBefore.blocks[index]
  if (was === undefined) return null
  const heading = allBefore.headingOf(was)
  const matches = (all: BlocksOfView): number[] =>
    all.blocks.flatMap((block, at) => (block.text === was.text && all.headingOf(block) === heading ? [at] : []))
  const wasAt = matches(allBefore)
  const nowAt = matches(blocksOfView(after))
  const ordinal = wasAt.indexOf(index)
  if (ordinal === -1 || wasAt.length !== nowAt.length) return null
  const landed = nowAt[ordinal] ?? null
  // The cursor rests only on drawn text.
  return landed !== null && landed < shownOf(after).blocks.length ? landed : null
}

type BlocksOfView = {
  blocks: MarkdownBlock[]
  origin: number[]
  /** The heading breadcrumbs over a block, joined, as `headingContextOf` names them. */
  headingOf: (block: MarkdownBlock) => string
}

/**
 * All the blocks of the text the pane draws from, past the cut included,
 * each knowing the line it came from, with the headings in force over the
 * held text worked out once for all of them.
 */
function blocksOfView(view: StrataDocView): BlocksOfView {
  const degraded = degradeHtml(cutOf(view), view.revealed)
  const range = sectionRangeOf(view)
  const base = range === null ? 0 : range.start
  const { lines, paths } = headingPathsByLine(view.markdown, view.isWhole ? [] : view.sectionsHeld)
  const headingOf = (block: MarkdownBlock): string => {
    const inCut = degraded.origin[block.start]
    if (inCut === undefined) return ''
    const under = lastAtOrBefore(lines, base + inCut)
    return under === -1 ? '' : (paths[under] ?? '')
  }
  return { blocks: blocksOf(degraded.text), origin: degraded.origin, headingOf }
}

/** The index of the last of `sorted` at or before `value`; -1 for none. */
function lastAtOrBefore(sorted: readonly number[], value: number): number {
  let low = 0
  let high = sorted.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((sorted[mid] ?? 0) <= value) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** The draft the pane draws a field for: one open, not one a post closed. */
export function draftOf(view: StrataDocView): StrataDraft | null {
  return view.draft !== null && !view.draft.isClosed ? view.draft : null
}

/**
 * Where the shown section lies in the text the pane holds: text held as
 * sections names its headings through those sections (the held `## A` of
 * `A > A` is not the whole document's `A`), the whole document by path.
 * Null for all of the held text.
 */
export function sectionRangeOf(view: StrataDocView): { start: number; end: number } | null {
  if (view.section === null) return null
  return !view.isWhole && view.sectionsHeld.length > 0
    ? heldSectionRange(view.markdown, view.section, view.sectionsHeld)
    : sectionRange(view.markdown, view.section)
}

/** The text the pane draws from: the shown section of what it holds, or all of it. */
export function cutOf(view: StrataDocView): string {
  const range = sectionRangeOf(view)
  if (range === null) return view.markdown
  return view.markdown.split('\n').slice(range.start, range.end).join('\n')
}

/** How much of the drawn tree `text` takes: as the engine serializes it, quotes, backslashes and line breaks escaped. */
export function drawnSize(text: string): number {
  return JSON.stringify(text).length
}

/**
 * `text` as the engine draws it: a Windows line end as a line end, and no
 * other control character (the engine refuses a drawn text with one, tab
 * and newline apart). For the drawing only: what is written or anchored
 * to keeps the document's own text.
 */
export function drawable(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}

/** `text` as one line the engine takes for a pane's title, a toast or a question: drawable, and no line break or tab either. */
export function lineOf(text: string): string {
  return drawable(text).replace(/[\t\n]+/g, ' ')
}

/** `text` cut so that it takes at most `budget` of the drawn tree. */
export function fitTo(text: string, budget: number): string {
  let cut = text
  while (cut.length > 0 && drawnSize(cut) > budget) {
    cut = cut.slice(0, Math.floor((cut.length * budget) / drawnSize(cut)))
  }
  return cut
}

/**
 * The body's share of the drawn tree: what the engine allows, less a
 * reserve for the header and the measured, bounded cost of the outline
 * strip, the threads, the fence toggles and the draft's text. One rule for
 * the drawing and for every handler, so the cursor reaches only drawn text.
 */
export function bodyBudgetOf(view: StrataDocView, fences: number): number {
  const outlineCost = view.outline
    .slice(0, OUTLINE_MAX)
    .reduce((total, entry) => total + drawnSize(clip(entry.title, 80)) + OUTLINE_OVERHEAD, 0)
  const threadsCost = view.threads
    .slice(0, THREADS_MAX)
    .reduce(
      (total, thread) =>
        total +
        drawnSize(clip(thread.body.replace(/\s+/g, ' '), 160)) +
        drawnSize(clip(thread.author, 40)) +
        3 * drawnSize(thread.id) +
        THREAD_OVERHEAD,
      0,
    )
  const fencesCost = Math.min(fences, FENCES_MAX) * FENCE_OVERHEAD
  const draft = draftOf(view)
  const draftCost = draft === null ? 0 : drawnSize(draft.text) + 400
  return Math.max(0, Math.min(BODY_LIMIT, TREE_LIMIT - HEADER_RESERVE - outlineCost - threadsCost - fencesCost - draftCost))
}

/**
 * The blocks the pane draws, within the body's share of the drawn tree. The
 * cut takes blocks off the end only, so a block's index is the same
 * whatever the budget.
 */
export function shownOf(view: StrataDocView): { folded: string; blocks: MarkdownBlock[]; isCut: boolean; origin: number[] } {
  const degraded = degradeHtml(cutOf(view), view.revealed)
  const all = blocksOf(degraded.text)
  const budget = bodyBudgetOf(view, degraded.fences.length)
  const blocks: MarkdownBlock[] = []
  let used = 0
  let isCut = false
  for (const block of all) {
    // A table is charged the most it can draw (`tableCost`), not its source.
    // Other text is charged as drawn: an image reference named grows (`withoutImages`).
    const size = ((block.kind === 'code' || block.kind === 'embed' ? null : tableCost(block.text)) ?? drawnSize(shownText(block))) + BLOCK_OVERHEAD
    if (used + size > budget || blocks.length >= BLOCKS_MAX) {
      if (blocks.length > 0 || size <= budget) {
        isCut = true
        break
      }
      // One block longer than the pane draws: shown cut, and as an embed, so
      // nothing anchors to text the person could not see whole.
      const note = '\n\n> … this block is longer than the pane draws; open the document in the browser for the rest'
      blocks.push({
        ...block,
        kind: 'embed',
        text: `${fitTo(shownText(block), Math.max(0, budget - BLOCK_OVERHEAD - drawnSize(note)))}${note}`,
      })
      used += budget
      isCut = true
      continue
    }
    used += size
    blocks.push(block)
  }
  return { folded: degraded.text, blocks, isCut, origin: degraded.origin }
}

export type Selection = { from: number; to: number }

/** The blocks the cursor covers, clamped to `count` blocks; null with no cursor. */
export function selectionOf(view: StrataDocView, count: number): Selection | null {
  // A cursor past the cut (the budget shrank under it: threads loaded, a
  // draft's text drawn) selects nothing, for the drawing and every handler
  // alike, rather than another block; the far end of a selection is held
  // within the cut.
  if (view.cursor === null || count === 0 || view.cursor >= count) return null
  const cursor = view.cursor
  const anchor = view.anchor === null ? cursor : Math.min(view.anchor, count - 1)
  return { from: Math.min(cursor, anchor), to: Math.max(cursor, anchor) }
}

/** The document text a selection quotes: its blocks' text, embeds left out. */
export function quotedOf(blocks: readonly MarkdownBlock[], selection: Selection): string {
  return blocks
    .slice(selection.from, selection.to + 1)
    .filter(block => block.kind !== 'embed')
    .map(block => block.text)
    .join('\n\n')
}

/**
 * The document's own text under a selection, for a comment or a suggestion
 * to anchor to: the document's lines from the first chosen block's first
 * line to the last chosen block's last, found by position (each drawn line
 * knows the document line it came from), never by searching text. Null for
 * a selection that crosses an html embed (the pane does not draw its source,
 * so the person did not see what they would be anchoring to).
 */
export function anchoredOf(
  view: StrataDocView,
  blocks: readonly MarkdownBlock[],
  origin: readonly number[],
  selection: Selection,
): string | null {
  const chosen = blocks.slice(selection.from, selection.to + 1)
  if (chosen.length === 0 || chosen.some(block => block.kind === 'embed')) return null
  const first = chosen[0]
  const last = chosen[chosen.length - 1]
  if (first === undefined || last === undefined) return null
  const startLine = origin[first.start]
  const endLine = origin[last.end - 1]
  if (startLine === undefined || endLine === undefined || endLine < startLine) return null
  return cutOf(view)
    .split('\n')
    .slice(startLine, endLine + 1)
    .join('\n')
}

/**
 * The heading breadcrumbs over `block`, as the whole document names them,
 * read off the text the pane holds (not the section cut from it, whose
 * headings lack their ancestors): the block's first drawn line leads back
 * to a line of the cut, and the cut to its place in the held text. Text
 * held as sections names its headings through the sections it holds.
 */
export function headingContextOf(view: StrataDocView, origin: readonly number[], block: MarkdownBlock): string[] {
  const inCut = origin[block.start]
  if (inCut === undefined) return []
  const range = sectionRangeOf(view)
  const line = (range === null ? 0 : range.start) + inCut
  if (!view.isWhole && view.sectionsHeld.length > 0) return heldPathAt(view.markdown, line, view.sectionsHeld)
  return headingPathAt(view.markdown, line)
}

/**
 * How many times `quoted` occurs in the held text under the same headings
 * as `heading` names: more than once, and an anchor by text and headings
 * could land on another occurrence.
 */
export function occurrencesUnder(view: StrataDocView, quoted: string, heading: readonly string[]): number {
  return occurrencesIn(view.markdown, view.isWhole ? [] : view.sectionsHeld, quoted, heading)
}

/** How many times `quoted` occurs in `text` under the headings `heading` names, as the whole document names them (`sectionsReturned` empty for the whole). */
export function occurrencesIn(
  text: string,
  sectionsReturned: readonly string[],
  quoted: string,
  heading: readonly string[],
): number {
  if (quoted === '') return 0
  const wanted = heading.join(' > ')
  // Where the lines start, and which heading is in force over each, worked
  // out once; each occurrence is then placed by a binary search, and the
  // search ends at the second occurrence: two is all that matters.
  const lineStarts = [0]
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
  const { lines, paths } = headingPathsByLine(text, sectionsReturned)
  // The stretches under the wanted heading (before the first heading, for
  // none): each searched on its own, an occurrence counted where it starts
  // in one. Text under other headings is never searched, so a long quote
  // that repeats there costs nothing.
  const offsetOfLine = (line: number): number => lineStarts[line] ?? text.length
  const stretches: { start: number; end: number }[] = []
  if (wanted === '') stretches.push({ start: 0, end: offsetOfLine(lines[0] ?? lineStarts.length) })
  lines.forEach((line, k) => {
    if ((paths[k] ?? '') === wanted) stretches.push({ start: offsetOfLine(line), end: offsetOfLine(lines[k + 1] ?? lineStarts.length) })
  })
  let count = 0
  for (const stretch of stretches) {
    const searched = text.slice(stretch.start, Math.min(text.length, stretch.end + quoted.length - 1))
    for (let from = 0; count < 2; ) {
      const at = searched.indexOf(quoted, from)
      if (at === -1 || stretch.start + at >= stretch.end) break
      count += 1
      from = at + 1
    }
    if (count >= 2) break
  }
  return count
}

/** What the pane's input field is for, in a line above it. */
export function draftTitle(draft: StrataDraft, selection: Selection | null, quoted: string): string {
  const where =
    selection === null ? '' : ` ¶${String(selection.from + 1)}${selection.to > selection.from ? `–${String(selection.to + 1)}` : ''}`
  const words = quoted === '' ? '' : ` · ${String(quoted.split(/\s+/).filter(word => word !== '').length)} words quoted`
  switch (draft.kind) {
    case 'comment':
      return `Comment on${where || ' the document'}${words}`
    case 'reply':
      return 'Reply to the thread'
    case 'suggest':
      return `Suggest a replacement for${where || ' the selection'} · empty proposes a deletion`
    case 'ask':
      return `Ask Claude about${where || ' the document'}${words}`
  }
}

/**
 * The field's value as the draft means it. After a post that the person
 * typed through, the draft keeps only what came after the posted text, and
 * the field is redrawn with that, under a new generation; a value a handler
 * of an older generation hands over is from before that redraw, still
 * carries the posted text in front, and loses it here.
 */
export function reconcile(draft: StrataDraft, field: number, value: string): string {
  if (field === draft.field || draft.posted === null || !value.startsWith(draft.posted)) return value
  return value.slice(draft.posted.length).replace(/^\n+/, '')
}
