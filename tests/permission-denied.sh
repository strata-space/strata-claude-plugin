#!/usr/bin/env bash
# T037 (US2): smoke test for the permission-denied diagnostic flow.
#
# Runs on either macOS (FSKit backend) or Linux (FUSE backend). Assumes the
# environment can simulate a refused save (`STRATA_TEST_FORCE_403` for the
# test CLI build, or a real Space with a doc owned by a different user that
# the tester edits during the run).

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== T037 permission-denied ==="

if ! command -v strata >/dev/null 2>&1; then
  log "skipped: strata not installed"; exit 0
fi

status=$(strata status --json 2>/dev/null || printf '{}')

# After provoking a 403 (manual step or test harness), the sidecar appears
# and surfaces through status. The test harness is responsible for the
# provocation; this assertion validates the contract surface.
assert_jq_field "status." '.recentWriteErrors | type' 'array' "$status"

recent_count=$(printf '%s\n' "$status" | jq -r '.recentWriteErrors | length' 2>/dev/null || printf '0')
if [ "$recent_count" -gt 0 ]; then
  ok "recentWriteErrors has $recent_count entries"
  # Validate the top entry's shape matches the contract.
  for field in ts spaceId docId httpStatus message; do
    val=$(printf '%s\n' "$status" | jq -r ".recentWriteErrors[0].$field" 2>/dev/null)
    if [ -n "$val" ] && [ "$val" != "null" ]; then
      ok "recentWriteErrors[0].$field populated"
    else
      fail "recentWriteErrors[0].$field missing"
    fi
  done
  status_code=$(printf '%s\n' "$status" | jq -r '.recentWriteErrors[0].httpStatus' 2>/dev/null)
  if [ "$status_code" = "403" ]; then
    ok "httpStatus = 403"
  else
    fail "httpStatus = $status_code (expected 403)"
  fi
else
  log "  no recentWriteErrors yet; trigger a refused save and rerun"
fi

summarize
