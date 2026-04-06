// iaGO-OS — Context Persistence hook
// Events: SessionStart, PreCompact, Stop (dispatched via CLI arg)
// Manages session snapshots, HANDOFF.json recovery, and cost logging.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { readTranscript, getTokenUsage, extractDecisions, getFilesModified } from "./lib/transcript.mjs";
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync, appendFileSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

if (isDisabled("context-persistence")) process.exit(0);

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE_DIR = join(PROJECT_DIR, ".iago", "state");
const SESSIONS_DIR = join(STATE_DIR, "sessions");
const HANDOFF_PATH = join(STATE_DIR, "HANDOFF.json");
const CLIENT_PATH = join(STATE_DIR, "active-client.json");
const COSTS_PATH = join(STATE_DIR, "costs.jsonl");
const MAX_SESSIONS = 10;

function ensureDirs() {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
}

function getSessionId(input) {
  return input.session_id || `s-${Date.now()}`;
}

function getGitBranch() {
  try {
    return execSync("git branch --show-current", { encoding: "utf8", timeout: 2000 }).trim() || "HEAD";
  } catch { return "unknown"; }
}

function getClient() {
  try {
    if (existsSync(CLIENT_PATH)) {
      return JSON.parse(readFileSync(CLIENT_PATH, "utf8"));
    }
  } catch { /* ignore */ }
  return { client: "internal", project: "unknown" };
}

function getOperator() {
  return process.env.USER || process.env.USERNAME || "unknown";
}

function listSessions() {
  try {
    return readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        name: f,
        path: join(SESSIONS_DIR, f),
        mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

function pruneSessions() {
  const sessions = listSessions();
  for (const s of sessions.slice(MAX_SESSIONS)) {
    try { unlinkSync(s.path); } catch { /* ignore */ }
  }
}

// === SessionStart ===
async function sessionStart(input) {
  ensureDirs();
  pruneSessions();

  const output = [];

  // Check for HANDOFF.json first (highest priority)
  if (existsSync(HANDOFF_PATH)) {
    try {
      const handoff = JSON.parse(readFileSync(HANDOFF_PATH, "utf8"));

      // Stale warning: >7 days
      if (handoff.paused_at) {
        const age = Date.now() - new Date(handoff.paused_at).getTime();
        const days = Math.floor(age / 86400000);
        if (days > 7) {
          output.push(`⚠ Handoff is ${days} days old — project state may have changed. Check STATE.md and git log.`);
        }
      }

      output.push("## Resumed from HANDOFF.json");
      if (handoff.client) output.push(`Client: ${handoff.client}`);
      if (handoff.project) output.push(`Project: ${handoff.project}`);
      if (handoff.current_task) output.push(`Task: ${handoff.current_task}`);
      if (handoff.next_action) output.push(`Next: ${handoff.next_action}`);
      if (handoff.git_branch) output.push(`Branch: ${handoff.git_branch}`);
      if (handoff.key_decisions?.length) {
        output.push(`Decisions: ${handoff.key_decisions.join("; ")}`);
      }
      if (handoff.blockers?.length) {
        output.push(`Blockers: ${handoff.blockers.join("; ")}`);
      }
      if (handoff.uncommitted_files?.length) {
        output.push(`Uncommitted: ${handoff.uncommitted_files.join(", ")}`);
      }

      // Delete after loading
      try { unlinkSync(HANDOFF_PATH); } catch { /* ignore */ }

      process.stdout.write(JSON.stringify({ hookSpecificOutput: output.join("\n") }));
      return;
    } catch { /* fall through to session snapshot */ }
  }

  // Load most recent session snapshot
  const sessions = listSessions();
  if (sessions.length > 0) {
    try {
      const snapshot = JSON.parse(readFileSync(sessions[0].path, "utf8"));

      output.push("## Previous Session Context");
      if (snapshot.client) output.push(`Client: ${snapshot.client}`);
      if (snapshot.git_branch) output.push(`Branch: ${snapshot.git_branch}`);
      if (snapshot.current_task) output.push(`Task: ${snapshot.current_task}`);
      if (snapshot.key_decisions?.length) {
        output.push(`Key decisions: ${snapshot.key_decisions.slice(0, 5).join("; ")}`);
      }

      // Detect interrupted session
      if (!snapshot.end_time && snapshot.outcome !== "completed") {
        output.push("⚠ Previous session ended unexpectedly.");
      }

      process.stdout.write(JSON.stringify({ hookSpecificOutput: output.join("\n") }));
      return;
    } catch { /* ignore corrupt snapshots */ }
  }

  // No prior state — first session
  process.stdout.write(JSON.stringify({ hookSpecificOutput: "First iaGO session. No prior context." }));
}

// === PreCompact ===
async function preCompact(input) {
  ensureDirs();

  const sessionId = getSessionId(input);
  const clientInfo = getClient();
  const usage = getTokenUsage();
  const decisions = extractDecisions();
  const filesModified = getFilesModified();

  const snapshot = {
    session_id: sessionId,
    start_time: new Date().toISOString(),
    outcome: "in_progress",
    client: clientInfo.client,
    project: clientInfo.project || "unknown",
    git_branch: getGitBranch(),
    compaction_count: (input.compaction_count || 0) + 1,
    files_modified: filesModified,
    files_read: [],
    tools_used: {},
    key_decisions: decisions,
    current_task: input.current_task || "",
    total_tokens: {
      input: usage.inputTokens,
      output: usage.outputTokens,
    },
    last_compaction: new Date().toISOString(),
  };

  const snapshotPath = join(SESSIONS_DIR, `${sessionId}.json`);
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  // Output compact instructions
  const lines = [
    "## Session Context (iaGO)",
    `Client: ${clientInfo.client}`,
    `Branch: ${snapshot.git_branch}`,
  ];
  if (snapshot.current_task) lines.push(`Task: ${snapshot.current_task}`);
  if (filesModified.length > 0) lines.push(`Files modified: ${filesModified.slice(0, 10).join(", ")}`);
  if (decisions.length > 0) lines.push(`Key decisions: ${decisions.slice(0, 5).join("; ")}`);

  process.stdout.write(JSON.stringify({ hookSpecificOutput: lines.join("\n") }));
}

// === Stop ===
async function stop(input) {
  ensureDirs();

  const sessionId = getSessionId(input);
  const clientInfo = getClient();
  const usage = getTokenUsage();
  const snapshotPath = join(SESSIONS_DIR, `${sessionId}.json`);

  // Update existing snapshot or create new one
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } catch {
    snapshot = {
      session_id: sessionId,
      start_time: new Date().toISOString(),
      client: clientInfo.client,
      project: clientInfo.project || "unknown",
      git_branch: getGitBranch(),
    };
  }

  snapshot.end_time = new Date().toISOString();
  snapshot.outcome = "completed";
  snapshot.total_tokens = {
    input: usage.inputTokens,
    output: usage.outputTokens,
  };

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  // Append to costs.jsonl
  const startTime = snapshot.start_time ? new Date(snapshot.start_time).getTime() : Date.now();
  const costEntry = {
    timestamp: snapshot.end_time,
    session_id: sessionId,
    client: clientInfo.client || "internal",
    project: clientInfo.project || "unknown",
    model: input.model || "unknown",
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_creation_tokens: usage.cacheCreationTokens,
    session_duration_ms: Date.now() - startTime,
    compaction_count: snapshot.compaction_count || 0,
    git_branch: snapshot.git_branch || "unknown",
    tools_used: snapshot.tools_used || {},
    files_modified_count: (snapshot.files_modified || []).length,
    operator: getOperator(),
  };

  try {
    appendFileSync(COSTS_PATH, JSON.stringify(costEntry) + "\n");
  } catch { /* non-fatal */ }
}

// === Dispatch ===
async function main() {
  const input = await readInput();
  const event = process.argv[2];

  switch (event) {
    case "session-start": return sessionStart(input);
    case "pre-compact": return preCompact(input);
    case "stop": return stop(input);
    default:
      console.error(`context-persistence: unknown event "${event}". Use: session-start, pre-compact, stop`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("context-persistence error:", err.message);
  process.exit(0); // Non-fatal — don't block Claude
});
