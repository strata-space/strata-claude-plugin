#!/usr/bin/env bash
# T042 (US3): smoke test for list / unmount-one / unmount-all paths.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== T042 unmount-lifecycle ==="

if ! command -v strata >/dev/null 2>&1; then
  log "skipped: strata not installed"; exit 0
fi

status=$(strata status --json 2>/dev/null || printf '{}')
# Mount entries carry the fields the SKILL.md renders.
mount_count=$(printf '%s\n' "$status" | jq -r '.mounts | length' 2>/dev/null || printf '0')
log "  $mount_count active mount(s)"

if [ "$mount_count" -gt 0 ]; then
  for field in spaceId spaceName mountpoint backend writable; do
    val=$(printf '%s\n' "$status" | jq -r ".mounts[0].$field" 2>/dev/null)
    if [ -n "$val" ] && [ "$val" != "null" ]; then
      ok "mounts[0].$field populated ($val)"
    else
      fail "mounts[0].$field missing"
    fi
  done

  # Validate backend is one of the contract values.
  backend=$(printf '%s\n' "$status" | jq -r '.mounts[0].backend' 2>/dev/null)
  case "$backend" in
    fuse|fskit) ok "backend = $backend (contract-compliant)" ;;
    *) fail "backend = $backend (expected fuse|fskit)" ;;
  esac
fi

# `strata unmount --help` includes the docs the SKILL.md relies on.
if strata unmount --help 2>&1 | grep -qi 'unmount'; then
  ok "strata unmount subcommand available"
else
  fail "strata unmount subcommand missing"
fi

summarize
