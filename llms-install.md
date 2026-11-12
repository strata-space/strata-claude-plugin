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
