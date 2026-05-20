#!/usr/bin/env bash
# T021 (US1): smoke test for the Arch first-mount path.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=plugins/strata/tests/_common.sh
. "$HERE/_common.sh"

log "=== T021 linux-arch-first-mount ==="

if [ "$(uname -s)" != "Linux" ]; then
  log "skipped: not Linux"; exit 0
fi
. /etc/os-release
case "${ID_LIKE:-$ID}" in
  *arch*) ;;
  *) log "skipped: not arch-like ($ID)"; exit 0 ;;
esac

assert_cmd_present curl
assert_cmd_present jq
assert_cmd_present pacman
assert_cmd_present tar
assert_cmd_present sha256sum

if [ -e /dev/fuse ]; then
  ok "/dev/fuse exists"
else
  fail "/dev/fuse missing — pacman -Sy fuse3 needed"
fi

if command -v fusermount3 >/dev/null 2>&1; then
  ok "fusermount3 on PATH"
fi

if command -v strata >/dev/null 2>&1; then
  status=$(strata status --json 2>/dev/null || printf '{}')
  assert_jq_field "status." '.mounts | type' 'array' "$status"
fi

summarize
