// iaGO-OS — Post-edit console.log warning hook
// Event: PostToolUse, Matcher: Edit
// Warns about console.log/warn/error in edited JS/TS files.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { readFileSync, existsSync } from "fs";

if (isDisabled("post-edit-console-warn")) process.exit(0);

const JS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

function getExtension(filePath) {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot) : "";
}

async function main() {
  const input = await readInput();
  const filePath = input.tool_input?.file_path;

  if (!filePath) process.exit(0);
  if (!JS_EXTENSIONS.has(getExtension(filePath))) process.exit(0);
  if (!existsSync(filePath)) process.exit(0);

  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    if (/console\.(log|warn|error|debug|info)\s*\(/.test(line)) {
      matches.push(`  L${i + 1}: ${line.trim()}`);
    }
  }

  if (matches.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: `console.* found in ${filePath}:\n${matches.slice(0, 5).join("\n")}${matches.length > 5 ? `\n  ...and ${matches.length - 5} more` : ""}`,
    }));
  }
}

main().catch(() => process.exit(0));
