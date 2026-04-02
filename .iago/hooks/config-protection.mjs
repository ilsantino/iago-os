// iaGO-OS — Config protection hook
// Event: PreToolUse, Matcher: Edit|Write|MultiEdit
// Blocks edits to protected config files.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { basename } from "path";

if (isDisabled("config-protection")) process.exit(0);

// Exact filename matches
const BLOCKED_FILES = new Set([
  "biome.json", "biome.jsonc",
  "tsconfig.json",
  ".gitignore",
  "Dockerfile",
]);

// Pattern-based blocks
const BLOCKED_PATTERNS = [
  /^\.eslintrc/,
  /^eslint\.config\./,
  /^\.prettierrc/,
  /^prettier\.config\./,
  /^tsconfig\..+\.json$/,
  /^vite\.config\./,
  /^tailwind\.config\./,
  /^postcss\.config\./,
  /^\.env($|\..+)/,
  /^docker-compose\./,
  /\.lock$/,
];

// package.json: partial protection
const BLOCKED_PKG_FIELDS = ["scripts", "engines", "overrides"];

function isProtected(filePath) {
  const name = basename(filePath);

  if (BLOCKED_FILES.has(name)) return name;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(name)) return name;
  }
  return null;
}

async function main() {
  const input = await readInput();
  const filePath = input.tool_input?.file_path;

  if (!filePath) process.exit(0);

  const name = basename(filePath);

  // package.json: check for blocked fields in the edit content
  if (name === "package.json") {
    const content = input.tool_input?.new_string || input.tool_input?.content || "";
    for (const field of BLOCKED_PKG_FIELDS) {
      if (content.includes(`"${field}"`)) {
        process.stdout.write(JSON.stringify({
          decision: "block",
          reason: `iaGO: Blocked edit to package.json field "${field}". Only dependencies/devDependencies edits are allowed.`,
        }));
        process.exit(2);
      }
    }
    process.exit(0);
  }

  const blocked = isProtected(filePath);
  if (blocked) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `iaGO: Blocked edit to protected config file "${blocked}". Modify manually if intended.`,
    }));
    process.exit(2);
  }
}

main().catch(() => process.exit(0));
