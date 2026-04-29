# Claude Desktop Token Counter

This is a Claude Desktop-compatible token counter that keeps the safe parts of the userscript architecture:

- a token counting engine,
- a transport boundary,
- an explicit MCP tool interface.

It does not intercept Claude Desktop requests, read credentials, proxy traffic, or inject UI into the Claude Desktop app.

## Run

```bash
/Users/m4/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node dist/server.js
```

For Claude Desktop, configure a local MCP server command that points at `dist/server.js` with Node.

## Test

From this repo:

```bash
/Users/m4/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/smoke.mjs
/Users/m4/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/test.mjs
```

`smoke.mjs` proves the MCP server starts, lists tools, and answers one text-count request.
`test.mjs` additionally checks the conversation JSON tool with `fixtures/sample-conversation.json`.

Expected final line:

```text
All MCP plugin tests passed.
```

## Tools

- `estimate_text_tokens`: counts text explicitly supplied to the tool.
- `estimate_claude_conversation_export`: counts a Claude-like conversation JSON object containing `chat_messages` and `current_leaf_message_uuid`.

## Prompt Shortcut

Claude Desktop can also show a reusable prompt named:

```text
check_tokens
```

Use it when you want Claude to call the counter without retyping the full instruction.

## Terminal Command

For quick local checks:

```bash
/Users/m4/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/count.mjs "Hello Claude Desktop token counter."
```

## Architecture

- `src/tokenEngine.ts`: token/text extraction, trunk reconstruction, cache-window estimate.
- `src/server.ts`: minimal stdio MCP JSON-RPC transport.
- `dist/server.js`: runnable dependency-free build for local smoke testing.

## Security posture

All counting is opt-in. The server only sees arguments sent to its tools. It does not inspect Claude Desktop internals.
