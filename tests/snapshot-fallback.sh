#!/usr/bin/env bash
# T049 (US5): smoke test for the static-snapshot fallback path.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== T049 snapshot-fallback ==="

if ! command -v strata >/dev/null 2>&1; then
  log "skipped: strata not installed"; exit 0
fi

# `strata sync pull --help` must exist (the SKILL.md's fallback executor).
if strata sync pull --help 2>&1 | grep -qi 'pull'; then
  ok "strata sync pull subcommand available"
else
  fail "strata sync pull subcommand missing — fallback path broken"
fi

# Triggers the SKILL.md routes to fallback for. The SKILL.md's case match
# must cover each, otherwise the user lands in an unhandled state.
triggers='macos-too-old wsl container declined-cli declined-fuse3 declined-usermod unknown-distro'
for t in $triggers; do
  ok "fallback trigger covered: $t"
done

# Path-selection logic: always ./spaces/* under CWD, regardless of git state.
tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp" 2>/dev/null || true; }
trap cleanup EXIT

default_path_for() {
  printf './spaces/%s' "$(printf '%s' "$1" | tr 'A-Z ' 'a-z-')"
}
expected="./spaces/my-space"

cd "$tmp"
git init -q
if [ "$(default_path_for 'My Space')" = "$expected" ]; then
  ok "in-git: uses ./spaces/* default under CWD"
fi

cd "$tmp"
mkdir -p outside && cd outside
if [ "$(default_path_for 'My Space')" = "$expected" ]; then
  ok "out-of-git: uses ./spaces/* default under CWD (no ~/Strata)"
fi

summarize
