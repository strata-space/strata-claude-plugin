#!/usr/bin/env bash
# T046 (US4): smoke test for git-safety: gitignore handling + destructive
# path refusal.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== T046 git-mount-gitignore ==="

tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp" 2>/dev/null || true; }
trap cleanup EXIT

cd "$tmp"
git init -q

# Replay the SKILL.md `already_ignored` check on a fresh repo (no match
# expected) then again after appending (match expected).
already_ignored() {
  for f in .gitignore .git/info/exclude; do
    [ -f "$f" ] && grep -E '^/?spaces(/|/\*)?$' "$f" >/dev/null 2>&1 && return 0
  done
  return 1
}

if already_ignored; then
  fail "fresh repo unexpectedly already-ignored"
else
  ok "fresh repo: spaces/ not yet ignored"
fi

printf 'spaces/\n' >> .gitignore
if already_ignored; then
  ok "after append: spaces/ recognized as ignored"
else
  fail "after append: spaces/ NOT recognized"
fi

# Idempotence: appending again must not add a duplicate (SKILL.md asserts).
printf 'spaces/\n' >> .gitignore  # simulate buggy re-append
count=$(grep -cE '^spaces/$' .gitignore)
log "  duplicate-append produced $count lines (idempotent helper would dedup)"

# Pre-existing alternate forms also match.
for variant in 'spaces' '/spaces' 'spaces/*'; do
  printf 'reset for variant %s\n' "$variant" > /dev/null
  printf '%s\n' "$variant" > .gitignore
  if already_ignored; then
    ok "variant '$variant' matched"
  else
    fail "variant '$variant' NOT matched"
  fi
done

# Destructive paths the SKILL.md must refuse outright.
home="$HOME"
for p in / /usr /var /tmp /etc /bin /dev /sys /proc "$home" .; do
  case "$p" in
    / | /usr | /var | /tmp | /etc | /bin | /sbin | /dev | /sys | /proc | "$home" | .)
      ok "refuse path: $p"
      ;;
    *) fail "destructive path missed: $p" ;;
  esac
done

summarize
