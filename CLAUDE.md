# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code plugin (`strata`) that ships five skills, a bundled `.mcp.json` that registers the Strata MCP server, and a set of bash smoke tests. There is no application code, no build step, and no package manager: the deliverables are the `SKILL.md` files plus their test runners.

- `skills/strata-research/SKILL.md`: answer a question from the user's Spaces with citations, over the MCP server (read-only, no CLI).
- `skills/strata-publish/SKILL.md`: push local content up. `edit_document` for a single doc, `strata sync push` for a folder.
- `skills/strata-review/SKILL.md`: leave anchored comments on a document via the MCP `manage_comments` tool; never rewrites the body.
- `skills/strata-spaces/SKILL.md`: operates the user's `strata` CLI to mount a Space as a local Markdown folder (macOS FSKit / Linux FUSE), with a static-snapshot fallback when a live mount is impossible.
- `skills/strata-doctor/SKILL.md`: diagnose why Strata is not working — MCP connectivity (registered, signed in, write scope, tool groups) and, when the CLI is present, auth state, mount health, and the permission-denied (write-failure) diagnosis. Read-only: it routes to a fix, never remediates by side effect.
- `.mcp.json`: registers the Strata MCP server, with the `comments` tool group enabled, on install.
- `.claude-plugin/plugin.json`: marketplace manifest.

When editing skills, remember they are **executed by Claude at runtime**, not by a script. The SKILL.md body is prompt content + reference bash snippets that Claude reads and adapts. Treat changes to it like changes to a runbook, not like refactoring source code.

## Commands

```bash
# Smoke tests — each script no-ops on the wrong platform and exits non-zero on failed assertion.
bash tests/git-mount-gitignore.sh         # cross-platform, runs in CI
bash tests/snapshot-fallback.sh           # needs strata CLI; skips otherwise
bash tests/unmount-lifecycle.sh           # needs strata CLI; skips otherwise
bash tests/permission-denied.sh           # needs strata CLI; skips otherwise
bash tests/macos-first-mount.sh           # release rehearsal on macOS 15.4+
bash tests/linux-debian-first-mount.sh    # release rehearsal on Ubuntu/Debian
bash tests/linux-fedora-first-mount.sh    # release rehearsal on Fedora
bash tests/linux-arch-first-mount.sh      # release rehearsal on Arch

# Lint shell scripts (this is what CI gates on first)
shellcheck tests/*.sh
```

CI (`.github/workflows/smoke.yml`) runs `shellcheck` then the cross-platform subset on `ubuntu-latest` and `macos-latest`. Per-OS first-mount scripts are reserved for release rehearsal — they install packages and expect a clean VM.

## Hard constraints these skills enforce

These are load-bearing rules the SKILL.md files spell out; don't soften or remove them when editing.

- **Explicit per-command consent.** Every privileged operation (`brew install`, `apt/dnf/pacman/zypper/apk`, `sudo usermod`, `diskutil unmount force`, `fusermount3 -uz`) must be shown verbatim and gated on `[y/N]` before execution. If declined, route to snapshot-fallback (`strata-spaces`) or stop. Never retry silently. Writes to Strata content (`strata-publish`, `strata-review`) are confirmed in conversation before the first write.
- **SHA-256 verification.** The Linux CLI install path fetches the GitHub release asset, reads the matching `digest` from the release JSON, and refuses to extract on mismatch. Keep this check intact.
- **Destructive-path refusal.** `strata-spaces` must reject `/`, `/usr`, `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`, `/sys`, `/proc`, `$HOME`, `.`, and any path that already contains `*.md` content. `git-mount-gitignore.sh` asserts the refusal list.
- **Git-tree safety.** When mounting inside a git work tree, `spaces/` must be added to `.gitignore` (or `.git/info/exclude`) before the mount is created. The skill must never `git add` or `git commit` the change — the user owns commits.
- **Endpoints come from the CLI's auth state.** The only hardcoded URL is the MCP endpoint `https://api.prod.us-east-2.strata.space/mcp` in `.mcp.json` (and the README's other-clients snippet). That literal is environment-specific and will move when a stable customer-facing alias is in place; when it does, update every reference and bump the plugin version. Document links in skills use `https://strata.space/app/documents/<docId>`.
- **MCP skills must not require the CLI.** `strata-research` and `strata-review` operate purely over the MCP server and must complete without `strata` on `PATH`. `strata-publish` needs the CLI only for folder sync; its single-document path is MCP-only. `strata-doctor`'s MCP-connectivity half (Layer 1) runs without the CLI; its Layer 2 (CLI auth, mount health, write-failure diagnosis) is skipped cleanly when `strata` is absent.
- **Doctor diagnoses, never remediates.** `strata-doctor` is read-only: it probes (`find`, `command -v`, `strata status --json`, reading config) and routes to a fix, but never installs the CLI, never `strata login`s for the user, never force-unmounts, and never edits `.mcp.json`. Each fix is a user action or a hand-off to the owning skill (`strata-spaces` for install and stuck-mount recovery).
- **Snapshot-fallback triggers.** `strata-spaces` falls back to `strata sync pull` when: platform is `macos-too-old` (< 15.4), `wsl`, `container`, `unsupported` (Windows native), the user declined a CLI/`fuse3`/`usermod` consent, or distro detection returned an unknown ID.

## Test helper conventions

`tests/_common.sh` provides `ok`, `fail`, `assert_cmd_present`, `assert_file_exists`, `assert_jq_field`, and `summarize`. All smoke scripts:

1. `set -euo pipefail` at the top.
2. Source `_common.sh` via `HERE="$(cd "$(dirname "$0")" && pwd)" && . "$HERE/_common.sh"`.
3. Use `mktemp -d` with a `trap … EXIT` cleanup — never write into the repo or `$HOME` outside a temp dir.
4. End with `summarize`, which exits non-zero if any `fail` was recorded.

When adding a new assertion, replay the exact bash snippet from the relevant `SKILL.md` rather than reimplementing the logic — the point is to catch drift between the runbook and the test.
