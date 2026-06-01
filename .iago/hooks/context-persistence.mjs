// iaGO-OS — Context Persistence hook
// Events: SessionStart, PreCompact, Stop (dispatched via CLI arg)
// Manages session snapshots and HANDOFF.json recovery.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { extractDecisions, getFilesModified } from "./lib/transcript.mjs";
import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, existsSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

if (isDisabled("context-persistence")) process.exit(0);

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE_DIR = join(PROJECT_DIR, ".iago", "state");
const SESSIONS_DIR = join(STATE_DIR, "sessions");
const HANDOFF_ARCHIVE_DIR = join(STATE_DIR, "handoffs", "archive");
const CLIENT_PATH = join(STATE_DIR, "active-client.json");
const MAX_SESSIONS = 10;

function ensureDirs() {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
}

function findLatestHandoff() {
  if (!existsSync(STATE_DIR)) return null;
  try {
    const matches = readdirSync(STATE_DIR)
      .filter((f) => /^HANDOFF-.+\.json$/.test(f))
      .map((f) => ({
        name: f,
        path: join(STATE_DIR, f),
        mtime: statSync(join(STATE_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return matches[0] || null;
  } catch { return null; }
}

function archiveHandoff(handoffPath, name) {
  try {
    if (!existsSync(HANDOFF_ARCHIVE_DIR)) mkdirSync(HANDOFF_ARCHIVE_DIR, { recursive: true });
    renameSync(handoffPath, join(HANDOFF_ARCHIVE_DIR, name));
  } catch { /* ignore — better to leave file than crash hook */ }
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
  // Keep MAX_SESSIONS - 1 to leave room for the incoming session
  for (const s of sessions.slice(MAX_SESSIONS - 1)) {
    try { unlinkSync(s.path); } catch { /* ignore */ }
  }
}

// === SessionStart ===
async function sessionStart(input) {
  ensureDirs();
  pruneSessions();

  const output = [];

  // Check for most recent HANDOFF-*.json first (highest priority)
  const latestHandoff = findLatestHandoff();
  if (latestHandoff) {
    try {
      const handoff = JSON.parse(readFileSync(latestHandoff.path, "utf8"));

      // Stale warning: >7 days
      if (handoff.paused_at) {
        const age = Date.now() - new Date(handoff.paused_at).getTime();
        const days = Math.floor(age / 86400000);
        if (days > 7) {
          output.push(`⚠ Handoff is ${days} days old — project state may have changed. Check STATE.md and git log.`);
        }
      }

      output.push(`## Resumed from ${latestHandoff.name}`);
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

      // Archive after loading (preserves history; allows manual recovery)
      archiveHandoff(latestHandoff.path, latestHandoff.name);

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

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
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
