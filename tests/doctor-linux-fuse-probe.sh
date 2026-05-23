#!/usr/bin/env bash
# Smoke test for strata-doctor's Linux FUSE-runtime probe (Layer 2).
# Replays the probe snippet from skills/strata-doctor/SKILL.md verbatim and
# asserts it evaluates cleanly under `set -e` and only emits known tokens.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== doctor-linux-fuse-probe ==="

if [ "$(uname -s)" != "Linux" ]; then
  log "skipped: not Linux"; exit 0
fi

assert_cmd_present getent

# --- replayed verbatim from skills/strata-doctor/SKILL.md "FUSE runtime" ---
# Captured inside an `if` condition: set -e is inherited by the command
# substitution, so if the probe's branches were not set -e safe the subshell
# would abort early and the condition would route us to `fail`.
if tokens=$(
  if [ "$(uname -s)" = Linux ]; then
    command -v fusermount3 >/dev/null 2>&1 || printf 'fuse3-missing\n'
    if [ ! -e /dev/fuse ]; then printf 'dev-fuse-absent\n'; fi
    if [ -e /dev/fuse ] && [ ! -r /dev/fuse ]; then printf 'dev-fuse-unreadable\n'; fi
    if getent group fuse >/dev/null 2>&1 && ! getent group fuse | grep -q "\b$USER\b"; then
      printf 'not-in-fuse-group\n'
    fi
  fi
); then
  ok "FUSE probe evaluated cleanly under set -e"
else
  fail "FUSE probe aborted under set -e — its branches are not set -e safe"
fi

# Every emitted line must be one of the four tokens the SKILL.md maps to a fix.
unknown=0
while IFS= read -r line; do
  if [ -z "$line" ]; then continue; fi
  case "$line" in
    fuse3-missing|dev-fuse-absent|dev-fuse-unreadable|not-in-fuse-group) ;;
    *) unknown=1; log "    unexpected token: $line" ;;
  esac
done <<EOF
$tokens
EOF
if [ "$unknown" -eq 0 ]; then
  ok "probe emitted only documented tokens"
else
  fail "probe emitted an undocumented token"
fi

summarize
