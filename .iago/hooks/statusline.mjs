// iaGO-OS — Statusline hook
// Event: Statusline
// Outputs: git branch | context% | client slug | session duration
// Writes bridge file for context-monitor.mjs

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { getTokenUsage } from "./lib/transcript.mjs";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

if (isDisabled("statusline")) process.exit(0);

const SESSION_START = Date.now();
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE_DIR = join(PROJECT_DIR, ".iago", "state");
const BRIDGE_PATH = join(STATE_DIR, "bridge-ctx.json");
const CLIENT_PATH = join(STATE_DIR, "active-client.json");

function getGitBranch() {
  try {
    return execSync("git branch --show-current", { encoding: "utf8", timeout: 2000 }).trim() || "HEAD";
  } catch {
    return "no-git";
  }
}

function getClientSlug() {
  try {
    if (existsSync(CLIENT_PATH)) {
      const data = JSON.parse(readFileSync(CLIENT_PATH, "utf8"));
      return data.client || "";
    }
  } catch { /* ignore */ }
  return "";
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h${String(mins % 60).padStart(2, "0")}m`;
}

async function main() {
  const input = await readInput();

  const branch = getGitBranch();
  const client = getClientSlug();
  const duration = formatDuration(Date.now() - SESSION_START);

  // Compute context % from token usage
  const usage = getTokenUsage();
  const totalTokens = usage.inputTokens + usage.outputTokens;
  // Claude Max: 200K context. Estimate % used.
  const contextWindow = 200000;
  const contextPct = Math.min(99, Math.round((totalTokens / contextWindow) * 100));

  // Write bridge file for context-monitor
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const bridge = {
      session_id: input.session_id || "unknown",
      context_pct: contextPct,
      client: client,
      git_branch: branch,
      timestamp: Math.floor(Date.now() / 1000),
      estimated_turns_remaining: Math.max(0, Math.floor((contextWindow - totalTokens) / 3000)),
      last_warning_tool_count: 0,
    };

    // Preserve last_warning_tool_count from existing bridge
    try {
      if (existsSync(BRIDGE_PATH)) {
        const prev = JSON.parse(readFileSync(BRIDGE_PATH, "utf8"));
        bridge.last_warning_tool_count = prev.last_warning_tool_count || 0;
      }
    } catch { /* ignore */ }

    writeFileSync(BRIDGE_PATH, JSON.stringify(bridge, null, 2));
  } catch { /* non-fatal */ }

  // Build statusline parts
  const parts = [branch];
  parts.push(`${contextPct}%`);
  if (client) parts.push(client);
  parts.push(duration);

  const line = parts.join(" | ");
  process.stdout.write(JSON.stringify({ statusline: line }));
}

main().catch(() => process.exit(0));
