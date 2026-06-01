# Strata Plugin for Claude

Work with your [Strata](https://strata.space) documents from inside Claude:
mount your Spaces as local folders of Markdown, keep a folder in live two-way
sync, or read, search, publish, and review your documents directly in
conversation. Installing the plugin registers the Strata MCP server
automatically (no setup step), so the in-conversation skills work out of the
box; the filesystem skills add an optional CLI.

## Table of contents

- [What you get](#what-you-get)
- [Quickstart](#quickstart)
- [Install the plugin](#install-the-plugin)
- [Install the Strata CLI (optional)](#install-the-strata-cli-optional)
- [Requirements](#requirements)
- [The five skills](#the-five-skills)
- [Getting documents onto disk: mount vs sync vs snapshot](#getting-documents-onto-disk-mount-vs-sync-vs-snapshot)
- [Other MCP clients](#other-mcp-clients)
- [Privacy and consent](#privacy-and-consent)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## What you get

The plugin ships five skills and a bundled `.mcp.json` that registers the
Strata MCP server on install. Two halves:

- **Conversation skills** run entirely over the MCP server — no CLI, no
  filesystem. Search your Spaces, read documents, publish a draft, and leave
  review comments without leaving the chat.
- **Filesystem skills** drive the `strata` CLI to bring a Space onto disk as
  real `.md` files — as a live mount, a live-synced folder, or a one-time
  snapshot — so any editor can open them.

You only need the CLI for the filesystem half. Everything else works the moment
the plugin is installed.

## Quickstart

1. **Install the plugin** (registers the MCP server):

   ```
   /plugin install strata-space/strata-claude-plugin
   ```

2. **Sign in** — the first Strata tool call opens a browser once for OAuth. If
   you are already signed in to strata.space, it completes in a click.

3. **Try a conversation skill** (no CLI needed). Ask Claude:

   > Search my Strata Spaces for the Lighthouse rollout plan and summarize it
   > with citations.

4. **(Optional) bring a Space onto disk.** Install the CLI (below), then ask:

   > Mount my "Engineering" Space as a local folder.

   or, where a mount is not available (or you just want plain files kept in
   sync):

   > Keep a local folder in two-way sync with my "Engineering" Space.

## Install the plugin

Through the Claude marketplace (recommended once listed). Manually:

```
/plugin install strata-space/strata-claude-plugin
```

inside any Claude client that speaks the marketplace protocol. On install, the
bundled `.mcp.json` registers the Strata MCP server with your client; on the
first tool call it opens a browser once for sign-in. No further configuration is
required for the conversation skills.

## Install the Strata CLI (optional)

The CLI is only needed for the **filesystem** features: mounting a Space
(`strata-spaces`), live folder sync, and bulk folder publish (`strata-publish`).
The `strata-spaces` skill installs it for you on first run under explicit
consent, so you can skip this section and let the skill drive. To install it
yourself ahead of time:

**macOS (Homebrew):**

```bash
brew install --cask strata-space/strata/strata
```

This taps `strata-space/strata` and installs the `strata` cask (the CLI plus the
bundled FSKit filesystem module). After install, enable the module once:
**System Settings → General → Login Items & Extensions → File System
Extensions → Strata CLI** (switch the Extensions list to **By Category** if the
toggle looks stuck in the By App view).

**macOS or Linux (official installer):**

```bash
curl -sSf https://github.com/strata-space/strata/releases/latest/download/install-cli.sh | sh
```

The installer detects your OS and architecture, verifies the download, and
places `strata` in `~/.local/bin` by default (override with
`STRATA_INSTALL_DIR`). On Linux it lays out the binary alongside its
`libstrata_fuse.so` cdylib; on macOS it installs the app and symlinks `strata`.

**Linux (manual):** download the matching tarball from the
[latest release](https://github.com/strata-space/strata/releases/latest) —
`strata-linux-x86_64.tar.gz` or `strata-linux-aarch64.tar.gz` — verify it
against `checksums.txt`, and extract `strata` (plus `libstrata_fuse.so`, kept in
the same directory) onto your `PATH`. A live mount also needs the `fuse3`
userspace helper from your distro (`sudo apt install fuse3`, or the `dnf` /
`pacman` / `zypper` / `apk` equivalent).

**Verify:**

```bash
strata --version
strata login          # opens a browser; on a headless host, prints a URL + code
strata status         # shows auth, mounts, and sync sessions
```

## Requirements

- **Conversation skills** (`strata-research`, `strata-publish` single-doc,
  `strata-review`, `strata-doctor` connectivity half) — `node` and `npm` for the
  bundled `mcp-remote` bridge. No Strata CLI needed.
- **Filesystem mount** (`strata-spaces`) and **bulk folder publish**
  (`strata-publish` folder mode) — the Strata CLI, plus either macOS 15.4+ (FSKit
  backend) or Linux with kernel ≥ 4.18 and the `fuse3` userspace helper (FUSE
  backend).
- **Live folder sync** (`strata sync run` / `install`) — the Strata CLI only. It
  uses ordinary files and a background process, **not** a kernel filesystem, so
  it works on systems where a mount cannot (older macOS, WSL, containers) as long
  as the process can run.
- **Windows** is detected and routed to the in-conversation MCP skills; a native
  mount is out of scope.

## The five skills

Skills activate from natural language — you do not call them by name. The
example prompts below are illustrative.

### `strata-research` — answer from your Spaces (MCP, no CLI)

Searches and reads your documents over the MCP server and links every claim back
to its source. Read-only.

> What did we decide about the buoy firmware OTA process? Cite the docs.

### `strata-publish` — push local content up (MCP + CLI)

Two shapes. A **single document** (a draft in the conversation or one file) goes
up over MCP with no CLI. A **folder of Markdown** (many files, possibly nested)
syncs via the CLI's `strata sync push` — the only path that handles creates,
updates, and deletes in one operation and can mirror a nested folder tree (with
`--folders`). A new document's audience is the folder it lands in; new docs
default to your private personal folder.

> Publish this draft to my "Specs" Space.
>
> Push my `./notes` folder up to the "Research" Space, keeping the subfolders.

### `strata-review` — comment, don't rewrite (MCP, no CLI)

Reads a document and posts feedback as anchored comments rather than editing the
body. Read-only with respect to the document text.

> Review the "API Gateway LLD" doc and leave comments on anything risky.

### `strata-spaces` — bring a Space onto disk (CLI)

Mounts a Space as a local folder of `.md` files: installs the CLI on first run,
handles the macOS FSKit extension or the Linux FUSE helper, logs in, mounts
Git-safely (auto-adds the mount dir to `.gitignore`, never commits), and manages
the lifecycle — list, unmount, recover stuck mounts. Also sets up **live folder
sync** where a mount is not available, and falls back to a one-time
static-snapshot pull when neither is possible.

> Mount my "Engineering" Space at ~/strata/engineering.
>
> Unmount the Lighthouse Space.

### `strata-doctor` — diagnose why Strata is not working (MCP + CLI)

Read-only diagnostician. Probes the MCP connection (registered, signed in, write
scope, tool groups) and, when the CLI is present, its auth state, environment
consistency, mount-backend prerequisites (the macOS FSKit module / the Linux
FUSE runtime), mount health, **live folder-sync health** (stuck / paused /
degraded sessions, the pending write journal, blocked supervised mounts), and
the most recent write failure (with the owner and a request-access link). It
routes every finding to a fix — a command you run or a hand-off to the owning
skill — and never remediates by side effect.

> Strata isn't showing my documents in Claude — what's wrong?
>
> My edits aren't syncing / my save failed. Diagnose it.

## Getting documents onto disk: mount vs sync vs snapshot

There are three ways to get a Space's documents into a local folder. The
`strata-spaces` skill picks the right one for your platform; here is the model.

| Mode | Command | Files | Live? | Needs FUSE/FSKit? | Best when |
| ---- | ------- | ----- | ----- | ----------------- | --------- |
| **Mount** | `strata mount` | virtual filesystem | yes (real-time) | **yes** | macOS 15.4+ / modern Linux; you want documents to appear like any other folder |
| **Live folder sync** | `strata sync run` / `install` | ordinary `.md` files | yes (seconds) | **no** | a mount is unavailable or unwanted; you want plain files that stay in sync |
| **Snapshot** | `strata sync pull` | ordinary `.md` files | no (one-time) | no | offline copy, or a platform where no live option works |

**Live folder sync** is the newest mode and the most portable: a background
daemon keeps a folder and a Space in **two-way CRDT sync** — local saves push to
Strata and remote edits land in the files within seconds. Concurrent editing on
both sides is safe: the daemon does a base-aware three-way merge and pauses a
local overwrite while you are mid-edit, so there is no clobber window. Run it in
the foreground (`strata sync run <folder> --space <id>`, stop with Ctrl-C) or
install it as a login-supervised service (`strata sync install <folder> --space
<id>`, manage with `strata sync stop` / `uninstall`).

If a bulk delete would unlink a large fraction of a Space, sync **pauses** and
holds the deletions rather than propagating a possible accident; confirm with
`strata sync resume <folder>` once you have verified the deletions are intended.

Check the health of any mount or sync session at a glance:

```bash
strata status --json | jq '{mounts, syncSessions, pendingJournal, blockedMounts}'
```

## Other MCP clients

Claude Code and Claude Desktop pick up the Strata MCP server from the bundled
`.mcp.json` automatically. For another MCP client (Cursor, VS Code, Zed,
Continue, Cline, Windsurf), add the server to that client's MCP config
yourself:

```json
{
  "mcpServers": {
    "strata": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://api.prod.us-east-2.strata.space/mcp",
        "--header",
        "X-Strata-Tool-Groups:core,comments"
      ]
    }
  }
}
```

The `X-Strata-Tool-Groups` header opts into the `comments` capability group so
`strata-review` works (that group also exposes Strata's suggestion tool, which
`strata-review` deliberately does not use); drop the header entirely for
read-only research and publishing. On the first tool call the server opens a
browser for OAuth. That login is separate from the CLI's keychain token, but if
you are already signed in to strata.space in your browser it completes in one
click, because it reuses your browser session rather than your CLI token.

## Privacy and consent

Every privileged command (`brew install`, `apt install`, `dnf install`,
`pacman`, `zypper`, `apk`, `sudo usermod`, `diskutil unmount force`,
`fusermount3 -uz`) is proposed in conversation and requires explicit user
confirmation before execution. Operations that write to your Strata content
(publishing, commenting) are confirmed in conversation before the first write.
Deletions held by the mass-delete guard are never applied for you; the skills
surface the count and leave `strata sync resume` to you. No binary download
proceeds without SHA-256 verification against a published checksum. No
environment-specific URLs are hardcoded beyond the MCP endpoint; the rest is read
from your CLI auth state.

## Troubleshooting

The fastest path is to ask Claude — the `strata-doctor` skill runs a full
read-only diagnosis and routes each finding to a fix:

> Diagnose my Strata setup.

A few things you can check yourself:

- **The Strata tools are missing in Claude.** The plugin's `.mcp.json` registers
  the server on install; confirm the `strata` plugin is installed and enabled,
  and restart Claude if you just installed it.
- **A tool call fails with an auth error.** The first call opens a browser for
  sign-in; complete it and retry. For the CLI half, run `strata login`.
- **`strata-review` has no comment tool.** Re-authorize and accept the write
  scope, and make sure your MCP config sends `X-Strata-Tool-Groups:core,comments`.
- **A mount silently does nothing on macOS.** The FSKit module is installed but
  not approved — enable **Strata CLI** under System Settings → General → Login
  Items & Extensions → File System Extensions (use the **By Category** view).
- **Edits are not syncing.** Run `strata status --json` and look at
  `syncSessions` (is it `live`, `degraded`, or `paused`?) and `pendingJournal`
  (is the backlog draining?). `strata-doctor` interprets these for you.

## Development

Layout:

```
.claude-plugin/plugin.json   # marketplace manifest
.mcp.json                    # auto-registers the Strata MCP server
skills/
  strata-research/SKILL.md   # ask your Spaces (MCP)
  strata-publish/SKILL.md    # push local content up (MCP + CLI)
  strata-review/SKILL.md     # comment on a document (MCP)
  strata-spaces/SKILL.md     # mount + live-sync lifecycle (CLI)
  strata-doctor/SKILL.md     # diagnose connectivity, mounts, sync, write failures (MCP + CLI)
tests/                       # VM smoke runners (bash)
```

Run the smoke tests on a clean VM (each script no-ops on a wrong platform, exits
non-zero on a failed assertion):

```
bash tests/macos-first-mount.sh           # macOS 15.4+
bash tests/linux-debian-first-mount.sh    # Ubuntu / Debian
bash tests/linux-fedora-first-mount.sh    # Fedora
bash tests/linux-arch-first-mount.sh      # Arch
bash tests/git-mount-gitignore.sh         # any platform
bash tests/snapshot-fallback.sh           # any platform with strata CLI
bash tests/unmount-lifecycle.sh           # any platform with strata CLI
bash tests/permission-denied.sh           # any platform with strata CLI
```

The MCP skills (`strata-research`, `strata-review`) are conversation-driven
orchestration over the MCP server; there is no host-side bash to smoke-test, so
they have no test runner. CI runs the platform-agnostic tests on every push and
PR; per-OS first-mount tests are reserved for release rehearsal.

## License

MIT. See [LICENSE](./LICENSE).
