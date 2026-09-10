# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0](https://github.com/strata-space/strata-claude-plugin/compare/strata--v0.7.1...strata--v0.8.0) (2026-09-10)


### Added

* add the shared presentation authoring skill ([#50](https://github.com/strata-space/strata-claude-plugin/issues/50)) ([33e3cf6](https://github.com/strata-space/strata-claude-plugin/commit/33e3cf64d1e4e84c8142b88e71593bbefa564d74))

## [0.7.1](https://github.com/strata-space/strata-claude-plugin/compare/strata--v0.7.0...strata--v0.7.1) (2026-07-01)


### Fixed

* **strata-spaces:** default mount path to ./spaces under CWD ([#45](https://github.com/strata-space/strata-claude-plugin/issues/45)) ([1a919e9](https://github.com/strata-space/strata-claude-plugin/commit/1a919e97a06c75425118004281a6147840957b89))

## [0.7.0](https://github.com/strata-space/strata-claude-plugin/compare/strata--v0.6.0...strata--v0.7.0) (2026-06-12)


### Added

* Codex packaging via a second host manifest with lockstep versioning ([#43](https://github.com/strata-space/strata-claude-plugin/issues/43)) ([7aed804](https://github.com/strata-space/strata-claude-plugin/commit/7aed8045b4d98c500fc541eabb3ce17ba052d2ac))

## [0.6.0](https://github.com/strata-space/strata-claude-plugin/compare/strata--v0.5.2...strata--v0.6.0) (2026-06-10)


### Added

* **skills:** unified-agent CLI — agent health in doctor, agent-era link lifecycle, Windows reach ([#41](https://github.com/strata-space/strata-claude-plugin/issues/41)) ([8a2e7ea](https://github.com/strata-space/strata-claude-plugin/commit/8a2e7ea875c26ba8441e3913033507da3a6a0f46))
* **strata-doctor:** surface the supervised sync daemon log cross-platform ([#38](https://github.com/strata-space/strata-claude-plugin/issues/38)) ([715c243](https://github.com/strata-space/strata-claude-plugin/commit/715c24301b0d7ab061dc41a326f1df49c9b8d13f))

## [0.5.2](https://github.com/strata-space/strata-claude-plugin/compare/strata--v0.5.1...strata--v0.5.2) (2026-06-08)


### Changed

* correct the Homebrew tap name in the CLI install note ([#36](https://github.com/strata-space/strata-claude-plugin/issues/36)) ([194bc8a](https://github.com/strata-space/strata-claude-plugin/commit/194bc8a2d25acb2ed37f01688cacdc661728ba3b))

## [0.5.1](https://github.com/strata-space/strata-claude-plugin/compare/strata--v0.5.0...strata--v0.5.1) (2026-06-08)


### Changed

* move the marketplace to its own repo ([#30](https://github.com/strata-space/strata-claude-plugin/issues/30)) ([0da9183](https://github.com/strata-space/strata-claude-plugin/commit/0da91830ee11066e59c710e6faf4ab3b669bb452))

## [0.5.0](https://github.com/strata-space/strata-claude-plugin/compare/strata--v0.4.0...strata--v0.5.0) (2026-06-02)


### Added

* **doctor:** detect stuck mount / leaked carrier disk and route recovery ([#19](https://github.com/strata-space/strata-claude-plugin/issues/19)) ([e1bfa29](https://github.com/strata-space/strata-claude-plugin/commit/e1bfa29a01d5602fc86ea5a3868ffe785b27af72))
* **doctor:** diagnose Linux FUSE runtime, symmetric with macOS FSKit ([0d99ffe](https://github.com/strata-space/strata-claude-plugin/commit/0d99ffe06a62f88c429d169c97d31aedc53b99f7))
* **publish:** default new docs to private + scope picker ([#16](https://github.com/strata-space/strata-claude-plugin/issues/16)) ([1819212](https://github.com/strata-space/strata-claude-plugin/commit/1819212a722c117ddcd3b927c6c3b809bcd9c7ad))
* **skills:** live folder-sync API + new-arch sync troubleshooting ([#22](https://github.com/strata-space/strata-claude-plugin/issues/22)) ([2d8dcad](https://github.com/strata-space/strata-claude-plugin/commit/2d8dcadab556a249e2b855d1b81c77c49e658d31))


### Fixed

* **fskit:** detect FSKit module via pluginkit, not systemextensionsctl ([cac758d](https://github.com/strata-space/strata-claude-plugin/commit/cac758ddae0a763c716b0201cf071b27910576e0))
* **publish:** rework scope picker to the folder-placement model ([#18](https://github.com/strata-space/strata-claude-plugin/issues/18)) ([f0b4162](https://github.com/strata-space/strata-claude-plugin/commit/f0b41628dd5059bad840205441aae934ce74ee29))
* **skills:** correct CLI jq shapes, ungate the doctor probe, set plan expectations ([#17](https://github.com/strata-space/strata-claude-plugin/issues/17)) ([e5bd3be](https://github.com/strata-space/strata-claude-plugin/commit/e5bd3be7840fd9ebfde131085e2f71e0bc917b52))
* **strata-doctor:** sync status subcommand is human-readable, not JSON ([#23](https://github.com/strata-space/strata-claude-plugin/issues/23)) ([58fa567](https://github.com/strata-space/strata-claude-plugin/commit/58fa567d2789ff1e161e094fe910bd651913bb54))
* **strata-spaces:** choose install mode up-front so "install" defaults to sync ([#25](https://github.com/strata-space/strata-claude-plugin/issues/25)) ([a8da374](https://github.com/strata-space/strata-claude-plugin/commit/a8da37473421c52dcd81d1bb89b6f81c239a05d5))
* **strata-spaces:** drop removed --writable flag (writable is the CLI default) ([#20](https://github.com/strata-space/strata-claude-plugin/issues/20)) ([bbf2f55](https://github.com/strata-space/strata-claude-plugin/commit/bbf2f558db84f8822937bd5d8c176d78f4782996))

## [0.4.0](https://github.com/strata-space/strata-claude-plugin/compare/v0.3.0...v0.4.0) (2026-05-23)


### Added

* **085:** plugin scaffolding + MountState enrichment (Phases 1-2) ([9967679](https://github.com/strata-space/strata-claude-plugin/commit/9967679f9b779221eb9c3b30f3bfa33c8073bc66))
* **085:** SKILL.md content + VM smoke tests (Phases 3-8) ([81c05a3](https://github.com/strata-space/strata-claude-plugin/commit/81c05a3615d01e42d72b8bb2e0d77ad1cae3835f))
* self-host as a custom marketplace ([#4](https://github.com/strata-space/strata-claude-plugin/issues/4)) ([67c2ba5](https://github.com/strata-space/strata-claude-plugin/commit/67c2ba501b01db7abbec7d6f49a349ff6fac31a9))
* strata-doctor diagnostic skill (+ pending release-please CI) ([#7](https://github.com/strata-space/strata-claude-plugin/issues/7)) ([a70f600](https://github.com/strata-space/strata-claude-plugin/commit/a70f600cb03e8960fe3b78f2eb9bdcd5e7afaba9))
* Tier-1 skills (research, publish, review); retire strata-mcp-setup ([#5](https://github.com/strata-space/strata-claude-plugin/issues/5)) ([29ac9b0](https://github.com/strata-space/strata-claude-plugin/commit/29ac9b09cb1fb3dc8a01dd260bad821a2c7a3572))


### Fixed

* **fskit:** correct system-extension enablement advice + add doctor probe ([#9](https://github.com/strata-space/strata-claude-plugin/issues/9)) ([29d2d6c](https://github.com/strata-space/strata-claude-plugin/commit/29d2d6c896a8e0c00fee7a42454b852a885ef23e))
* **strata-doctor:** correct CLI default-URL claim; probe effective apiUrl ([#8](https://github.com/strata-space/strata-claude-plugin/issues/8)) ([73de68d](https://github.com/strata-space/strata-claude-plugin/commit/73de68d581128730709c2797320214e6d255eea2))

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
