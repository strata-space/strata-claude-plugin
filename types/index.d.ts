/** A document the model read this session, as the ledger keeps it. */
export type StrataLoadedDoc = {
  id: string
  title: string
  /** The revision `read_document` returned when the model last read it. */
  versionAtRead: number
  /** The revision the last check found; `versionAtRead` until one differs. */
  versionNow: number
  /** When the model last read it, in milliseconds since the epoch. */
  readAt: number
  /** Heading paths the model read, when it read sections rather than the whole. */
  sectionsRead: string[]
  /** What of the document the model holds: all of it, the sections in `sectionsRead`, or its outline alone. */
  coverage: 'whole' | 'sections' | 'outline'
  /** The MCP server the read went through: the middle of `mcp__<server>__read_document`. */
  server: string
}

/** One heading of a document, as the pane's outline strip lists it. */
export type StrataOutlineEntry = {
  level: number
  title: string
  /** The heading path `read_document` takes in `sections`: titles joined by ` > `. */
  path: string
}

/** What the document pane draws. */
export type StrataDocView = {
  id: string
  title: string
  version: number
  server: string
  /**
   * The pane's navigation count: one more each time what the pane shows is
   * moved (a read of the model's, a fetch begun, a section picked, a close).
   * A fetch begun under one count applies nothing under another: the pane
   * moved on while it was out.
   */
  nav: number
  /** The Markdown the pane draws from: the whole document, or the sections it holds. */
  markdown: string
  /** The headings the Markdown holds, in order. */
  outline: StrataOutlineEntry[]
  /** The heading path the pane shows, or null for all it holds. */
  section: string | null
  /** True when `markdown` is the whole document; false for sections, or none. */
  isWhole: boolean
  /** The sections `markdown` holds when it is not the whole: their paths, as the whole document names them. */
  sectionsHeld: string[]
  /** How the Markdown got here: the model's read, or a fetch the pane made. */
  source: 'read' | 'fetch'
  /** True while the pane fetches a section. */
  isLoading: boolean
  /** The last fetch's failure, shown in the pane; null when none. */
  error: string | null
  /** The html fences the person expanded to their source, by index in the Markdown. */
  revealed: number[]
  /** The document's link in the web app. */
  url: string
  /** The block the cursor rests on, by index among the shown text's blocks; null for none. */
  cursor: number | null
  /** Where a selection started (`v`), so the cursor's moves extend it; null for one block. */
  anchor: number | null
  /** The text the person is writing in the pane, if any. */
  draft: StrataDraft | null
  /** The document's comment threads, as `list_comments` last answered. */
  threads: StrataThread[]
  /** Who else is on the document, from the live watch; empty without one. */
  presence: StrataPresence[]
  /**
   * True when `markdown` came from a read with comments or suggestions
   * folded in (footnotes, an appended block): drawn, but not the document's
   * own text, so nothing anchors to it until a plain fetch replaces it.
   */
  isAnnotated: boolean
  /**
   * True when `markdown` holds sections read together whose headings could
   * begin one section or belong to the one before it: the breadcrumbs over
   * its text are a guess, so nothing anchors to it until a fetch of the
   * whole document, or of one section, replaces it.
   */
  isAmbiguous: boolean
  /** A newer revision a poll found for the pane's document when the model never read it; null when none or caught up. */
  newerVersion: number | null
  /** The live watch's state for this document. */
  live: 'off' | 'starting' | 'connected' | 'reconnecting' | 'error'
  /** Why the watch is reconnecting or failed; null otherwise. */
  liveNote: string | null
}

/** One collaborator on the document, one row per person per client kind. */
export type StrataPresence = {
  entityId: string
  name: string
  color: string
  /** `web`, `terminal`, `agent`, or whatever kind the server names. */
  kind: string
}

/** How the mod follows documents: the CLI's live watch, or revision polls over MCP. */
export type StrataTier = 'cli-stream' | 'mcp-poll' | 'unknown'

/** What the pane's input field is for, what it holds, and what it was opened on. */
export type StrataDraft = {
  /** This draft's own tag, so a post closes the draft it was made from and no later one. */
  id: string
  kind: 'comment' | 'reply' | 'suggest' | 'ask'
  /** The field's text as last typed (the selection to start with, for a suggestion). */
  text: string
  /** The thread a reply goes to; null for the other kinds. */
  replyTo: string | null
  /** The document text the draft was opened on, kept as it was: a live edit under it changes nothing here. */
  quoted: string
  /** The heading breadcrumbs over that text. */
  heading: string[]
  /** The document revision the pane showed when the draft opened. */
  version: number
  /**
   * The field's generation: one more each time a post's settlement redraws
   * the field without the text it posted. The field's handlers carry the
   * generation they were drawn with, so a value from an older one is known
   * to come from before that redraw, with `posted` still in front.
   */
  field: number
  /**
   * The text the last post took from the field (the value Enter came with;
   * empty for a deletion proposed from an emptied replacement), so a value
   * the older field hands over loses it in front. Null for none: nothing
   * posted yet, or the redrawn field has spoken since.
   */
  posted: string | null
  /** True while a post from this draft is on its way: a second Enter posts nothing more. */
  isPosting: boolean
  /**
   * True once a post closed the draft with nothing typed since: the field is
   * not drawn, but until its redraw the old one still is, and a keystroke it
   * hands over reopens the draft with what came after the posted text.
   */
  isClosed: boolean
}

/** One comment thread's root, as the pane draws it beneath the paragraph it quotes. */
export type StrataThread = {
  id: string
  author: string
  body: string
  /** The document text the thread is anchored to; empty for a thread without one. */
  quotedText: string
  status: 'active' | 'resolved'
  createdAt: string
}

/** A comment or suggestion made this session, as the review queue lists it. */
export type StrataReviewItem = {
  kind: 'suggestion' | 'comment'
  id: string
  documentId: string
  documentTitle: string
  /** The MCP server it was made through, for the queue's own calls. */
  server: string
  summary: string
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'resolved'
  /** Who put it there: the model's own tool call, or the person in the pane. */
  origin: 'model' | 'pane'
}

/** One row of the explorer's search results. */
export type StrataExplorerResult = {
  id: string
  title: string
  detail: string
}

/** What the explorer pane draws. */
export type StrataExplorerView = {
  query: string
  results: StrataExplorerResult[]
  /** The MCP server `results` came through, which opening one reads from; null before any search. */
  server: string | null
  isSearching: boolean
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    strata: {
      ledger: Shaped<StrataLoadedDoc[]>
      doc: Shaped<StrataDocView | null>
      review: Shaped<StrataReviewItem[]>
      explorer: Shaped<StrataExplorerView>
      /** The Strata MCP server last seen in a tool call, for calls the panes make before any read. */
      server: string | null
      /** The person hid the band for this session. */
      isBandHidden: boolean
      /**
       * The document pane: never opened this session, open (or asked for),
       * or closed by `/strata close`. Kept here so a reload does not start a
       * watch for a pane nobody sees; the unasked first open happens once.
       */
      pane: 'unopened' | 'open' | 'closed'
      /** Whether the CLI's live watch is available this session, as the session start probed it. */
      tier: StrataTier
      /** The person's `/strata live on|off` for this session, over the `liveWatch` option; null for none. It outlives a reload. */
      liveOverride: 'on' | 'off' | null
      /** The MCP server each document a mention completion offered came through, by id: a mention is read from there. Outlives a reload. */
      mentionServers: Shaped<Record<string, string>>
    }
  }
}
