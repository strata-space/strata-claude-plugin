# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
