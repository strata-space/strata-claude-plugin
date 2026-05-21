#!/usr/bin/env bash
# T019 (US1): smoke test for the Ubuntu / Debian first-mount path.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== T019 linux-debian-first-mount ==="

if [ "$(uname -s)" != "Linux" ]; then
  log "skipped: not Linux"; exit 0
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID_LIKE:-$ID}" in
  *debian*|*ubuntu*) ;;
  *) log "skipped: not debian-like ($ID)"; exit 0 ;;
esac

assert_cmd_present curl
assert_cmd_present jq
assert_cmd_present apt
assert_cmd_present uname
assert_cmd_present tar
assert_cmd_present sha256sum

arch=$(uname -m)
case "$arch" in
  x86_64|aarch64|arm64) ok "supported arch: $arch" ;;
  *) fail "unsupported arch: $arch" ;;
esac

if [ -e /dev/fuse ]; then
  ok "/dev/fuse exists (kernel FUSE present)"
else
  fail "/dev/fuse missing — apt install fuse3 needed"
fi

# GitHub releases API reachable + the asset name the SKILL.md depends on is published.
release=$(curl -sf "https://api.github.com/repos/strata-space/strata/releases/latest" || printf '{}')
case "$arch" in
  x86_64) asset='strata-linux-amd64.tar.gz' ;;
  aarch64|arm64) asset='strata-linux-arm64.tar.gz' ;;
esac
url=$(printf '%s\n' "$release" | jq -r --arg n "$asset" '.assets[]? | select(.name==$n) | .browser_download_url' 2>/dev/null || printf '')
digest=$(printf '%s\n' "$release" | jq -r --arg n "$asset" '.assets[]? | select(.name==$n) | .digest' 2>/dev/null || printf '')
if [ -n "$url" ] && [ -n "$digest" ]; then
  ok "release asset $asset: url + digest published"
else
  fail "release asset $asset missing url or digest (network or release not cut?)"
fi

if command -v strata >/dev/null 2>&1; then
  status=$(strata status --json 2>/dev/null || printf '{}')
  assert_jq_field "status." '.mounts | type' 'array' "$status"
  assert_jq_field "status." '.recentWriteErrors | type' 'array' "$status"
fi

summarize
