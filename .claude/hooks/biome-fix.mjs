import { execSync } from "node:child_process";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const filePath = input.tool_input?.file_path ?? "";

if (/\.(ts|js|css)$/.test(filePath)) {
  execSync(`npx biome check --fix "${filePath}"`, { stdio: "inherit" });
}
