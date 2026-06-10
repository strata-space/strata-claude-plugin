---
name: strata-doctor
description: >
  Diagnose why Strata is not working in Claude and map each failure to a
  concrete next step. Probes the Strata MCP connection (registered, signed in,
  write scope, tool groups), and — when the strata CLI is present — its auth
  state, mount health, live folder-link health (stuck/paused/degraded sync
  sessions, pending write journal, blocked supervised mounts), and the most
  recent write failure (owner + request-access link). Use for "Strata isn't
  working in Claude", "why can't I see my docs", "my save failed", "my edits
  aren't syncing", "sync is stuck/paused", "permission denied on a Strata file",
  "is Strata connected", or "the Strata tools are missing". No CLI install
  required for the MCP half; the CLI half degrades gracefully when strata is not
  on PATH.
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
  `find` tool with intent `list`, scope `spaces`, a small `limit` — and read
  the error. A network/5xx error means the endpoint is down; an auth error
  routes to the next check. (Use `list`, not `recent`: `recent` is plan-gated,
  so a `Feature gated` error there is a healthy server, not a fault.)

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
> Linking a folder and mounting need the CLI — the `strata-spaces` skill owns
> that install. Everything in Layer 1 works without it.

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
> strata-space/tap/strata` (macOS) or download the latest Linux release, then
> retry.

### Auth state

```bash
strata status --json | jq -r '.status'
```

If `logged_out` or `expired`, ask the user to run `strata login` themselves (do
not run it for them):

> Please run `strata login` in your terminal, then tell me when you are signed
> in. On a local machine it opens a browser; over SSH or on a headless host it
> prints a URL and asks you to paste back the code shown in the browser (or run
> `strata login --no-browser` to force that).

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

### FUSE runtime (Linux only)

On Linux, every mount goes through FUSE: the kernel `/dev/fuse` device plus the
`fusermount3` userspace helper from the `fuse3` package. Unlike macOS — where the
FSKit module ships *inside* the CLI, so a present CLI implies a present module —
`fuse3` is a separate system package. You are already in Layer 2, so the CLI is
on `PATH`; that says nothing about whether the FUSE runtime is present. Probe it
read-only, in the same order `strata-spaces` runs its preflight:

```bash
if [ "$(uname -s)" = Linux ]; then
  command -v fusermount3 >/dev/null 2>&1 || printf 'fuse3-missing\n'
  if [ ! -e /dev/fuse ]; then printf 'dev-fuse-absent\n'; fi
  if [ -e /dev/fuse ] && [ ! -r /dev/fuse ]; then printf 'dev-fuse-unreadable\n'; fi
  if getent group fuse >/dev/null 2>&1 && ! getent group fuse | grep -q "\b$USER\b"; then
    printf 'not-in-fuse-group\n'
  fi
fi
```

Map each finding to a fix the **user** runs — the same shape as the `brew
upgrade` / `strata login` fixes above, never a command this skill executes:

- **`fuse3-missing`** (no `fusermount3`): the FUSE userspace helper is not
  installed. The package is named `fuse3` on every distro `strata-spaces`
  supports, so tell the user to install it with their package manager — e.g.
  `sudo apt install fuse3` on Debian/Ubuntu, or the `dnf` / `pacman` / `zypper` /
  `apk` equivalent for their distro. If they would rather not run it by hand,
  `strata-spaces` installs `fuse3` under explicit consent as part of its
  preflight; hand off there.

- **`dev-fuse-absent`** (no `/dev/fuse`): the kernel exposes no FUSE device. This
  is the WSL / container / locked-down-kernel case, where a virtual-drive mount
  is not possible at all. Do not propose a fix for the mount — report that
  mounting is impossible on this system and point at the `strata-spaces` skill,
  which routes these platforms to a live link (`strata link`, no FUSE needed) or,
  failing that, the snapshot fallback (`strata sync pull`).

- **`dev-fuse-unreadable`** / **`not-in-fuse-group`**: FUSE is installed but the
  current user cannot open the device (group membership / udev). Both map to one
  fix; tell the user, verbatim:

  > Run `sudo usermod -aG fuse $USER`, then log out and back in for the group
  > change to take effect.

- **No token printed**: the FUSE runtime is ready. If a mount still fails, the
  problem is elsewhere (auth, the Space, or the mount itself) — fall through to
  mount health.

### Mount health

```bash
strata status --json | jq -r '
  .mounts[] |
  "| \(.spaceName) | \(.mountpoint) | \(.backend) | \(if .writable then "writable" else "read-only" end) |"'
```

Render as a Markdown table (Space, Path, Backend, Mode).

On macOS, also probe for a stuck mount or a leaked carrier disk — the residue of
a failed teardown. CLI versions before the escalating-unmount fix printed
`✓ Unmounted` even when `umount` returned `EBUSY` (Spotlight indexing the fresh
volume), leaving the volume mounted and its carrier `/dev/diskN` attached:

```bash
[ "$(uname -s)" = Darwin ] && {
  /sbin/mount | grep -i fskit || true                                  # Strata volumes still mounted
  hdiutil info 2>/dev/null | grep -i 'strata/fskit/.*carrier' || true   # carriers still attached
}
```

A `fskit` mount line, or a carrier image with no matching mount, is the signal.
Map it to a fix the **user** runs:

- **Recoverable (a mount or carrier is present):** first step is `strata unmount
  <mountpoint>`. On a current CLI this escalates `umount` → `diskutil unmount` →
  `diskutil unmount force` and detaches the carrier, clearing most stuck states
  on its own. Tell the user to run it, then re-probe.
- **`strata unmount` cannot find it** (mount state was lost when a killed
  foreground process never recorded it): clear it by hand — `diskutil unmount
  force <mountpoint>` then `hdiutil detach <diskN>`. That is a forced unmount, so
  do **not** run it here; hand off to the `strata-spaces` stuck-mount recovery,
  which proposes it under explicit consent.

### Blocked supervised mounts

A supervised mount (one that restarts at login) records why it could not come up
in a `.blockedMounts` sidecar, so a mount that silently never appears is not a
mystery — read the reason:

```bash
strata status --json | jq -r '
  .blockedMounts[]? |
  "| \(.spaceId) | \(.reason | gsub("\n"; " — ")) | \(.at) |"'
```

Each entry is a supervised `strata mount` child that failed to start. The
`reason` string already names the cause; map it to the user fix and re-run the
mount (a successful `strata mount` clears the sidecar — you never clear it here):

- **FSKit extension disabled / not approved** → the System-Settings fix under
  *FSKit module* above, then re-run `strata mount`.
- **Bad / expired credentials** → `strata login`, then re-run `strata mount`.
- **Already mounted elsewhere** → `strata unmount <space>` at the other path
  first.
- **FUSE not available** (Linux) → the `fuse3` / `usermod` fixes under *FUSE
  runtime* above.

If `.blockedMounts` is empty, no supervised mount is wedged at startup; a
missing mount is a fresh-install or auth problem, not a blocked supervisor.

### Live folder-link health (`strata link`)

A live link is the **other** way a Space syncs locally — ordinary Markdown
files kept in two-way CRDT sync by a background service (`strata link`,
login-supervised by default, or `strata link --foreground` for a single
terminal session), distinct from a FUSE / FSKit mount. It has its own health
sidecar. Read every session:

```bash
strata status --json | jq -r '
  .syncSessions[]? |
  "| \(.folder) | alive=\(.alive) | \(.sessionState) | degraded=\(.degraded) | pending=\(.pendingCount)\(if .oldestPendingSecs then " (oldest \(.oldestPendingSecs)s)" else "" end) |"'
```

The top-level `strata status --json` above is the reliable machine-readable
source for every session at once. For a single folder the user names, `strata
status <folder>` prints the same session in human-readable form (treat its
output as text, not JSON — the command emits structured JSON only on its
error path). Map what you see — every fix is the **user**'s to run:

- **`sessionState: "live"`, `degraded: false`, `pendingCount: 0`** — healthy and
  caught up. If edits still aren't appearing, the problem is auth or the document,
  not the link.
- **`degraded: true`** (always `Live` with a backlog older than 30s) — pushes are
  queuing but not draining. This is usually a transient network/transport stall
  that self-heals. A **supervised** link (the default `strata link`)
  that stays wedged ~3 minutes exits and is auto-restarted by `launchd` /
  `systemd`, which drains the backlog — tell the user to wait and re-check. A
  **foreground** `strata link --foreground` has no supervisor: if it stays
  degraded, the user stops it (Ctrl-C) and re-runs `strata link <folder> --space
  <id> --foreground`, or re-links without `--foreground` for auto-restart.
- **`sessionState` is stuck or paused (and not `re-login required`)** — the
  session was interrupted and isn't progressing. Deletions are never held: a
  deleted file unlinks its document immediately (reversible, never destroyed),
  so there is nothing to confirm or release. Recover by re-running the link:

  > The sync session looks stuck. Re-run `strata link <folder> --space <id>` to
  > recover it. If auth has lapsed, run `strata login` first, then re-link.

- **`sessionState` contains `paused (re-login required)`** — the session's token
  expired and could not refresh. Route to the *Auth state* fix: `strata login`,
  then the daemon resumes.
- **`alive: false`** while `sessionState` is non-terminal (not `stopping`) — the
  service process died and the sidecar is stale. For a supervised link, restart
  it: `strata unlink <space_id> --pause` then `strata link <folder> --space
  <space_id>`. For a foreground run, the user re-runs `strata link <folder>
  --space <space_id> --foreground`.
- **`recentPushErrors`** lists per-document push failures (`error`, `count`,
  `lastSeen`); a 403 there is the same permission-denied case as *Write refused*
  below — surface the owner + request-access link. Entries self-clear after five
  minutes, so a stale one next to `pendingCount: 0` is already resolved.

The durable write journal is the companion signal — file saves captured on disk
but not yet pushed:

```bash
strata status --json | jq -r '.pendingJournal | to_entries[]? | select(.value > 0) | "\(.key): \(.value) queued"'
```

A small, shrinking count is normal (writes drain within seconds). A count that
**stays** nonzero means saves aren't reaching the server — cross-check
`syncSessions` (degraded / paused / dead) and `recentWriteErrors`; the journal is
durable, so nothing is lost, but the daemon needs the restart or re-login above
to drain it.

### Re-link didn't fix it: corrupt local cache vs corrupt server state

The standard stuck-session recovery is "re-run `strata link`" (above), and a full
`strata unlink` discards the local cache on its way out. When a session comes back
**degraded the same way after a clean unlink + re-link** — same `recentPushErrors`,
a `pendingCount` that never drains, classically a `payloadTooLarge` /
oversized-update push error — the bad CRDT state is *persisted*, not transient, and
a plain re-link re-derives it. Two different things persist it, and they need
opposite fixes, so tell them apart before you hand off:

- **A bloated local cache.** The per-folder `.strata/` cache (the daemon's CRDT
  replica: `state.json` + `snapshots/*.bin.zst`) is grossly out of proportion to
  the Space's content — tens of MB of `.strata` for a handful of small documents
  is the tell (a healthy cache is a few hundred KB). Read it; this is read-only:

  ```bash
  folder=<the syncSessions .folder for this space>
  du -sh "$folder/.strata" "$folder/.strata/snapshots" 2>/dev/null
  ```

- **Corrupt server state.** The canonical document on the server is itself damaged,
  so every fresh replica re-derives the damage. A clean local cache cannot be the
  cause, and flushing it changes nothing.

The discriminator is a throwaway `sync pull` into an empty temp dir: it fetches the
server's state with no local cache in the way, and is read-only with respect to the
user's link and the server.

```bash
probe=$(mktemp -d)
strata sync pull <space_id> "$probe" >/dev/null 2>&1
# Inspect "$probe"/*.md for the same corruption — pathologically long lines,
# repeated garbage runs, interleaved/duplicated tokens — then: rm -rf "$probe"
```

- **Probe is clean** → the damage lived only in the local cache. Hand off to
  `strata-spaces` **cache-flush recovery**, which purges `.strata/` under consent
  and re-links to re-bootstrap clean state from the server. Doctor does not flush
  it here — mutating sync state is out of scope.
- **Probe is still corrupt** → the server document is the source, and no local flush
  can fix it; it has to be recreated clean on the server (recover a clean copy,
  `strata api documents create` it, `strata api spaces add-documents` it back, and
  trash the damaged one). That is data surgery, not a sync fix — surface it as such
  and hand off; do not attempt it inside doctor.

### Daemon log (when the state alone doesn't explain it)

When a session is degraded, stuck, or dead and the restart / re-login fixes above
don't say *why*, read the supervised daemon's own output. It is the only record of
what a background `strata link` actually did, so it is where a silent stall stops
being a mystery. The location is platform-specific — a log file on macOS, the user
journal on Linux — so branch on the OS. Reading it is read-only and in scope here;
`spaceId` comes from the `syncSessions` entry:

```bash
sid=<spaceId>
if [ "$(uname -s)" = Darwin ]; then
  tail -n 50 "$HOME/Library/Logs/strata/sync-$sid.log" 2>/dev/null \
    || printf 'no log yet at ~/Library/Logs/strata/sync-%s.log\n' "$sid"
else
  journalctl --user -u "strata-sync@$sid.service" -n 50 --no-pager 2>/dev/null \
    || printf 'no user journal for strata-sync@%s.service\n' "$sid"
fi
```

Map what the tail shows to a fix the **user** runs, never the whole file: a
repeated auth/401 error routes to *Auth state* (`strata login`); a repeated
network/transport error is the transient degraded case above (wait, or re-link);
a panic or a repeated push rejection is the line to surface when you report. If
neither branch prints anything, the daemon has not logged yet (a brand-new or
never-started link) — that points back at `syncSessions` liveness, not the log.

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
| Mount backend ready  | FSKit installed / FUSE ready / missing / n-a |
| Active mounts        | N                 |
| Blocked mounts       | none / <space>:<reason> |
| Live link sessions   | N (live / degraded / paused / dead) |
| Sync backlog         | drained / N queued |
| Recent write error   | none / <doc>      |
```

Only the rows that apply belong in the table — drop the mount / link rows
entirely when the user has neither a mount nor a link session, rather than
padding the report with `n-a`.

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
- Mutating sync state. Doctor never re-links a stuck session, never restarts a
  service, and never `strata login`s. It surfaces the recovery command (re-run
  `strata link`), the restart command, or the re-login prompt, and the **user**
  runs it. Starting / installing a live link belongs to `strata-spaces`.
