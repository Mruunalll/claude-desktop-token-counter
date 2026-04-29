#!/usr/bin/env node
import { computeConversationMetrics, estimateTokens } from "./tokenEngine.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: any;
};

function send(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: JsonRpcRequest["id"], value: unknown) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id: JsonRpcRequest["id"], code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const tools = [
  {
    name: "estimate_text_tokens",
    description: "Estimate tokens for explicit text supplied by the user. No Claude Desktop traffic is intercepted.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "estimate_claude_conversation_export",
    description: "Estimate tokens from a Claude conversation JSON object with chat_messages/current_leaf_message_uuid.",
    inputSchema: {
      type: "object",
      properties: { conversation: { type: "object" } },
      required: ["conversation"],
    },
  },
];

async function callTool(name: string, args: any) {
  if (name === "estimate_text_tokens") {
    const text = typeof args?.text === "string" ? args.text : "";
    return { content: [{ type: "text", text: JSON.stringify(await estimateTokens(text), null, 2) }] };
  }

  if (name === "estimate_claude_conversation_export") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(await computeConversationMetrics(args?.conversation ?? {}), null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let request: JsonRpcRequest;
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
          serverInfo: { name: "claude-desktop-token-counter", version: "0.1.0" },
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
                  required: true,
                },
              ],
            },
          ],
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
                text: `Use the estimate_text_tokens tool from claude-token-counter for this text:\n\n${text}`,
              },
            },
          ],
        });
      } else if (request.method === "tools/call") {
        result(request.id, await callTool(request.params?.name, request.params?.arguments ?? {}));
      } else {
        error(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err) {
      error(request.id, -32000, err instanceof Error ? err.message : "Tool failed");
    }
  }
});
