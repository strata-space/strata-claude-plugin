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
(`edit_document`), and the user has to ask for it explicitly.

## Comments only, by design

This skill uses the Strata `manage_comments` tool and nothing else. Strata also
has a `manage_suggestions` tool (propose concrete text replacements the author
can accept in one click); it is exposed on the same MCP capability group as
comments, so it may appear in the tool list, but **this skill deliberately does
not use it.** If the user wants proposed edits rather than discussion comments,
tell them that is a different mode and confirm before switching to it; do not
reach for `manage_suggestions` on your own.

## Prerequisite check

`manage_comments` lives in the `comments` capability group, which the plugin's
MCP registration enables, and it is a write operation, so the MCP session also
needs write scope. If the `manage_comments` tool is not available:

- The `comments` group is not enabled on this connection, or the OAuth grant
  has no write scope. Tell the user their MCP connection needs the
  `X-Strata-Tool-Groups:core,comments` header (the bundled `.mcp.json` sets it;
  reconnect after confirming it) and write scope. Do not fall back to editing
  the document.

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

On confirmation, post each with `manage_comments`, `action="create"`:

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

`manage_comments` also handles the rest of the comment lifecycle when the user
asks: `action="reply"` (with `parentCommentId`) to continue a thread,
`action="resolve"` / `action="reopen"` to change a thread's state, and
`action="list"` (filter by `status`) to enumerate threads. Resolve a thread
only when the user asks you to; do not resolve other people's comments as a
side effect of your review.

## Out of scope

- Editing the document body. This skill comments; it does not rewrite.
- `manage_suggestions` (proposed text edits). Available on the wire, but this
  skill does not use it. Switch modes only on an explicit request.
- Accepting or resolving the author's own comments or suggestions on their
  behalf.
