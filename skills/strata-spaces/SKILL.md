---
name: strata-spaces
description: >
  Link or mount a Strata Space (strata.space) as a local folder of Markdown
  files. First-run install of the strata CLI, browser login, Space pick,
  Git-safe setup, live two-way folder link (`strata link` / `unlink`, the
  recommended cross-platform path, no kernel extension), an optional
  virtual-drive mount (`strata mount`, macOS FSKit / Linux FUSE), lifecycle
  (list, unlink, unmount, recover stuck sessions), and a static-snapshot
  fallback when neither is possible. Use for "link my Space", "keep a folder in
  sync", "mount my Space", "open my Strata docs as files", "sync Strata
  locally", or any link/mount-lifecycle request.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion
---

# Strata Spaces

You operate the `strata` CLI on the user's behalf to put a Strata Space (a
collection of Markdown documents stored at strata.space) on disk as `.md` files:
as a continuously synced folder, a live mounted volume, or a one-time snapshot.
Edits and deletes on disk synchronise back to Strata; users can read and edit
with any editor.

Every privileged command (package install, system-extension toggle, force
unmount, group membership change) requires explicit in-conversation consent
from the user. Never run such a command without first showing it verbatim and
asking permission. If the user declines any install consent, route to the
snapshot-fallback path (see "Snapshot fallback") and exit gracefully. Do not
retry silently.

## Choose the install mode

There are three ways to put a Space on disk; they need different things, so pick
the mode before installing anything:

- **Live link** (`strata link`) — a normal folder of real `.md` files kept in
  continuous two-way sync by a background service that restarts at login. Needs
  only the CLI: cross-platform (macOS + Linux), read/write, **no FSKit/FUSE and
  no system-extension approval**. The recommended path: lowest friction, fully
  live, and works everywhere the process can run.
- **Virtual-drive mount** (`strata mount`) — the optional alternative: a virtual
  filesystem showing the Space as a mounted volume. Needs FSKit (macOS 15.4+,
  read-only, plus a one-time system-extension approval) or FUSE (Linux,
  read/write).
- **One-time snapshot** (`strata sync pull`) — a static copy with no live
  updates.

Map intent to a mode:

- "link", "install", "set up", "sync", or "keep in sync" a Space, or a bare "put
  Space X in ./y" → **live link**. This is the default for ambiguous
  install/sync requests; say in one line that you are setting up a live link and
  that they can ask for a virtual-drive mount instead.
- "mount", "as a volume/drive", or an explicit virtual-drive ask → **mount**.
- "grab", "download", "a copy", "offline", or any one-time wording → **snapshot**.
  Also the fallback when a link and mount are both unavailable or declined.

Use `AskUserQuestion` only when the request genuinely implies no mode. Do not
default to a mount.

Every mode needs the CLI installed and a login. Run **Platform detection** and
install the CLI next regardless of mode. **FSKit enablement** (macOS) and **FUSE
preflight** (Linux) are mount-only — skip them for a live link and snapshot.
Then route by mode:

- Live link → **Login and Space pick** → **Live folder link** (`strata link`).
- Mount → **Login and Space pick** → **Mount path selection** (with
  **Git-tree** handling) → **Mount execution and summary**.
- Snapshot → **Login and Space pick** → **Snapshot fallback**.

## Platform detection

Identify the OS and route to the right install flow:

```bash
case "$(uname -s)" in
  Darwin)
    macos_version=$(sw_vers -productVersion)
    macos_major=$(printf '%s\n' "$macos_version" | cut -d. -f1)
    macos_minor=$(printf '%s\n' "$macos_version" | cut -d. -f2)
    if [ "$macos_major" -lt 15 ] || { [ "$macos_major" -eq 15 ] && [ "$macos_minor" -lt 4 ]; }; then
      # < 15.4: no FSKit. Route to snapshot fallback.
      platform="macos-too-old"
    else
      platform="macos"
    fi
    ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      platform="wsl"  # WSL: route to snapshot fallback
    elif [ -f /.dockerenv ] || grep -q '/docker\|/containerd' /proc/1/cgroup 2>/dev/null; then
      platform="container"  # No FUSE inside containers: snapshot fallback
    else
      platform="linux"
      distro=$(. /etc/os-release && printf '%s\n' "${ID_LIKE:-$ID}")
    fi
    ;;
  *)
    platform="windows-or-other"  # links work via the Windows CLI zip; no mounts
    ;;
esac
```

If `platform` is `macos-too-old`, `wsl`, or `container`, a virtual-drive mount is
impossible, but a **live link** still runs there (it needs only the CLI process,
not FSKit/FUSE) — prefer it over a snapshot when the user wants ongoing sync,
otherwise use the snapshot. Both still need the CLI installed, so run the
platform's CLI install below and skip only the mount-only FSKit/FUSE steps.
For `windows-or-other`: on native Windows the CLI ships as
`strata-windows-x86_64.zip` on the GitHub releases page (early-adopter,
not yet code-signed — extract, keep `strata.exe` and `st-agent.exe` together,
add the folder to `PATH`). Live links and snapshots work there; mounts do
not. On anything else with no CLI build, no live or snapshot option exists;
note the plugin already registers the Strata MCP server, so the user can
read, search, and edit documents in conversation through the
`strata-research`, `strata-publish`, and `strata-review` siblings.

## macOS install + FSKit enablement

Brew is required. Check first:

```bash
if ! command -v brew >/dev/null 2>&1; then
  printf 'Homebrew is required. Install it from https://brew.sh and rerun.\n'
  exit 1
fi
```

Propose the cask install. Tap is `strata-space/strata`:

> Plugin proposes: `brew install --cask strata-space/tap/strata`. Run it?
> [y/N]

If declined, jump to "Snapshot fallback". If accepted, run it. **The FSKit
enablement below is mount-only: for a live link or snapshot the cask install is
all you need here, so skip to "Login and Space pick".** On macOS, the
CLI ships an FSKit module that needs a one-time approval before the first mount
works. Do **not** probe for it here; detecting the module is `strata-doctor`'s
job, and macOS does not expose the enabled state to any CLI anyway. Just guide
the approval and let the mount be the test.

Open the System Settings pane and ask the user to turn the module on:

```bash
open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' 2>/dev/null
```

Tell the user verbatim:

> Open **System Settings → General → Login Items & Extensions**. In the
> **Extensions** section, switch from **By App** to **By Category** (the By App
> view has a broken toggle that will not turn on and wrongly shows off). Open
> **File System Extensions** and turn on **Strata CLI**. Reply when you have done
> it.

The mount is the verification; proceed to "Login and Space pick". If the mount
later fails because the module is not approved, send the user back to the **By
Category** toggle above, or hand off to `strata-doctor` to confirm the module is
even installed (`pluginkit`).

## Linux distro detection + FUSE preflight

Resolve the install command from `/etc/os-release`:

```bash
. /etc/os-release
case "${ID_LIKE:-$ID}" in
  *debian*|*ubuntu*) install='sudo apt update && sudo apt install -y fuse3' ;;
  *fedora*|*rhel*|*centos*) install='sudo dnf install -y fuse3' ;;
  *arch*) install='sudo pacman -Sy --noconfirm fuse3' ;;
  *suse*|*opensuse*) install='sudo zypper install -y fuse3' ;;
  *alpine*) install='sudo apk add fuse3' ;;
  *) install='' ;;  # Unknown distro: snapshot fallback
esac
```

Install the CLI. Linux ships as a GitHub release asset. Fetch the matching
asset for the architecture, verify SHA-256 against GitHub's `digest`, then
extract:

```bash
arch=$(uname -m)
case "$arch" in
  x86_64) asset='strata-linux-amd64.tar.gz' ;;
  aarch64|arm64) asset='strata-linux-arm64.tar.gz' ;;
  *) printf 'Unsupported architecture: %s\n' "$arch"; exit 1 ;;
esac

release=$(curl -sf https://api.github.com/repos/strata-space/strata/releases/latest)
url=$(printf '%s\n' "$release" | jq -r --arg n "$asset" '.assets[] | select(.name==$n) | .browser_download_url')
digest=$(printf '%s\n' "$release" | jq -r --arg n "$asset" '.assets[] | select(.name==$n) | .digest' | sed 's/^sha256://')
tag=$(printf '%s\n' "$release" | jq -r '.tag_name')

tmp=$(mktemp -d)
curl -fL -o "$tmp/$asset" "$url"
actual=$(sha256sum "$tmp/$asset" | awk '{print $1}')
[ "$actual" = "$digest" ] || { printf 'Checksum mismatch for %s\n' "$asset"; exit 1; }
```

Show the user the install commands you would run, request consent, then run
them. If they decline any consent, jump to "Snapshot fallback".

> Plugin proposes: `tar -xzf $tmp/$asset -C ~/.local/bin/` (then add
> `~/.local/bin` to PATH if needed). Run it? [y/N]

FUSE preflight is mount-only — skip it for a live link and snapshot
(those need only the installed CLI). For a mount, run it in this order:

1. `[ -e /dev/fuse ]` (kernel module present).
2. `command -v fusermount3` (preferred over `fusermount`).
3. `stat /dev/fuse` succeeds as the current user (group membership / udev).
4. `getent group fuse | grep -q "\b$USER\b"` (or skip if the distro does not
   use a `fuse` group).

If `/dev/fuse` or `fusermount3` is missing, propose the distro install
command from the `install` variable above. If the user is not in the `fuse`
group:

> Plugin proposes: `sudo usermod -aG fuse $USER`. You will need to log out
> and back in for the group change to take effect. Run it? [y/N]

If declined, jump to "Snapshot fallback". On unknown distros where the
`install` variable is empty, jump straight to "Snapshot fallback" without
asking.

## Login and Space pick

Detect auth state:

```bash
strata status --json | jq -r '.status'
```

If `logged_out` or `expired`, ask the user to run `strata login` themselves
(you should not run it for them):

> Please run `strata login` in your terminal, then tell me when you are signed
> in. On a local machine it opens a browser; over SSH or on a headless host it
> prints a URL and asks you to paste back the code shown in the browser (or run
> `strata login --no-browser` to force that).

Then re-check. Once `logged_in`, list Spaces:

```bash
strata spaces --json | jq '.[] | {id, name, scope}'
```

If the user gave you an explicit Space name or ID in their request, skip the
picker. Otherwise, render the list numbered and ask them to pick by number or
by name. Save the Space `id` for the mount command.

## Mount path selection

Default behaviour:

```bash
if git rev-parse --is-inside-work-tree 2>/dev/null; then
  default_path="./spaces/$(printf '%s' "$space_name" | tr 'A-Z ' 'a-z-')"
else
  default_path="$HOME/Strata/$(printf '%s' "$space_name" | tr 'A-Z ' 'a-z-')"
fi
```

Reject destructive paths outright. Never propose, accept, or `mkdir` any of:
`/`, `/usr`, `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`, `/sys`, `/proc`,
`$HOME` itself, `.` (the user's CWD), or any path whose existing contents
match `*.md` or look like a checked-in document folder. Explain the risk in
one sentence and offer the default path or another safe location.

If the parent directory does not exist, `mkdir -p` it.

## Git-tree detection and `.gitignore` handling

If `git rev-parse --is-inside-work-tree` succeeded, the mount needs to be
excluded from version control before it is created (FR-024). Check both
`.gitignore` (in the repo root) and `.git/info/exclude` for any existing
match against `spaces/`, `/spaces/`, or `spaces/*`:

```bash
gitroot=$(git rev-parse --show-toplevel)
already_ignored() {
  for f in "$gitroot/.gitignore" "$gitroot/.git/info/exclude"; do
    [ -f "$f" ] && grep -E '^/?spaces(/|/\*)?$' "$f" >/dev/null 2>&1 && return 0
  done
  return 1
}
if ! already_ignored; then
  printf 'spaces/\n' >> "$gitroot/.gitignore"
fi
```

Never `git add` or `git commit` the `.gitignore` change. The user owns commit
decisions; the plugin owns avoiding accidental commits of mount contents.

## Mount execution and summary

Run the mount. Writable is the default; pass `--readonly` for a read-only mount:

```bash
strata mount "$space_id" "$mount_path"
```

On exit code 0, re-read status and present a summary:

```bash
strata status --json | jq -r --arg id "$space_id" '
  .mounts[] | select(.spaceId == $id) |
  "Mounted \(.spaceName) at \(.mountpoint) (\(.backend), \(if .writable then "writable" else "read-only" end))"'
```

Tell the user what writable means in their next sentence:

> The folder is now live. Edits sync back to Strata. Files you delete go to
> Strata's trash (recoverable from the web app for 30 days). To unmount, ask
> me or run `strata unmount <space>`.

On non-zero exit, show the CLI's stderr in a fenced block and offer two
choices: retry, or fall back to the snapshot path.

## List active mounts

```bash
strata status --json | jq -r '
  .mounts[] |
  "| \(.spaceName) | \(.mountpoint) | \(.backend) | \(if .writable then "writable" else "read-only" end) |"'
```

Render as a Markdown table with columns: Space, Path, Backend, Mode.

## Unmount one

```bash
strata status --json | jq -r '.mounts[] | "\(.spaceName)\t\(.spaceId)\t\(.mountpoint)"'
```

If there is exactly one mount, unmount it without asking which. Otherwise,
show the user a numbered list and ask them to pick:

```bash
strata unmount "$target"  # $target is the spaceId or mountpoint
```

Confirm success with the post-unmount status.

## Unmount everything

```bash
strata status --json | jq -r '.mounts[].spaceId' | while read -r id; do
  printf 'Unmounting %s ...\n' "$id"
  strata unmount "$id" || printf '  failed\n'
done
```

Report per-mount results in a final summary.

## Stuck-mount recovery

If `strata unmount` fails with stderr containing `Resource busy`, `device or
resource busy`, or `EBUSY`, the mount is stuck. Propose the force path
explicitly:

On macOS:

> Plugin proposes: `diskutil unmount force /Volumes/Strata-<name>`. Run it?
> [y/N]

On Linux:

> Plugin proposes: `fusermount3 -uz <mountpoint>` (lazy unmount). Run it?
> [y/N]

After the force unmount succeeds, run `strata status --json` to confirm the
mount entry is gone.

## Live folder link (`strata link`)

This is the **live link** mode from "Choose the install mode": an ordinary folder
of real `.md` files kept in continuous two-way CRDT sync by a background process
— no kernel filesystem, so it works cross-platform (macOS + Linux) and runs where
a mount cannot (macOS without FSKit approval, WSL, containers) as long as the
process itself can run. Edits on either side merge with no clobber window (the
service does a base-aware three-way merge and pauses a local overwrite while you
are mid-edit), so concurrent web + local editing is safe.

The same safety rails as a mount apply, because it writes real files into a
folder: reuse the **Mount path selection** destructive-path refusal and the
**Git-tree** `.gitignore` handling above before creating the folder.

`strata link` hands the folder to the **Strata agent** — one per-user
background service that supervises every linked folder and restarts at login
(launchd on macOS, systemd on Linux, Task Scheduler on Windows). The first
link installs the agent's login item, so get explicit consent first:

> Plugin proposes: `strata link "$folder" --space "$space_id"` — the Strata
> background agent keeps the folder synced and restarts at login (the first
> link installs the agent as a login item). Run it? [y/N]

Tell the user what continuous sync means before the first run:

> This keeps the folder and the Space in two-way sync: your local saves push to
> Strata and remote edits land in the files within seconds. Deletes propagate to
> Strata's trash (recoverable for 30 days). Stop and remove it with `strata
> unlink <space>`; `strata unlink <space> --pause` pauses it (re-running
> `strata link` on the folder resumes). `strata agent status` shows the
> agent that runs it all.

### Link lifecycle

```bash
strata status "$folder"               # session state, pending count, errors
strata unlink "$space_id" --pause     # pause sync (re-run `strata link` to resume)
strata unlink "$space_id"             # stop syncing; keeps the local Markdown
strata agent status                   # the background agent that runs every link
strata agent restart                  # one-click repair when sessions look dead
```

For a deeper read of a stuck, paused, or degraded session, hand off to
`strata-doctor` (it owns the `syncSessions` / `pendingJournal` diagnosis).

### Cache-flush recovery (corrupt local sync state)

`strata-doctor` routes a link here when its probe shows the **local `.strata/`
cache** is the corrupted party — a clean-room `sync pull` came back clean, but the
live link stays degraded after a restart with an oversized-update / `payloadTooLarge`
push error. The fix is to discard the local CRDT replica and let a fresh `strata
link` re-bootstrap clean state from the server. The `.md` files on disk are not the
cache and are always kept.

A normal `strata unlink "$space_id"` already removes `.strata/` on its way out, so
the first attempt is simply unlink-then-relink:

> Plugin proposes: `strata unlink "$space_id"`, then `strata link "$folder" --space
> "$space_id"` — discards the local sync cache and re-downloads clean state from the
> Space. Your `.md` files are kept. Run it? [y/N]

When the link is *wedged* — the daemon crashed and left an orphaned service
registration — `strata unlink` bails with `No linked folder found` and never reaches
the cache. Use the force flush, which ignores the broken registry and removes
`.strata/` plus the health sidecar regardless of service state:

> Plugin proposes: `strata unlink "$space_id" --purge` (force-flush the local cache
> for a wedged link), then `strata link "$folder" --space "$space_id"`. Run it?
> [y/N]

After re-linking, confirm with `strata status "$folder"`: `sessionState: live`,
`degraded: false`, `pendingCount: 0`. If it returns to degraded with the same push
error, the cache was not the cause — the server document is corrupt, which a local
flush cannot fix; hand back to `strata-doctor`'s server-state branch (recreate the
document). That is data surgery, not a sync operation.

### Deletions

Deleting a local file unlinks its document from the Space and propagates
immediately — there is no pause and no held-deletions step. Unlinks are
reversible: the document is never destroyed and can be re-added by recreating
the file. If a sync session is interrupted or stuck, recover it by re-running
`strata link "$folder" --space "$space_id"`.

### One-time push with folders

The snapshot path below pulls; the inverse one-time upload is `strata sync push`.
By default push is flat (new docs land at the Space root). Pass `--folders` to
recreate the local directory tree as Strata folders and file new documents into
them:

```bash
strata sync push "$space_id" "$folder" --folders
```

## Snapshot fallback

Trigger this path when any of the following is true:
- Platform is `macos-too-old`, `wsl`, `container`, or `unsupported`.
- User declined the CLI install consent.
- User declined the `fuse3` install consent.
- User declined the `usermod -aG fuse` consent.
- Distro detection returned an unknown ID.

Before settling for a static snapshot, consider **live folder sync** (above): on
`macos-too-old`, `wsl`, and `container` the mount is impossible but the sync
daemon still runs, giving live two-way sync without FUSE/FSKit. Offer it as the
live option when the user wants ongoing sync; fall through to the static snapshot
only when even that is unwanted, or when the user explicitly asked for a one-time
copy.

Explain the tradeoff in one short paragraph:

> Live mounting is not available on this system. I can pull your Space's
> documents as static Markdown files instead. You will not get live sync
> (edits to the files will not push back to Strata), but you keep local
> read and edit access for offline use. If you'd rather keep it in sync, I can
> set up live folder sync instead — it works here without a mount.

Use the same path-selection logic as the live mount (in-git → `./spaces/...`,
out-of-git → `~/Strata/...`). Run the pull:

```bash
strata sync pull "$space_id" "$dest_dir"
```

On success, count the files and confirm:

```bash
count=$(find "$dest_dir" -name '*.md' -type f | wc -l | tr -d ' ')
printf 'Pulled %s Markdown files to %s.\n' "$count" "$dest_dir"
```
