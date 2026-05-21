# Contributing

Thanks for helping improve the Strata Claude plugin.

## What this repo ships

Two skills (`skills/strata-spaces/SKILL.md`, `skills/strata-mcp-setup/SKILL.md`),
a plugin manifest, and bash smoke tests. There is no application code, no
build step, and no package manager.

Skills are **executed by Claude at runtime**, not by a script. Treat changes
to `SKILL.md` like changes to a runbook, not refactoring source code.

## Before opening a PR

1. **Validate the manifest.**
   ```bash
   claude plugin validate ./
   ```
   CI runs this on every PR. Locally you can pass `--strict` to also surface
   warnings (useful for catching mistyped manifest fields), but note that
   the contributor `CLAUDE.md` at the repo root triggers a structural
   warning that does not apply to plugin users.
2. **Lint shell.**
   ```bash
   shellcheck tests/*.sh
   ```
3. **Run the cross-platform smokes.**
   ```bash
   bash tests/git-mount-gitignore.sh
   bash tests/mcp-setup.sh
   ```
4. **If you touched a runbook step**, replay the exact bash snippet from the
   relevant `SKILL.md` in `tests/`. The point of the tests is to catch drift
   between the runbook and the assertions — don't reimplement the logic.

## Hard rules these skills enforce

These are spelled out in the `SKILL.md` files and asserted in `tests/`.
Don't soften or remove them in a PR:

- Every privileged command must be shown verbatim and gated on explicit
  `[y/N]` consent. If declined, route to snapshot-fallback
  (`strata-spaces`) or exit (`strata-mcp-setup`). Never retry silently.
- The Linux CLI install path reads the GitHub release `digest` and refuses
  to extract on SHA-256 mismatch. Keep this check intact.
- `strata-spaces` rejects mounting over destructive paths (`/`, `/usr`,
  `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`, `/sys`, `/proc`,
  `$HOME`, `.`) or any directory containing existing `*.md` content.
- Mounting inside a git work tree must add `spaces/` to `.gitignore` or
  `.git/info/exclude` before creating the mount. Never `git add` or
  `git commit` on the user's behalf.
- No environment-specific URLs hardcoded. The only allowed literal is
  the public MCP endpoint `https://api.strata.space/mcp` in
  `strata-mcp-setup`.
- `strata-mcp-setup` must not invoke or check for the `strata` CLI.

## Test helper conventions

`tests/_common.sh` exposes `ok`, `fail`, `assert_cmd_present`,
`assert_file_exists`, `assert_jq_field`, and `summarize`. Every smoke script:

1. `set -euo pipefail` at the top.
2. Sources `_common.sh` via `HERE="$(cd "$(dirname "$0")" && pwd)" && . "$HERE/_common.sh"`.
3. Uses `mktemp -d` with `trap … EXIT` cleanup. Never writes into the repo
   or `$HOME` outside a temp dir.
4. Ends with `summarize`, which exits non-zero if any `fail` was recorded.

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json` following
   [SemVer](https://semver.org/spec/v2.0.0.html). MAJOR for breaking
   runbook changes, MINOR for new skills or platforms, PATCH for fixes.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`.
3. Open a PR, get it merged.
4. On `main` after merge:
   ```bash
   claude plugin tag ./ --push
   ```
   This creates and pushes `strata--vX.Y.Z`, validating that
   `plugin.json` agrees with any enclosing marketplace entry.

## Reporting bugs

Open a GitHub issue with reproduction steps, your OS / Claude client, and
the relevant snippet of the conversation if the skill misbehaved. For
security reports, see `SECURITY.md`.
