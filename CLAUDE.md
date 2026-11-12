# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A dual-host plugin (`strata`) for Claude Code and Codex that ships seven skills, a bundled `.mcp.json` that registers the StrataSpace MCP server. There is no application code, no build step, and no package manager: the deliverables are the `SKILL.md` files. Tests live in `strata-space/strata-claude-plugin-tests`.

**Never add scripts or programs here.** The Claude plugin directory accepts only Markdown, text, JSON, YAML and images (PNG, JPEG, GIF, WebP, ICO) from an unverified organization, and refuses the whole version for one other file, a `#!` line, or a package-manager config. Images must carry no long embedded text (metadata, comments).

- `skills/strata-research/SKILL.md`: answer a question from the user's Spaces with citations, over the MCP server (read-only, no CLI).
- `skills/strata-publish/SKILL.md`: push local content up. `create_document` for a single doc, `strata sync push` for a folder.
- `skills/strata-review/SKILL.md`: leave anchored comments on a document via the MCP `create_comment` tool; never rewrites the body.
- `skills/strata-spaces/SKILL.md`: operates the user's `strata` CLI to mount a Space as a local Markdown folder (macOS FSKit / Linux FUSE), with a static-snapshot fallback when a live mount is impossible.
- `skills/strata-doctor/SKILL.md`: diagnose why StrataSpace is not working — MCP connectivity (registered, signed in, write scope, tool groups) and, when the CLI is present, auth state, mount health, and the permission-denied (write-failure) diagnosis. Read-only: it routes to a fix, never remediates by side effect.
- `skills/strata-blog/SKILL.md`: writes, converts, and styles blog posts through `blog:` frontmatter (cover, header image, wallpaper, metadata), checking `blogValidation`. Uses MCP without requiring the Strata CLI.
- `skills/strata-presentation/SKILL.md`: creates and revises decks from a conversation, with grammar, theme, import, validation, and refresh references. Uses MCP without requiring the Strata CLI.
- `.mcp.json`: registers the StrataSpace MCP server on install. It sends no headers; the server serves the `core` and `comments` tool groups by default.
- `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json`: the two host manifests. Versions stay in lockstep (release-please bumps both via extra-files; smoke.yml asserts equality). The marketplace that lists this plugin lives in its own repo, `strata-space/marketplace`.

When editing skills, remember they are **executed by Claude at runtime**, not by a script. The SKILL.md body is prompt content + reference bash snippets that Claude reads and adapts. Treat changes to it like changes to a runbook, not like refactoring source code.

## Commands

```bash
claude plugin validate .claude-plugin/plugin.json
```

CI (`.github/workflows/smoke.yml`) checks manifest JSON, version lockstep, and `claude plugin validate`. The smoke tests and presentation checks run in `strata-space/strata-claude-plugin-tests` (clone it next to this repo; see its README).

## Hard constraints these skills enforce

These are load-bearing rules the SKILL.md files spell out; don't soften or remove them when editing.

- **Explicit per-command consent.** Every privileged operation (`brew install`, `apt/dnf/pacman/zypper/apk`, `sudo usermod`, `diskutil unmount force`, `fusermount3 -uz`) must be shown verbatim and gated on `[y/N]` before execution. If declined, route to snapshot-fallback (`strata-spaces`) or stop. Never retry silently. Writes to StrataSpace content (`strata-publish`, `strata-review`) are confirmed in conversation before the first write.
- **SHA-256 verification.** The Linux CLI install path fetches the GitHub release asset, reads the matching `digest` from the release JSON, and refuses to extract on mismatch. Keep this check intact.
- **Destructive-path refusal.** `strata-spaces` must reject `/`, `/usr`, `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`, `/sys`, `/proc`, `$HOME`, `.`, and any path that already contains `*.md` content. `git-mount-gitignore.sh` in the tests repo asserts the refusal list.
- **Git-tree safety.** When mounting inside a git work tree, `spaces/` must be added to `.gitignore` (or `.git/info/exclude`) before the mount is created. The skill must never `git add` or `git commit` the change — the user owns commits.
- **Endpoints come from the CLI's auth state.** The only hardcoded URL is the MCP endpoint `https://api.strata.space/mcp` in `.mcp.json` (plus `mcp.json` for Cursor, `.codex-mcp.json` for Codex, and the README's other-clients snippet). This is the canonical, region-free production endpoint. When changing it, update every reference and bump the plugin version. Document links in skills use the app's workspace-chooser deep link `https://app.strata.space/workspaces?next=%2Fdocuments%2F<docId>` (MCP results carry a `documentId` but no URL or workspace slug; the chooser resolves it to `/w/<workspace>/documents/<docId>/<title-slug>`). Never construct `/w/<workspace>/…` links from a guessed workspace.
- **MCP skills must not require the CLI.** `strata-research` and `strata-review` operate purely over the MCP server and must complete without `strata` on `PATH`. `strata-publish` needs the CLI only for folder sync; its single-document path is MCP-only. `strata-doctor`'s MCP-connectivity half (Layer 1) runs without the CLI; its Layer 2 (CLI auth, mount health, write-failure diagnosis) is skipped cleanly when `strata` is absent.
- **Doctor diagnoses, never remediates.** `strata-doctor` is read-only: it probes (`find`, `command -v`, `strata status --json`, reading config) and routes to a fix, but never installs the CLI, never `strata login`s for the user, never force-unmounts, and never edits `.mcp.json`. Each fix is a user action or a hand-off to the owning skill (`strata-spaces` for install and stuck-mount recovery).
- **Snapshot-fallback triggers.** `strata-spaces` falls back to `strata sync pull` when: platform is `macos-too-old` (< 15.4), `wsl`, `container`, `unsupported` (Windows native), the user declined a CLI/`fuse3`/`usermod` consent, or distro detection returned an unknown ID.

## Tests

When changing a runbook step, update the matching assertion in the tests repo: replay the exact bash snippet from the relevant `SKILL.md` rather than reimplementing the logic.
