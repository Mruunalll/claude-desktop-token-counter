import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = join(root, "dist/server.js");
const fixturePath = join(root, "fixtures/sample-conversation.json");

function startServer() {
  return spawn(process.execPath, [serverPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });
}

function createClient(server) {
  let nextId = 1;
  let buffer = "";
  const pending = new Map();

  server.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });

  return {
    request(method, params = {}) {
      const id = nextId++;
      const payload = { jsonrpc: "2.0", id, method, params };

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}`));
        }, 2000);

        pending.set(id, (message) => {
          clearTimeout(timeout);
          resolve(message);
        });

        server.stdin.write(`${JSON.stringify(payload)}\n`);
      });
    },
  };
}

function parseToolText(response) {
  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.result, "Expected JSON-RPC result");
  const text = response.result.content?.[0]?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

const server = startServer();
const client = createClient(server);

try {
  const initialized = await client.request("initialize", { protocolVersion: "2024-11-05" });
  assert.equal(initialized.result.serverInfo.name, "claude-desktop-token-counter");

  const tools = await client.request("tools/list");
  const names = tools.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["estimate_claude_conversation_export", "estimate_text_tokens"]);

  const prompts = await client.request("prompts/list");
  assert.deepEqual(prompts.result.prompts.map((prompt) => prompt.name), ["check_tokens"]);

  const prompt = await client.request("prompts/get", {
    name: "check_tokens",
    arguments: { text: "Hello from the prompt shortcut." },
  });
  assert.match(prompt.result.messages[0].content.text, /estimate_text_tokens/);

  const textResult = parseToolText(
    await client.request("tools/call", {
      name: "estimate_text_tokens",
      arguments: { text: "Hello Claude Desktop token counter." },
    })
  );
  assert.ok(["heuristic", "gpt-tokenizer"].includes(textResult.estimator));
  assert.ok(textResult.tokens > 0);
  assert.equal(textResult.chars, 35);

  const conversation = JSON.parse(await readFile(fixturePath, "utf8"));
  const conversationResult = parseToolText(
    await client.request("tools/call", {
      name: "estimate_claude_conversation_export",
      arguments: { conversation },
    })
  );
  assert.equal(conversationResult.trunkMessageCount, 2);
  assert.ok(conversationResult.totalTokens > textResult.tokens);
  assert.equal(conversationResult.cachedUntil, "2026-04-30T10:05:12.000Z");

  console.log("All MCP plugin tests passed.");
} finally {
  server.kill();
}
