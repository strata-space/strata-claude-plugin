# Strata Plugin for Claude

Mount your [Strata](https://strata.space) Spaces as local folders of Markdown files, or register the Strata MCP server so Claude can read and edit your Strata documents directly in conversation. Two skills ship in v1:

- **`strata-spaces`** — install the Strata CLI on first run, grant the macOS FSKit extension permission (or install the Linux FUSE userspace helper), log in, pick a Space, mount it Git-safely, and manage the lifecycle (list, unmount, force-recover). Falls back to a static-snapshot pull on environments that cannot host a live mount.
- **`strata-mcp-setup`** — register `https://api.prod.us-east-2.strata.space/mcp` with Claude (Desktop, Code, Cursor, VS Code, Zed, Continue, Cline, Windsurf) via the `mcp-remote` bridge or, where supported, a direct streamable-HTTP config. No CLI install required.

## Install

Through the Claude marketplace (recommended once listed). Manually:

```
/plugin install strata-space/strata-claude-plugin
```

inside any Claude client that speaks the marketplace protocol.

## Requirements

- **`strata-spaces`** — macOS 15.4+ (FSKit backend) or Linux with kernel ≥ 4.18 and the `fuse3` userspace helper (FUSE backend). Windows is detected and routed to the MCP path; native filesystem mount on Windows is out of scope.
- **`strata-mcp-setup`** — any platform with `node` and `npm` for the `mcp-remote` bridge (no CLI install needed).

## Privacy and consent

Every privileged command (`brew install`, `apt install`, `dnf install`, `pacman`, `zypper`, `apk`, `sudo usermod`, `diskutil unmount force`, `fusermount3 -uz`) is proposed in conversation and requires explicit user confirmation before execution. No binary download proceeds without SHA-256 verification against a published checksum. No environment-specific URLs are hardcoded; the plugin reads them from the user's CLI auth state.

## Development

Layout:

```
.claude-plugin/plugin.json   # marketplace manifest
skills/
  strata-spaces/SKILL.md     # mount lifecycle skill
  strata-mcp-setup/SKILL.md  # MCP server registration skill
tests/                       # VM smoke runners (bash)
```

Run the smoke tests on a clean VM (each script no-ops on a wrong platform, exits non-zero on a failed assertion):

```
bash tests/macos-first-mount.sh           # macOS 15.4+
bash tests/linux-debian-first-mount.sh    # Ubuntu / Debian
bash tests/linux-fedora-first-mount.sh    # Fedora
bash tests/linux-arch-first-mount.sh      # Arch
bash tests/git-mount-gitignore.sh         # any platform
bash tests/mcp-setup.sh                   # any platform with node + npx
bash tests/snapshot-fallback.sh           # any platform with strata CLI
bash tests/unmount-lifecycle.sh           # any platform with strata CLI
bash tests/permission-denied.sh           # any platform with strata CLI
```

CI runs the platform-agnostic tests on every push and PR; per-OS first-mount tests are reserved for release rehearsal.

## License

MIT. See [LICENSE](./LICENSE).
