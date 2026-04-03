// iaGO-OS — Usage Tracking hook
// Events: PostToolUse (Skill + Agent matcher), Stop
// Logs skill invocations and session summaries to .iago/state/usage-log.jsonl

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

if (isDisabled("usage-tracker")) process.exit(0);

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE_DIR = join(PROJECT_DIR, ".iago", "state");
const LOG_PATH = join(STATE_DIR, "usage-log.jsonl");
const SESSION_FILE = join(STATE_DIR, "usage-session.json");

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function appendLog(entry) {
  ensureDir();
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch { /* non-fatal */ }
}

function getSessionId(input) {
  return input.session_id || `s-${Date.now()}`;
}

function loadSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

function saveSession(data) {
  ensureDir();
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

function ensureSession(sessionId) {
  let session = loadSession();
  if (!session) {
    session = {
      id: sessionId,
      start: new Date().toISOString(),
      skills: [],
      agents: [],
    };
  }
  return session;
}

// --- PostToolUse handler ---
async function postToolUse(input) {
  ensureDir();
  const sessionId = getSessionId(input);
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};

  // Track Skill invocations
  if (toolName === "Skill") {
    const skillName = toolInput.skill || toolInput.name || "unknown";

    appendLog({
      ts: new Date().toISOString(),
      event: "skill_invoked",
      skill: skillName,
      session: sessionId,
    });

    const session = ensureSession(sessionId);
    if (!session.skills.includes(skillName)) {
      session.skills.push(skillName);
    }
    saveSession(session);
  }

  // Track Agent dispatches
  if (toolName === "Agent") {
    const agentType = toolInput.subagent_type || "general-purpose";

    appendLog({
      ts: new Date().toISOString(),
      event: "agent_dispatched",
      agent: agentType,
      session: sessionId,
    });

    const session = ensureSession(sessionId);
    if (!session.agents.includes(agentType)) {
      session.agents.push(agentType);
    }
    saveSession(session);
  }
}

// --- Stop: Session summary ---
async function stop(input) {
  ensureDir();
  const sessionId = getSessionId(input);
  const session = loadSession();

  if (!session) return;

  const startTime = session.start ? new Date(session.start).getTime() : Date.now();
  const durationMin = Math.round((Date.now() - startTime) / 60000);

  appendLog({
    ts: new Date().toISOString(),
    event: "session_end",
    duration_min: durationMin,
    skills_used: session.skills || [],
    agents_dispatched: session.agents || [],
    session: sessionId,
  });

  // Clean up session file
  try { unlinkSync(SESSION_FILE); } catch { /* ignore */ }
}

// === Dispatch ===
async function main() {
  const input = await readInput();
  const event = process.argv[2];

  switch (event) {
    case "post-tool-use": return postToolUse(input);
    case "stop": return stop(input);
    default:
      process.exit(0);
  }
}

main().catch(() => {
  process.exit(0); // Non-fatal — never block Claude
});
