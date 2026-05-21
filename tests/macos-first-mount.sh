#!/usr/bin/env bash
# T018 (US1): smoke test for the macOS first-mount path.
#
# Runs on a clean macOS 15.4+ machine. Asserts that the load-bearing
# primitives the SKILL.md depends on are present and functional. Does NOT
# execute the full Claude conversational flow; that is verified by hand
# during release rehearsal.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_common.sh
. "$HERE/_common.sh"

log "=== T018 macos-first-mount ==="

# Platform sanity.
if [ "$(uname -s)" != "Darwin" ]; then
  log "skipped: not macOS"
  exit 0
fi

# macOS version gate (>= 15.4).
version=$(sw_vers -productVersion)
major=$(printf '%s\n' "$version" | cut -d. -f1)
minor=$(printf '%s\n' "$version" | cut -d. -f2)
if [ "$major" -lt 15 ] || { [ "$major" -eq 15 ] && [ "$minor" -lt 4 ]; }; then
  fail "macOS $version is below 15.4 (FSKit unavailable)"
  summarize; exit 1
fi
ok "macOS $version meets >= 15.4 gate"

# Required helpers SKILL.md uses.
assert_cmd_present brew
assert_cmd_present jq
assert_cmd_present curl
assert_cmd_present sw_vers
assert_cmd_present systemextensionsctl

# Deep-link URL the SKILL.md emits must stay in sync with the test literal.
skill_md="$HERE/../skills/strata-spaces/SKILL.md"
if [ -f "$skill_md" ] && grep -qF 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' "$skill_md"; then
  ok "deep link URL pinned in SKILL.md"
else
  fail "deep link URL drift: not found in $skill_md"
fi

# Cask tap reachable.
if brew tap | grep -qF strata-space/strata; then
  ok "strata-space/strata tap already added"
else
  log "  (tap not yet added; user will tap on consent during real run)"
  ok "tap probe non-fatal"
fi

# Strata CLI install verification (cask present after install).
if command -v strata >/dev/null 2>&1; then
  ok "strata CLI on PATH"
  strata --help >/dev/null && ok "strata --help exits 0"

  # Extension enablement check (the exact grep the SKILL.md runs).
  if systemextensionsctl list 2>/dev/null | grep -qi strata; then
    ok "systemextensionsctl shows strata entry"
  else
    log "  (extension not enabled; user must toggle in System Settings)"
  fi

  # Mount lookup matches the JSON shape the SKILL.md depends on.
  status=$(strata status --json 2>/dev/null || printf '{}')
  assert_jq_field "status." '.mounts | type' 'array' "$status"
  assert_jq_field "status." '.recentWriteErrors | type' 'array' "$status"
else
  log "  (strata not yet installed; SKILL.md install flow runs 'brew install --cask strata-space/strata/strata')"
fi

summarize
