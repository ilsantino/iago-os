// iaGO-OS — Context Monitor hook
// Event: PostToolUse (all tools)
// Reads bridge-ctx.json, injects warnings at 80%/90% thresholds.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

if (isDisabled("context-monitor")) process.exit(0);

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const BRIDGE_PATH = join(PROJECT_DIR, ".iago", "state", "bridge-ctx.json");

async function main() {
  const input = await readInput();

  if (!existsSync(BRIDGE_PATH)) process.exit(0);

  let bridge;
  try {
    bridge = JSON.parse(readFileSync(BRIDGE_PATH, "utf8"));
  } catch {
    process.exit(0);
  }

  const pct = bridge.context_pct || 0;

  if (pct < 80) process.exit(0);

  // Track tool use count for debounce
  const toolCount = (bridge.last_warning_tool_count || 0) + 1;

  if (pct >= 90) {
    // CRITICAL — every time, no debounce
    bridge.last_warning_tool_count = toolCount;
    writeFileSync(BRIDGE_PATH, JSON.stringify(bridge, null, 2));

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: `⚠ CRITICAL: Context at ${pct}%. Run /compact now or /iago:pause to save state.`,
    }));
    return;
  }

  if (pct >= 80) {
    // WARNING — debounce every 5 tool uses
    if (toolCount % 5 !== 1) {
      bridge.last_warning_tool_count = toolCount;
      writeFileSync(BRIDGE_PATH, JSON.stringify(bridge, null, 2));
      process.exit(0);
    }

    bridge.last_warning_tool_count = toolCount;
    writeFileSync(BRIDGE_PATH, JSON.stringify(bridge, null, 2));

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: `⚠ Context at ${pct}%. Finish current task, then /compact or /iago:pause.`,
    }));
  }
}

main().catch(() => process.exit(0));
