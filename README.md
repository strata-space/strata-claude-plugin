# Strata Plugin for Claude

Mount your [Strata](https://strata.space) Spaces as local folders of Markdown files, or register the Strata MCP server so Claude can read and edit your Strata documents directly in conversation. Two skills ship in v1:

- **`strata-spaces`** — install the Strata CLI on first run, grant the macOS FSKit extension permission (or install the Linux FUSE userspace helper), log in, pick a Space, mount it Git-safely, and manage the lifecycle (list, unmount, force-recover). Falls back to a static-snapshot pull on environments that cannot host a live mount.
- **`strata-mcp-setup`** — register `https://api.strata.space/mcp` with Claude (Desktop, Code, Cursor, VS Code, Zed, Continue, Cline, Windsurf) via the `mcp-remote` bridge or, where supported, a direct streamable-HTTP config. No CLI install required.

Empty placeholder directories are created on install; the skills self-bootstrap on first use.

## Requirements

- macOS 15.4+ (FSKit backend) or Linux with kernel ≥ 4.18 and the `fuse3` userspace helper (FUSE backend) for `strata-spaces`.
- Any platform with `node`/`npm` (for `mcp-remote`) for `strata-mcp-setup`.

Windows is detected and routed to the MCP path; native filesystem mount on Windows is out of scope.

## Privacy and consent

Every privileged command (`brew install`, `apt install`, `dnf install`, `pacman`, `zypper`, `apk`, `sudo usermod`, `diskutil unmount force`, `fusermount3 -uz`) is proposed in conversation and requires explicit user confirmation before execution. No binary download proceeds without SHA-256 verification against a published checksum. No environment-specific URLs are hardcoded; the plugin reads them from the user's CLI auth state.
