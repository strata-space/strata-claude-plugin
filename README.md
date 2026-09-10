# Strata Plugin for Claude Code and Codex

Work with your [Strata](https://strata.space) documents from inside Claude:
link a folder to a Space for live two-way sync, mount your Spaces as local
folders of Markdown, or read, search, publish, and review your documents
directly in conversation, including creating and revising presentations. Installing the plugin registers the Strata MCP server
automatically (no setup step), so the in-conversation skills work out of the
box; the filesystem skills add an optional CLI.

## Table of contents

- [What you get](#what-you-get)
- [Quickstart](#quickstart)
- [Install the plugin](#install-the-plugin)
- [Install the Strata CLI (optional)](#install-the-strata-cli-optional)
- [Requirements](#requirements)
- [The six skills](#the-six-skills)
- [Getting documents onto disk: link vs mount vs snapshot](#getting-documents-onto-disk-link-vs-mount-vs-snapshot)
- [Other MCP clients](#other-mcp-clients)
- [Privacy and consent](#privacy-and-consent)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## What you get

The plugin ships six skills and a bundled `.mcp.json` that registers the
Strata MCP server on install. Two halves:

- **Conversation skills** use the MCP server without the Strata CLI. Search your Spaces, read
  documents, publish a draft, leave review comments, and create presentations
  from a conversation or an existing local deck file.
- **Filesystem skills** drive the `strata` CLI to bring a Space onto disk as
  real `.md` files — as a live-linked folder, a virtual-drive mount, or a
  one-time snapshot — so any editor can open them.

You only need the CLI for the filesystem half. Everything else works the moment
the plugin is installed.

## Quickstart

1. **Install the plugin** (registers the MCP server):

   ```
   /plugin marketplace add strata-space/marketplace
   /plugin install strata@strata-space
   ```

2. **Sign in** — the first Strata tool call opens a browser once for OAuth. If
   you are already signed in to strata.space, it completes in a click.

3. **Try a conversation skill** (no CLI needed). Ask Claude:

   > Search my Strata Spaces for the Lighthouse rollout plan and summarize it
   > with citations.

4. **(Optional) bring a Space onto disk.** Install the CLI (below), then ask:

   > Keep a local folder in two-way sync with my "Engineering" Space.

   or, for a virtual drive that shows the Space as a mounted volume:

   > Mount my "Engineering" Space as a local folder.

## Install the plugin

Add the Strata marketplace, then install the plugin:

```
/plugin marketplace add strata-space/marketplace
/plugin install strata@strata-space
```

inside any Claude client that speaks the marketplace protocol. On install, the
bundled `.mcp.json` registers the Strata MCP server with your client; on the
first tool call it opens a browser once for sign-in. No further configuration is
required for the conversation skills.

Or, without the marketplace, install the plugin directly from its repo:

```
/plugin install strata-space/strata-claude-plugin
```

### Codex

The same repository ships a Codex manifest (`.codex-plugin/plugin.json`), so
Codex users get the bundled MCP server and the six skills too. Add the
marketplace source and enable the plugin (or install it from the Codex app's
plugin directory):

```toml
# ~/.codex/config.toml
[plugins."strata@strata-space"]
marketplace = "github:strata-space/marketplace"
```

Then run `/plugins` in Codex and install `strata`.

## Install the Strata CLI (optional)

The CLI is only needed for the **filesystem** features: linking a folder for
live sync, mounting a Space (`strata-spaces`), and bulk folder publish
(`strata-publish`).
The `strata-spaces` skill installs it for you on first run under explicit
consent, so you can skip this section and let the skill drive. To install it
yourself ahead of time:

**macOS (Homebrew):**

```bash
brew install --cask strata-space/tap/strata
```

This taps `strata-space/tap` and installs the `strata` cask (the CLI plus the
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
`STRATA_INSTALL_DIR`). On Linux it lays out the binary alongside the
`st-agent` background agent and its `libstrata_fuse.so` cdylib; on macOS it
installs the app and symlinks `strata`.

**Windows (early-adopter):** download `strata-windows-x86_64.zip` from the
[latest release](https://github.com/strata-space/strata/releases/latest),
extract it somewhere stable (keep `strata.exe` and `st-agent.exe` together),
and add the folder to `PATH`. The build is not yet code-signed — terminals run
it without fuss; Explorer shows a SmartScreen prompt ("More info" → "Run
anyway"). Live folder links work; virtual-drive mounts are macOS/Linux only.

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
  `strata-review`, `strata-presentation`, `strata-doctor` connectivity half) — `node` and `npm` for the
  bundled `mcp-remote` bridge. No Strata CLI needed.
- **Live folder link** (`strata link`, recommended) and **bulk folder publish**
  (`strata-publish` folder mode) — the Strata CLI only. Linking uses ordinary
  files and the Strata background agent (one per-user login item that
  supervises every linked folder; `strata agent status` shows it), **not** a
  kernel filesystem, so it works cross-platform (macOS, Linux, and Windows)
  on systems where a mount cannot (older macOS, WSL, containers) as long as
  the agent can run.
- **Virtual-drive mount** (`strata mount`, optional) — the Strata CLI, plus
  either macOS 15.4+ (FSKit backend, read-only, needs a one-time System Settings
  permission) or Linux with kernel ≥ 4.18 and the `fuse3` userspace helper (FUSE
  backend, read/write).
- **Windows** is detected and routed to the in-conversation MCP skills; a native
  mount is out of scope.

## The six skills

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

### `strata-presentation` — create and revise decks (MCP, no CLI)

Authors a presentation as a Strata document from your prompt and source documents.
Infers the audience, purpose, length, and theme, bundling necessary questions into
one round. Supports slide edits, company themes, existing HTML deck import,
validation, and export through the connected server's available tools.

> Turn these project notes into a short presentation for the leadership team.
>
> Use our company theme and tighten the recommendation on slide three.

### `strata-spaces` — bring a Space onto disk (CLI)

Links a folder to a Space for live two-way sync as the recommended,
cross-platform path: installs the CLI on first run, logs in, sets up the link
Git-safely (auto-adds the folder to `.gitignore`, never commits), and manages
the lifecycle — list, unlink, recover stuck sessions. As an optional
virtual-drive alternative it can `strata mount` the Space (handling the macOS
FSKit extension or the Linux FUSE helper), and it falls back to a one-time
static-snapshot pull when even a link is not wanted.

> Keep ~/strata/engineering in sync with my "Engineering" Space.
>
> Mount the Lighthouse Space as a virtual drive.

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

## Getting documents onto disk: link vs mount vs snapshot

There are three ways to get a Space's documents into a local folder. The
`strata-spaces` skill picks the right one for your platform; here is the model.

| Mode | Command | Files | Live? | Needs FUSE/FSKit? | Best when |
| ---- | ------- | ----- | ----- | ----------------- | --------- |
| **Live link** (recommended) | `strata link` | ordinary `.md` files | yes (seconds) | **no** | the default: cross-platform read/write two-way sync, no kernel extension, no permissions |
| **Mount** (virtual drive) | `strata mount` | virtual filesystem | yes (real-time) | **yes** | you want the Space to appear like a mounted volume; Linux read/write (FUSE), macOS read-only (FSKit, one-time permission) |
| **Snapshot** | `strata sync pull` | ordinary `.md` files | no (one-time) | no | offline copy, or a platform where no live option works |

**Live link** is the recommended path and the most portable: a background
service keeps a folder and a Space in **two-way CRDT sync** — local saves push
to Strata and remote edits land in the files within seconds — cross-platform on
macOS and Linux, with no kernel extension and no permissions. Concurrent editing
on both sides is safe: the service does a base-aware three-way merge and pauses a
local overwrite while you are mid-edit, so there is no clobber window. By default
`strata link <folder> --space <id>` installs a supervised background service
(launchd on macOS, systemd on Linux); pass `--foreground` to run it in the
terminal for one session (stop with Ctrl-C), or `--no-autostart` to install
without starting. Stop and remove a link with `strata unlink <space>` (`--pause`
stops it but leaves it to resume at next login).

The **mount** is the optional virtual-drive alternative: it shows the Space as a
mounted volume. On Linux it is read/write (FUSE); on macOS it is read-only and
needs a one-time System Settings permission (FSKit). Stop it with `strata
unmount`.

Deleting a file locally unlinks the document from the Space and propagates
immediately. Unlinks are reversible: the document is never destroyed and can be
re-added by recreating the file. If a sync session is interrupted or stuck,
re-run `strata link <folder> --space <id>` to recover it.

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
Deleting a synced file unlinks the document from the Space (reversible, never
destroyed) and propagates immediately. No binary download
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
.claude-plugin/plugin.json   # plugin manifest
.mcp.json                    # auto-registers the Strata MCP server
skills/
  strata-research/SKILL.md   # ask your Spaces (MCP)
  strata-publish/SKILL.md    # push local content up (MCP + CLI)
  strata-review/SKILL.md     # comment on a document (MCP)
  strata-presentation/      # deck authoring skill and references (MCP)
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

Presentation tests use the built-in Node.js test runner (Node.js 20+):

```sh
node --test tests/presentation/*.test.mjs
```

The import cases and documentation overview are committed snapshots, so CI
needs neither the monorepo nor Strata credentials. For release rehearsal against
a freshly generated platform corpus, pass its manifest explicitly:

```sh
STRATA_DOCS_MANIFEST=/path/to/aidocs/packages/shared/src/generated/docs-manifest.json node --test tests/presentation/compatibility.test.mjs
```

See [the import rehearsal](tests/presentation/import.md) for fresh agent runs.
The live documentation corpus remains the runtime authority for the skill.

## License

MIT. See [LICENSE](./LICENSE).
