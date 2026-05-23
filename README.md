# Strata Plugin for Claude

Work with your [Strata](https://strata.space) documents from inside Claude:
mount your Spaces as local folders of Markdown, or read, search, publish, and
review your documents directly in conversation. Installing the plugin registers
the Strata MCP server automatically (no setup step), so the in-conversation
skills work out of the box.

Skills:

- **`strata-research`** — answer a question from your Spaces with citations.
  Searches and reads your documents over the MCP server and links every claim
  back to its source. Read-only; no CLI install.
- **`strata-publish`** — push local content up to Strata. Creates a document
  from a draft, or syncs a whole folder of Markdown into a Space (new files
  become documents, changed files update them, removed files are trashed).
- **`strata-review`** — review a document by leaving anchored comments on it,
  rather than rewriting it. Reads the document and posts feedback as comments.
  No CLI install.
- **`strata-spaces`** — mount a Space as a local folder of `.md` files: installs
  the Strata CLI on first run, handles the macOS FSKit extension or Linux FUSE
  helper, logs in, mounts Git-safely, and manages the lifecycle (list, unmount,
  recover). Falls back to a static-snapshot pull where a live mount is not
  possible.
- **`strata-doctor`** — diagnose why Strata is not working in Claude. Probes the
  MCP connection (registered, signed in, write scope, tool groups) and, when the
  CLI is present, its auth state, mount-backend prerequisites (the macOS FSKit
  module / the Linux FUSE runtime), mount health, and the most recent write
  failure (owner + request-access link). Read-only: it routes to a fix, never
  remediates by side effect. No CLI install for the MCP half.

## Install

Through the Claude marketplace (recommended once listed). Manually:

```
/plugin install strata-space/strata-claude-plugin
```

inside any Claude client that speaks the marketplace protocol. On install, the
bundled `.mcp.json` registers the Strata MCP server with your client; on the
first tool call it opens a browser once for sign-in.

## Requirements

- **MCP skills** (`strata-research`, `strata-publish` single-doc,
  `strata-review`, `strata-doctor` connectivity half) — `node` and `npm` for the
  bundled `mcp-remote` bridge. No Strata CLI needed.
- **Filesystem mount** (`strata-spaces`) and **folder publish**
  (`strata-publish` bulk) — macOS 15.4+ (FSKit backend) or Linux with kernel
  ≥ 4.18 and the `fuse3` userspace helper (FUSE backend). Windows is detected
  and routed to the in-conversation MCP skills; a native mount is out of scope.

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
browser for OAuth. That login is separate
from the CLI's keychain token, but if you are already signed in to strata.space
in your browser it completes in one click, because it reuses your browser
session rather than your CLI token.

## Privacy and consent

Every privileged command (`brew install`, `apt install`, `dnf install`,
`pacman`, `zypper`, `apk`, `sudo usermod`, `diskutil unmount force`,
`fusermount3 -uz`) is proposed in conversation and requires explicit user
confirmation before execution. Operations that write to your Strata content
(publishing, commenting) are confirmed in conversation before the first write.
No binary download proceeds without SHA-256 verification against a published
checksum. No environment-specific URLs are hardcoded beyond the MCP endpoint;
the rest is read from your CLI auth state.

## Development

Layout:

```
.claude-plugin/plugin.json   # marketplace manifest
.mcp.json                    # auto-registers the Strata MCP server
skills/
  strata-research/SKILL.md   # ask your Spaces (MCP)
  strata-publish/SKILL.md    # push local content up (MCP + CLI)
  strata-review/SKILL.md     # comment on a document (MCP)
  strata-spaces/SKILL.md     # mount lifecycle (CLI)
  strata-doctor/SKILL.md     # diagnose connectivity & write failures (MCP + CLI)
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
