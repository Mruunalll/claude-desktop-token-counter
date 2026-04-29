#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const text = process.argv.slice(2).join(" ");

if (!text) {
  console.error('Usage: node scripts/count.mjs "text to count"');
  process.exit(1);
}

const server = spawn(process.execPath, [join(root, "dist/server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk;
  const lines = output.trim().split(/\r?\n/);
  const response = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).find((message) => message?.id === 1);

  if (!response) return;
  const resultText = response.result?.content?.[0]?.text;
  if (resultText) console.log(resultText);
  server.kill();
});

server.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "estimate_text_tokens",
      arguments: { text },
    },
  })}\n`
);
