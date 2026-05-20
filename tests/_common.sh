#!/usr/bin/env bash
# Shared helpers for plugins/strata/tests/*.sh smoke runners.
#
# Each smoke script sources this file and uses the helpers to assert load-
# bearing primitives. Scripts run on a clean VM (macOS 15.4+, or Ubuntu /
# Fedora / Arch) and exit non-zero on the first failed assertion.

set -euo pipefail

PASS=0
FAIL=0

log() { printf '%s\n' "$*" >&2; }

ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1" >&2
}

fail() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1" >&2
}

assert_cmd_present() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 on PATH"
  else
    fail "$1 NOT on PATH"
  fi
}

assert_file_exists() {
  if [ -e "$1" ]; then
    ok "exists: $1"
  else
    fail "missing: $1"
  fi
}

assert_jq_field() {
  local source_label="$1" path="$2" expected="$3" json="$4"
  local actual
  actual=$(printf '%s\n' "$json" | jq -r "$path" 2>/dev/null || printf '')
  if [ "$actual" = "$expected" ]; then
    ok "$source_label$path = $expected"
  else
    fail "$source_label$path = $actual (expected $expected)"
  fi
}

summarize() {
  printf '\n%d passed, %d failed\n' "$PASS" "$FAIL" >&2
  [ "$FAIL" -eq 0 ]
}
