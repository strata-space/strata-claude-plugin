#!/usr/bin/env bash
# Smoke test for strata-doctor's agent-health probes (Layer 2).
# The skill's jq expressions run against `strata status --json`; here they are
# replayed against fixture payloads (agent-era, pre-agent, agent-down) so the
# expressions stay valid without a CLI install.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tests/_common.sh
. "$HERE/_common.sh"

log "=== doctor-agent-probe ==="

assert_cmd_present jq

agent_era='{"status":"logged_in","agent":{"running":true,"agentVersion":"2.2.0","unitInstalled":true,"heartbeatAt":"2026-06-09T00:00:00Z","heartbeatStale":false}}'
agent_down='{"status":"logged_in","agent":{"running":false,"agentVersion":null,"unitInstalled":true,"heartbeatAt":null,"heartbeatStale":false}}'
pre_agent='{"status":"logged_in","recentWriteErrors":[]}'

# --- version gate: replayed from "Agent-era CLI? (version gate)" ---
if printf '%s' "$agent_era" | jq -e 'has("agent")' >/dev/null 2>&1; then
  log "gate: agent-era payload passes"
else
  fail "gate: agent-era payload must pass has(\"agent\")"
fi
if printf '%s' "$pre_agent" | jq -e 'has("agent")' >/dev/null 2>&1; then
  fail "gate: pre-agent payload must NOT pass has(\"agent\")"
else
  log "gate: pre-agent payload routes to cli-pre-agent"
fi

# --- health line: replayed from "Agent health" ---
line=$(printf '%s' "$agent_era" | jq -r '.agent |
  "running=\(.running) version=\(.agentVersion // "-") unit=\(.unitInstalled) heartbeatStale=\(.heartbeatStale)"')
[ "$line" = "running=true version=2.2.0 unit=true heartbeatStale=false" ] \
  || fail "health line mismatch: $line"
log "health: agent-era line renders ($line)"

line=$(printf '%s' "$agent_down" | jq -r '.agent |
  "running=\(.running) version=\(.agentVersion // "-") unit=\(.unitInstalled) heartbeatStale=\(.heartbeatStale)"')
[ "$line" = "running=false version=- unit=true heartbeatStale=false" ] \
  || fail "agent-down line mismatch: $line"
log "health: agent-down line renders ($line)"

log "ok"
