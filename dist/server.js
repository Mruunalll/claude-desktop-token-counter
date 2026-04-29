#!/usr/bin/env node
"use strict";

const ROOT_MESSAGE_ID = "00000000-0000-4000-8000-000000000000";

function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(normalize);
    const out = {};
    for (const key of Object.keys(v).sort()) out[key] = normalize(v[key]);
    return out;
  };
  try {
    return JSON.stringify(normalize(value));
  } catch {
    return "";
  }
}

function isCountableContentItem(item) {
  if (!item || typeof item !== "object") return false;
  if (typeof item.type !== "string") return false;
  if (item.type === "thinking" || item.type === "redacted_thinking") return false;
  if (item.type === "image" || item.type === "document") return false;
  return true;
}

function stringifyCountableContentItem(item) {
  if (!isCountableContentItem(item)) return "";
  if (item.type === "text" && typeof item.text === "string") return item.text;
  if (item.type === "tool_use") return stableStringify({ id: item.id, name: item.name, input: item.input });
  if (item.type === "tool_result") {
    return stableStringify({ tool_use_id: item.tool_use_id, is_error: item.is_error, content: item.content });
  }
  const minimal = {};
  if (typeof item.text === "string") minimal.text = item.text;
  if (typeof item.title === "string") minimal.title = item.title;
  if (typeof item.url === "string") minimal.url = item.url;
  if (typeof item.content === "string" || Array.isArray(item.content)) minimal.content = item.content;
  return Object.keys(minimal).length ? stableStringify(minimal) : "";
}

function stringifyMessageCountables(message) {
  const parts = [];
  for (const item of message.content ?? []) {
    const text = stringifyCountableContentItem(item);
    if (text) parts.push(text);
  }
  for (const attachment of message.attachments ?? []) {
    if (attachment.extracted_content) parts.push(attachment.extracted_content);
  }
  return parts.join("\n");
}

function buildTrunk(conversation) {
  const messages = conversation.chat_messages ?? [];
  const byId = new Map(messages.filter((m) => m.uuid).map((m) => [m.uuid, m]));
  const trunk = [];
  let currentId = conversation.current_leaf_message_uuid;
  while (currentId && currentId !== ROOT_MESSAGE_ID) {
    const message = byId.get(currentId);
    if (!message) break;
    trunk.push(message);
    currentId = message.parent_message_uuid;
  }
  return trunk.reverse();
}

function estimateTokens(text) {
  const chars = text.length;
  if (!text) return { tokens: 0, chars, estimator: "heuristic" };
  const segments = text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  const asciiWords = text.match(/[A-Za-z0-9_]+/g) ?? [];
  const nonAsciiChars = text.match(/[^\x00-\x7F]/g) ?? [];
  const whitespaceRuns = text.match(/\s+/g) ?? [];
  const estimated = Math.ceil(
    asciiWords.join("").length / 4 +
      Math.max(0, segments.length - asciiWords.length) * 0.75 +
      nonAsciiChars.length * 0.35 +
      whitespaceRuns.length * 0.1
  );
  return { tokens: Math.max(1, estimated), chars, estimator: "heuristic" };
}

function computeConversationMetrics(conversation) {
  const trunk = buildTrunk(conversation);
  const text = trunk.map(stringifyMessageCountables).filter(Boolean).join("\n");
  const estimate = estimateTokens(text);
  const lastAssistantMs = trunk.reduce((latest, message) => {
    if (message.sender !== "assistant" || !message.created_at) return latest;
    const ms = Date.parse(message.created_at);
    return Number.isFinite(ms) && (!latest || ms > latest) ? ms : latest;
  }, null);
  return {
    trunkMessageCount: trunk.length,
    totalTokens: estimate.tokens,
    chars: estimate.chars,
    estimator: estimate.estimator,
    cachedUntil: lastAssistantMs ? new Date(lastAssistantMs + 5 * 60 * 1000).toISOString() : null,
    limitations: [
      "Does not include Claude Desktop system prompt or hidden context.",
      "Counts only user-supplied/exported conversation data.",
      "Uses a transparent heuristic unless wired to an exact tokenizer dependency."
    ]
  };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const tools = [
  {
    name: "estimate_text_tokens",
    description: "Estimate tokens for explicit text supplied by the user. No Claude Desktop traffic is intercepted.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"]
    }
  },
  {
    name: "estimate_claude_conversation_export",
    description: "Estimate tokens from a Claude conversation JSON object with chat_messages/current_leaf_message_uuid.",
    inputSchema: {
      type: "object",
      properties: { conversation: { type: "object" } },
      required: ["conversation"]
    }
  }
];

function callTool(name, args) {
  if (name === "estimate_text_tokens") {
    const text = typeof args?.text === "string" ? args.text : "";
    return { content: [{ type: "text", text: JSON.stringify(estimateTokens(text), null, 2) }] };
  }
  if (name === "estimate_claude_conversation_export") {
    return {
      content: [{ type: "text", text: JSON.stringify(computeConversationMetrics(args?.conversation ?? {}), null, 2) }]
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      if (request.method === "initialize") {
        result(request.id, {
          protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: "claude-desktop-token-counter", version: "0.1.0" }
        });
      } else if (request.method === "notifications/initialized") {
        // Notification: no response.
      } else if (request.method === "tools/list") {
        result(request.id, { tools });
      } else if (request.method === "prompts/list") {
        result(request.id, {
          prompts: [
            {
              name: "check_tokens",
              description: "Estimate tokens for text you paste into Claude.",
              arguments: [
                {
                  name: "text",
                  description: "Text to estimate.",
                  required: true
                }
              ]
            }
          ]
        });
      } else if (request.method === "prompts/get") {
        const text = request.params?.arguments?.text ?? "";
        result(request.id, {
          description: "Estimate pasted text with the token counter tool.",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Use the estimate_text_tokens tool from claude-token-counter for this text:\n\n${text}`
              }
            }
          ]
        });
      } else if (request.method === "tools/call") {
        result(request.id, callTool(request.params?.name, request.params?.arguments ?? {}));
      } else {
        error(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err) {
      error(request.id, -32000, err instanceof Error ? err.message : "Tool failed");
    }
  }
});
