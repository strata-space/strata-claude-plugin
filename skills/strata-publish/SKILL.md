---
name: strata-publish
description: >
  Push local content up into Strata (strata.space). Creates a single document
  from a draft or file, or syncs a whole folder of Markdown into a Space
  (new files become documents, changed files update them, removed files are
  trashed). Use for "publish this to Strata", "push my /docs folder to a
  Space", "upload this draft", "sync my local notes up to Strata". A single
  document needs only the Strata MCP connection; pushing a folder needs the
  `strata` CLI.
---

# Strata publish

Get local content into Strata. Two shapes, two paths. Decide which the user
is asking for before doing anything:

- **One document** (a draft in the conversation, or a single file): use the
  Strata MCP `edit_document` tool. No CLI needed.
- **A folder of Markdown** (many files, possibly nested): use the `strata`
  CLI's `sync push`. This is the only path that handles creates, updates, and
  deletes in one operation, and the only one that can preserve a nested folder
  structure (with `--folders`; see below).

This skill writes to the user's Strata content. Confirm the target and the
scope of the change before the first write, every time.

## Single document (MCP)

For a draft the user wrote in the conversation, or one file:

1. Confirm the title and target. New documents land in the user's default
   location and are visible to their org; mention that.
2. Call `edit_document` with `action="create"`, the `title`, and the Markdown
   `content`. Pass `folderId` only if the user named a folder.
3. Report the new document's title and link
   (`https://strata.space/app/documents/<documentId>` from the result).

To replace the body of a document that already exists, use `edit_document`
with `action="edit"` (targeted `oldString`/`newString`) or `action="write"`
(full replacement) instead of creating a duplicate. Search with the Strata
`find` tool first if you are unsure whether the document already exists.

## Folder of Markdown (CLI)

### Preflight

The folder path requires the `strata` CLI and an authenticated session.

```bash
command -v strata >/dev/null 2>&1 || printf 'strata CLI not installed\n'
strata status --json | jq -r '.status'
```

- If the CLI is not installed, the user needs the install flow that the
  `strata-spaces` sibling skill owns (Homebrew on macOS, the verified GitHub
  release on Linux). Hand off to it, then return here. Do not reimplement the
  install.
- If status is `logged_out` or `expired`, ask the user to run `strata login`
  themselves (do not run it for them; it opens a browser locally, or prints a
  URL to paste a code from over SSH or on a headless host). Re-check after.

### Pick the target Space

```bash
strata spaces --json | jq -r '.[] | "\(.name)\t\(.id)\t\(.documentCount)"'
```

If the user named a Space, match it. Otherwise present the list and ask. Save
the Space `id`. (To publish into a brand-new Space, the user creates it in the
web app first, or you run `strata api raw POST /api/v1/spaces --body
'{"name":"..."}'` with their consent.)

### Decide whether a pull is safe

`strata sync push` requires a sync manifest (`.strata-sync.json`) in the
folder, and refuses to run without one ("Run `strata sync pull` first"). The
manifest is what lets push diff local against remote. So a fresh folder needs a
`sync pull` to seed the manifest first. But `sync pull` writes the Space's
existing documents into the folder, which can co-mingle two sources of truth.
Check the target Space's contents before pulling:

```bash
strata api spaces documents "$space_id" --json | jq '.items | length'
```

Branch on what you find:

- **Empty target Space**: safe. The pull is a no-op that just seeds an empty
  manifest; the push then creates everything. This is the clean publish path.
- **Non-empty target, and the local folder shares filenames with the Space's
  documents**: stop. Pulling would overwrite or interleave the user's local
  files with remote ones. Explain the conflict and ask the user to publish into
  an empty Space, or to reconcile manually, rather than pulling.
- **Non-empty target, no filename overlap**: warn the user that `sync pull`
  will add the Space's existing documents into their local folder before the
  push, and get explicit consent before pulling.

### Seed the manifest, then push

`sync push` needs a manifest, so seed one with `sync pull` when none exists. For
an empty target Space the pull changes nothing and needs no consent. For the
non-empty, no-overlap case above, the pull writes the Space's documents into the
local folder, so gate it as its own step first:

> Plugin proposes: `strata sync pull <space> <dir>` to seed the sync manifest.
> This writes the Space's existing documents into `<dir>`. Proceed? [y/N]

Run the pull only when there is no manifest yet (and, for a non-empty target,
only after the consent above):

```bash
[ -f "$dir/.strata-sync.json" ] || strata sync pull "$space_id" "$dir"
```

Now show the user exactly what the push will do and gate on explicit consent:

> Plugin proposes: push the contents of `<dir>` to Space `<name>`. New files
> become new documents, changed files update existing ones, and files you have
> deleted locally are moved to Strata's trash (recoverable for 30 days from the
> web app). Proceed? [y/N]

Run the push only on `y`. Use `--json` so the result is machine-readable; this
also bypasses the CLI's own interactive prompt, which cannot be answered when
the command runs non-interactively. Do **not** pass `--force` for any other
reason: the conversation consent above is the gate.

By default the push is **flat**: every document lands at the Space root,
regardless of local subdirectories. If the folder is nested and the user wants
that structure mirrored in Strata, add `--folders`. It recreates each
subdirectory as a Strata folder and files documents into them. Confirm with the
user which they want when the folder has subdirectories; mention that without
`--folders`, nested files flatten to the root.

```bash
strata sync push "$space_id" "$dir" --json            # flat: all docs at Space root
strata sync push "$space_id" "$dir" --folders --json  # mirror the nested folder tree
```

Report the result honestly from the JSON
(`{status, modified, created, deleted, errors[]}`):

> Pushed to <name>: 3 created, 1 updated, 0 deleted.

If `status` is `partial` or `errors[]` is non-empty, surface each error
verbatim. A common one is a per-file conflict: the document changed on Strata
since the last sync. Do not silently retry or force past a conflict; show the
user the conflicting file and let them decide.

## Out of scope

- Resolving merge conflicts. Report them and point at the web app; the skill
  does not overwrite a conflicting remote document.
- Server-side repository indexing (pushing a codebase's interfaces into Strata
  search). That is a separate platform feature, not a CLI push.
- Leaving comments or review feedback: use `strata-review`.
