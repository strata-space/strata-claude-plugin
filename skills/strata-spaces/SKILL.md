---
name: strata-spaces
description: >
  Mount or sync a Strata Space (strata.space) as a local folder of Markdown
  files. First-run install of the strata CLI, macOS FSKit / Linux FUSE
  preflight, browser login, Space pick, Git-safe mount, lifecycle (list,
  unmount, recover stuck mounts), and a static-snapshot fallback when live
  mounting is not possible. Use for "mount my Space", "open my Strata docs as
  files", "sync Strata locally", or any mount-lifecycle request.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion
---

# Strata Spaces

You operate the `strata` CLI on the user's behalf to mount a Strata Space (a
collection of Markdown documents stored at strata.space) as a real folder of
`.md` files. After a successful mount, edits and deletes in the local folder
synchronise back to Strata; users can read and edit with any editor.

Every privileged command (package install, system-extension toggle, force
unmount, group membership change) requires explicit in-conversation consent
from the user. Never run such a command without first showing it verbatim and
asking permission. If the user declines any install consent, route to the
snapshot-fallback path (see "Snapshot fallback") and exit gracefully. Do not
retry silently.

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
    platform="unsupported"  # Windows native, etc: route to snapshot or MCP skills
    ;;
esac
```

If `platform` is `macos-too-old`, `wsl`, `container`, or `unsupported`, jump to
"Snapshot fallback". For Windows specifically, tell the user a live mount is not
possible, but the plugin already registers the Strata MCP server, so they can
read, search, and edit their documents in the conversation through the
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

> Plugin proposes: `brew install --cask strata-space/strata/strata`. Run it?
> [y/N]

If declined, jump to "Snapshot fallback". If accepted, run it. On macOS, the
CLI ships an FSKit system extension that must be approved by the user before
the first mount works.

Check whether it is already enabled:

```bash
systemextensionsctl list 2>/dev/null | grep -i strata
```

If the entry shows `[activated enabled]`, proceed to "Login and Space pick".
Otherwise, open the System Settings pane and ask the user to toggle Strata on:

```bash
open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' 2>/dev/null
```

Tell the user verbatim:

> Go to **System Settings → General → Login Items & Extensions → File System
> Extensions** and turn on **Strata**. Reply when you have done it.

After the user confirms, re-run `systemextensionsctl list | grep -i strata`.
Loop until the entry shows `[activated enabled]`, with a friendly nudge if
the user reports done but the check still fails (most often: the deep link
opened the wrong pane; ask them to scroll to "File System Extensions").

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

FUSE preflight in this order:

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
(it opens a browser; you should not run it for them):

> Please run `strata login` in your terminal. It opens a browser to sign you
> in. Tell me when you are signed in.

Then re-check. Once `logged_in`, list Spaces:

```bash
strata spaces --json | jq '.items[] | {id, name, scope}'
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

Run the mount. Default is writable:

```bash
strata mount "$space_id" "$mount_path" --writable
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

## Snapshot fallback

Trigger this path when any of the following is true:
- Platform is `macos-too-old`, `wsl`, `container`, or `unsupported`.
- User declined the CLI install consent.
- User declined the `fuse3` install consent.
- User declined the `usermod -aG fuse` consent.
- Distro detection returned an unknown ID.

Explain the tradeoff in one short paragraph:

> Live mounting is not available on this system. I can pull your Space's
> documents as static Markdown files instead. You will not get live sync
> (edits to the files will not push back to Strata), but you keep local
> read and edit access for offline use.

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
