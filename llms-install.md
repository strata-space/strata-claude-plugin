# Installing the StrataSpace MCP server

StrataSpace is a hosted remote MCP server. There is nothing to build or run locally.

- Transport: Streamable HTTP
- URL: `https://api.strata.space/mcp`
- Auth: OAuth 2.1 with dynamic client registration. The client opens a browser for sign-in on first use; no API key.

## Cline

Add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "strataspace": {
      "type": "streamableHttp",
      "url": "https://api.strata.space/mcp"
    }
  }
}
```

Then sign in when Cline prompts. A free StrataSpace account is created on first sign-in at https://strata.space.

## Verify

Ask: "Use StrataSpace to find my documents." The `find` tool should return your Spaces and documents.

## Plan tools (optional)

The plan skills `strata-plan` (make a plan and write its items), `strata-plan-work` (take a plan item and finish it) and `strata-plan-lead` (run a plan with a team of agents) use the plan tools. These are in the `plans` tool group. It is on by default while Plans is on for your StrataSpace account, so the bundled setup needs no change. If your config names its groups in an `X-Strata-Tool-Groups` header or the `groups` parameter of the URL, list `plans` too, for example `https://api.strata.space/mcp?groups=core,comments,plans`. `plan_status` needs read scope, and the item commands need write scope. Check: `plan_status` is in the tool list, and `claim_item` is too when write scope is granted.
