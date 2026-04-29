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
npm install
```

Find your Node path:

```bash
which node
```

If `which node` returns `/usr/local/bin/node`, use that in the Claude Desktop config below. If you use another Node manager, use the absolute path it prints.

On Windows, use Command Prompt or PowerShell:

```powershell
where node
```

Claude Desktop config lives in different places depending on the operating system:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

Windows paths need escaped backslashes:

```json
{
  "mcpServers": {
    "claude-token-counter": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\YOUR_USER\\claude-desktop-token-counter\\dist\\server.js"
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
  "estimator": "gpt-tokenizer"
}
```

If dependencies are not installed, `estimator` may be `"heuristic"` instead.

Claude Desktop can also show a reusable prompt named:

```text
check_tokens
```

Use that prompt shortcut when you want Claude to call the counter without retyping the full instruction.

## Local Test

Build from TypeScript:

```bash
npm run build
```

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
  "estimator": "gpt-tokenizer"
}
```

If dependencies are not installed, `estimator` may be `"heuristic"` instead.

## Tools

- `estimate_text_tokens`: counts text explicitly supplied to the tool.
- `estimate_claude_conversation_export`: counts a Claude-like conversation JSON object containing `chat_messages` and `current_leaf_message_uuid`.

## Conversation JSON Shape

`estimate_claude_conversation_export` accepts a Claude-like JSON object:

```json
{
  "current_leaf_message_uuid": "assistant-2",
  "chat_messages": [
    {
      "uuid": "user-1",
      "parent_message_uuid": "00000000-0000-4000-8000-000000000000",
      "sender": "human",
      "created_at": "2026-04-30T10:00:00.000Z",
      "content": [
        {
          "type": "text",
          "text": "Please summarize this."
        }
      ]
    },
    {
      "uuid": "assistant-2",
      "parent_message_uuid": "user-1",
      "sender": "assistant",
      "created_at": "2026-04-30T10:00:12.000Z",
      "content": [
        {
          "type": "text",
          "text": "Summary text."
        }
      ]
    }
  ]
}
```

See `fixtures/sample-conversation.json` for a fuller example. Claude Desktop does not currently expose a one-click export for this private conversation-tree shape, so this tool is mainly for explicit JSON you already have from a safe source.

## Architecture

- `src/tokenEngine.ts`: token/text extraction, trunk reconstruction, cache-window estimate.
- `src/server.ts`: minimal stdio MCP JSON-RPC transport.
- `dist/server.js`: runnable MCP server build for local smoke testing.

## Limitations

- It is opt-in; Claude calls it only when you ask or use the prompt shortcut.
- It does not automatically monitor every Claude Desktop message.
- It does not inject a live token counter into the Claude Desktop UI.
- It does not intercept internal Claude Desktop network requests.
- Counts use `gpt-tokenizer` when installed, with a heuristic fallback.
- Counts do not include hidden system prompts or server-side context.

## Security posture

All counting is opt-in. The server only sees arguments sent to its tools. It does not inspect Claude Desktop internals.
