# Contributing

Thanks for helping improve the StrataSpace Claude plugin.

## What this repo ships

Seven skills under `skills/`, a plugin manifest, a bundled `.mcp.json` that
registers the StrataSpace MCP server. There is no application code, no build
step, and no package manager. Tests live in
[strata-space/strata-claude-plugin-tests](https://github.com/strata-space/strata-claude-plugin-tests).

Do not add scripts or programs to this repo. The Claude plugin directory
accepts only Markdown, text, JSON, YAML and images (PNG, JPEG, GIF, WebP, ICO)
from an unverified organization, and refuses the whole version otherwise.

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
2. **Run the tests** from a clone of
   [strata-claude-plugin-tests](https://github.com/strata-space/strata-claude-plugin-tests)
   next to this repo (see its README). At least:
   ```bash
   shellcheck -x tests/*.sh
   bash tests/git-mount-gitignore.sh
   node --test tests/presentation/*.test.mjs
   ```
3. **If you touched a runbook step**, replay the exact bash snippet from the
   relevant `SKILL.md` in that repo's `tests/`. The point of the tests is to
   catch drift between the runbook and the assertions — don't reimplement the
   logic.

## Hard rules these skills enforce

These are spelled out in the `SKILL.md` files and asserted in the tests repo.
Don't soften or remove them in a PR:

- Every privileged command must be shown verbatim and gated on explicit
  `[y/N]` consent. If declined, route to snapshot-fallback (`strata-spaces`)
  or stop. Never retry silently. Skills that write to StrataSpace content
  (`strata-publish`, `strata-review`) confirm in conversation before the
  first write.
- The Linux CLI install path reads the GitHub release `digest` and refuses
  to extract on SHA-256 mismatch. Keep this check intact.
- `strata-spaces` rejects mounting over destructive paths (`/`, `/usr`,
  `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`, `/sys`, `/proc`,
  `$HOME`, `.`) or any directory containing existing `*.md` content.
- Mounting inside a git work tree must add `spaces/` to `.gitignore` or
  `.git/info/exclude` before creating the mount. Never `git add` or
  `git commit` on the user's behalf.
- No environment-specific URLs hardcoded in skills. The public MCP endpoint
  `https://api.strata.space/mcp` lives in the bundled
  `.mcp.json` (plus `mcp.json` for Cursor, `.codex-mcp.json` for Codex, and the README's other-clients snippet); document links use the
  app's workspace-chooser deep link,
  `https://app.strata.space/workspaces?next=%2Fdocuments%2F<docId>`, because
  MCP results carry a `documentId` but no URL and no workspace slug. It
  resolves to `/w/<workspace>/documents/<docId>/<title-slug>`.

## Test helper conventions

See the tests repo's `tests/_common.sh`. Smoke scripts read this plugin from
`PLUGIN_ROOT`, which defaults to a sibling clone.

## Releasing

The version bump and changelog are automated. [release-please](https://github.com/googleapis/release-please)
watches `main` and opens (or updates) a "release PR" that bumps `version` in
`.claude-plugin/plugin.json` and adds a `CHANGELOG.md` entry, derived from the
[Conventional Commits](https://www.conventionalcommits.org/) since the last
release (`fix:` → PATCH, `feat:` → MINOR, `feat!:` / `BREAKING CHANGE:` →
MAJOR). Follow Conventional Commits in commit messages so this works.

1. Review the open release PR (edit the changelog wording if you like), then
   merge it. That commits the version bump, and release-please then creates the
   GitHub Release and the matching `strata--vX.Y.Z` tag automatically — no
   manual tagging step is needed.

## Reporting bugs

Open a GitHub issue with reproduction steps, your OS / Claude client, and
the relevant snippet of the conversation if the skill misbehaved. For
security reports, see `SECURITY.md`.
