// iaGO-OS — Post-edit typecheck hook
// Event: PostToolUse, Matcher: Edit
// Runs tsc --noEmit filtered to the edited file.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";

if (isDisabled("post-edit-typecheck")) process.exit(0);

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

function getExtension(filePath) {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot) : "";
}

function findTsConfig(filePath) {
  let dir = dirname(filePath);
  const root = process.platform === "win32" ? dir.split("\\")[0] + "\\" : "/";
  while (dir !== root && dir !== ".") {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main() {
  const input = await readInput();
  const filePath = input.tool_input?.file_path;

  if (!filePath) process.exit(0);
  if (!TS_EXTENSIONS.has(getExtension(filePath))) process.exit(0);
  if (!existsSync(filePath)) process.exit(0);

  const tsconfig = findTsConfig(filePath);
  if (!tsconfig) process.exit(0);

  // Shell metachar guard
  if (/[;&|`$(){}]/.test(filePath)) process.exit(0);

  try {
    const cmd = process.platform === "win32"
      ? `npx.cmd tsc --noEmit --pretty false -p "${tsconfig}"`
      : `npx tsc --noEmit --pretty false -p "${tsconfig}"`;

    execSync(cmd, {
      encoding: "utf8",
      timeout: 4500,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    // Filter to only show errors in the edited file
    const stderr = err.stderr || err.stdout || "";
    const lines = stderr.split("\n");
    const relevant = lines.filter((line) => {
      const normalized = line.replace(/\\/g, "/");
      const normalizedFile = filePath.replace(/\\/g, "/");
      return normalized.includes(normalizedFile);
    });

    if (relevant.length > 0) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: `TypeScript errors in ${filePath}:\n${relevant.join("\n")}`,
      }));
    }
  }
}

main().catch(() => process.exit(0));
