---
name: strata-mcp-setup
description: >
  Register the Strata MCP server with Claude (Desktop, Code, Cursor, VS Code,
  Zed, Continue, Cline, Windsurf) so Strata's document tools (read, edit,
  search, list) become callable inside conversations. No filesystem mount, no
  CLI install required. Use for "add Strata to Claude as MCP", "set up
  Strata MCP", "use Strata tools inside Claude".
allowed-tools: Bash, Read, Write, Edit, Grep, AskUserQuestion
---

# Strata MCP setup

Register `https://api.strata.space/mcp` with the user's Claude client so
Strata document tools work directly in conversation. No CLI install, no
filesystem mount.

This skill must complete without `strata` on `PATH` — never invoke or check
for the CLI. If the user asks for a filesystem mount, hand off to the
`strata-spaces` sibling skill instead.

## Detect the Claude client

Ask the user which client they are configuring, but try to detect first so
the question is informed:

```bash
detected=()
[ -f "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ] && detected+=("claude-desktop")
command -v claude >/dev/null 2>&1 && detected+=("claude-code")
[ -f "$HOME/Library/Application Support/Cursor/User/settings.json" ] && detected+=("cursor")
[ -f "$HOME/Library/Application Support/Code/User/settings.json" ] && detected+=("vscode")
[ -f "$HOME/.config/zed/settings.json" ] && detected+=("zed")
[ -d "$HOME/.continue" ] && detected+=("continue")
[ -d "$HOME/.cline" ] && detected+=("cline")
[ -f "$HOME/Library/Application Support/Windsurf/User/settings.json" ] && detected+=("windsurf")
```

If exactly one client is detected, propose that one. If multiple, list them
and ask which to configure. The user can also tell you explicitly.

## Render MCP config

The default registration uses the `mcp-remote` bridge (an npm package). This
works for every client above, and is what Strata's own docs recommend.

For **Claude Code**, the canonical command is:

```bash
claude mcp add strata -- npx -y mcp-remote https://api.strata.space/mcp
```

Propose it with explicit consent, run on accept:

> Plugin proposes: `claude mcp add strata -- npx -y mcp-remote https://api.strata.space/mcp`.
> Run it? [y/N]

For **Claude Desktop**, edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Add the
`strata` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "strata": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://api.strata.space/mcp"]
    }
  }
}
```

If the file does not exist yet, create it with just that `mcpServers`
object. If it exists, merge the `strata` key into the existing `mcpServers`
object without disturbing other servers. Show the user the diff before
saving and request consent to write.

For **Cursor / VS Code / Zed / Continue / Cline / Windsurf**, render the
same `{ "command": "npx", "args": ["-y", "mcp-remote", "https://api.strata.space/mcp"] }`
fragment into the client's MCP servers config file. The file locations vary
per client; ask the user to confirm the path you propose before writing.

On first tool call, the MCP server opens a browser for OAuth login. Tell the
user this is normal and not something they need to set up in advance.

## Native HTTP (advanced, optional)

For clients that support streamable-HTTP MCP servers directly (Claude
Desktop ≥ 0.7, Cursor ≥ 0.45, VS Code 1.101+), you can skip the `mcp-remote`
bridge and register the URL natively:

```json
{
  "mcpServers": {
    "strata": {
      "url": "https://api.strata.space/mcp",
      "transport": "http"
    }
  }
}
```

Offer this only if the user explicitly asks for it or you know their client
version supports it. The bridge is the safe default because it works
everywhere.

## Auth-reuse precision

The user may already be logged into Strata via the CLI (`strata login`) or
the web app. The CLI's OAuth token lives in the OS keychain; the MCP
bridge's OAuth state lives in `~/.mcp-auth/`. These two stores do not share
tokens — the MCP first-tool-call browser flow is its own OAuth round-trip.

What *is* shared is browser session state: if the user is already signed in
to strata.space in their default browser, the MCP OAuth click-through
completes in one click rather than asking for credentials. Frame this
correctly when the user asks "do I have to log in again?":

> The MCP server opens its own login flow on first use, but if you are
> already signed in to strata.space in your browser, it completes in one
> click. The MCP login does not share tokens with the CLI; it is a separate
> OAuth round-trip that reuses your browser cookies, not your CLI token.

## Verification

After registering, ask the user to restart their client (only Claude Desktop
needs a hard restart; Claude Code picks up `mcp add` immediately). Then
suggest a probe such as:

> Try asking me: "list my Strata documents". If MCP is wired up, I will
> call Strata's MCP `list_documents` tool and you will see the result.
