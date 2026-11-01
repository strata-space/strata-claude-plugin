# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A dual-host plugin (`strata`) for Claude Code and Codex that ships seven skills, a bundled `.mcp.json` that registers the Strata MCP server, a Claude Code hooks module under `hooks/` (TypeScript the engine runs directly), and a set of bash smoke tests. There is no build step and no package manager: the deliverables are the `SKILL.md` files, the hooks module, and their test runners.

- `skills/strata-research/SKILL.md`: answer a question from the user's Spaces with citations, over the MCP server (read-only, no CLI).
- `skills/strata-publish/SKILL.md`: push local content up. `create_document` for a single doc, `strata sync push` for a folder.
- `skills/strata-review/SKILL.md`: leave anchored comments on a document via the MCP `create_comment` tool; never rewrites the body.
- `skills/strata-spaces/SKILL.md`: operates the user's `strata` CLI to mount a Space as a local Markdown folder (macOS FSKit / Linux FUSE), with a static-snapshot fallback when a live mount is impossible.
- `skills/strata-doctor/SKILL.md`: diagnose why Strata is not working — MCP connectivity (registered, signed in, write scope, tool groups) and, when the CLI is present, auth state, mount health, and the permission-denied (write-failure) diagnosis. Read-only: it routes to a fix, never remediates by side effect.
- `skills/strata-blog/SKILL.md`: writes, converts, and styles blog posts through `blog:` frontmatter (cover, header image, wallpaper, metadata), checking `blogValidation`. Uses MCP without requiring the Strata CLI.
- `skills/strata-presentation/SKILL.md`: creates and revises decks from a conversation, with grammar, theme, import, validation, and refresh references. Uses MCP without requiring the Strata CLI.
- `hooks/register.tsx` (named by `hooks/hooks.json`): the Claude Code hooks module. A document pane on `read_document` (`hooks/markdown.ts` cuts sections, folds html embeds, makes the blocks the cursor walks), a band above the prompt with revision polling over `find` info, the explorer and review queue, `@strata:` mentions, and the live tier over `strata doc watch` (`hooks/watch.ts` parses its JSON lines). `types/index.d.ts` is its `$.state` contract, named by `plugin.json` `types`; `userConfig` there declares its options.
- `.mcp.json`: registers the Strata MCP server, with the `comments` tool group enabled, on install. Its URL reads `STRATA_API_URL` with the production endpoint as the default.
- `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json`: the two host manifests. Versions stay in lockstep (release-please bumps both via extra-files; smoke.yml asserts equality). The marketplace that lists this plugin lives in its own repo, `strata-space/marketplace`.

When editing skills, remember they are **executed by Claude at runtime**, not by a script. The SKILL.md body is prompt content + reference bash snippets that Claude reads and adapts. Treat changes to it like changes to a runbook, not like refactoring source code.

## Commands

```bash
# Presentation skill checks (Node.js 20+, no package install)
node --test tests/presentation/*.test.mjs

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

# Hooks module: validate (manifest + what the module hooks and calls) and test (hooks/*.test.ts)
claude plugin validate .
claude plugin test .
# Type-check after one load (`claude --plugin-dir .` lays .claude-plugin/types/, gitignored)
npx tsc -p .
```

## Hooks module rules

- Every write to Strata from the pane follows a press or a keystroke; the module never writes on its own, and it never holds, rewrites or denies the model's own document writes (`rewrite_document`, `replace_document_text`, `insert_document_section`): review-before-write, if ever wanted, belongs on the edit tools server-side, not in a client-side gate. `$.mcp.call` raises no permission prompt.
- `$.state` values are declared in `types/index.d.ts` with a `shape` tag per atom; change the tag when a value's fields change, so a reload declines what an older version stored.
- No new hardcoded URLs: document links come from `find` info (`url`) or the workspace-chooser deep link in `hooks/strata.ts`.
- The live tier spawns the CLI the `cliPath` option names, `strata` by default; it must degrade to revision polling when the CLI is missing, signed out, too old, or not saying which deployment it is signed into (`probeTier`), never fail the pane. A watch follows a document only when the document's link in the web app (from `find` info) names the deployment the CLI's `status --json` `apiUrl` names (`deploymentOf`): the CLI watches by id on its own deployment, and another deployment's MCP server may hold a document of the same id. A document is the pair of its MCP server and its id everywhere the module tells documents apart (`DocumentRef`, `isViewOf`, `isRowOf`).
- Tests live beside the code (`hooks/*.test.ts`) and run with `claude plugin test .`; the kit's stand-ins for `$` calls answer `{ value }`, plain events answer their result, and a `process.spawn` stand-in is an async generator.
- `hooks/hooks.json` keeps both shapes: an empty classic `hooks` record, so a Claude Code build without hooks modules (they are rolling out) validates and loads the plugin without the module, and `modules` naming `register.tsx` for a build with them. Keep both; `claude plugin test` exists only on the latter, and CI skips it with a notice elsewhere.
- The module changes its state through one queue of steps (`step` in `hooks/register.tsx`): a step reads the atoms, decides, writes and returns, and waits on nothing else (no `$.mcp.call`, no process, no question). Work that waits runs outside the queue and brings its answer in as a step judged against the state then: a fetch by the view's `nav` (one more on every navigation), the watch's events by its identity (`watching === watch`), a post by the draft's id and the field's generation. Do not add module-level sequence counters or "judged inside the update and again after" checks; add a step, or extend the runner that owns the concern (`settlePane`, `syncWatch`, `requestThreads`, `probe`, `runSearch`, `checkRevisions`). `hooks/pane.ts` is the pure side (views, budgets, selections, anchors): keep `$` out of it. `hooks/interleave.test.ts` drives the module through every ordering of held fetches, a read of the model's and a close; add to its events when adding a path that can run beside another.

CI (`.github/workflows/smoke.yml`) runs `shellcheck` then the cross-platform subset on `ubuntu-latest` and `macos-latest`. Per-OS first-mount scripts are reserved for release rehearsal — they install packages and expect a clean VM.

## Hard constraints these skills enforce

These are load-bearing rules the SKILL.md files spell out; don't soften or remove them when editing.

- **Explicit per-command consent.** Every privileged operation (`brew install`, `apt/dnf/pacman/zypper/apk`, `sudo usermod`, `diskutil unmount force`, `fusermount3 -uz`) must be shown verbatim and gated on `[y/N]` before execution. If declined, route to snapshot-fallback (`strata-spaces`) or stop. Never retry silently. Writes to Strata content (`strata-publish`, `strata-review`) are confirmed in conversation before the first write.
- **SHA-256 verification.** The Linux CLI install path fetches the GitHub release asset, reads the matching `digest` from the release JSON, and refuses to extract on mismatch. Keep this check intact.
- **Destructive-path refusal.** `strata-spaces` must reject `/`, `/usr`, `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`, `/sys`, `/proc`, `$HOME`, `.`, and any path that already contains `*.md` content. `git-mount-gitignore.sh` asserts the refusal list.
- **Git-tree safety.** When mounting inside a git work tree, `spaces/` must be added to `.gitignore` (or `.git/info/exclude`) before the mount is created. The skill must never `git add` or `git commit` the change — the user owns commits.
- **Endpoints come from the CLI's auth state.** The only hardcoded URL is the MCP endpoint `https://api.strata.space/mcp` in `.mcp.json` (plus `mcp.json` for Cursor, `.codex-mcp.json` for Codex, and the README's other-clients snippet). This is the canonical, region-free production endpoint. When changing it, update every reference and bump the plugin version. Document links in skills use the app's workspace-chooser deep link `https://app.strata.space/workspaces?next=%2Fdocuments%2F<docId>` (MCP results carry a `documentId` but no URL or workspace slug; the chooser resolves it to `/w/<workspace>/documents/<docId>/<title-slug>`). Never construct `/w/<workspace>/…` links from a guessed workspace.
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
