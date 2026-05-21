#!/usr/bin/env bash
# T056 (US6): smoke test for `strata-mcp-setup` sibling skill prerequisites.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== T056 mcp-setup ==="

# `mcp-remote` runs via `npx -y mcp-remote …`, so node + npx must be
# available. (npm install is not the SKILL.md's job; npx auto-fetches.)
assert_cmd_present node
assert_cmd_present npx

# Client config-file probe: at least one of the supported clients should be
# detectable on a workstation actually using a Claude client. On a clean VM
# none may be present — that is not a failure, just informational.
detected=0
for path in \
  "$HOME/Library/Application Support/Claude/claude_desktop_config.json" \
  "$HOME/.config/Claude/claude_desktop_config.json" \
  "$HOME/Library/Application Support/Cursor/User/settings.json" \
  "$HOME/Library/Application Support/Code/User/settings.json" \
  "$HOME/.config/Code/User/settings.json" \
  "$HOME/.config/zed/settings.json" \
  "$HOME/.continue" \
  "$HOME/.cline" \
  "$HOME/Library/Application Support/Windsurf/User/settings.json"; do
  [ -e "$path" ] && { detected=$((detected + 1)); ok "client config: $path"; }
done

if command -v claude >/dev/null 2>&1; then
  ok "claude (Claude Code CLI) on PATH"
  detected=$((detected + 1))
fi

if [ "$detected" -eq 0 ]; then
  log "  no Claude clients detected on this machine (expected on a clean VM)"
fi

# The SKILL.md MUST NOT depend on the strata CLI.
if command -v strata >/dev/null 2>&1; then
  log "  strata CLI is present, but the SKILL.md works without it"
else
  ok "strata CLI absent — confirms no-CLI verification (FR-039)"
fi

# Endpoint URL the SKILL.md hardcodes must stay in sync with the test literal.
skill_md="$HERE/../skills/strata-mcp-setup/SKILL.md"
if [ -f "$skill_md" ] && grep -qF 'https://api.prod.us-east-2.strata.space/mcp' "$skill_md"; then
  ok "MCP endpoint URL pinned in SKILL.md"
else
  fail "MCP endpoint URL drift: not found in $skill_md"
fi

summarize
