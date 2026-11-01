// Markdown helpers for the document pane: the outline a document's headings
// make, the slice of one section, and what the terminal does with the html
// embeds Strata documents carry. Pure functions: no `$`, no state.

import type { StrataOutlineEntry } from '../types'

/**
 * A line of Markdown is a fence delimiter when it opens or closes a code
 * block: up to three blanks, the list markers a fence may open an item
 * under (`- ```text`, each with one to four blanks after it), the
 * delimiter, and its info string. The mention scanner reads fences through
 * these same functions, so the two never disagree about where code is.
 */
const FENCE = /^( {0,3})((?:(?:[-+*]|\d{1,9}[.)])[ \t]{1,4})*)(`{3,}|~{3,})(.*)$/

/**
 * A fence open: its delimiter, its info string, and the column its item's
 * text starts at (`indent`: the width of the list markers it opened under,
 * with the blanks before and after them, a tab reaching the next multiple
 * of four; zero for a fence of its own). Its close may be indented from
 * that column to three past it; a line of text indented less ends the
 * item, and the fence with it.
 */
export type Fence = { delimiter: string; info: string; indent: number; html?: HtmlBlock }

/** An HTML block's kind: how it begins, what ends it (null for a blank line), and whether it may interrupt a paragraph. */
export type HtmlBlock = { start: RegExp; end: RegExp | null; interrupts: boolean }

/**
 * The kinds of HTML block Markdown has, in the order they are tried: raw
 * text elements, a comment, a processing instruction, a declaration, a
 * CDATA section (each to the line its end marker is on); a known block
 * element's tag, and any tag alone on its line (each to a blank line, the
 * last unable to interrupt a paragraph).
 */
export const HTML_BLOCKS: readonly HtmlBlock[] = [
  { start: /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, end: /<\/(?:script|pre|style|textarea)>/i, interrupts: true },
  { start: /^ {0,3}<!--/, end: /-->/, interrupts: true },
  { start: /^ {0,3}<\?/, end: /\?>/, interrupts: true },
  { start: /^ {0,3}<![A-Za-z]/, end: />/, interrupts: true },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/, interrupts: true },
  {
    start:
      /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/i,
    end: null,
    interrupts: true,
  },
  {
    start:
      /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/,
    end: null,
    interrupts: false,
  },
]

/** The HTML block `line` begins, if any. */
export function htmlBlockStart(line: string): HtmlBlock | null {
  return HTML_BLOCKS.find(kind => kind.start.test(line)) ?? null
}


/** The columns `prefix` spans from the line's start, a tab reaching the next multiple of four. */
export function columnsOf(prefix: string): number {
  return columnsFrom(prefix, 0)
}

/** The column `prefix` reaches when it starts at column `from`, a tab reaching the next multiple of four. */
export function columnsFrom(prefix: string, from: number): number {
  let columns = from
  for (const char of prefix) columns = char === '\t' ? columns + 4 - (columns % 4) : columns + 1
  return columns
}

/**
 * A line as the block scans read it: without a CRLF's carriage return, and
 * a Unicode line or paragraph separator (U+2028, U+2029) read as a no-break
 * space: text to the block structure, as Markdown takes it, and a Unicode
 * blank where a test asks for one (a definition's label), but a character
 * a pattern's `.` crosses. Same length, so offsets hold.
 */
export function physicalLine(line: string): string {
  // A no-break space: text to the block structure (as a blank it is not one there), Unicode blank to a label's test.
  return withoutReturn(line).replace(/[\u2028\u2029]/g, '\u00a0')
}

/** The line without the carriage return a CRLF ending leaves on it. */
function withoutReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * The fence `raw` opens, if any: a backtick delimiter's info string holds
 * no backtick, and each list marker before the delimiter is padded by one
 * to four columns (a tab reaching the next tab stop from where it stands;
 * five or more columns leave indented code, no fence).
 */
export function opensFence(raw: string): Fence | null {
  const delimiter = FENCE.exec(physicalLine(raw))
  if (!delimiter) return null
  const mark = delimiter[3] ?? ''
  // The info string as written (a separator in it kept): the same columns of the line itself.
  const original = withoutReturn(raw)
  const info = original.slice(original.length - (delimiter[4] ?? '').length)
  if (mark[0] === '`' && info.includes('`')) return null
  const markers = delimiter[2] ?? ''
  let column = columnsOf(delimiter[1] ?? '')
  for (const marker of markers.matchAll(/([-+*]|\d{1,9}[.)])([ \t]{1,4})/g)) {
    const markerEnd = columnsFrom(marker[1] ?? '', column)
    column = columnsFrom(marker[2] ?? '', markerEnd)
    if (column - markerEnd > 4) return null
  }
  return { delimiter: mark, info, indent: markers === '' ? 0 : column }
}

/**
 * The fence line `i` of `lines` opens, if any, with its list container: a
 * fence inside a list item (a blank line between them or not) has the
 * item's text column as its indent, so the item's end (a line of text
 * indented less) ends it, and its three columns of leeway count from there.
 * Read from one forward pass over `lines`, kept per array, that follows
 * fences and the list items open at each line.
 */
export function fenceIn(lines: readonly string[], i: number): Fence | null {
  return scanOf(lines).opens[i] ?? null
}

/**
 * Which lines of `text` (split at line feeds) are prose as Markdown reads
 * them: not a fence's (its delimiters included), indented code, raw HTML, a
 * quote's, or a link reference definition's (an address, not prose). The block scan's own reading, which the mention scanner takes
 * as the last word on where prose can be.
 */
export function proseLines(text: string): boolean[] {
  const lines = text.split('\n')
  const scan = scanOf(lines)
  const prose = lines.map(
    (_, at) => !(scan.code[at] ?? false) && !(scan.html[at] ?? false) && !(scan.quoted[at] ?? false) && !(scan.definition[at] ?? false),
  )
  let i = 0
  while (i < lines.length) {
    const fence = scan.opens[i] ?? null
    if (fence === null) {
      i += 1
      continue
    }
    const { last } = fenceEnd(lines, i, fence)
    for (let at = i; at < last; at += 1) prose[at] = false
    i = Math.max(last, i + 1)
  }
  return prose
}

/** Which lines of `text` (split at line feeds) run the paragraph before them on, by the block scan; any other line begins a block. */
export function runsOn(text: string): boolean[] {
  return scanOf(text.split('\n')).cont
}

/** Whether line `i` of `lines` is an HTML block begun and ended on that one line, as the same pass reads it. */
export function isOneLineHtml(lines: readonly string[], i: number): boolean {
  return scanOf(lines).html[i] ?? false
}

/** Whether line `i` of `lines` is code outside a fence of the scan's own (indented code, or a fence inside a quote), as the same pass reads it. */
export function isIndentedCode(lines: readonly string[], i: number): boolean {
  return scanOf(lines).code[i] ?? false
}

type BlockScan = { opens: (Fence | null)[]; code: boolean[]; html: boolean[]; cont: boolean[]; quoted: boolean[]; definition: boolean[] }

function scanOf(lines: readonly string[]): BlockScan {
  let scan = BLOCK_SCANS.get(lines)
  if (scan === undefined) {
    scan = fenceOpens(lines)
    BLOCK_SCANS.set(lines, scan)
  }
  return scan
}

const BLOCK_SCANS = new WeakMap<readonly string[], BlockScan>()

/** The text of `line` past its first `columns` columns, the rest of its leading blanks given as spaces (each tab measured from where it stands). */
function pastColumnsOf(line: string, columns: number): string {
  let at = 0
  let k = 0
  while (k < line.length) {
    const char = line[k]
    if (char === ' ') at += 1
    else if (char === '\t') at += 4 - (at % 4)
    else break
    k += 1
  }
  return ' '.repeat(Math.max(0, at - columns)) + line.slice(k)
}

/**
 * Whether `line`, indented `indent` columns, interrupts a paragraph rather
 * than running on into it: a thematic break, an ATX heading, a fence, a
 * quote, a bullet with text, an ordered item from 1 with text, or a sibling
 * of an open item (its marker's kind, within that item's marker columns).
 */
function interruptsParagraph(line: string, indent: number, items: readonly { column: number; kind: string; base: number }[]): boolean {
  // Four columns past the deepest container the line reaches, it is text run on, whatever it looks like.
  const reach = Math.max(0, ...items.filter(item => item.column <= indent).map(item => item.column))
  if (indent - reach >= 4) return false
  // The line falls short of the paragraph's container, so the paragraph's
  // own rules (an ordered item only from 1, no empty item, no bare tag) do
  // not apply: any block start begins a block, as the reference parser has it.
  const text = line.replace(/^[ \t]+/, '')
  // (A bare tag alone, though, never interrupts text that could run on.)
  if (htmlBlockStart(text)?.interrupts === true) return true
  if (/^([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(text) || /^(?:#{1,6}(?:[ \t]|$)|>)/.test(text)) return true
  // A fence as `opensFence` has one (a backtick fence's info string holds no backtick).
  if (/^(?:`{3,}|~{3,})/.test(text)) return opensFence(text) !== null
  return /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(text)
}

/**
 * A link reference definition whole on one line: a label (no unescaped
 * bracket in it, at most 999 characters), a destination (in angle brackets,
 * or a run with no blank or control character, its parentheses balanced one
 * level deep), and an optional title after a blank, nothing
 * after; the pieces below also read one over two lines (`definitionLines`).
 */
// (A label of blanks alone is none.)
const DEFINITION_LABEL = String.raw`^ {0,3}\[(?!\s*\])(?:\\[\s\S]|[^\\[\]]){1,999}\]:`
const DEFINITION_DESTINATION = String.raw`(?:<(?:\\.|[^\\<>\n])*>|(?!<)(?:\\[^ \t\x00-\x1f\x7f]|[^ \t()\\\x00-\x1f\x7f]|\((?:\\[^ \t\x00-\x1f\x7f]|[^ \t()\\\x00-\x1f\x7f])*\))+)`
const DEFINITION_TITLE = String.raw`(?:"(?:\\.|[^\\"])*"|'(?:\\.|[^\\'])*'|\((?:\\.|[^\\()])*\))`
const LINK_DEFINITION = new RegExp(`${DEFINITION_LABEL}[ \\t]*${DEFINITION_DESTINATION}(?:[ \\t]+${DEFINITION_TITLE})?[ \\t]*$`)
/** A definition's label alone on its line, its destination on the next. */
const DEFINITION_LABEL_ALONE = new RegExp(`${DEFINITION_LABEL}[ \\t]*$`)
/** A definition's label and destination, its title on the next line. */
const DEFINITION_UNTITLED = new RegExp(`${DEFINITION_LABEL}[ \\t]*${DEFINITION_DESTINATION}[ \\t]*$`)
/** The line after a label alone: a destination, and a title after it or not. */
const DEFINITION_DESTINATION_LINE = new RegExp(`^[ \\t]*${DEFINITION_DESTINATION}(?:[ \\t]+${DEFINITION_TITLE})?[ \\t]*$`)
/** The line after a destination: a title alone. */
const DEFINITION_TITLE_LINE = new RegExp(`^[ \\t]*${DEFINITION_TITLE}[ \\t]*$`)

/**
 * How many lines a link reference definition starting with `line` takes
 * (`next` the line after): 1 whole on its line, 2 with its destination or
 * its title on the next line, 0 for none. A title on the next line is taken
 * only when the line after holds it whole (else the definition ends on its
 * own line).
 */
function definitionLines(line: string, next: string | undefined): number {
  // A label runs at most 999 characters as written (an escape counting both of its), and holds more than blanks.
  const label = /^ {0,3}\[((?:\\[\s\S]|[^\\[\]])*)\]:/.exec(line)?.[1]
  if (label === undefined || label.length > 999 || !/\S/.test(label)) return 0
  const after = physicalLine(next ?? '')
  // The next line is the definition's only where it would run a paragraph on: one that begins a block, or underlines one, is not.
  const isRunOn =
    next !== undefined &&
    !interruptsParagraph(after, columnsOf(/^[ \t]*/.exec(after)?.[0] ?? ''), []) &&
    !/^ {0,3}(?:=+|-+)[ \t]*$/.test(after)
  if (!isRunOn) return LINK_DEFINITION.test(line) ? 1 : 0
  if (DEFINITION_LABEL_ALONE.test(line)) return next !== undefined && DEFINITION_DESTINATION_LINE.test(after) ? 2 : 0
  if (DEFINITION_UNTITLED.test(line) && next !== undefined && DEFINITION_TITLE_LINE.test(after)) return 2
  return LINK_DEFINITION.test(line) ? 1 : 0
}

/** The most list markers one line opens as items (see `fenceOpens`, and the mention scanner's `itemsOf`). */
export const MAX_NESTED_MARKERS = 32

/**
 * The text past the quote mark `text` begins with (at most three blanks
 * before it), `text` standing at column `column`: a blank after the mark is
 * its space (a tab giving up one column of its width, the rest kept as
 * spaces), the text's other leading blanks kept as spaces of their width.
 * Null where no mark begins it. Also the column the text past it stands at.
 */
function quoteInner(text: string, column: number): { inner: string; column: number } | null {
  const mark = /^( {0,3})>/.exec(text)
  if (mark === null) return null
  const at = column + mark[0].length
  const after = text.slice(mark[0].length)
  const blanks = /^[ \t]*/.exec(after)?.[0] ?? ''
  if (blanks === '') return { inner: after, column: at }
  const reach = columnsFrom(blanks, at)
  return { inner: ' '.repeat(reach - at - 1) + after.slice(blanks.length), column: at + 1 }
}

/** Each line's fence, as `fenceIn` reads it: one pass, fences skipped whole, list items stacked by their text column. */
function fenceOpens(lines: readonly string[]): BlockScan {
  const opens: (Fence | null)[] = lines.map(() => null)
  const code: boolean[] = lines.map(() => false)
  const html1: boolean[] = lines.map(() => false)
  // Whether a line runs the paragraph before it on (a setext underline included), rather than beginning a block.
  const cont: boolean[] = lines.map(() => false)
  // Whether a line is a quote's (its mark, or a lazy run-on of its paragraph).
  const quoted: boolean[] = lines.map(() => false)
  // Whether a line is a link reference definition whole on its own.
  const definition: boolean[] = lines.map(() => false)
  // Whether the line before was a quote's (so a quote line after it runs its paragraph on).
  let isQuoting = false
  // A fence open inside a quote: its quote lines are code, and a line without the mark ends both.
  let quoteFence: Fence | null = null
  // How many quote marks deep that fence opened: a line fewer deep ends it.
  let quoteFenceDepth = 0
  // The list items open inside the quote (the text columns, past its marks), and the depth they belong to.
  let quoteItems: number[] = []
  let quoteItemsDepth = 0
  // How many marks deep the last quote line was: a deeper one begins a quote of its own, no run-on.
  let lastQuoteDepth = 0
  // Open list items: the column their text starts at, the kind of their
  // marker (its bullet, or an ordered item's `.` or `)`), and the column of
  // the item they sit in; and whether it is bare (a marker alone, no line in it yet).
  const items: { column: number; kind: string; base: number; isBare?: boolean }[] = []
  let fence: Fence | null = null
  // Whether the line before was paragraph text, which only some items interrupt.
  let isParagraph = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = physicalLine(lines[i] ?? '')
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside === 'content') continue
      fence = null
      if (inside === 'close') continue
    }
    if (/^[ \t]*$/.test(line)) {
      isParagraph = false
      isQuoting = false
      quoteFence = null
      quoteItems = []
      quoteItemsDepth = 0
      // An item begun by a marker alone holds at most one blank line: a blank line before any text in it ends it.
      if (items.at(-1)?.isBare === true) items.pop()
      continue
    }
    const indent = columnsOf(/^[ \t]*/.exec(line)?.[0] ?? '')
    // A paragraph runs on lazily into a line indented less that interrupts it with no block: its items stay open.
    if (isParagraph && indent < (items.at(-1)?.column ?? 0) && !interruptsParagraph(line, indent, items)) {
      cont[i] = true
      continue
    }
    if (quoteFence !== null && !/^ {0,3}>/.test(pastColumnsOf(line, items.at(-1)?.column ?? 0))) {
      quoteFence = null
      isQuoting = false
    }
    // So does a quote's paragraph into a line without the quote's mark that begins no block (a setext underline there is text).
    const isQuoteLazy =
      isParagraph && isQuoting && !/^ {0,3}>/.test(pastColumnsOf(line, items.at(-1)?.column ?? 0)) && !interruptsParagraph(line, indent, items)
    if (isQuoteLazy) {
      cont[i] = true
      quoted[i] = true
      continue
    }
    const wasParagraph = isParagraph
    const wasQuoting = isQuoting
    isQuoting = false
    let popped: { kind: string; base: number } | null = null
    while (items.length > 0 && indent < (items.at(-1)?.column ?? 0)) popped = items.pop() ?? null
    // The items left hold this line: none is bare from here on.
    for (const item of items) item.isBare = false
    const base = items.at(-1)?.column ?? 0
    let rest = pastColumnsOf(line, base)
    let column = base
    // Four columns in, outside a paragraph: indented code, which no paragraph follows on from.
    if (!isParagraph && /^ {4}/.test(rest)) {
      code[i] = true
      continue
    }
    // Markers first, each opening an item; a thematic break (`- - -`, `* * *`)
    // is none, at any depth. Past a paragraph, the first marker interrupts it
    // only as a sibling of the item the paragraph ended, or as a bullet with
    // text, or an ordered item from 1 (a marker alone never): else the line,
    // marker and all, is the paragraph's.
    let isText = true
    let isRejected = false
    // A setext underline ends the paragraph it makes a heading of.
    // (Only in the paragraph's own container: a line that ended an item is a sibling marker, not an underline.)
    if (isParagraph && popped === null && !wasQuoting && !(definition[i - 1] ?? false) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(rest)) {
      cont[i] = true
      isParagraph = false
      continue
    }
    // At most `MAX_NESTED_MARKERS` markers are read as items on one line; past
    // them the rest is the innermost item's text (no document nests lists that
    // deep, and each marker's tests read the rest of the line).
    for (let isFirst = true, depth = 0; depth < MAX_NESTED_MARKERS; isFirst = false, depth += 1) {
      if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(rest)) {
        isText = false
        break
      }
      const marker = /^( {0,3})(?:([-+*])|\d{1,9}([.)]))([ \t]*)(.*)$/.exec(rest)
      if (marker === null) break
      const kind = marker[2] ?? marker[3] ?? ''
      const start = column + (marker[1] ?? '').length
      const markerEnd = start + (marker[0].length - (marker[1] ?? '').length - (marker[4] ?? '').length - (marker[5] ?? '').length)
      const padEnd = columnsFrom(marker[4] ?? '', markerEnd)
      const text = marker[5] ?? ''
      const isEmpty = text === ''
      // A marker needs a blank after it, or nothing at all.
      if (!isEmpty && padEnd === markerEnd) break
      const isOne = marker[3] === undefined || /^0*1[.)]/.test(rest.slice((marker[1] ?? '').length))
      // A line short of the paragraph's container (it closed an item) is not held to the paragraph's rules.
      const interrupts = !isFirst || !isParagraph || popped !== null || wasQuoting || (!isEmpty && isOne)
      if (!interrupts) {
        isRejected = true
        break
      }
      if (isEmpty) {
        // A marker alone: the item's text, on the lines after, starts one column past it.
        items.push({ column: markerEnd + 1, kind, base: column, isBare: true })
        isText = false
        rest = ''
        break
      }
      // Five columns or more of padding: the text starts one past the marker, the rest is indented code.
      const textAt = padEnd - markerEnd > 4 ? markerEnd + 1 : padEnd
      items.push({ column: textAt, kind, base: column })
      rest = ' '.repeat(padEnd - textAt) + text
      column = textAt
    }
    // A fold's placeholder stands where its fence did: a block of its own, no paragraph after it.
    if (!isRejected && /^ {0,3}> \*\*(?:html block|[a-z][a-z0-9-]* (?:diagram|chart|math)) \d+\*\*/.test(rest)) {
      isParagraph = false
      continue
    }
    // A quote's line (past any markers, their items kept): a paragraph is open after it only if it holds text (a lone `>` closes any).
    const quote = isRejected ? null : /^ {0,3}>[ \t]?(.*)$/.exec(rest)
    if (quote !== null) {
      // Nested quotes (`> > `): the text past each depth of marks, the deepest
      // last, each read by columns (a tab after a mark gives up one column as
      // the mark's space and keeps the rest as blanks).
      const inners: string[] = []
      let past = quoteInner(rest, column)
      while (past !== null && inners.length < 64) {
        inners.push(past.inner)
        past = quoteInner(past.inner, past.column)
      }
      const depth = inners.length
      const inner = inners.at(-1) ?? ''
      isQuoting = true
      quoted[i] = true
      // A fence inside the quote, its lines to the close: code, drawn
      // literally. Its lines are read past as many marks as it opened under
      // (a mark more is its content); a line with fewer ends it.
      if (quoteFence !== null && depth < quoteFenceDepth) quoteFence = null
      // A line short of the list item the fence opened under ends the item and the fence: read anew as quote text.
      const inside = quoteFence === null ? null : insideFence(inners[quoteFenceDepth - 1] ?? '', quoteFence)
      if (inside === 'end') quoteFence = null
      if (quoteFence !== null) {
        if (inside === 'close') quoteFence = null
        code[i] = true
        isParagraph = false
        continue
      }
      // The quote's own list items: kept while its lines reach their column
      // (or run a paragraph on, or are blank), read afresh at another depth.
      if (depth !== quoteItemsDepth || !wasQuoting) {
        quoteItems = []
        quoteItemsDepth = depth
      }
      const isOpenParagraph = wasParagraph && wasQuoting
      const lead = /^ */.exec(inner)?.[0].length ?? 0
      const isBlankInner = !/[^ \t]/.test(inner)
      const startsBlock = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)|^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,})/.test(inner.slice(Math.min(lead, quoteItems.at(-1) ?? 0)))
      if (!isBlankInner && !(isOpenParagraph && !startsBlock)) {
        while (quoteItems.length > 0 && lead < (quoteItems.at(-1) ?? 0)) quoteItems.pop()
      }
      const within = quoteItems.at(-1) ?? 0
      const local = inner.slice(Math.min(lead, within))
      // Four columns past its container, outside a paragraph: indented code in the quote.
      if (/^ {4}/.test(local) && !isOpenParagraph) {
        code[i] = true
        isParagraph = false
        continue
      }
      const openedHere = opensFence(local)
      if (openedHere !== null) {
        quoteFence = { ...openedHere, indent: within + openedHere.indent }
        if (openedHere.indent > 0) quoteItems.push(within + openedHere.indent)
        quoteFenceDepth = depth
        code[i] = true
        isParagraph = false
        continue
      }
      const item = /^( {0,3}(?:[-+*]|\d{1,9}[.)]))([ \t]+(?=[^ \t])|[ \t]*$)/.exec(local)
      if (item !== null && !(isOpenParagraph && !startsBlock)) {
        const padding = (item[2] ?? '').length
        const isBare = /^[ \t]*$/.test(local.slice(item[0].length))
        quoteItems.push(within + (item[1] ?? '').length + (padding === 0 || padding > 4 || isBare ? 1 : padding))
        // Five blanks or more after the marker: the item's text is indented code.
        if (padding > 4 && !isBare) {
          code[i] = true
          isParagraph = false
          lastQuoteDepth = depth
          continue
        }
      }
      // Within the quote, a heading, a list item or a break begins a block of
      // its own (a heading or break leaves no paragraph open after it); a
      // nested quote's line runs on as the quote's does.
      const isHeadingOrBreak = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/.test(inner)
      const beginsInner = isHeadingOrBreak || /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(inner)
      isParagraph = /[^ \t]/.test(inner) && !isHeadingOrBreak
      cont[i] = wasParagraph && wasQuoting && column === base && !beginsInner && depth <= lastQuoteDepth && isParagraph
      lastQuoteDepth = depth
      continue
    }
    // Padding of five columns or more after a marker it accepted leaves indented code: no paragraph.
    if (!isRejected && column !== base && /^ {4}/.test(rest)) {
      code[i] = true
      isParagraph = false
      continue
    }
    // A raw HTML block: its lines are HTML, not Markdown (a fence or a heading
    // in a comment is none), kept as a block of its own to its end. One that
    // ends on its first line holds nothing past it.
    const html = rest === '' || isRejected ? null : htmlBlockStart(rest)
    if (html !== null && (html.interrupts || !isParagraph)) {
      isParagraph = false
      const after = rest.replace(html.start, '')
      if (html.end !== null && html.end.test(after)) {
        html1[i] = true
        continue
      }
      fence = { delimiter: '', info: '', indent: column, html }
      opens[i] = fence
      continue
    }
    const opened = rest === '' || isRejected ? null : opensFence(rest)
    if (opened !== null) {
      fence = { ...opened, indent: column }
      opens[i] = fence
      isText = false
    } else if (!isRejected && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(rest)) {
      isText = false
    } else if ((!wasParagraph || (definition[i - 1] ?? false)) && definitionLines(rest, lines[i + 1]) > 0) {
      // Over two lines (a label alone, then its destination; or a title on the line after): both lines the definition's.
      if (definitionLines(rest, lines[i + 1]) === 2 && i + 1 < lines.length) {
        definition[i] = true
        i += 1
      }
      // A link reference definition on a line of its own: Markdown reads it
      // as the start of a paragraph it then takes the definition out of, so
      // the paragraph's rules hold for the line after (an item numbered 2
      // runs on), but that line begins a block of its own (no run-on for
      // inline marks, no setext heading of the definition).
      definition[i] = true
    }
    cont[i] = wasParagraph && isText && (column === base || isRejected)
    isParagraph = isText
  }
  // The line after a definition begins a block, whatever ran it on.
  for (let i = 1; i < lines.length; i += 1) if (definition[i - 1] === true) cont[i] = false
  return { opens, code, html: html1, cont, quoted, definition }
}

/**
 * An ATX heading: its marks, then its title, with an optional closing run of
 * hashes that only counts when a space precedes it (`# C#` is titled `C#`).
 */
const HEADING_OPENER = /^ {0,3}(#{1,6})[ \t]+/

/**
 * The parts of an ATX heading line: the line, its hashes, and its title,
 * or null. The title runs past the blanks after the hashes to the line's
 * end, less trailing blanks (a carriage return last), and less a closing run
 * of hashes that blanks set apart (`# C#` is titled `C#`). Read with one
 * match at the start and a scan back from the end: a long run of blanks is
 * read once, not once per character of it.
 */
function headingParts(line: string): [string, string, string] | null {
  const opener = HEADING_OPENER.exec(line)
  if (opener === null) return null
  const start = opener[0].length
  const isBlank = (at: number): boolean => line[at] === ' ' || line[at] === '\t'
  let end = line.endsWith('\r') ? line.length - 1 : line.length
  while (end > start && isBlank(end - 1)) end -= 1
  let hashes = end
  while (hashes > start && line[hashes - 1] === '#') hashes -= 1
  if (hashes < end && hashes > start && isBlank(hashes - 1)) {
    let before = hashes
    while (before > start && isBlank(before - 1)) before -= 1
    if (before > start) end = before
  }
  // Nothing but blanks after the hashes (two characters or more of them, a
  // carriage return counted): an empty heading.
  if (end <= start) return line.length - (/^ */.exec(line)?.[0].length ?? 0) - (opener[1] ?? '').length >= 2 ? [line, opener[1] ?? '', ''] : null
  return [line, opener[1] ?? '', line.slice(start, end)]
}

/**
 * How a line after the fence `open` reads: `content`; `close`, a delimiter
 * of the same character, at least as long, indented from the item's column
 * to three past it, with nothing but whitespace after it (a delimiter
 * followed by text, ` ```html `, is content); or `end`, a line of text
 * indented less than the item the fence opened under, which ends the item
 * and the fence with it, and is read anew as what it is.
 */
export function insideFence(raw: string, open: Fence): 'content' | 'close' | 'end' {
  const line = physicalLine(raw)
  // Blanks, as Markdown has them: spaces and tabs alone.
  // A raw HTML block (its `html` kind set) runs to its end marker's line, or to a blank line.
  if (open.html !== undefined && /^[ \t]*$/.test(line)) return open.html.end === null ? 'end' : 'content'
  if (/^[ \t]*$/.test(line)) return 'content'
  const leading = /^[ \t]*/.exec(line)?.[0] ?? ''
  const columns = columnsOf(leading)
  if (columns < open.indent) return 'end'
  if (open.html !== undefined) return open.html.end !== null && open.html.end.test(line) ? 'close' : 'content'
  if (columns > open.indent + 3) return 'content'
  const delimiter = /^(`{3,}|~{3,})(.*)$/.exec(line.slice(leading.length))
  if (!delimiter) return 'content'
  const mark = delimiter[1] ?? ''
  const isClose = mark[0] === open.delimiter[0] && mark.length >= open.delimiter.length && /^[ \t]*$/.test(delimiter[2] ?? '')
  return isClose ? 'close' : 'content'
}

/**
 * Where the fence opened at line `from` of `lines` runs to: `end` is the
 * line of its close, or the first line outside it (its item's end, or the
 * text's); `last` is the first line after the fence, close included.
 */
export function fenceEnd(lines: readonly string[], from: number, open: Fence): { end: number; last: number } {
  for (let at = from + 1; at < lines.length; at += 1) {
    const inside = insideFence(lines[at] ?? '', open)
    if (inside === 'close') return { end: at, last: at + 1 }
    if (inside === 'end') return { end: at, last: at }
  }
  return { end: lines.length, last: lines.length }
}

/**
 * The headings of `markdown`, outside code fences, each with the heading path
 * `read_document` takes in `sections` (titles joined by ` > `).
 */
export function outlineOf(markdown: string): StrataOutlineEntry[] {
  const entries: StrataOutlineEntry[] = []
  const trail: string[] = []
  let fence: Fence | null = null
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = fenceIn(lines, i)
    if (opened !== null) {
      fence = opened
      continue
    }
    const heading = headingParts(line)
    if (!heading) continue
    const level = (heading[1] ?? '#').length
    const title = (heading[2] ?? '').trim()
    trail.length = Math.max(0, level - 1)
    while (trail.length < level - 1) trail.push('')
    trail[level - 1] = title
    const path = trail.filter(part => part !== '').join(' > ')
    entries.push({ level, title, path })
  }
  return entries
}

/** The headings of `markdown`, outside code fences, with the line each is on. */
function headingsOf(markdown: string): { level: number; title: string; line: number }[] {
  const out: { level: number; title: string; line: number }[] = []
  let fence: Fence | null = null
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = fenceIn(lines, i)
    if (opened !== null) {
      fence = opened
      continue
    }
    const heading = headingParts(line)
    if (!heading) continue
    out.push({ level: (heading[1] ?? '#').length, title: (heading[2] ?? '').trim(), line: i })
  }
  return out
}

/**
 * The paths the whole document gives headings of sections read on their
 * own: a section's text starts at its heading, so the paths its headings
 * make lack the ancestors above it. The returned sections come in order,
 * each starting at its own heading: at each such root the ancestry restarts
 * from that section's path, and the headings under it hang from it by their
 * levels. The next root is a heading with its title at or above the current
 * root's level: a heading deeper than the root is one of its descendants,
 * even when it shares a later section's title. Only when no such heading
 * follows before the section after it begins (a section returned from
 * deeper in the document than the one before it) does a deeper heading
 * with that title count as the root: the one at the level the path's
 * length names, when exactly one is (the server returns a section's
 * heading at its own level); else the last that is no descendant of a
 * candidate before it (a same-titled child of a root is its own child), at
 * whatever level, since documents skip levels and a path's length need not
 * match a heading's level.
 * One path (its parts) per heading, in order; a heading before any root,
 * or beside one and no root, keeps the path its own level gives it among
 * its neighbours.
 */
function rebasePaths(headings: readonly { level: number; title: string }[], sectionsReturned: readonly string[]): string[][] {
  return rebase(headings, sectionsReturned).paths
}

/**
 * Whether text held as sections (`sectionsReturned`) has a heading that
 * could begin a returned section or belong to the one before it: a deeper
 * root chosen among several same-titled candidates. The choice is a guess
 * then, and nothing should anchor to the text by it.
 */
export function heldHeadingsAmbiguous(markdown: string, sectionsReturned: readonly string[]): boolean {
  return rebase(headingsOf(markdown), sectionsReturned).isAmbiguous
}

function rebase(
  headings: readonly { level: number; title: string }[],
  sectionsReturned: readonly string[],
): { paths: string[][]; isAmbiguous: boolean } {
  let isAmbiguous = false
  const roots = sectionsReturned.map(path => {
    const parts = path.split(' > ')
    return { title: parts[parts.length - 1] ?? '', ancestors: parts.slice(0, -1) }
  })
  const out: string[][] = []
  let nextRoot = 0
  let base: string[] = []
  let trail: string[] = []
  let rootLevel = 0
  const own: string[] = []
  // Whether heading `i` begins root `k`: at or above the current root's level
  // it does; deeper, only as the candidate chosen among the headings with
  // that title before the section after it begins (a heading with the next
  // root's title at or above the current root's level; a deeper one is a
  // candidate itself, not a boundary): the one at the level the path's
  // length names when exactly one is, else the last that is no descendant
  // of the candidate chosen before it. Chosen once, at the first candidate,
  // so every later one is judged against the same choice.
  const chosen = new Map<number, number>()
  // The headings' places by title, built once per rebase.
  const byTitle = new Map<string, number[]>()
  headings.forEach((heading, at) => {
    const list = byTitle.get(heading.title)
    if (list === undefined) byTitle.set(heading.title, [at])
    else list.push(at)
  })
  const positionsOf = (title: string): number[] => byTitle.get(title) ?? []
  // A title's places whose level is at most `level` (one to six), listed on first use.
  const atMost = new Map<string, number[]>()
  const positionsAtMost = (title: string, level: number): number[] => {
    const key = `${String(level)} ${title}`
    let list = atMost.get(key)
    if (list === undefined) {
      list = positionsOf(title).filter(at => levelOf(at) <= level)
      atMost.set(key, list)
    }
    return list
  }
  const firstAtOrAfter = (sorted: readonly number[], value: number): number => {
    let low = 0
    let high = sorted.length
    while (low < high) {
      const mid = (low + high) >> 1
      if ((sorted[mid] ?? 0) < value) low = mid + 1
      else high = mid
    }
    return low
  }
  // A title's places at exactly `level`, listed on first use.
  const atLevel = new Map<string, number[]>()
  const positionsAtLevel = (title: string, level: number): number[] => {
    const key = `${String(level)} ${title}`
    let list = atLevel.get(key)
    if (list === undefined) {
      list = positionsOf(title).filter(at => levelOf(at) === level)
      atLevel.set(key, list)
    }
    return list
  }
  // Built on first use: where each heading's subtree ends (the first heading
  // after it at or above its level), the next heading of its title at or
  // past that end, and the binary-lifting table over those next picks.
  let lifting: number[][] | null = null
  const liftingTable = (): number[][] => {
    if (lifting !== null) return lifting
    const count = headings.length
    const subtreeEnd = new Array<number>(count).fill(count)
    const stack: number[] = []
    for (let j = count - 1; j >= 0; j -= 1) {
      while (stack.length > 0 && levelOf(stack.at(-1) ?? 0) > levelOf(j)) stack.pop()
      subtreeEnd[j] = stack.at(-1) ?? count
      stack.push(j)
    }
    const next = headings.map((heading, j) => {
      const same = positionsOf(heading.title)
      return same[firstAtOrAfter(same, subtreeEnd[j] ?? count)] ?? count
    })
    const table = [next]
    for (let step = 1; 1 << step < count; step += 1) {
      const below = table.at(-1) ?? []
      table.push(below.map(to => (to >= count ? count : (below[to] ?? count))))
    }
    lifting = table
    return table
  }
  const lastPickBefore = (from: number, boundary: number): number => {
    const table = liftingTable()
    let pick = from
    for (let step = table.length - 1; step >= 0; step -= 1) {
      const to = table[step]?.[pick] ?? headings.length
      if (to < boundary) pick = to
    }
    return pick
  }
  const rootsByTitle = new Map<string, { roots: number[]; next: number }>()
  roots.forEach((root, k) => {
    const entry = rootsByTitle.get(root.title)
    if (entry === undefined) rootsByTitle.set(root.title, { roots: [k], next: 0 })
    else entry.roots.push(k)
  })
  const levelOf = (j: number): number => headings[j]?.level ?? 0
  const begins = (i: number, k: number): boolean => {
    const root = roots[k]
    const heading = headings[i]
    if (root === undefined || heading === undefined || root.title !== heading.title) return false
    if (rootLevel === 0 || heading.level <= rootLevel) return true
    const known = chosen.get(k)
    if (known !== undefined) return known === i
    const after = roots[k + 1]
    // The headings of each title, in order, found once: the candidates (this
    // root's title) and the boundary (the next root's title at or above the
    // current root's level) are looked up, not walked to.
    const candidatesFrom = positionsOf(root.title)
    const first = firstAtOrAfter(candidatesFrom, i)
    let boundary = headings.length
    if (after !== undefined) {
      const nexts = positionsAtMost(after.title, rootLevel)
      boundary = nexts[firstAtOrAfter(nexts, i + 1)] ?? headings.length
    }
    // Several candidates: the choice below is a guess, and the text says so.
    if (firstAtOrAfter(candidatesFrom, boundary) - first > 1) isAmbiguous = true
    const depth = root.ancestors.length + 1
    const atDepth = positionsAtLevel(root.title, depth)
    const atDepthFrom = firstAtOrAfter(atDepth, i)
    let pick = i
    if (firstAtOrAfter(atDepth, boundary) - atDepthFrom === 1) {
      pick = atDepth[atDepthFrom] ?? i
    } else {
      // The last candidate that is no descendant of the one chosen before
      // it: from a pick, the next is the first candidate at or past the end
      // of the pick's subtree (`nextPick`), followed by binary lifting while
      // it stays short of the boundary.
      pick = lastPickBefore(i, boundary)
    }
    chosen.set(k, pick)
    return pick === i
  }
  for (const [index, heading] of headings.entries()) {
    // The path the heading's own level gives it, the way `outlineOf` reads the text.
    own.length = Math.max(0, heading.level - 1)
    while (own.length < heading.level - 1) own.push('')
    own[heading.level - 1] = heading.title
    // Only the roots not yet begun, and of this heading's title (none of another can begin here): found through the roots by title.
    // (Each title's list read from a cursor past the roots already begun: `nextRoot` only grows.)
    let at = -1
    const same = rootsByTitle.get(heading.title)
    if (same !== undefined) {
      while (same.next < same.roots.length && (same.roots[same.next] ?? 0) < nextRoot) same.next += 1
      // The first root of this title still to begin is the only one it may begin: roots begin in order, none skipped.
      const k = same.roots[same.next]
      if (k !== undefined && begins(index, k)) at = k
    }
    if (at >= 0) {
      const root = roots[at]
      nextRoot = at + 1
      base = root === undefined ? [] : root.ancestors
      rootLevel = heading.level
      trail = [heading.title]
      out.push([...base, ...trail])
      continue
    }
    if (rootLevel === 0 || heading.level <= rootLevel) {
      out.push(own.filter(part => part !== ''))
      continue
    }
    const depth = heading.level - rootLevel
    trail.length = Math.min(trail.length, depth)
    while (trail.length < depth) trail.push('')
    trail[depth] = heading.title
    out.push([...base, ...trail.filter(part => part !== '')])
  }
  return { paths: out, isAmbiguous }
}

/**
 * Where each thread's quoted text lies among the drawn blocks: the block the
 * quote starts in, when the text occurs exactly once in `drawn` (the text
 * the blocks were cut from); a quote found nowhere, or in two places, is
 * `loose`, since a guess would put it under a paragraph it may not belong to.
 */
export function placeThreads<T extends { id: string; quotedText: string }>(
  drawn: string,
  blocks: readonly MarkdownBlock[],
  threads: readonly T[],
  /** All the text held (a section's whole document, where it is held): a quote found twice there is loose, wherever the drawn cut finds it. */
  held: string = drawn,
): { perBlock: T[][]; loose: T[] } {
  const lineStart: number[] = [0]
  for (const line of drawn.split('\n')) lineStart.push((lineStart[lineStart.length - 1] ?? 0) + line.length + 1)
  const perBlock: T[][] = blocks.map(() => [])
  const loose: T[] = []
  for (const thread of threads) {
    if (thread.quotedText === '') {
      loose.push(thread)
      continue
    }
    const inHeld = held.indexOf(thread.quotedText)
    if (inHeld >= 0 && held.indexOf(thread.quotedText, inHeld + 1) >= 0) {
      loose.push(thread)
      continue
    }
    const first = drawn.indexOf(thread.quotedText)
    const again = first < 0 ? -1 : drawn.indexOf(thread.quotedText, first + 1)
    const at =
      first < 0 || again >= 0
        ? -1
        : blocks.findIndex(
            block =>
              block.kind !== 'embed' && first >= (lineStart[block.start] ?? 0) && first < (lineStart[block.end] ?? Number.POSITIVE_INFINITY),
          )
    if (at < 0) loose.push(thread)
    else perBlock[at]?.push(thread)
  }
  return { perBlock, loose }
}

/** The outline of sections read on their own, with the paths the whole document gives them (`rebasePaths`). */
export function rebaseOutline(entries: readonly StrataOutlineEntry[], sectionsReturned: readonly string[]): StrataOutlineEntry[] {
  if (sectionsReturned.length === 0) return [...entries]
  const paths = rebasePaths(entries, sectionsReturned)
  return entries.map((entry, index) => ({ ...entry, path: (paths[index] ?? [entry.title]).join(' > ') }))
}

/**
 * The heading path (its parts) in force at line `at` of text made of sections
 * read on their own, as the whole document names it; empty before any heading.
 */
export function heldPathAt(markdown: string, at: number, sectionsReturned: readonly string[]): string[] {
  const headings = headingsOf(markdown)
  const paths = rebasePaths(headings, sectionsReturned)
  let path: string[] = []
  for (const [index, heading] of headings.entries()) {
    if (heading.line > at) break
    path = paths[index] ?? []
  }
  return path
}

/**
 * Where the section the whole document names `path` lies in text held as
 * sections (`sectionsReturned`), whose headings lack their ancestors: the
 * first heading whose rebased path is `path`, to the next heading at its
 * level or above. Null when the text holds no such heading. A path search
 * over the held text would be wrong here: the held `## A` of `A > A` reads
 * as plain `A`, and its own `### A` as `A > A`.
 */
export function heldSectionRange(
  markdown: string,
  path: string,
  sectionsReturned: readonly string[],
): { start: number; end: number } | null {
  const headings = headingsOf(markdown)
  const folded = rebasePaths(headings, sectionsReturned).map(parts => foldPath(parts.join(' > ')))
  const wanted = foldPath(path)
  const at = folded.indexOf(wanted)
  const heading = headings[at]
  if (heading === undefined) return null
  // The section ends at the next heading at its level or above, or at one the
  // whole document places outside it: another returned section's root sits
  // under its own ancestors there, however deep its heading is here.
  const after = headings.findIndex(
    (later, i) => i > at && (later.level <= heading.level || !(folded[i] ?? '').startsWith(`${wanted} > `)),
  )
  const end = headings[after]?.line
  return { start: heading.line, end: after === -1 || end === undefined ? markdown.split('\n').length : end }
}

/**
 * The heading paths in force through `markdown`, once for the whole text:
 * each heading's line, in order, and the path (joined by ` > `) it begins,
 * as the whole document names it when the text is sections returned
 * (`sectionsReturned`, empty for the whole document). A line is under the
 * last heading at or before it, and under none before the first.
 */
export function headingPathsByLine(markdown: string, sectionsReturned: readonly string[]): { lines: number[]; paths: string[] } {
  const headings = headingsOf(markdown)
  return {
    lines: headings.map(heading => heading.line),
    paths: rebasePaths(headings, sectionsReturned).map(parts => parts.join(' > ')),
  }
}

/** A heading path as the server compares it: trimmed parts, case folded. */
function foldPath(path: string): string {
  return path
    .split('>')
    .map(part => part.trim().toLowerCase())
    .filter(part => part !== '')
    .join(' > ')
}

/**
 * Where the section at `path` lies in `markdown`: its heading line, and the
 * line after its last. Paths match as the server matches them, regardless of
 * case and of spacing around the separators.
 */
export function sectionRange(markdown: string, path: string): { start: number; end: number } | null {
  const lines = markdown.split('\n')
  const wanted = foldPath(path)
  const trail: string[] = []
  let fence: Fence | null = null
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = fenceIn(lines, i)
    if (opened !== null) {
      fence = opened
      continue
    }
    const heading = headingParts(line)
    if (!heading) continue
    const thisLevel = (heading[1] ?? '#').length
    if (start >= 0 && thisLevel <= level) return { start, end: i }
    if (start >= 0) continue
    const title = (heading[2] ?? '').trim()
    trail.length = Math.max(0, thisLevel - 1)
    while (trail.length < thisLevel - 1) trail.push('')
    trail[thisLevel - 1] = title
    if (foldPath(trail.filter(part => part !== '').join(' > ')) === wanted) {
      start = i
      level = thisLevel
    }
  }
  return start >= 0 ? { start, end: lines.length } : null
}

/**
 * The section of `markdown` under the heading at `path`: from its heading line
 * to the next heading of the same or a higher level. The whole text for a null
 * path, and for a path the text does not hold.
 */
export function sectionSlice(markdown: string, path: string | null): string {
  if (path === null) return markdown
  const range = sectionRange(markdown, path)
  if (range === null) return markdown
  return markdown.split('\n').slice(range.start, range.end).join('\n')
}

/** The heading path (its parts) in force at line `at` of `markdown`; empty before any heading. */
export function headingPathAt(markdown: string, at: number): string[] {
  const lines = markdown.split('\n')
  const trail: string[] = []
  let fence: Fence | null = null
  for (let i = 0; i <= Math.min(at, lines.length - 1); i += 1) {
    const line = lines[i] ?? ''
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = fenceIn(lines, i)
    if (opened !== null) {
      fence = opened
      continue
    }
    if (fence !== null) continue
    const heading = headingParts(line)
    if (!heading) continue
    const level = (heading[1] ?? '#').length
    trail.length = Math.max(0, level - 1)
    while (trail.length < level - 1) trail.push('')
    trail[level - 1] = (heading[2] ?? '').trim()
  }
  return trail.filter(part => part !== '')
}

/** What kind of block a run of Markdown lines is, as the pane's cursor treats it. */
export type BlockKind = 'heading' | 'paragraph' | 'code' | 'embed'

/** Whether line `i` of `lines` is a binding marker (`<!-- strata:… -->` alone on its line) outside code. */
function isBindingMarker(lines: readonly string[], i: number): boolean {
  return /^[ \t]*<!--\s*strata:[^>]*-->[ \t]*\r?$/.test(lines[i] ?? '') && !isIndentedCode(lines, i)
}

/** Whether `line` is blank as Markdown has it: spaces and tabs alone (a trailing carriage return allowed). */
function isBlankLine(line: string): boolean {
  return /^[ \t]*\r?$/.test(line)
}

/** A block's text as the pane draws it: code and embeds verbatim, prose with its images named (`withoutImages`). */
export function shownText(block: { kind: BlockKind; text: string }): string {
  if (block.kind === 'code' || block.kind === 'embed') return block.text
  // Image references named block by block within the text (a list item, a
  // quote, a setext heading each its own): a code span never pairs across them.
  const lines = block.text.split('\n')
  const { cont } = scanOf(lines)
  const runs: string[][] = []
  lines.forEach((line, at) => {
    const run = runs.at(-1)
    if (run !== undefined && cont[at] === true) run.push(line)
    else runs.push([line])
  })
  return runs.map(run => withoutImages(run.join('\n'))).join('\n')
}

/** One block of Markdown the pane's cursor can rest on: a run of lines, and where it lies. */
export type MarkdownBlock = {
  /** The block's first line, 0-based, in the text it was cut from. */
  start: number
  /** The line after its last. */
  end: number
  /** The lines, joined; what a comment quotes. */
  text: string
  kind: BlockKind
}

/**
 * The blocks of `markdown`: each heading alone, each fenced code block whole,
 * and otherwise each run of non-blank lines. A folded html placeholder (what
 * `degradeHtml` leaves) and a revealed html fence are `embed`: shown, never
 * quoted, since the document's text there is not what the terminal draws.
 */
/** The line `degradeHtml` leaves for a folded fence: an html embed, or a diagram, chart or formula drawn in the web app. */
// A fold's line: the folded fence's list markers, if any, then the placeholder itself.
const PLACEHOLDER = /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)*> \*\*(?:html block|[a-z][a-z0-9-]* (?:diagram|chart|math)) \d+\*\*/

/**
 * The fences the web app draws as something other than their source: html
 * embeds (which run there), diagrams, charts and formulas (which render
 * there). The pane folds each to a one-line placeholder; what a person
 * reads in a terminal is the source, which a toggle shows. Answers how the
 * placeholder names the fence (`html block`, `mermaid diagram`), or null
 * for a fence drawn as code.
 */
export function foldedKind(info: string): { label: string; noun: string } | null {
  const language = (/^\s*([A-Za-z][\w+-]*)/.exec(info)?.[1] ?? '').toLowerCase()
  if (language === 'html') return { label: 'html block', noun: 'html' }
  const diagrams: Record<string, string> = {
    mermaid: 'mermaid diagram',
    plantuml: 'plantuml diagram',
    puml: 'plantuml diagram',
    dot: 'graphviz diagram',
    graphviz: 'graphviz diagram',
    d2: 'd2 diagram',
    vega: 'vega chart',
    'vega-lite': 'vega chart',
    chart: 'chart chart',
    math: 'tex math',
    latex: 'tex math',
    katex: 'tex math',
    tex: 'tex math',
  }
  if (!Object.hasOwn(diagrams, language)) return null
  const label = diagrams[language] ?? ''
  return { label: label === 'chart chart' ? 'data chart' : label, noun: language }
}

export function blocksOf(markdown: string): MarkdownBlock[] {
  const lines = markdown.split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0
  const push = (start: number, end: number, kind: BlockKind) => {
    const text = lines.slice(start, end).join('\n')
    if (/[^ \t\r\n]/.test(text)) blocks.push({ start, end, text, kind })
  }
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (isBlankLine(line)) {
      i += 1
      continue
    }
    const opened = fenceIn(lines, i)
    if (opened !== null) {
      const { last } = fenceEnd(lines, i, opened)
      push(i, last, foldedKind(opened.info) !== null ? 'embed' : 'code')
      i = last
      continue
    }
    // A binding marker is the server's, not the text's: no block, though it
    // bounds the blocks around it as the HTML block it is (ending a paragraph,
    // a list item), so it stays in the text the scans read.
    if (isBindingMarker(lines, i)) {
      i += 1
      continue
    }
    // An HTML block on one line: literal, a block of its own.
    if (isOneLineHtml(lines, i)) {
      push(i, i + 1, 'code')
      i += 1
      continue
    }
    // Indented code, blank lines inside it included: literal, as a fence is.
    if (isIndentedCode(lines, i)) {
      let end = i + 1
      for (let at = i + 1; at < lines.length; at += 1) {
        if (isIndentedCode(lines, at)) end = at + 1
        else if (!isBlankLine(lines[at] ?? '')) break
      }
      push(i, end, 'code')
      i = end
      continue
    }
    if (/^ {0,3}#{1,6}[ \t]+[^ \t]/.test(line)) {
      push(i, i + 1, 'heading')
      i += 1
      continue
    }
    if (PLACEHOLDER.test(line)) {
      push(i, i + 1, 'embed')
      i += 1
      continue
    }
    // A paragraph ends before a fence, indented code, a heading, or a folded placeholder
    // (an html fence right under a paragraph, with no blank line between):
    // the placeholder stays an embed of its own, never quoted with the text.
    let end = i + 1
    while (end < lines.length) {
      const next = lines[end] ?? ''
      if (isBlankLine(next) || fenceIn(lines, end) !== null || isIndentedCode(lines, end) || isOneLineHtml(lines, end) || /^ {0,3}#{1,6}[ \t]+[^ \t]/.test(next) || PLACEHOLDER.test(next)) break
      end += 1
    }
    push(i, end, 'paragraph')
    i = end
  }
  return blocks
}

/** A fence the pane folded or showed (an html embed, a diagram, a chart, a formula), by its index among the text's folded fences. */
export type HtmlFence = {
  index: number
  lines: number
  uses: string[]
  isRevealed: boolean
  /** How the placeholder names it (`html block`, `mermaid diagram`). */
  label: string
  /** The short word its toggle uses (`html`, `mermaid`). */
  noun: string
}

/**
 * Strata html embeds (```html fences, optionally `uses="a,b"`) cannot run in a
 * terminal. Each one folds to a one-line placeholder naming its size and what
 * it uses, unless its index is in `revealed`, when its source is drawn as
 * code. Binding markers (`<!-- strata:name=x -->`) are hidden; the named data
 * fences they bind stay, since they read as data. A fence of another kind
 * passes through whole, an html fence inside it included: it is code, not an
 * embed. `origin[i]` is the line of `markdown` that line `i` of the text came
 * from (a placeholder's is its fence's opening line), so a block of the
 * text can be found in the document as written.
 */
export function degradeHtml(
  markdown: string,
  revealed: readonly number[],
): { text: string; fences: HtmlFence[]; origin: number[] } {
  const out: string[] = []
  const origin: number[] = []
  const fences: HtmlFence[] = []
  const lines = markdown.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    // A binding marker is the server's, not the text's; written in indented code, it is code.
    const opened = fenceIn(lines, i)
    const kind = opened === null ? null : foldedKind(opened.info)
    if (opened !== null && kind === null) {
      // A code fence that is not an embed: copied whole, to its close.
      const { last } = fenceEnd(lines, i, opened)
      for (let at = i; at < last; at += 1) {
        out.push(lines[at] ?? '')
        origin.push(at)
      }
      i = last
      continue
    }
    if (opened === null || kind === null) {
      out.push(line)
      origin.push(i)
      i += 1
      continue
    }
    const attrs = opened.info.replace(/^\s*[A-Za-z][\w+-]*/, '')
    const { end, last } = fenceEnd(lines, i, opened)
    const body = lines.slice(i + 1, end)
    // `uses="a,b"`, or bare as the server may write it back (`uses=a,b`).
    const uses = (/uses\s*=\s*(?:"([^"]*)"|([^\s"]+))/.exec(attrs)?.slice(1).find(one => one !== undefined) ?? '')
      .split(',')
      .map(name => name.trim())
      .filter(name => name !== '')
    const index = fences.length
    const isRevealed = revealed.includes(index)
    fences.push({ index, lines: body.length, uses, isRevealed, label: kind.label, noun: kind.noun })
    if (isRevealed) {
      for (let at = i; at < last; at += 1) {
        out.push(lines[at] ?? '')
        origin.push(at)
      }
    } else {
      const using = uses.length > 0 ? `, uses ${uses.join(', ')}` : ''
      const where = kind.noun === 'html' ? 'runs in the web app' : 'drawn in the web app; open in browser to view'
      // The fence's own prefix (its indent and list markers) is kept: its items hold what follows as they did.
      const prefix = /^(.*?)(?=`{3,}|~{3,})/.exec(lines[i] ?? '')?.[1] ?? ''
      out.push(`${prefix}> **${kind.label} ${index + 1}** (${body.length} lines${using}): ${where}`)
      origin.push(i)
    }
    i = last
  }
  return { text: out.join('\n'), fences, origin }
}

/** A Markdown table, as the pane lays it out within its width. */
export type TableLayout =
  /** Columns that fit side by side: each cell padded to its column's width. */
  | { kind: 'grid'; header: string; rule: string; rows: string[] }
  /** Too wide for the pane: each row as a card of `header: cell` lines. */
  | { kind: 'cards'; cards: { label: string; value: string }[][] }

/** The cells of one table row, its outer pipes dropped and escaped pipes kept. */
function cellsOf(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '')
  // The closing pipe goes only where it is a delimiter, not an escaped character of the last cell.
  const inner = /(^|[^\\])(\\\\)*\|$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i] ?? ''
    // A backslash escapes the ASCII punctuation after it: kept as written
    // here (the cell's escapes are decoded after its markup is read), save
    // an escaped pipe, which divides nothing; a pipe after an escaped
    // backslash divides cells.
    const next = inner[i + 1] ?? ''
    if (char === '\\' && next === '|') {
      cell += '|'
      i += 1
    } else if (char === '\\' && /[!-/:-@[-`{-~]/.test(next)) {
      cell += char + next
      i += 1
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += char
  }
  cells.push(cell.trim())
  // As the pane draws a cell: plain text, its emphasis and code marks
  // dropped and its images named, so the width measured is the width drawn.
  return cells.map(one => plainCell(withoutImages(one)))
}

/**
 * A cell as plain text: its unescaped emphasis and code marks dropped, and
 * its escapes decoded (a backslash before ASCII punctuation draws that
 * character alone), read in one pass so an escaped mark stays a character.
 */
function plainCell(cell: string): string {
  let out = ''
  let prose = ''
  // Prose between code spans: escapes set aside (so an escaped mark is no
  // delimiter), paired emphasis delimiters dropped where they open before a
  // non-blank and close after one (`**bold**`, never `2 ** 3`), then the
  // escaped characters put back as themselves.
  const flush = (): void => {
    const escaped: string[] = []
    // The placeholder character itself, where the text holds one, is set aside too.
    const shielded = prose.replace(/\\([!-/:-@[-`{-~])|\uE000/g, (whole: string, char: string | undefined) => {
      escaped.push(char ?? whole)
      return '\uE000'
    })
    // An underscore pair counts only off a word's edges: `my__internal__name` stays as written.
    const plain = withoutPairs(
      withoutPairs(shielded, '**', () => true, () => true),
      '__',
      (text, run) => !isWordAt(codePointBefore(text, run.start)),
      (text, run) => !isWordAt(codePointAfter(text, run.end)),
    )
    let at = 0
    out += plain.replace(/\uE000/g, () => escaped[at++] ?? '')
    prose = ''
  }
  let i = 0
  // The cell's backtick runs by length, in order, a pointer per length moving
  // only forward: a span's closer (the next run of its opener's length) is
  // found without searching the rest of the cell again for each opener.
  const byLength = new Map<number, { starts: number[]; next: number }>()
  for (const found of cell.matchAll(/`+/g)) {
    const entry = byLength.get(found[0].length)
    if (entry === undefined) byLength.set(found[0].length, { starts: [found.index ?? 0], next: 0 })
    else entry.starts.push(found.index ?? 0)
  }
  const closerOf = (length: number, after: number): number => {
    const entry = byLength.get(length)
    if (entry === undefined) return -1
    while (entry.next < entry.starts.length && (entry.starts[entry.next] ?? 0) < after) entry.next += 1
    return entry.starts[entry.next] ?? -1
  }
  while (i < cell.length) {
    const char = cell[i] ?? ''
    const next = cell[i + 1] ?? ''
    if (char === '\\' && /[!-/:-@[-`{-~]/.test(next)) {
      prose += char + next
      i += 2
    } else if (char === '`') {
      // A code span: its content kept literally (marks, backslashes and all),
      // its delimiters dropped; a run never closed is literal backticks.
      let run = 1
      while (cell[i + run] === '`') run += 1
      const ticks = '`'.repeat(run)
      const close = closerOf(run, i + run)
      if (close < 0) {
        prose += ticks
        i += run
      } else {
        flush()
        const inner = cell.slice(i + run, close)
        out += /^ .*\S.* $/s.test(inner) ? inner.slice(1, -1) : inner
        i = close + run
      }
    } else {
      prose += char
      i += 1
    }
  }
  flush()
  return out
}

/** The whole code point before `at` (a surrogate pair read as one), or ''. */
function codePointBefore(text: string, at: number): string {
  if (at <= 0) return ''
  const low = text.charCodeAt(at - 1)
  if (low >= 0xdc00 && low <= 0xdfff && at >= 2) {
    const high = text.charCodeAt(at - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(at - 2, at)
  }
  return text.slice(at - 1, at)
}

/** The whole code point at `at`, or ''. */
function codePointAfter(text: string, at: number): string {
  const point = text.codePointAt(at)
  return point === undefined ? '' : String.fromCodePoint(point)
}

/** A stretch of text: from its start, up to its end. */
type Range = { start: number; end: number }

/** Whether `point` is a letter or a number, as an intraword underscore's neighbour is. */
function isWordAt(point: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(point)
}

/**
 * `text` with each pair of `mark` (`**` or `__`) dropped around its
 * content: an opener before a non-blank (and as `canOpen` allows), closed by
 * the first `mark` past at least one character whose character before is no
 * blank (and as `canClose` allows), scanning on past the pair. The closers
 * are listed once, in order, and met by a cursor that only moves forward:
 * an opener with no closer ends the search, as none after it has one.
 */
function withoutPairs(
  text: string,
  mark: string,
  canOpen: (text: string, run: Range) => boolean,
  canClose: (text: string, run: Range) => boolean,
): string {
  // The run of the mark's character each place is in, found once for all
  // (the delimiter run as a whole stands off a word or not).
  const char = mark[0] ?? ''
  const runOf = new Map<number, Range>()
  for (const found of text.matchAll(new RegExp(`\\${char}+`, 'g'))) {
    const run = { start: found.index ?? 0, end: (found.index ?? 0) + found[0].length }
    for (let at = run.start; at < run.end; at += 1) runOf.set(at, run)
  }
  const run = (at: number): Range => runOf.get(at) ?? { start: at, end: at + mark.length }
  const closers: number[] = []
  for (let at = text.indexOf(mark, 1); at !== -1; at = text.indexOf(mark, at + 1)) {
    if (/\S/.test(text[at - 1] ?? '') && canClose(text, run(at))) closers.push(at)
  }
  let out = ''
  let from = 0
  let next = 0
  for (let at = text.indexOf(mark); at !== -1; at = text.indexOf(mark, at + 1)) {
    if (at < from || !/\S/.test(text[at + mark.length] ?? '') || !canOpen(text, run(at))) continue
    while (next < closers.length && (closers[next] ?? 0) < at + mark.length + 1) next += 1
    const close = closers[next]
    if (close === undefined) break
    out += text.slice(from, at) + text.slice(at + mark.length, close)
    from = close + mark.length
    at = from - 1
  }
  return out + text.slice(from)
}

/**
 * Whether `line` is a table's delimiter row: blanks around, an optional
 * pipe at each end, and cells of dashes (a colon allowed at either end of
 * one) set apart by pipes. Read by splitting at the pipes, each cell trimmed
 * once: no pattern with overlapping blank runs to backtrack through.
 */
function isDelimiterRow(line: string): boolean {
  let row = line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').every(cell => /^:?-+:?$/.test(cell.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')))
}

/** Whether a block is a Markdown table (a header row, a delimiter row, rows). */
export function isTable(block: string): boolean {
  return tableParts(block) !== null
}

/** The columns a cell takes on screen, wide characters as two. */
function cellWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u.test(char) ? 2 : 1
  }
  return width
}

/** The parts of a block that is a Markdown table (a header row, a delimiter row, rows); null for a block that is no table. */
function tableParts(block: string): { header: string[]; body: string[][]; widths: number[]; total: number } | null {
  // Lines without the carriage return a CRLF ending leaves; blank ones (spaces and tabs) dropped.
  const lines = block
    .split('\n')
    .map(withoutReturn)
    .filter(line => !isBlankLine(line))
  // Header or delimiter indented four columns or more: the lines are code (or prose), not a table.
  const isIndented = (line: string): boolean => columnsOf(/^[ \t]*/.exec(line)?.[0] ?? '') >= 4
  if (lines.length < 2 || !(lines[0] ?? '').includes('|') || isIndented(lines[0] ?? '') || isIndented(lines[1] ?? '')) return null
  if (!isDelimiterRow(lines[1] ?? '')) return null
  const header = cellsOf(lines[0] ?? '')
  // A delimiter row of another count of cells makes no table (a setext heading, then prose).
  if (cellsOf(lines[1] ?? '').length !== header.length) return null
  // A row that begins another block (a quote, a heading, a list item, a
  // fence, a break) ends the table: the block mixes the two, and draws as
  // Markdown rather than as a table that would drop its text.
  const beginsBlock = /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|[-+*][ \t]|\d{1,9}[.)][ \t]|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/
  if (lines.slice(2).some(line => beginsBlock.test(line))) return null
  const body = lines.slice(2).map(cellsOf)
  // Each column's widest cell, found row by row: a long table spreads into no argument list.
  const widths = header.map(cell => cellWidth(cell))
  // Only the cells a row has (up to the header's count): a missing cell widens nothing, and a sparse table costs its cells, not rows by columns.
  for (const row of body) {
    const reach = Math.min(row.length, widths.length)
    for (let at = 0; at < reach; at += 1) widths[at] = Math.max(widths[at] ?? 0, cellWidth(row[at] ?? ''))
  }
  const total = widths.reduce((sum, width) => sum + width, 0) + TABLE_GAP * Math.max(0, header.length - 1)
  return { header, body, widths, total }
}

const TABLE_GAP = 2

/** The size a string takes in the serialized drawing: quotes, backslashes and escapes counted. */
function serialized(text: string): number {
  return JSON.stringify(text).length
}

/**
 * A block that is a Markdown table, laid out for `columns` of pane: a grid
 * where every column fits at its widest cell, else one card per row. Null
 * for a block that is no table. Never cut: the body's budget charges a
 * table what it draws at most (`tableCost`).
 */
export function tableLayout(block: string, columns: number): TableLayout | null {
  const parts = tableParts(block)
  if (parts === null) return null
  const { header, body, widths, total } = parts
  const count = header.length
  if (total <= columns) {
    const pad = (cells: readonly string[]) =>
      header
        .map((_, at) => {
          const cell = cells[at] ?? ''
          return at === count - 1 ? cell : cell + ' '.repeat(Math.max(0, (widths[at] ?? 0) - cellWidth(cell)))
        })
        .join(' '.repeat(TABLE_GAP))
        .trimEnd()
    return { kind: 'grid', header: pad(header), rule: widths.map(width => '─'.repeat(width)).join(' '.repeat(TABLE_GAP)), rows: body.map(pad) }
  }
  // A table of headers alone, too wide for a grid: its headers as one wrapping line.
  if (body.length === 0) return { kind: 'grid', header: header.join(' '.repeat(TABLE_GAP)), rule: '', rows: [] }
  return {
    kind: 'cards',
    cards: body.map(row =>
      row
        .slice(0, header.length)
        .map((value, at) => ({ label: header[at] ?? '', value }))
        .filter(entry => entry.value !== ''),
    ),
  }
}

/** The descriptor a drawn element costs over its text, with room to spare. */
const ELEMENT_COST = 120

/**
 * What a table block costs the body's budget: the most it can draw, in
 * serialized characters, whatever the pane's width (the larger of its grid,
 * every row padded to the table's natural width in one element, and its
 * cards, each label repeated per row, an element per entry). Null for a
 * block that is no table, charged as its source. A table too large for the
 * pane is then cut as any block is: unanchorable, with a note.
 */
export function tableCost(block: string): number | null {
  const parts = tableParts(block)
  if (parts === null) return null
  const { header, body, total } = parts
  const rows = body.length + 2
  const grid = rows * (total + 2) * 2 + 4 * ELEMENT_COST
  let cards = ELEMENT_COST
  for (const row of body) {
    cards += ELEMENT_COST
    const reach = Math.min(row.length, header.length)
    for (let at = 0; at < reach; at += 1) {
      const value = row[at] ?? ''
      if (value !== '') cards += serialized(header[at] ?? '') + serialized(value) + 2 * ELEMENT_COST
    }
  }
  return Math.max(grid, cards)
}

/**
 * Text as the pane draws it in place of an image reference: the terminal
 * shows no image, and the server's address for one (`strata://image/...`)
 * means nothing there. `![alt](address)` reads `[image: alt]`.
 */
export function withoutImages(text: string): string {
  // A fence, or a code span, is literal: an image reference written there is code.
  // (A fence block's first line read loosely: inside a list item it sits past the three columns `opensFence` allows.)
  if (/^[ \t]*(?:`{3,}|~{3,})/.test(text.split('\n')[0] ?? '')) return text
  let out = ''
  let from = 0
  const runs = [...text.matchAll(/`+/g)].map(run => ({ at: run.index ?? 0, length: run[0].length }))
  const byLength = new Map<number, { indexes: number[]; next: number }>()
  runs.forEach((run, index) => {
    const entry = byLength.get(run.length)
    if (entry === undefined) byLength.set(run.length, { indexes: [index], next: 0 })
    else entry.indexes.push(index)
  })
  const nextRunOf = (length: number, after: number): number => {
    const entry = byLength.get(length)
    if (entry === undefined) return -1
    while (entry.next < entry.indexes.length && (entry.indexes[entry.next] ?? 0) < after) entry.next += 1
    return entry.indexes[entry.next] ?? -1
  }
  let i = 0
  while (i < runs.length) {
    const run = runs[i]
    if (run === undefined) break
    // A backslash before a run escapes its first backtick (an odd count of
    // them): the opener is what follows it, if anything.
    let slashes = 0
    for (let at = run.at - 1; at >= from && text[at] === '\\'; at -= 1) slashes += 1
    const opener = slashes % 2 === 1 ? { at: run.at + 1, length: run.length - 1 } : run
    if (opener.length === 0) {
      i += 1
      continue
    }
    // The next run of the opener's length, found through the runs of each
    // length in order (a pointer per length, moving only forward): no rescan
    // of the runs between for every opener.
    const j = nextRunOf(opener.length, i + 1)
    const closer = j === -1 ? undefined : runs[j]
    if (closer === undefined) {
      i += 1
      continue
    }
    out += imagesNamed(text.slice(from, opener.at)) + text.slice(opener.at, closer.at + closer.length)
    from = closer.at + closer.length
    i = j + 1
  }
  return out + imagesNamed(text.slice(from))
}

/**
 * `text` with each image reference, `![alt](address "title")`, named
 * (`[image: alt]`): read in one forward pass, each lookahead (the alt's
 * closing bracket, a title's closing quote) found at most once per stretch,
 * so a run of unclosed openers costs no rescan of the text after them.
 */
function imagesNamed(text: string): string {
  let out = ''
  let from = 0
  // The first `]` at or after the last place one was looked for (-1: none past it).
  let bracket = -2
  let bracketFrom = -1
  // A place past which no closing quote stands (a title's search that failed).
  let noQuoteFrom = Number.POSITIVE_INFINITY
  // The bracket whose address was last read, and where that address ends (-1: none).
  let addressFor = -1
  let addressAt = -1
  for (let at = text.indexOf('!['); at !== -1; at = text.indexOf('![', at + 1)) {
    if (at < from) continue
    // A bang a backslash escapes (an odd count of them) is a literal `!` before a link: left as written.
    let slashes = 0
    for (let k = at - 1; k >= 0 && text[k] === '\\'; k -= 1) slashes += 1
    if (slashes % 2 === 1) continue
    if (bracket === -2 || (bracket !== -1 && bracket < at + 2) || bracketFrom > at + 2) {
      bracket = text.indexOf(']', at + 2)
      bracketFrom = at + 2
    }
    if (bracket === -1) break
    if (text[bracket + 1] !== '(') continue
    // Openers sharing one bracket share its address: read once, its failure kept too.
    if (addressFor !== bracket) {
      addressFor = bracket
      addressAt = addressEnd(text, bracket + 2, () => noQuoteFrom, place => {
        noQuoteFrom = Math.min(noQuoteFrom, place)
      })
    }
    const end = addressAt
    if (end === -1) continue
    const alt = text.slice(at + 2, bracket).trim()
    out += text.slice(from, at) + (alt === '' ? '[image]' : `[image: ${alt}]`)
    from = end
    at = end - 1
  }
  return out + text.slice(from)
}

/**
 * Where an image's address that starts at `start` ends (past its closing
 * parenthesis), or -1: escaped characters, one level of balanced
 * parentheses, then an optional title in double quotes after blanks.
 */
function addressEnd(text: string, start: number, noQuoteFrom: () => number, sawNoQuote: (place: number) => void): number {
  let i = start
  while (i < text.length) {
    const char = text[i] ?? ''
    if (char === '\\' && i + 1 < text.length) {
      i += 2
    } else if (char === ')') {
      return i + 1
    } else if (char === '(') {
      i += 1
      while (i < text.length && text[i] !== ')' && text[i] !== '(') i += text[i] === '\\' ? 2 : 1
      if (text[i] !== ')') return -1
      i += 1
    } else if (/\s/.test(char)) {
      let j = i
      while (j < text.length && /\s/.test(text[j] ?? '')) j += 1
      if (text[j] !== '"') return -1
      j += 1
      if (j >= noQuoteFrom()) return -1
      const titleStart = j
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      if (j >= text.length) {
        sawNoQuote(titleStart)
        return -1
      }
      return text[j + 1] === ')' ? j + 2 : -1
    } else {
      i += 1
    }
  }
  return -1
}

/** What `read_document` answered, in the two shapes it has. */
export type ReadResult = {
  id: string
  title: string
  version: number
  format: 'markdown' | 'outline'
  /** The Markdown read; empty for an outline answer. */
  markdown: string
  /** The server's outline, when the answer carried one. */
  outline: StrataOutlineEntry[]
  /** The heading paths a sectioned read returned. */
  sectionsReturned: string[]
}

/** Parse the JSON `read_document` answers; null for anything else. */
export function parseReadResult(text: string): ReadResult | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = record.documentId
  const title = record.title
  if (typeof id !== 'string' || typeof title !== 'string') return null
  const version = typeof record.documentVersion === 'number' ? record.documentVersion : 0
  const format = record.format === 'outline' ? 'outline' : 'markdown'
  const markdown = typeof record.content === 'string' ? record.content : ''
  const outline = Array.isArray(record.outline)
    ? record.outline.flatMap(entry => {
        if (typeof entry !== 'object' || entry === null) return []
        const row = entry as Record<string, unknown>
        const path = typeof row.path === 'string' ? row.path : null
        if (path === null || path === '') return []
        const heading = typeof row.heading === 'string' ? row.heading : path.split(' > ').pop() ?? path
        const level = typeof row.headingLevel === 'number' ? row.headingLevel : path.split(' > ').length
        return [{ level: Math.max(1, level), title: heading, path }]
      })
    : []
  const sectionsReturned = Array.isArray(record.sectionsReturned)
    ? record.sectionsReturned.filter((entry): entry is string => typeof entry === 'string')
    : []
  return { id, title, version, format, markdown, outline, sectionsReturned }
}
