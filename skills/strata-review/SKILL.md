---
name: strata-review
description: >
  Review a Strata document (strata.space) and leave anchored comments on it,
  rather than silently rewriting it. Reads the document, drafts feedback tied
  to exact passages, and posts it as comments through the Strata MCP server.
  Use for "review this Strata doc and leave comments", "mark up this document",
  "leave feedback on X without changing it", "comment on the parts that need
  work". No CLI install required.
---

# Strata review

Review a document the way a careful colleague would: read it, then leave
comments anchored to the exact passages they refer to. This skill never edits
the document body. Feedback goes in as comments the author can read, reply to,
and resolve. To change the text itself, that is `strata-publish`
(`replace_document_text`), and the user has to ask for it explicitly.

## Comments only, by design

This skill uses Strata's comment tools and nothing else: `create_comment`,
`list_comments` and `set_comment_resolved`. Strata also has suggestion tools
(`propose_suggestion` and its accept, reject and withdraw counterparts) that
propose concrete text replacements the author can accept in one click. They
sit in the same MCP capability group as comments, so they may appear in the
tool list, but **this skill deliberately does not use them.** If the user
wants proposed edits rather than discussion comments, tell them it is a
different mode and confirm before switching to it. Do not reach for the
suggestion tools on your own.

Older servers bundled these operations as `manage_comments` and
`manage_suggestions` with an `action` field. Current servers still accept
those names but leave them out of the tool list, so use the single-operation
tools.

## Prerequisite check

`create_comment` lives in the `comments` capability group, which the plugin's
MCP registration enables, and it is a write operation, so the MCP session also
needs write scope. If `create_comment` is not available:

- The `comments` group is not enabled on the connection, or the OAuth grant
  has no write scope. Tell the user the MCP connection needs the
  `X-Strata-Tool-Groups:core,comments` header (the bundled `.mcp.json` sets
  it, so reconnect after confirming it) and write scope. Do not fall back to
  editing the document.

## Read first, with existing threads

Identify the target document (the user names it, or `find` it by title). Then
read it **with its existing comments** so you do not duplicate feedback that is
already there or comment on a passage someone has already flagged:

Call `read_document` with the document ID and `includeComments` enabled. Note
which passages already carry comments and what they say. Your review adds to
the conversation; it does not repeat it.

## Draft, confirm, then post

Work through the document and draft each comment as a pair: the exact passage
it is about, and what you want to say. Aim for substance over volume: a handful
of specific, actionable comments beats a swarm of nitpicks.

Before posting, show the user the comments you intend to leave, as a short
list (passage → comment), and get a quick confirmation. Posting comments writes
to a document other people may be reading, so do not surprise the author with a
wall of comments they did not see coming.

On confirmation, post each with `create_comment`:

- `quotedText`: the exact substring from the document the comment anchors to.
  It must match the document text verbatim, or the anchor will not resolve.
- `headingContext`: the heading breadcrumb the passage sits under. Always
  include it. It is what disambiguates the anchor when the same phrase appears
  more than once in the document.
- `body`: the comment itself, in Markdown.

Post comments one at a time and stop if one fails (for example, the
`quotedText` did not resolve); fix the anchor and retry that one rather than
plowing ahead.

## Managing threads

The other comment tools handle the rest of the lifecycle when the user asks:
`create_comment` with `parentCommentId` replies in a thread,
`set_comment_resolved` with `resolved` set to `true` or `false` resolves or
reopens a thread, and `list_comments` (filter by `status`) enumerates threads.
Resolve a thread only when the user asks you to, and never resolve other
people's comments as a side effect of your review.

## Out of scope

- Editing the document body. This skill comments; it does not rewrite.
- The suggestion tools (`propose_suggestion` and its accept, reject and
  withdraw counterparts). They are available on the wire, but this skill does
  not use them. Switch modes only on explicit request.
- Accepting or resolving the author's own comments or suggestions on their
  behalf.
