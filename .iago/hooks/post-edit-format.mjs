// iaGO-OS — Post-edit format hook
// Event: PostToolUse, Matcher: Edit
// Runs Biome format on edited files.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { execSync } from "child_process";
import { existsSync } from "fs";

if (isDisabled("post-edit-format")) process.exit(0);

const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".json"]);

function getExtension(filePath) {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot) : "";
}

async function main() {
  const input = await readInput();
  const filePath = input.tool_input?.file_path;

  if (!filePath) process.exit(0);
  if (!EXTENSIONS.has(getExtension(filePath))) process.exit(0);
  if (!existsSync(filePath)) process.exit(0);

  // Shell metachar guard
  if (/[;&|`$(){}]/.test(filePath)) process.exit(0);

  try {
    // Use npx to find biome — works cross-platform
    const cmd = process.platform === "win32"
      ? `npx.cmd biome check --write "${filePath}"`
      : `npx biome check --write "${filePath}"`;

    execSync(cmd, {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    // Biome not installed or format failed — non-fatal
    const msg = err?.message || "";
    if (err?.code === "ENOENT" || msg.includes("not found") || msg.includes("ENOENT")) {
      process.stderr.write("iaGO: biome not found. Run npm install in iaGO-OS root.\n");
    }
  }
}

main().catch(() => process.exit(0));
