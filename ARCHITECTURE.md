# Evaluation

## What the userscript does

The reference userscript runs on `https://claude.ai/*` at `document-start`. It wraps `window.fetch`, keeps the original fetch as `CC._ccInternal.originalFetch`, and observes:

- `POST` URLs containing `/completion` or `/retry_completion` to mark generation start.
- Responses whose `content-type` contains `event-stream`; it clones the response, reads the stream, splits lines, parses `data:` JSON, and handles `type === "message_limit"`.
- Conversation tree responses for `/api/organizations/{org}/chat_conversations/{conversation}?tree=...`; it clones and parses JSON, then computes conversation metrics.

Token estimation reconstructs the active conversation branch from `current_leaf_message_uuid` back to the root UUID. It ignores `thinking`, `redacted_thinking`, `image`, and `document` content blocks; includes text, selected tool payloads, tool results, fallback textual fields, and attachment `extracted_content`. It counts with `globalThis.GPTTokenizer_o200k_base.countTokens`, supplied by the userscript `@require` for `gpt-tokenizer@2.9.0`.

The UI is DOM-driven. It injects styles, creates header text, progress bars, cache timers, usage bars, and tooltips. It attaches near Claude web selectors such as `[data-testid="chat-menu-trigger"]`, `[data-testid="model-selector-dropdown"]`, and `.chat-project-wrapper`.

MutationObservers are used for three jobs:

- Watch `<html data-mode>` for theme changes and recolor bars.
- Watch `document.body` for Claude SPA re-renders and reattach injected UI.
- Implement `waitForElement` by observing child-list/subtree changes until target elements appear.

It also wraps `history.pushState`, `history.replaceState`, and listens for `popstate` to refresh on SPA URL changes.

## Claude Desktop feasibility

| Approach | Feasibility | Complexity | Accuracy | Maintainability | Security risk |
| --- | --- | --- | --- | --- | --- |
| MCP server | Medium for explicit counting, low for automatic tracking | Low/medium | Medium; only explicit inputs, no hidden prompt or live request stream | High | Low if read-only and opt-in |
| Desktop extension / MCPB | Medium; packages an MCP server, not an app patcher | Medium | Same as MCP unless paired with user-supplied exports | High | Low/medium depending on tools exposed |
| Local proxy / network interceptor | Low under these constraints | High | Potentially high if all traffic is captured | Low | High: credentials, TLS, private API fragility |
| Browser userscript | High for claude.ai web | Low/medium | Best approximation of original behavior | Medium; DOM/API selectors can drift | Medium; runs in authenticated web page |

## Recommendation

Use a local MCPB-packaged MCP server for Claude Desktop. Treat it as an explicit, transparent token counter, not a background monitor. Keep the browser userscript for users who require live claude.ai header injection and usage bars.

Recommended module boundaries:

- Token counting engine: pure TypeScript functions for content extraction, trunk reconstruction, token estimation, and cache-window calculation. It uses `gpt-tokenizer` when available and falls back to a transparent heuristic if the dependency cannot load.
- Transport layer: MCP stdio server, later packageable as MCPB.
- UI layer: optional MCP App/dashboard rendered only when invoked. Do not attempt global Claude Desktop DOM injection.

## Cannot be replicated safely

- Fetch interception inside Claude Desktop: MCP servers are tools Claude can call; they do not sit in the app’s internal request path.
- Persistent header injection into Claude Desktop chrome: MCPB is a packaging format for local MCP servers, and MCP Apps render in scoped app surfaces, not arbitrary Desktop DOM.
- Automatic usage bars from `message_limit` SSE: that requires observing Claude’s private event stream.
- Exact live context accounting: hidden system prompts, compaction, server-side cache behavior, and private request payloads are not exposed through MCP.
