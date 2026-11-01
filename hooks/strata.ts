// What the mod knows about Strata's MCP surface: which server a tool call
// went through, the text a tool answered, the document link, and the shape
// of a `find` info answer. Pure functions: no `$`, no state.

import type { StrataExplorerResult, StrataThread } from '../types'
import { type Fence, type HtmlBlock, HTML_BLOCKS, columnsFrom, columnsOf, htmlBlockStart, insideFence, MAX_NESTED_MARKERS, opensFence, proseLines, runsOn } from './markdown'

/** The server segment of an MCP tool name, `mcp__<server>__<tool>`. */
export function serverOf(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const cut = tool.lastIndexOf('__')
  if (cut <= 5) return null
  return tool.slice(5, cut)
}

/** The tool segment of an MCP tool name. */
export function toolOf(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const cut = tool.lastIndexOf('__')
  if (cut <= 5) return null
  return tool.slice(cut + 2)
}

/**
 * The document's link in the web app: the workspace chooser's deep link,
 * since MCP results carry a document id but no workspace slug.
 */
export function docUrl(documentId: string): string {
  return `https://app.strata.space/workspaces?next=%2Fdocuments%2F${encodeURIComponent(documentId)}`
}

/**
 * The deployment a Strata URL points at: its host and port, the host less
 * the `api.` or `app.` in front (`beta.strata.space:443` for the API and
 * the web app of beta alike), so the CLI's API and a document's link in the
 * web app name one deployment the same way. An address with a port keeps
 * it (two local stacks differ by port alone), and a bracketed IPv6 host is
 * kept whole. Null for anything that is not such a URL: no watch is started
 * on what cannot be told apart.
 */
export function deploymentOf(url: string): string | null {
  const match = /^(https?):\/\/([^/?#]*)/i.exec(url.trim())
  if (match === null) return null
  const scheme = (match[1] ?? '').toLowerCase()
  let authority = match[2] ?? ''
  const userEnd = authority.lastIndexOf('@')
  if (userEnd !== -1) authority = authority.slice(userEnd + 1)
  let host: string
  let port: string
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    if (close === -1) return null
    host = authority.slice(0, close + 1).toLowerCase()
    const rest = authority.slice(close + 1)
    if (rest !== '' && !rest.startsWith(':')) return null
    port = rest.slice(1)
  } else {
    const colon = authority.lastIndexOf(':')
    host = (colon === -1 ? authority : authority.slice(0, colon)).toLowerCase()
    port = colon === -1 ? '' : authority.slice(colon + 1)
  }
  if (host === '' || (port !== '' && !/^\d{1,5}$/.test(port))) return null
  const named = host.startsWith('[') ? host : host.replace(/^(api|app)\./, '')
  return `${named}:${port === '' ? (scheme === 'https' ? '443' : '80') : port}`
}

/** One content block an MCP tool answers with. */
type ContentBlock = { type?: unknown; text?: unknown }

/** The text blocks of an MCP tool's answer, joined. */
export function textOf(result: { content: readonly ContentBlock[]; structuredContent?: unknown }): string {
  const texts = result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
  if (texts.length > 0) return texts.join('\n')
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent)
  return ''
}

/** What a `find` with `intent: 'info'` on a document answers, as the mod reads it. */
export type DocumentInfo = {
  id: string
  title: string
  version: number
  url: string | null
  openComments: number
  pendingSuggestions: number
  viewing: number
}

/**
 * Parse an info answer: the summary at the top level, or under a key the
 * server may wrap it in. Null when the text is no such answer.
 */
export function infoOf(text: string): DocumentInfo | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const candidates: unknown[] = [value]
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    for (const key of ['document', 'info', 'result']) candidates.push(record[key])
    if (Array.isArray(record.results)) candidates.push(record.results[0])
    if (Array.isArray(record.documents)) candidates.push(record.documents[0])
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const row = candidate as Record<string, unknown>
    if (typeof row.documentId !== 'string' || typeof row.documentVersion !== 'number') continue
    const presence = row.presence
    const viewing =
      typeof presence === 'object' && presence !== null && typeof (presence as Record<string, unknown>).count === 'number'
        ? ((presence as Record<string, unknown>).count as number)
        : 0
    return {
      id: row.documentId,
      title: typeof row.title === 'string' ? row.title : '',
      version: row.documentVersion,
      url: typeof row.url === 'string' ? row.url : null,
      openComments: typeof row.openCommentCount === 'number' ? row.openCommentCount : 0,
      pendingSuggestions: typeof row.pendingSuggestionCount === 'number' ? row.pendingSuggestionCount : 0,
      viewing,
    }
  }
  return null
}

/** The root comments a `list_comments` answer carries, as the pane draws them; replies are left out. */
export function threadsOf(text: string): StrataThread[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof value !== 'object' || value === null) return []
  const rows = (value as Record<string, unknown>).comments
  if (!Array.isArray(rows)) return []
  const threads: StrataThread[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const item = row as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.body !== 'string') continue
    if (typeof item.parentCommentId === 'string' && item.parentCommentId !== '') continue
    const anchor = typeof item.anchor === 'object' && item.anchor !== null ? (item.anchor as Record<string, unknown>) : {}
    threads.push({
      id: item.id,
      author:
        typeof item.authorDisplayName === 'string' && item.authorDisplayName !== ''
          ? item.authorDisplayName
          : typeof item.authorEmail === 'string'
            ? item.authorEmail
            : 'someone',
      body: item.body,
      quotedText: typeof anchor.quotedText === 'string' ? anchor.quotedText : '',
      status: item.status === 'resolved' ? 'resolved' : 'active',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    })
  }
  return threads
}

/** An id a tool's JSON answer carries, under any of `keys`, at its top or one level down. */
export function idIn(text: string, keys: readonly string[]): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const candidates: unknown[] = [value]
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (typeof nested === 'object' && nested !== null) candidates.push(nested)
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const row = candidate as Record<string, unknown>
    for (const key of keys) {
      if (typeof row[key] === 'string' && row[key] !== '') return row[key] as string
    }
  }
  return null
}

/**
 * A search snippet as a person reads it: the server's match markers
 * (`<<word>>`, `<b>word</b>`) dropped, and the HTML entities it may carry
 * (`&rarr;`, `&amp;`, numeric ones) turned into their characters.
 */
export function plainSnippet(snippet: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', mdash: '—', ndash: '–', hellip: '…' }
  return snippet
    .replace(/<<|>>|<\/?(?:b|em|mark|strong)>/gi, '')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (whole, name: string) => {
      const code = name.startsWith('#x') || name.startsWith('#X') ? Number.parseInt(name.slice(2), 16) : name.startsWith('#') ? Number.parseInt(name.slice(1), 10) : null
      if (code === null) return named[name.toLowerCase()] ?? whole
      // A code point past Unicode's range, or a control character, stays as written.
      return code > 0x1f && code <= 0x10ffff && (code < 0x7f || code > 0x9f) ? String.fromCodePoint(code) : whole
    })
}

/** The documents a `find` search answered, as the explorer lists them. */
export function searchResults(text: string): StrataExplorerResult[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  const rows = Array.isArray(record.documents)
    ? record.documents
    : Array.isArray(record.results)
      ? record.results
      : Array.isArray(record.items)
        ? record.items
        : []
  const seen = new Set<string>()
  const out: StrataExplorerResult[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const item = row as Record<string, unknown>
    const id =
      typeof item.documentId === 'string'
        ? item.documentId
        : typeof item.docId === 'string'
          ? item.docId
          : typeof item.id === 'string'
            ? item.id
            : null
    if (id === null || seen.has(id)) continue
    seen.add(id)
    const title = typeof item.title === 'string' ? item.title : typeof item.docTitle === 'string' ? item.docTitle : id
    const spaces = Array.isArray(item.spaceNames) ? item.spaceNames.filter((one): one is string => typeof one === 'string') : []
    const snippet = typeof item.snippet === 'string' ? plainSnippet(item.snippet) : ''
    const detail = spaces.length > 0 ? spaces.join(', ') : clip(snippet.replace(/\s+/g, ' ').trim(), 72)
    out.push({ id, title, detail })
  }
  return out
}

/** A title cut to `width` cells for a band or a tab. */
export function clip(text: string, width: number): string {
  if (text.length <= width) return text
  return `${text.slice(0, Math.max(1, width - 1))}…`
}

/** A `@strata:doc_…` mention a person typed: which document, and where it stands in the text. */
/**
 * A passage as the pane quotes it into the prompt: on lines of its own, each
 * line (split at every ending the mention scan reads: a CRLF, a bare
 * carriage return, a line feed) behind a quote mark, and a blank line after.
 */
export function quoteForPrompt(passage: string): string {
  return `\n${passage
    .split(/\r\n|\r|\n/)
    .map(line => `> ${line}`)
    .join('\n')}\n\n`
}

export type MentionSpan = { id: string; start: number; end: number }

/** What may stand right before a mention of its own: nothing, space, or an opening mark. */
const BEFORE_MENTION = /[\s([{<"'*“‘]/
/** What may not follow one: more of a word in any script, a path, or an address. Tested on the text after the mention, so a character of two code units counts whole. */
const AFTER_MENTION = /^[\p{L}\p{N}\p{M}_/\\@~-]/u
/** A dot or a colon with more of a word after it: a file name, a domain, a path. No mention either. */
const AFTER_MENTION_JOINED = /^[.:][\p{L}\p{N}_/\\.]/u

/** The columns a line's leading blanks take, a tab reaching the next stop of four, as Markdown counts an indented code line. */
function indentOf(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/**
 * The mentions in a prompt that stand on their own, in order: outside fenced
 * code, outside indented code, outside inline code, outside quoted lines
 * (`> `), and not part of a longer word, path or address. A document's text
 * the pane quoted, a pasted log, a URL, a file name or a literal in
 * backticks spells no mention, so nothing is read for it and the text is
 * left as typed.
 */
export function mentionSpans(written: string): MentionSpan[] {
  // A bare carriage return ends a line as a line feed does: read as one (same
  // length, so the offsets returned hold for the text as written).
  const text = written.replace(/\r(?!\n)/g, '\n')
  // Block level, as Markdown reads it: which stretches of the text are
  // paragraphs of the person's own prose. A fence holds code to its close,
  // or to the end of the list item it opened under, or of the text (read
  // through `opensFence` and `insideFence`, the pane's own reading of
  // fences, so the two scanners agree); an indented line after a
  // paragraph's end is code; a quoted line is not prose of the person's,
  // nor is a line running its paragraph on lazily (no blank between, no
  // block of its own begun); a blank line ends a paragraph.
  const paragraphs: { start: number; end: number }[] = []
  let open: { start: number; end: number } | null = null
  // The list item the open paragraph began as, if any: the column its text
  // starts at, and its delimiter (the bullet, or an ordered one's mark). A
  // line indented to that column is the item's own text, judged with the
  // column stripped (a nested item numbered 1 interrupts it, one numbered
  // otherwise runs it on); a line short of it is a sibling item of the same
  // delimiter, whatever its number, or a block that may interrupt prose.
  let openOffset = 0
  let openDelimiter: string | null = null
  const interruptsOpen = (line: string, inner: string, columns: number, ordered: RegExpExecArray | null): boolean => {
    if (openOffset > 0 && columns >= openOffset) return beginsBlock(pastColumns(line, openOffset))
    return beginsBlock(inner) || (ordered !== null && isSiblingMark(ordered[1] ?? '', columns))
  }
  // A marker short of an open item's column, of that item's delimiter, is a
  // sibling of it (the paragraph's own item, or one enclosing it), whatever
  // its number: it ends the paragraph and the items inside that one.
  const isSiblingMark = (delimiter: string, columns: number): boolean =>
    delimiter === openDelimiter || containers.some(item => item.column > columns && item.delimiter === delimiter)
  // The list items in force as containers, innermost last, each by the
  // column its text starts at: kept across blank lines while lines stay
  // indented to it (their blocks judged with the column stripped, a fence
  // among them the item's), ended by a line short of it that runs no
  // paragraph on. A line is in the deepest item whose column it reaches.
  const containers: ListItem[] = []
  const containerAt = (columns: number): number => {
    let at = 0
    for (const item of containers) {
      if (item.column > columns) break
      at = item.column
    }
    return at
  }
  // An empty item's marker (`-`, `2.`) read from `from`: a container one column past it.
  const pushEmptyItem = (text: string, from: number): void => {
    const mark = /^( {0,3})([-+*]|\d{1,9}([.)]))/.exec(text)
    if (mark === null) return
    containers.push({ column: columnsFrom(mark[0], from) + 1, delimiter: mark[3] ?? mark[2] ?? '' })
  }
  const cutContainers = (columns: number): void => {
    while (containers.length > 0 && (containers[containers.length - 1]?.column ?? 0) > columns) containers.pop()
  }
  let fence: Fence | null = null
  // The HTML block open, if any: its kind (what ends it), and the column of the item it is in (zero outside any), whose end ends it too.
  let html: { kind: HtmlBlock; column: number } | null = null
  // Whether the line before was a quote's own text, which this one may run on.
  let isQuoting = false
  const endParagraph = (): void => {
    if (open !== null) paragraphs.push(open)
    open = null
  }
  // Each line as the block scans read it (`physicalLine`: a Unicode separator is text there).
  const lines = text.split('\n').map(line => line.replace(/[\u2028\u2029]/g, 'x'))
  // The block a definition was last looked for in: its end line, where it starts in the text, and its text.
  let block: { endLine: number; startAt: number; text: string } | null = null
  let at = 0
  for (let n = 0; n < lines.length; n += 1) {
    const raw = lines[n] ?? ''
    const lineStart = at
    at += raw.length + 1
    // A line ended by CRLF is read without its carriage return.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    // An HTML block holds raw lines, no prose: to the line its end marker is
    // on (included), or, for one of the kinds a blank line ends, to that
    // blank line.
    if (html !== null) {
      const isBlank = /^[ \t]*$/.test(line)
      if (!isBlank && columnsOf(/^[ \t]*/.exec(line)?.[0] ?? '') < html.column) {
        // The item the block was in ended under it: the line is read anew.
        html = null
      } else if (html.kind.end !== null) {
        if (html.kind.end.test(line)) html = null
        continue
      } else if (!isBlank) continue
      else html = null
    }
    // A blank line, as Markdown has it: spaces and tabs alone (another
    // whitespace character is text, and runs a code span on).
    if (/^[ \t]*$/.test(line)) {
      endParagraph()
      isQuoting = false
      continue
    }
    const columns = columnsOf(/^[ \t]*/.exec(line)?.[0] ?? '')
    // The items the line falls short of end here, unless it runs a
    // paragraph on (a block of its own ends them below). The line is read
    // as its container does: the container's column stripped.
    if (open === null) cutContainers(columns)
    const base = containerAt(columns)
    const inner = pastColumns(line, base)
    // The list items the line begins (`- 10. text` begins two), each a
    // container from here on, whatever begins in the innermost: a fence, a
    // quote, or a paragraph.
    const items = itemsOf(inner, base)
    const innermost = items.items[items.items.length - 1]
    // A block of its own ends the paragraph before it: a code span never
    // runs from one block into the next. A heading's text is prose of the
    // person's, scanned alone; a thematic break or a setext underline holds
    // none; a list item begins the paragraph of its own text.
    const ordered = /^ {0,3}\d{1,9}([.)])[ \t]+[^ \t]/.exec(inner)
    // An empty item of the same list (its marker alone, short of the open
    // item's column) ends the item's paragraph and opens none of its own;
    // one of another list cannot interrupt a paragraph, and runs it on.
    const marker = /^ {0,3}([-+*]|\d{1,9}([.)]))[ \t]*$/.exec(inner)
    if (open !== null && marker !== null && openOffset > 0 && columns < openOffset && isSiblingMark(marker[2] ?? marker[1] ?? '', columns)) {
      endParagraph()
      cutContainers(columns)
      // The empty sibling is a container of its own for the lines after it.
      pushEmptyItem(inner, base)
      continue
    }
    if (open !== null) {
      if (!interruptsOpen(line, inner, columns, ordered)) {
        // A setext underline (equals signs, or hyphens too few for a
        // thematic break), reaching the paragraph's column, closes the
        // paragraph before it as its heading; one short of the column
        // runs the paragraph on, as any line does.
        if (columns >= openOffset && /^ {0,3}(?:=+|-+)[ \t]*$/.test(pastColumns(line, openOffset))) {
          endParagraph()
          continue
        }
        // A line that begins no block of its own runs the paragraph on,
        // whatever marks it bears: a quote or a fence behind a marker that
        // cannot interrupt is the paragraph's text.
        open.end = lineStart + line.length
        continue
      }
      endParagraph()
      cutContainers(columns)
    }
    // A line after a quote's text runs it on, unless it begins a block of
    // its own. Held even where the quote's text was a fence or a heading,
    // which Markdown would not run on: a mention there is left as typed.
    if (isQuoting && !beginsBlock(inner)) continue
    isQuoting = false
    // An empty list item (its marker alone, on a line of its own or after
    // the markers of the items it is nested in) begins a container all the
    // same: its content, on the lines after, stands one column past it.
    const items0 = itemsOf(inner, base)
    if (/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]*$/.test(items0.rest)) {
      cutContainers(columns)
      containers.push(...items0.items)
      pushEmptyItem(items0.rest, items0.items[items0.items.length - 1]?.column ?? base)
      continue
    }
    // A fresh block: a fence or a quote, in the innermost item the line
    // begins or in the line itself (the fence's padding judged by columns,
    // as the items were: five columns leave indented code, no fence).
    const opened = opensFence(items.rest)
    if (opened !== null) {
      fence = { ...opened, indent: innermost?.column ?? base }
      containers.push(...items.items)
      continue
    }
    const quote = /^ {0,3}>(.*)$/.exec(items.rest)
    if (quote !== null) {
      isQuoting = /[^ \t]/.test(quote[1] ?? '')
      containers.push(...items.items)
      continue
    }
    // Else indented code, an HTML block, a link reference definition, a
    // heading, a thematic break, or a paragraph. The items begun are
    // containers from here on.
    containers.push(...items.items)
    // Indented code (four columns past the item's text) holds no prose.
    if (indentOf(items.rest) >= 4) continue
    // An HTML block begins: its lines are raw to its end (`htmlBlockStart`),
    // or to the end of the item it is in.
    const htmlStart = htmlBlockStart(items.rest)
    if (htmlStart !== null) {
      if (htmlStart.end === null || !htmlStart.end.test(items.rest)) html = { kind: htmlStart, column: innermost?.column ?? base }
      continue
    }
    // A link reference definition, as Markdown takes it (`leadingDefinition`,
    // one at a time, over the lines of this block: to the next blank line,
    // or the next line beginning a block of its own at the container's
    // column): a block of its own holding no prose, the lines after it read
    // anew as what they are. Looked for only where a line begins like one
    // (a label may run over lines, so an opening bracket is enough to
    // look); the block's text and bound are found once and kept for the
    // definitions after it, each read at its own offset.
    if (DEFINITION_OPENER.test(line)) {
      if (block === null || n >= block.endLine) {
        const column = innermost?.column ?? base
        let endLine = n + 1
        while (endLine < lines.length) {
          const next = (lines[endLine] ?? '').replace(/\r$/, '')
          if (/^[ \t]*$/.test(next) || beginsBlock(pastColumns(next, column))) break
          endLine += 1
        }
        let endAt = lineStart - 1
        for (let k = n; k < endLine; k += 1) endAt += (lines[k] ?? '').length + 1
        block = { endLine, startAt: lineStart, text: text.slice(lineStart, endAt) }
      }
      const from = lineStart - block.startAt
      const taken = leadingDefinition(block.text, from)
      if (taken !== null) {
        const consumed = block.text.slice(from, taken)
        const count = consumed.split('\n').length - (consumed.endsWith('\n') ? 1 : 0)
        for (let k = 1; k < count; k += 1) at += (lines[n + k] ?? '').length + 1
        n += count - 1
        continue
      }
    }
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(items.rest)) {
      open = { start: lineStart, end: lineStart + line.length }
      endParagraph()
      continue
    }
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(items.rest)) continue
    open = { start: lineStart, end: lineStart + line.length }
    // The paragraph's item: the innermost begun here, else the one it is in.
    const item = innermost ?? containers[containers.length - 1]
    openOffset = item?.column ?? 0
    openDelimiter = item?.delimiter ?? null
  }
  endParagraph()
  // Inline level, per paragraph: a code span (a run of backticks closed by
  // a run of the same length, across line breaks within the paragraph; a
  // run never closed is literal text) is skipped, and a mention elsewhere
  // counts when it stands on its own.
  const spans: MentionSpan[] = []
  // The addresses of the paragraph being scanned, as ranges of `text`: a URL
  // (a scheme, `://`, then to the next blank or angle bracket) and a Markdown
  // link's destination (`](…)`) spell no mention either, whatever marks stand
  // around one inside them. Found over the whole paragraph, code spans and
  // all, before the paragraph is cut around its code spans: an address that
  // holds a code span is still one address.
  let held: { start: number; end: number }[] = []
  let isHeld: (at: number) => boolean = () => false
  const scan = (from: number, to: number): void => {
    for (const match of text.slice(from, to).matchAll(/@strata:(doc_[A-Za-z0-9]+)/g)) {
      const index = from + (match.index ?? 0)
      if (isHeld(index)) continue
      const end = index + match[0].length
      const before = index === 0 ? '' : (text[index - 1] ?? '')
      if (before !== '' && !BEFORE_MENTION.test(before)) continue
      // Opening marks before it stand at a word's start too: `/tmp/(@strata:…)`
      // is a path, not a mention in parentheses.
      let start = index
      while (start > 0 && /[([{<"'*“‘]/.test(text[start - 1] ?? '')) start -= 1
      if (start > 0 && !/\s/.test(text[start - 1] ?? '')) continue
      // Enough of what follows to hold a mark and a whole character after it.
      const after = text.slice(end, end + 3)
      if (AFTER_MENTION.test(after) || AFTER_MENTION_JOINED.test(after)) continue
      // So do the closing marks after it: `(@strata:…)/README.md` and
      // `(@strata:…).md` are paths, `(@strata:…).` the end of a sentence.
      let close = end
      while (close < text.length && /[)\]}>"'*”’]/.test(text[close] ?? '')) close += 1
      if (close > end) {
        const past = text.slice(close, close + 3)
        if (AFTER_MENTION.test(past) || AFTER_MENTION_JOINED.test(past)) continue
      }
      spans.push({ id: match[1] ?? '', start: index, end })
    }
  }
  // Where the last paragraph held for a pipe ended: a table runs on to the
  // next blank line, its body rows pipe-free or not.
  let heldTo = -1
  // Cut where the block scan sees a block begin (a list item of another
  // kind or number short of the paragraph's container, say): a code span
  // never pairs across blocks the pane's own reading tells apart.
  const runs = runsOn(text)
  // Where each line starts, found once: a line is looked up by offset with a binary search.
  const lineStarts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lineStarts.push(at + 1)
  const lineAt = (offset: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if ((lineStarts[mid] ?? 0) <= offset) low = mid
      else high = mid - 1
    }
    return low
  }
  const cut: { start: number; end: number }[] = []
  for (const paragraph of paragraphs) {
    let from = paragraph.start
    let line = lineAt(from)
    for (let at = text.indexOf('\n', from); at !== -1 && at < paragraph.end; at = text.indexOf('\n', at + 1)) {
      line += 1
      if (runs[line] === true) continue
      cut.push({ start: from, end: at })
      from = at + 1
    }
    cut.push({ start: from, end: paragraph.end })
  }
  for (const paragraph of cut) {
    const para = text.slice(paragraph.start, paragraph.end)
    // A paragraph holding a pipe may be a table, or part of one (a header
    // the block scan split from its delimiter row, rows a thematic break or
    // setext underline cut off): its cells are inline scopes of their own,
    // and a mention in one is an example. Held whole, deliberately coarse:
    // a mention in prose beside a pipe is left as typed, never read unasked.
    // So is every paragraph after it with no blank line between: a table's
    // body rows need no pipe, and run on until a blank line ends the table.
    const isAfterHeld = heldTo >= 0 && !/\n[ \t]*\r?\n/.test(text.slice(heldTo, paragraph.start))
    if (para.includes('|') || isAfterHeld) {
      heldTo = paragraph.end
      continue
    }
    const code = codeSpansOf(para)
    held = addressesOf(para, code).map(range => ({ start: paragraph.start + range.start, end: paragraph.start + range.end }))
    isHeld = insideAny(held)
    let cursor = paragraph.start
    for (const span of code) {
      scan(cursor, paragraph.start + span.start)
      cursor = paragraph.start + span.end
    }
    scan(cursor, paragraph.end)
  }
  // The block scan the pane reads with has the last word on where prose is:
  // a mention on a line it reads as code, raw HTML or a quote's is none.
  const prose = proseLines(text)
  return spans.filter(span => span.id !== '' && (prose[lineAt(span.start)] ?? false))
}

type Range = { start: number; end: number }

/**
 * A test of whether an offset falls inside any of `ranges` (each from its
 * start, up to its end): a binary search over them sorted by start, with
 * the furthest end reached so far kept per place, so many ranges and many
 * offsets cost no scan of every range for every offset.
 */
function insideAny(ranges: readonly Range[]): (at: number) => boolean {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const reach: number[] = []
  let far = Number.NEGATIVE_INFINITY
  for (const range of sorted) {
    far = Math.max(far, range.end)
    reach.push(far)
  }
  return at => {
    let low = 0
    let high = sorted.length - 1
    let found = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if ((sorted[mid]?.start ?? 0) <= at) {
        found = mid
        low = mid + 1
      } else high = mid - 1
    }
    return found !== -1 && (reach[found] ?? 0) > at
  }
}


/** A list item as a container: the column its text starts at, and its delimiter (the bullet, or an ordered one's mark). */
type ListItem = { column: number; delimiter: string }

/**
 * The list items a line of text begins, from the outermost in (`- 10. text`
 * begins two), each by the column its text starts at (counted from `base`,
 * the column the line is read from, tab stops of four) and its delimiter;
 * and `rest`, the text past the markers. A marker is followed by one to
 * four blanks and then text; five or more blanks pad it by one, the rest
 * being the item's text, indented code.
 */
function itemsOf(inner: string, base: number): { items: ListItem[]; rest: string } {
  const items: ListItem[] = []
  let rest = inner
  let column = base
  // At most `MAX_NESTED_MARKERS` items per line, as the pane's block scan reads them.
  for (let depth = 0; depth < MAX_NESTED_MARKERS; depth += 1) {
    // A thematic break at this level (`- - -`) begins no item.
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(rest)) break
    const marker = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))([ \t]*)/.exec(rest)
    if (marker === null) break
    const mark = (marker[2] ?? '') + (marker[3] ?? '') + (marker[4] ?? '')
    const blanks = marker[5] ?? ''
    if (blanks === '' || rest.length === marker[0].length) break
    const markerEnd = columnsFrom((marker[1] ?? '') + mark, column)
    const blankEnd = columnsFrom(blanks, markerEnd)
    let padding = blanks
    let remainder = ''
    if (blankEnd - markerEnd <= 4) column = blankEnd
    else {
      // Five or more: one column of padding; a tab's further columns stay, as blanks of the item's text.
      padding = blanks.slice(0, 1)
      remainder = ' '.repeat(columnsFrom(padding, markerEnd) - markerEnd - 1)
      column = markerEnd + 1
    }
    items.push({ column, delimiter: marker[2] ?? marker[4] ?? '' })
    rest = remainder + rest.slice((marker[1] ?? '').length + mark.length + padding.length)
    if (padding !== blanks) break
  }
  return { items, rest }
}

/**
 * `line` past its first `columns` columns of blanks (a tab reaching the next
 * multiple of four), the rest of its leading blanks given as spaces: a tab
 * past the boundary is measured from where it stands, not from column zero.
 */
function pastColumns(line: string, columns: number): string {
  let seen = 0
  let i = 0
  while (i < line.length) {
    const char = line[i]
    if (char === ' ') seen += 1
    else if (char === '\t') seen += 4 - (seen % 4)
    else break
    i += 1
  }
  return ' '.repeat(Math.max(0, seen - columns)) + line.slice(i)
}

/**
 * Whether `line` begins a block of its own, which the paragraph before it
 * cannot run on into: an ATX heading, a thematic break, a list item (an
 * ordered one numbered 1, zeros before it or not), a quote, a fence, or an
 * HTML block of a kind that may interrupt a paragraph.
 */
function beginsBlock(line: string): boolean {
  return (
    /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line) ||
    /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line) ||
    /^ {0,3}(?:[-+*]|0{0,8}1[.)])[ \t]+[^ \t]/.test(line) ||
    /^ {0,3}>/.test(line) ||
    isFenceAtLevel(line) ||
    HTML_BLOCKS.some(kind => kind.interrupts && kind.start.test(line))
  )
}

/** Whether `line` opens a fence at its own level (no list marker before it): a backtick fence's info string holds no backtick. */
function isFenceAtLevel(line: string): boolean {
  const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  return delimiter !== null && !((delimiter[1] ?? '')[0] === '`' && (delimiter[2] ?? '').includes('`'))
}

/** A raw span in angle brackets found in a paragraph: where it starts, and how long it runs. */
type InlineTag = { index: number; length: number }

const ASCII_BLANK = /[ \t\n\v\f\r]/
// eslint-disable-next-line no-control-regex
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\x00-\x20<>\x7f]*>/y
const MAIL_AUTOLINK = /<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/y
const CLOSING_TAG = /<\/[A-Za-z][A-Za-z0-9-]*[ \t\n\v\f\r]*>/y

/**
 * A finder of the raw spans in angle brackets of `para`, as Markdown has
 * them, the first at or past a place: an autolink (a scheme and an address,
 * or a mail address), an open tag (its attributes over lines, set apart by
 * ASCII whitespace alone, a value quoted or bare), a closing tag, a comment
 * (the short forms `<!-->` and `<!--->` whole, else to the first `-->`), a
 * processing instruction, a declaration, or a CDATA section. Tried in that
 * order at each `<`; each terminator (`-->`, `?>`, `>`, `]]>`, a closing
 * quote) is searched for through a cache that only moves forward, so a run
 * of unclosed openers costs no rescan of the paragraph after them.
 */
function inlineTags(para: string): (from: number) => InlineTag | null {
  const found = new Map<string, { from: number; at: number }>()
  const nextOf = (needle: string, from: number): number => {
    const cached = found.get(needle)
    if (cached !== undefined && from >= cached.from && (cached.at === -1 || from <= cached.at)) return cached.at
    const at = para.indexOf(needle, from)
    found.set(needle, { from, at })
    return at
  }
  const sticky = (pattern: RegExp, at: number): number => {
    pattern.lastIndex = at
    return pattern.test(para) ? pattern.lastIndex : -1
  }
  const openTagEnd = (at: number): number => {
    let i = at + 1
    if (!/[A-Za-z]/.test(para[i] ?? '')) return -1
    i += 1
    while (/[A-Za-z0-9-]/.test(para[i] ?? '')) i += 1
    for (;;) {
      let j = i
      while (ASCII_BLANK.test(para[j] ?? '')) j += 1
      if (para[j] === '>') return j + 1
      if (para[j] === '/' && para[j + 1] === '>') return j + 2
      // An attribute: set apart by whitespace, a name, an optional value.
      if (j === i || !/[A-Za-z_:]/.test(para[j] ?? '')) return -1
      j += 1
      while (/[A-Za-z0-9_.:-]/.test(para[j] ?? '')) j += 1
      let k = j
      while (ASCII_BLANK.test(para[k] ?? '')) k += 1
      if (para[k] === '=') {
        k += 1
        while (ASCII_BLANK.test(para[k] ?? '')) k += 1
        const quote = para[k]
        if (quote === '"' || quote === "'") {
          const close = nextOf(quote, k + 1)
          if (close === -1) return -1
          j = close + 1
        } else {
          let m = k
          while (m < para.length && !/[ \t\n\v\f\r"'=<>`]/.test(para[m] ?? '')) m += 1
          if (m === k) return -1
          j = m
        }
      }
      i = j
    }
  }
  const endAt = (at: number): number => {
    for (const pattern of [AUTOLINK, MAIL_AUTOLINK]) {
      const end = sticky(pattern, at)
      if (end !== -1) return end
    }
    const open = openTagEnd(at)
    if (open !== -1) return open
    const closing = sticky(CLOSING_TAG, at)
    if (closing !== -1) return closing
    if (para.startsWith('<!-->', at)) return at + 5
    if (para.startsWith('<!--->', at)) return at + 6
    if (para.startsWith('<!--', at)) {
      const close = nextOf('-->', at + 4)
      return close === -1 ? -1 : close + 3
    }
    if (para.startsWith('<?', at)) {
      const close = nextOf('?>', at + 2)
      return close === -1 ? -1 : close + 2
    }
    if (para.startsWith('<!', at) && /[A-Za-z]/.test(para[at + 2] ?? '')) {
      const close = nextOf('>', at + 3)
      return close === -1 ? -1 : close + 1
    }
    if (para.startsWith('<![CDATA[', at)) {
      const close = nextOf(']]>', at + 9)
      return close === -1 ? -1 : close + 3
    }
    return -1
  }
  return from => {
    for (let at = para.indexOf('<', from); at !== -1; at = para.indexOf('<', at + 1)) {
      const end = endAt(at)
      if (end !== -1) return { index: at, length: end - at }
    }
    return null
  }
}

/**
 * The raw spans of a paragraph, as ranges of it: its code spans (a run of
 * backticks closed by the next run of the same length, across line breaks;
 * a run never closed is literal text, and the search goes on after it) and
 * its inline HTML tags, whichever begins first taking the text to its end
 * (a backtick in a tag's attribute opens nothing; a tag in a code span is
 * text). A backslash before a run escapes its first backtick, which is
 * then literal and opens nothing: the run is what follows it, if anything.
 * Inside a span a backslash is literal, so a closer is never escaped.
 */
function codeSpansOf(para: string): Range[] {
  const runs = [...para.matchAll(/`+/g)].map(run => ({ at: run.index ?? 0, length: run[0].length }))
  // The runs of each length in order, a pointer per length moving only
  // forward: a closer is found without rescanning the runs between.
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
  // The next inline tag at or past a place, kept while the search place has
  // not passed it (or, when none was found, for good): no rescan to the end
  // of the paragraph at every backtick run.
  let tagFrom = -1
  let tagFound: InlineTag | null = null
  const tags = inlineTags(para)
  const tagAt = (place: number): InlineTag | null => {
    if (tagFrom !== -1 && place >= tagFrom && (tagFound === null || place <= tagFound.index)) return tagFound
    tagFound = tags(place)
    tagFrom = place
    return tagFound
  }
  const out: Range[] = []
  let i = 0
  let from = 0
  for (;;) {
    while (i < runs.length && (runs[i]?.at ?? 0) < from) i += 1
    const run = runs[i]
    const tag = tagAt(from)
    if (tag !== null && (run === undefined || tag.index < run.at)) {
      // A bracket a backslash escapes opens no tag: the search goes on past it.
      if (backslashesBefore(para, tag.index) % 2 === 1) {
        from = tag.index + 1
        continue
      }
      out.push({ start: tag.index, end: tag.index + tag.length })
      from = tag.index + tag.length
      continue
    }
    if (run === undefined) break
    let opener = run
    if (backslashesBefore(para, opener.at) % 2 === 1) {
      opener = { at: opener.at + 1, length: opener.length - 1 }
      if (opener.length === 0) {
        i += 1
        from = run.at + run.length
        continue
      }
    }
    const j = nextRunOf(opener.length, i + 1)
    const closer = j === -1 ? undefined : runs[j]
    if (closer === undefined) {
      i += 1
      from = run.at + run.length
      continue
    }
    out.push({ start: opener.at, end: closer.at + closer.length })
    i = j + 1
    from = closer.at + closer.length
  }
  return out
}

/**
 * The addresses in a paragraph, as ranges of it: each URL (a code span
 * inside one and all), each mail or chat address and each autolink in
 * angle brackets, each link reference definition's line, and each link
 * destination from its `](` (not one inside a code span, where it is
 * literal) to the parenthesis that closes it, parentheses inside balanced,
 * a title in quotes skipped whole, and a backslash escaping the character
 * after it; a destination never closed runs to the end, so nothing in it is
 * read unasked.
 */
function addressesOf(para: string, code: readonly Range[]): Range[] {
  const inCode = insideAny(code)
  const out: Range[] = []
  // A URL with a scheme and `//`, or bare with `www.`; a mail or chat
  // address with its scheme alone (as the GitHub flavour reads them bare);
  // and an autolink in angle brackets, any scheme, to its closing bracket.
  // Each runs to an ASCII blank or control character, or a bracket: other
  // whitespace is part of it.
  // eslint-disable-next-line no-control-regex
  const address = /\bwww\.[^\x00-\x20<>\x7f]+|\b(?:mailto|xmpp):[^\x00-\x20<>\x7f]+|<[a-z][a-z0-9+.-]{1,31}:[^\x00-\x20<>\x7f]*>/gi
  for (const url of para.matchAll(address)) {
    out.push({ start: url.index ?? 0, end: (url.index ?? 0) + url[0].length })
  }
  // A scheme and `//`: found from each `://` (its scheme read back from
  // there, to the first letter standing at a word's start in the run of
  // scheme characters before it), so a long run of scheme characters with no
  // `://` after it is read once, not once per place in it; a `://` inside an
  // address already found starts none.
  let reached = 0
  for (let at = para.indexOf('://'); at !== -1; at = para.indexOf('://', at + 1)) {
    if (at < reached) continue
    let run = at
    while (run > 0 && /[a-z0-9+.-]/i.test(para[run - 1] ?? '')) run -= 1
    let start = -1
    for (let k = run; k < at; k += 1) {
      if (/[a-z]/i.test(para[k] ?? '') && (k === 0 || !/\w/.test(para[k - 1] ?? ''))) {
        start = k
        break
      }
    }
    if (start === -1) continue
    // eslint-disable-next-line no-control-regex
    const tail = /[^\x00-\x20<>\x7f]+/y
    tail.lastIndex = at + 3
    const rest = tail.exec(para)
    if (rest === null) continue
    reached = at + 3 + rest[0].length
    out.push({ start, end: reached })
  }
  // A link reference definition (`[label]: destination "title"`, at the
  // start of a line, list markers before it or not, the label to its first
  // unescaped bracket, the destination allowed on the next line and the
  // title on the one after, running on over lines to its closing quote or
  // parenthesis): all of it is an address, title and all. One whose opener
  // falls inside a code span is literal; a label of blanks alone opens
  // none. Held wherever its line starts, even where Markdown would read it
  // as a paragraph's prose: a mention there is left as typed rather than
  // read unasked.
  // (A label holds no unescaped bracket and runs at most 999 characters, as Markdown has it: its search stops at the next bracket.)
  for (const definition of para.matchAll(/^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]{1,4})*\[((?:\\[\s\S]|[^[\]\\]){1,999})\]:/gm)) {
    const start = definition.index ?? 0
    if (inCode(start)) continue
    if (!isLabel(definition[1] ?? '')) continue
    out.push({ start, end: definitionEnd(para, start + definition[0].length).end })
  }
  let from = 0
  for (;;) {
    const open = para.indexOf('](', from)
    if (open === -1) break
    // One inside a code span, or whose bracket a backslash escapes, opens no link.
    if (inCode(open) || backslashesBefore(para, open) % 2 === 1) {
      from = open + 2
      continue
    }
    let depth = 0
    let end = para.length
    // Where the destination itself begins: past the blanks Markdown allows after the opening parenthesis.
    const destination = open + 2 + (/^\s*/.exec(para.slice(open + 2))?.[0].length ?? 0)
    for (let i = open + 1; i < para.length; i += 1) {
      const char = para[i]
      if (char === '\\') {
        i += 1
      } else if (char === '<' && i === destination) {
        // A destination in angle brackets: to its closing bracket, whatever parentheses it holds.
        i = closingBracket(para, i)
      } else if ((char === '"' || char === "'") && depth === 1 && /\s/.test(para[i - 1] ?? '')) {
        // A title, after the blank that sets it off from the destination: to
        // its closing quote, whatever parentheses it holds. A quote elsewhere
        // (an apostrophe in an address) is a character of the destination.
        i = closingQuote(para, i)
      } else if (char === '(') {
        depth += 1
      } else if (char === ')') {
        depth -= 1
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    out.push({ start: open, end })
    from = end
  }
  return out
}

/**
 * A link reference definition's label at a line's start, list markers
 * before it or not: `[label]:`, the label holding no unescaped bracket of
 * either kind (the lenient scan that holds addresses allows an opening one;
 * this, which strips a definition as a block, does not). Read at an offset
 * of a block's text, sticky, so a block of many definitions is not copied
 * for each.
 */
const DEFINITION_LABEL_AT = /[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]{1,4})*\[((?:\\[\s\S]|[^[\]\\])+)\]:/y
/** Where a definition may begin: a line opening a bracket after blanks and list markers (its label may run over the lines after). */
const DEFINITION_OPENER = /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]{1,4})*\[/

/** Whether what stands between a label's brackets is one: something besides blanks, and at most 999 characters. */
function isLabel(inside: string): boolean {
  return inside.length <= 999 && /\S/.test(inside)
}

/** What a sticky pattern matches at `at` in `text`; empty for nothing. */
function matchAt(pattern: RegExp, text: string, at: number): string {
  pattern.lastIndex = at
  return pattern.exec(text)?.[0] ?? ''
}

/** The blank Markdown allows inside a definition: blanks, a line break among them or not. */
const DEFINITION_BLANK = /[ \t]*(?:\r?\n[ \t]*)?/y
/** A bare destination: to an ASCII blank or control character, other whitespace being part of it. */
// eslint-disable-next-line no-control-regex
const BARE_DESTINATION = /[^\x00-\x20\x7f]*/y

/** Where a link reference definition runs to, and what of it Markdown takes. */
type Definition = {
  /** Past the title, where there is one; else past the destination. */
  end: number
  /** Past the destination. */
  destinationEnd: number
  /** Whether the destination is one Markdown takes: present, closed on its line in angle brackets with no unescaped bracket inside, its parentheses balanced otherwise. */
  isDestinationValid: boolean
  /** Whether a title was found after the destination. */
  hasTitle: boolean
  /** Whether that title is one Markdown takes: closed, and holding no unescaped opening parenthesis where parentheses enclose it. */
  isTitleValid: boolean
  /** Whether that title began on the line after the destination. */
  isTitleOnNextLine: boolean
}

/**
 * Where the definition whose label ends at `from` ends in `para`: past its
 * destination (allowed on the next line; in angle brackets, or a run with
 * no blank in it), then past a title after a blank, to the title's closing
 * mark over lines (a backslash escaping the character after it). The range
 * is answered whatever Markdown takes of it, for holding; what it takes
 * decides where a definition stripped as a block ends.
 */
function definitionEnd(para: string, from: number): Definition {
  let i = from
  i += matchAt(DEFINITION_BLANK, para, i).length
  let isDestinationValid = true
  if (para[i] === '<') {
    const close = closingBracket(para, i)
    const inside = para.slice(i + 1, close)
    if (close >= para.length || inside.includes('\n') || hasUnescaped(inside, '<')) isDestinationValid = false
    i = close + 1
  } else {
    const run = matchAt(BARE_DESTINATION, para, i)
    if (run === '' || !hasBalancedParentheses(run)) isDestinationValid = false
    i += run.length
  }
  const destinationEnd = Math.min(i, para.length)
  const blank = i < para.length ? matchAt(DEFINITION_BLANK, para, i) : ''
  const opener = para[i + blank.length]
  let hasTitle = false
  let isTitleValid = false
  if (blank !== '' && (opener === '"' || opener === "'" || opener === '(')) {
    hasTitle = true
    const close = closingMark(para, i + blank.length, opener === '(' ? ')' : opener)
    isTitleValid = close < para.length && !(opener === '(' && hasUnescaped(para.slice(i + blank.length + 1, close), '('))
    i = close + 1
  }
  return {
    end: Math.min(i, para.length),
    destinationEnd,
    isDestinationValid,
    hasTitle,
    isTitleValid,
    isTitleOnNextLine: hasTitle && blank.includes('\n'),
  }
}

/** Whether `text` holds `char` with no backslash escaping it. */
function hasUnescaped(text: string, char: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1
    else if (text[i] === char) return true
  }
  return false
}

/** Whether `run` holds its parentheses balanced, a backslash escaping the character after it. */
function hasBalancedParentheses(run: string): boolean {
  let depth = 0
  for (let i = 0; i < run.length; i += 1) {
    const char = run[i]
    if (char === '\\') i += 1
    else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

/** Whether nothing but blanks follows `from` on its line of `para`. */
function endsLine(para: string, from: number): boolean {
  const lineEnd = para.indexOf('\n', from)
  return /^[ \t\r]*$/.test(para.slice(from, lineEnd === -1 ? para.length : lineEnd))
}

/**
 * Where the link reference definition beginning at `from` of `block` ends,
 * as Markdown takes it, past the end of its last line: its destination
 * valid; its title, where it has one, valid and ending its line, or else
 * dropped where it began on the line after the destination (which then
 * ends the definition on its own line, and the title's line is prose);
 * one with more on its line is no definition, and prose begins there.
 * Null where none begins there.
 */
function leadingDefinition(block: string, from: number): number | null {
  DEFINITION_LABEL_AT.lastIndex = from
  const label = DEFINITION_LABEL_AT.exec(block)
  if (label === null || !isLabel(label[1] ?? '')) return null
  const definition = definitionEnd(block, from + label[0].length)
  if (!definition.isDestinationValid) return null
  let stop: number
  if (definition.hasTitle && definition.isTitleValid && endsLine(block, definition.end)) stop = definition.end
  else if (definition.hasTitle && definition.isTitleOnNextLine && endsLine(block, definition.destinationEnd)) stop = definition.destinationEnd
  else if (!definition.hasTitle && endsLine(block, definition.destinationEnd)) stop = definition.destinationEnd
  else return null
  const lineEnd = block.indexOf('\n', stop)
  return lineEnd === -1 ? block.length : lineEnd + 1
}

/** How many backslashes stand right before `at`: an odd count escapes the character there. */
function backslashesBefore(text: string, at: number): number {
  let count = 0
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i -= 1) count += 1
  return count
}

/** The index of the quote closing the one at `open` (a backslash escaping the character after it), or the text's end. */
function closingQuote(para: string, open: number): number {
  return closingMark(para, open, para[open] ?? '"')
}

/** The index of the `>` closing the `<` at `open` (a backslash escaping the character after it), or the text's end. */
function closingBracket(para: string, open: number): number {
  return closingMark(para, open, '>')
}

/**
 * The first `mark` past `open` that no backslash escapes, or the text's end.
 * The opener is no backslash, so a run of backslashes before a later mark
 * is the same counted from anywhere past it: each mark's unescaped places
 * in `para` are listed once (for the text last asked about) and found by a
 * binary search, so many unclosed openers cost no rescan to the end.
 */
function closingMark(para: string, open: number, mark: string): number {
  if (markText !== para) {
    markText = para
    markPlaces.clear()
  }
  let places = markPlaces.get(mark)
  if (places === undefined) {
    places = []
    for (let at = para.indexOf(mark); at !== -1; at = para.indexOf(mark, at + 1)) {
      if (backslashesBefore(para, at) % 2 === 0) places.push(at)
    }
    markPlaces.set(mark, places)
  }
  let low = 0
  let high = places.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((places[mid] ?? 0) <= open) low = mid + 1
    else high = mid
  }
  return places[low] ?? para.length
}

/** The text `closingMark` last listed marks for, and those lists by mark. */
let markText: string | null = null
const markPlaces = new Map<string, number[]>()
