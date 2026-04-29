import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = spawn(process.execPath, [join(root, "dist/server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

const requests = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "estimate_text_tokens", arguments: { text: "Hello Claude Desktop token counter." } },
  },
];

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk;
  if (output.trim().split(/\r?\n/).length >= 3) {
    console.log(output.trim());
    server.kill();
  }
});

for (const request of requests) {
  server.stdin.write(`${JSON.stringify(request)}\n`);
}
