# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-22

### Added
- `strata-doctor` skill: diagnose why Strata is not working in Claude and map
  each failure to a concrete next step. Probes MCP connectivity (registered,
  signed in, write scope, tool groups) and, when the CLI is present, its auth
  state, FSKit system-extension state, mount health, and the most recent write
  failure. Read-only: it routes to a fix, never remediates by side effect.

### Fixed
- `strata-doctor` no longer claims the CLI defaults to a local dev URL. The
  released CLI defaults to production (matching the bundled MCP endpoint), so
  the environment-consistency check now reads the effective `apiUrl` from
  `strata status --json` instead of guessing from an unset env var.
- macOS FSKit enablement advice (in `strata-spaces` and `strata-doctor`) now
  routes through the **By Category** view in System Settings, since the **By
  App** toggle is broken on macOS Tahoe, and enables the **Strata CLI** module
  under File System Extensions. `strata-doctor` also gains an FSKit
  system-extension probe, the most common cause of a silent mount failure.

## [0.2.0] - 2026-05-21

### Added
- `strata-research` skill: answer a question from your Spaces with citations,
  over the bundled MCP server. Read-only, no CLI install required.
- `strata-publish` skill: create a document from a draft, or `sync push` a
  folder of Markdown into a Space (creates, updates, and trashes to match).
- `strata-review` skill: leave anchored comments on a document via the MCP
  `manage_comments` tool. Reviews by commenting; never rewrites the body.
- `.claude-plugin/marketplace.json` makes this repo a self-hosted
  marketplace. Users can now add it directly with
  `/plugin marketplace add strata-space/strata-claude-plugin` and install
  with `/plugin install strata@strata-space`, independent of any
  Anthropic-operated catalog.

### Changed
- `.mcp.json` now enables the `comments` tool group via the
  `X-Strata-Tool-Groups` header, which unlocks `manage_comments` (and, on the
  same group, `manage_suggestions`) for `strata-review`. This affects every
  existing user on upgrade, not just new installers.

### Removed
- `strata-mcp-setup` skill: redundant. The bundled `.mcp.json` auto-registers
  the Strata MCP server on install, so there is no manual setup step in Claude
  Code or Claude Desktop. Configuration notes for other MCP clients moved to
  the README.

## [0.1.1] - 2026-05-20

### Changed
- MCP endpoint URL updated from `https://api.strata.space/mcp` to
  `https://api.prod.us-east-2.strata.space/mcp` (the actual deployment).
  The `api.strata.space` host did not resolve, so the previous release
  registered a dead MCP server with users' Claude clients.

## [0.1.0] - 2026-05-20

### Added
- `strata-spaces` skill: macOS FSKit / Linux FUSE mount lifecycle with
  static-snapshot fallback.
- `strata-mcp-setup` skill: register `https://api.strata.space/mcp` with
  Claude Desktop, Code, Cursor, VS Code, Zed, Continue, Cline, and Windsurf.
- Cross-platform smoke tests (`tests/`) and per-OS first-mount rehearsals.
- GitHub Actions: shellcheck and cross-platform smokes on every PR.
