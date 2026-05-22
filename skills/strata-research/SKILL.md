---
name: strata-research
description: >
  Answer a question from the user's Strata knowledge base (strata.space) with
  citations. Searches their Spaces and documents over the Strata MCP server,
  reads the most relevant hits, follows document links for context, and
  synthesises an answer that links back to each source. Use for "ask my Strata
  docs", "what do we know about X", "summarize what our Space says about Y",
  "find the doc about Z", or any question answerable from the user's Strata
  content. No CLI install and no filesystem mount required.
---

# Strata research

Answer the user's question from their Strata content using the Strata MCP
tools that the plugin registers (`find`, `read_document`, `get_document_graph`).
This skill is read-only: it never edits, comments on, or publishes anything.
For those, use the `strata-publish` or `strata-review` siblings.

The Strata MCP server is registered automatically by the plugin's `.mcp.json`.
If its tools are not available, the MCP connection is not live; point the user
at the `strata-doctor` flow rather than guessing.

## Pick the scope

`find` takes a `scope` object, not a string. Choose the narrowest scope that
fits the question, because narrow scopes return cleaner results:

- The user named a Space, or the question is clearly about one body of work:
  `scope = { "type": "space", "id": "space_..." }`. If you do not have the ID,
  run `find` with `intent="list"`, `scope={ "type": "spaces" }` first and match
  by name.
- The user named a document: read it directly (see below), or use
  `scope = { "type": "document", "id": "doc_..." }` with `intent="related"` to
  pull neighbours.
- Anything broader, or you are unsure: `scope = { "type": "all" }`.
- The question is about Strata itself (how agents, prompts, MCP tools, Spaces
  work): `scope = { "type": "strataDocumentation" }`.

## Search, then broaden before reformulating

Run `find` with `intent="search"` and the user's question as `query`. Hybrid
keyword + semantic retrieval means a natural-language sentence works as well as
keywords; do not strip the query down to one word.

If you get zero or thin results, **broaden the scope before rewording the
query** (a narrow Space can be empty even when the content exists workspace-
wide): retry the same query with `scope = { "type": "all" }`. Only after a
broad search still comes back empty should you reword. If two broad searches
return nothing, tell the user you found nothing rather than inventing an answer.

Keep `limit` modest (the default is fine); pull more only when the top hits do
not cover the question.

## Read the hits

`find` returns snippets, not full documents. Before answering, `read_document`
the handful of top hits whose snippets actually bear on the question. Pass a
`maxTokens` budget when a document may be large so you do not exhaust context
on one file. Prefer reading two or three focused documents over skimming ten.

When the top document references or links to others and the answer depends on
that web of context, call `get_document_graph` on it once (`depth=1`) and read
a linked neighbour or two. Do not traverse deeper than one hop unless the user
asks for an exhaustive trace.

## Answer with citations

Synthesise the answer from what you read, and cite every non-obvious claim back
to its source document so the user can verify it. Cite by document title with a
link in the form `https://strata.space/app/documents/<docId>`, using the
`documentId` from the `find` or `read_document` result. For example:

> Pricing is per-seat with a hard per-user credit cap
> ([HLD: Pricing & Routing Restructure](https://strata.space/app/documents/doc_01KRFAMHE99512BY201H2J4AWK)).

Be honest about coverage: if the documents only partially answer the question,
say what is and is not covered, and name the gap. Distinguish what the user's
documents state from your own inference.

## Out of scope

- Writing answers back into Strata: that is `strata-publish` (new doc) or
  `strata-review` (comments).
- Editing or restructuring documents.
- Anything requiring the `strata` CLI or a filesystem mount: this skill is
  MCP-only by design.
