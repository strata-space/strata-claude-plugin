---
name: strata-doctor
description: >
  Diagnose why Strata is not working in Claude and map each failure to a
  concrete next step. Probes the Strata MCP connection (registered, signed in,
  write scope, tool groups), and — when the strata CLI is present — its auth
  state, mount health, and the most recent write failure (owner + request-access
  link). Use for "Strata isn't working in Claude", "why can't I see my docs",
  "my save failed", "permission denied on a Strata file", "is Strata connected",
  or "the Strata tools are missing". No CLI install required for the MCP half;
  the CLI half degrades gracefully when strata is not on PATH.
---

# Strata doctor

You are a diagnostician, not a surgeon. Every check below is read-only:
a probe `find`, `command -v`, `strata status --json`, reading config. You never
remediate by side effect — every fix is either something the **user** runs
(`strata login`, a `brew upgrade`) or a **hand-off** to the skill that owns it.
In particular this skill does **not** install the CLI (that is `strata-spaces`),
does **not** force-unmount stuck volumes (that is `strata-spaces` stuck-mount
recovery), and does **not** edit `.mcp.json`.

Run the layers in order. Layer 1 (MCP) needs no CLI and applies to every user.
Layer 2 (CLI) only runs when `strata` is on `PATH`; skip it cleanly otherwise.
Finish with the consolidated report so the user leaves with one clear next step.

## Layer 1 — MCP connectivity (always; no CLI needed)

### Registered, or just unreachable?

These are two different failures with two different fixes, so distinguish them
by what you can observe:

- **The Strata MCP tools are not in your toolkit at all** (no `find`,
  `read_document`, etc.). The server is **not registered**. The plugin's
  `.mcp.json` is supposed to register it automatically on install, so tell the
  user to confirm the `strata` plugin is installed and enabled, and to restart
  Claude if they just installed it. Editing `.mcp.json` is out of scope here —
  point at it, do not modify it.
- **The tools exist but a call fails.** The server is registered but
  unreachable or not yet authorized. Run a minimal probe — call the Strata
  `find` tool with a trivial query (intent `recent`, scope `all`, a small
  limit) — and read the error. A network/5xx error means the endpoint is down;
  an auth error routes to the next check.

### Signed in?

The first Strata MCP tool call in a session opens a browser for OAuth sign-in.
If the probe returned an authentication error, the grant has not completed:

> The Strata MCP server needs you to sign in. A browser window should open on
> the next tool call — complete the sign-in there, then ask me to retry.

After the user confirms, re-run the probe `find`.

### Write scope present?

`list_tools` hides write-bearing tools (`edit_document`, `manage_comments`,
`manage_suggestions`) unless the OAuth grant includes write scope. Symptom: the
user can search and read, but publish or review "has no tool to call." If the
write tools are absent from your toolkit while the read tools work, the grant is
read-only. Tell the user to re-authorize and accept the write scope when the
browser prompts.

### Tool groups active?

`manage_comments` / `manage_suggestions` (group `comments`) and the agent tools
(group `agents`) are gated behind the `X-Strata-Tool-Groups` header. The plugin
sends `core,comments`. The MCP server echoes the **active** groups in its
instructions string ("Active groups: …"). Compare:

- If the server reports `core` only but the user expects review/comments to
  work, the configured header is not reaching the server. Surface the mismatch
  ("configured: core,comments — active: core") and point at the plugin's
  `.mcp.json`; do not edit it.
- If the active groups include `comments`, the review surface is available and
  the problem is elsewhere (scope, or the document itself).

## Layer 2 — CLI state (only when `strata` is on PATH)

```bash
command -v strata >/dev/null 2>&1 || printf 'no-cli\n'
```

If the CLI is absent, say so plainly and stop the CLI layer:

> The strata CLI is not installed, so I can only diagnose the MCP side (above).
> Mounting and folder sync need the CLI — the `strata-spaces` skill owns that
> install. Everything in Layer 1 works without it.

Do not install it here.

### Environment consistency (CLI host vs MCP)

The released CLI defaults to production (`https://api.prod.us-east-2.strata.space`),
the same endpoint the plugin's `.mcp.json` registers the MCP server against, so
the two surfaces are consistent out of the box. A mismatch only arises when the
user overrides the CLI with `--api-url` / `STRATA_API_URL`, or runs a non-release
build (debug builds default to beta; localhost is never a default, only an
explicit override). When the surfaces point at different environments they see
different data and nothing lines up: a silent, total failure.

Read the URL the CLI is actually using (`apiUrl`, populated once logged in)
rather than guessing from the env var, which is unset for normal users:

```bash
strata status --json | jq -r '.apiUrl // "<not logged in; release builds default to prod>"'
```

If that URL is anything other than the production host the MCP server uses, the
mismatch is the bug: the CLI and the MCP server are looking at different
backends. Tell the user to unset the override (or point both at the same
environment) rather than chasing per-document errors.

### CLI version / sidecar capability

`strata status --json` carries a `recentWriteErrors` sidecar that powers the
permission-denied diagnosis below. If the field is absent entirely, the CLI is
too old to report write failures:

```bash
strata status --json | jq -e 'has("recentWriteErrors")' >/dev/null 2>&1 || printf 'cli-too-old\n'
```

On `cli-too-old`, tell the user:

> Your strata CLI is too old to report write failures. Run `brew upgrade --cask
> strata-space/strata/strata` (macOS) or download the latest Linux release, then
> retry.

### Auth state

```bash
strata status --json | jq -r '.status'
```

If `logged_out` or `expired`, ask the user to run `strata login` themselves (it
opens a browser; do not run it for them):

> Please run `strata login` in your terminal — it opens a browser to sign you
> in — then tell me when you are signed in.

### FSKit module (macOS only)

On macOS, every mount needs the bundled FSKit module installed and approved. The
module is a `pluginkit`-managed app extension, **not** a classic system
extension, so probe with `pluginkit` (the FSKit extension point is
`com.apple.fskit.fsmodule`). `systemextensionsctl` never lists FSKit modules and
will report a false negative:

```bash
[ "$(uname -s)" = Darwin ] && pluginkit -m -p com.apple.fskit.fsmodule 2>/dev/null | grep -i strata || true
```

macOS does **not** expose the System-Settings on/off toggle state to any CLI
(`pluginkit` shows a blank status flag whether the module is enabled or not, the
same as Apple's own msdos/exfat modules), so do not try to read "enabled" and do
not loop on a probe. Presence is all the CLI can tell you; a successful mount is
the only authoritative enabled-test.

- **A `space.strata.cli.fskit` line prints**: the module is installed and
  registered. If mounting works, this is not the problem. If a mount silently
  does nothing or fails with a permission/extension error, the module is
  installed but not approved; tell the user, verbatim:

  > Open **System Settings → General → Login Items & Extensions**. In the
  > **Extensions** section, switch from **By App** to **By Category** (the By App
  > view has a broken toggle that will not turn on and wrongly shows off). Open
  > **File System Extensions** and turn on **Strata CLI**.

- **No strata line**: the FSKit module is not installed. The CLI is missing or
  installed incorrectly; hand off to `strata-spaces` to (re)install.

### Mount health

```bash
strata status --json | jq -r '
  .mounts[] |
  "| \(.spaceName) | \(.mountpoint) | \(.backend) | \(if .writable then "writable" else "read-only" end) |"'
```

Render as a Markdown table (Space, Path, Backend, Mode). If a mount is stuck
(the user reports it hangs, or an unmount fails with `Resource busy` / `EBUSY`),
do **not** force it here — hand off to the `strata-spaces` stuck-mount recovery,
which proposes the platform-specific force unmount under explicit consent.

### Write refused (permission-denied)

Triggers: the user says their save failed, or mentions "permission denied",
"EACCES", "could not write", "save error", or any editor-side failure on a
mounted file.

Read the most-recent failure from `strata status --json`:

```bash
strata status --json | jq -r '
  .recentWriteErrors[0] // empty |
  "Document: \(.docTitle // .docId) (\(.docId))\nOwner: \(.ownerEmail // .ownerId)\nRequest access: https://strata.space/app/documents/\(.docId)"'
```

If `recentWriteErrors[0]` exists, render owner + the webapp link verbatim. Tell
the user their unsaved edits are still in the editor buffer (POSIX guarantees the
kernel did not commit) so they can retry the save against a different document if
needed. (If the field is missing entirely, you already caught it under "CLI
version / sidecar capability" above — point the user there.)

## Report

Close every run with a compact status table and exactly one headline — the
single highest-priority fix — so the user is not left to triage a list:

```
| Check                | Result            |
| -------------------- | ----------------- |
| MCP registered       | yes / no          |
| MCP signed in        | yes / no          |
| MCP write scope      | yes / no / n-a    |
| Tool groups          | core,comments     |
| CLI installed        | yes / no          |
| CLI / MCP same env   | yes / no / n-a    |
| CLI auth             | logged_in / …     |
| FSKit module (macOS) | installed / missing / n-a |
| Active mounts        | N                 |
| Recent write error   | none / <doc>      |
```

> **Next step:** <the one thing to do, e.g. "re-run `strata login` — your token
> expired">

If every check passes, do not stop at "everything looks fine" — that strands the
user with no resolution path:

> Every check passed: the MCP server is registered, signed in, and scoped, and
> the CLI is healthy. Paste the exact error message or describe what you clicked
> when it failed, and I'll dig into the specific symptom.

## Out of scope

- Editing the MCP configuration. The plugin's `.mcp.json` owns registration and
  the tool-group header; doctor reports on it but never rewrites it.
- Installing the CLI, enabling FSKit/FUSE, or force-unmounting. Those belong to
  `strata-spaces`; hand off rather than reimplement.
