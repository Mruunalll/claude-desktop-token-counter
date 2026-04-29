# Claude Desktop Token Counter

This is a Claude Desktop-compatible token counter that keeps the safe parts of the userscript architecture:

- a token counting engine,
- a transport boundary,
- an explicit MCP tool interface.

It does not intercept Claude Desktop requests, read credentials, proxy traffic, or inject UI into the Claude Desktop app.

## Prerequisites

- Claude Desktop
- Node.js 20 or newer
- This repository cloned locally

## Setup

Clone the repository:

```bash
git clone git@github.com:Mruunalll/claude-desktop-token-counter.git
cd claude-desktop-token-counter
```

Find your Node path:

```bash
which node
```

If `which node` returns `/usr/local/bin/node`, use that in the Claude Desktop config below. If you use another Node manager, use the absolute path it prints.

## Add to Claude Desktop

Open Claude Desktop:

1. Go to **Settings**.
2. Open **Developer**.
3. Click **Edit Config**.
4. Add this server under the top-level `mcpServers` key.

Example config:

```json
{
  "mcpServers": {
    "claude-token-counter": {
      "command": "/usr/local/bin/node",
      "args": [
        "/absolute/path/to/claude-desktop-token-counter/dist/server.js"
      ]
    }
  }
}
```

If your config already contains other settings, keep them and add `mcpServers` beside them:

```json
{
  "preferences": {
    "coworkWebSearchEnabled": true
  },
  "mcpServers": {
    "claude-token-counter": {
      "command": "/usr/local/bin/node",
      "args": [
        "/absolute/path/to/claude-desktop-token-counter/dist/server.js"
      ]
    }
  }
}
```

Save the config, fully quit Claude Desktop, then reopen it.

## Use in Claude Desktop

Start a new chat and ask Claude to use the tool:

```text
Use the claude-token-counter tool to estimate tokens for this text:

Hello Claude Desktop token counter.
```

Expected output:

```json
{
  "tokens": 9,
  "chars": 35,
  "estimator": "heuristic"
}
```

Claude Desktop can also show a reusable prompt named:

```text
check_tokens
```

Use that prompt shortcut when you want Claude to call the counter without retyping the full instruction.

## Local Test

Run the MCP smoke test:

```bash
node scripts/smoke.mjs
```

Run the full local test:

```bash
node scripts/test.mjs
```

Expected final line:

```text
All MCP plugin tests passed.
```

## Terminal Token Count

For quick local checks without Claude Desktop:

```bash
node scripts/count.mjs "Hello Claude Desktop token counter."
```

Output:

```json
{
  "tokens": 9,
  "chars": 35,
  "estimator": "heuristic"
}
```

## Tools

- `estimate_text_tokens`: counts text explicitly supplied to the tool.
- `estimate_claude_conversation_export`: counts a Claude-like conversation JSON object containing `chat_messages` and `current_leaf_message_uuid`.

## Architecture

- `src/tokenEngine.ts`: token/text extraction, trunk reconstruction, cache-window estimate.
- `src/server.ts`: minimal stdio MCP JSON-RPC transport.
- `dist/server.js`: runnable dependency-free build for local smoke testing.

## Limitations

- It is opt-in; Claude calls it only when you ask or use the prompt shortcut.
- It does not automatically monitor every Claude Desktop message.
- It does not inject a live token counter into the Claude Desktop UI.
- It does not intercept internal Claude Desktop network requests.
- Counts are approximate and do not include hidden system prompts or server-side context.

## Security posture

All counting is opt-in. The server only sees arguments sent to its tools. It does not inspect Claude Desktop internals.
