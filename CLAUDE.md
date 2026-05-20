# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code plugin (`strata`, v0.1.0) that ships **two skills** and a set of bash smoke tests. There is no application code, no build step, and no package manager — the deliverables are the two `SKILL.md` files plus their test runners.

- `skills/strata-spaces/SKILL.md` — operates the user's `strata` CLI to mount a Space as a local Markdown folder (macOS FSKit / Linux FUSE), with a static-snapshot fallback when live mount is impossible.
- `skills/strata-mcp-setup/SKILL.md` — registers `https://api.strata.space/mcp` with the user's Claude client (Desktop, Code, Cursor, VS Code, Zed, Continue, Cline, Windsurf), usually via the `mcp-remote` npm bridge.
- `.claude-plugin/plugin.json` — marketplace manifest.

When editing skills, remember they are **executed by Claude at runtime**, not by a script. The SKILL.md body is prompt content + reference bash snippets that Claude reads and adapts. Treat changes to it like changes to a runbook, not like refactoring source code.

## Commands

```bash
# Smoke tests — each script no-ops on the wrong platform and exits non-zero on failed assertion.
bash tests/git-mount-gitignore.sh         # cross-platform, runs in CI
bash tests/mcp-setup.sh                   # cross-platform, runs in CI
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

- **Explicit per-command consent.** Every privileged operation (`brew install`, `apt/dnf/pacman/zypper/apk`, `sudo usermod`, `diskutil unmount force`, `fusermount3 -uz`) must be shown verbatim and gated on `[y/N]` before execution. If declined, route to snapshot-fallback (`strata-spaces`) or exit (`strata-mcp-setup`). Never retry silently.
- **SHA-256 verification.** The Linux CLI install path fetches the GitHub release asset, reads the matching `digest` from the release JSON, and refuses to extract on mismatch. Keep this check intact.
- **Destructive-path refusal.** `strata-spaces` must reject `/`, `/usr`, `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`, `/sys`, `/proc`, `$HOME`, `.`, and any path that already contains `*.md` content. `git-mount-gitignore.sh` asserts the refusal list.
- **Git-tree safety.** When mounting inside a git work tree, `spaces/` must be added to `.gitignore` (or `.git/info/exclude`) before the mount is created. The skill must never `git add` or `git commit` the change — the user owns commits.
- **No environment-specific URLs hardcoded.** Read endpoints from the CLI's auth state. The one allowed literal is the public MCP endpoint `https://api.strata.space/mcp` in `strata-mcp-setup`.
- **`strata-mcp-setup` must not touch the CLI.** It must complete without `strata` on `PATH`, and never invoke or check for it. Mount requests hand off to the `strata-spaces` sibling.
- **Snapshot-fallback triggers.** `strata-spaces` falls back to `strata sync pull` when: platform is `macos-too-old` (< 15.4), `wsl`, `container`, `unsupported` (Windows native), the user declined a CLI/`fuse3`/`usermod` consent, or distro detection returned an unknown ID.

## Test helper conventions

`tests/_common.sh` provides `ok`, `fail`, `assert_cmd_present`, `assert_file_exists`, `assert_jq_field`, and `summarize`. All smoke scripts:

1. `set -euo pipefail` at the top.
2. Source `_common.sh` via `HERE="$(cd "$(dirname "$0")" && pwd)" && . "$HERE/_common.sh"`.
3. Use `mktemp -d` with a `trap … EXIT` cleanup — never write into the repo or `$HOME` outside a temp dir.
4. End with `summarize`, which exits non-zero if any `fail` was recorded.

When adding a new assertion, replay the exact bash snippet from the relevant `SKILL.md` rather than reimplementing the logic — the point is to catch drift between the runbook and the test.
