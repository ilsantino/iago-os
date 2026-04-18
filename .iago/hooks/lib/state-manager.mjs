// iaGO-OS — State engine for workflow state, config, and session logging
// Manages STATE.md, config.json, decision log, and session log under .iago/

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const IAGO_DIR = join(PROJECT_DIR, ".iago");
const STATE_PATH = join(IAGO_DIR, "STATE.md");
const CONFIG_PATH = join(IAGO_DIR, "config.json");
const PROJECT_PATH = join(IAGO_DIR, "PROJECT.md");
const ROADMAP_PATH = join(IAGO_DIR, "ROADMAP.md");
const PLANS_DIR = join(IAGO_DIR, "plans");
const SESSION_LOG_PATH = join(IAGO_DIR, "state", "session-log.jsonl");

const SUBDIRS = ["context", "plans", "summaries", "reviews", "learnings", "hooks", "state"];

const DEFAULT_CONFIG = {
  project: { name: "", client: "internal", type: "saas" },
  workflow: { skip_discuss: false, auto_verify: true, auto_advance: false },
  planning: { max_tasks_per_plan: 8, context_budget_pct: 40 },
  review: { mode: "single" },
};

const DEFAULT_STATE = `# State

- **Project:** (not configured)
- **Client:** internal
- **Phase:** init
- **Task:** (none)
- **Branch:** (none)
- **Updated:** ${new Date().toISOString()}

## Decisions

(none yet)

## Session Log

(none yet)
`;

const DEFAULT_PROJECT = `# Project

## Vision

(Set during /iago-init)

## Constraints

(Set during /iago-init)

## Architecture Decisions

(Logged during execution)
`;

const DEFAULT_ROADMAP = `# Roadmap

## Phases

(Set during /iago-init)

## Status

| Phase | Description | Status |
|-------|-------------|--------|
`;

/**
 * Create .iago/ subdirectories, write default config.json, STATE.md,
 * PROJECT.md, and ROADMAP.md. Skips anything that already exists.
 * @returns {{ created: string[], skipped: string[] }}
 */
export function init() {
  const created = [];
  const skipped = [];

  // Ensure .iago/ root
  if (!existsSync(IAGO_DIR)) {
    mkdirSync(IAGO_DIR, { recursive: true });
    created.push(".iago/");
  }

  // Ensure subdirectories
  for (const sub of SUBDIRS) {
    const dir = join(IAGO_DIR, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(`.iago/${sub}/`);
    } else {
      skipped.push(`.iago/${sub}/`);
    }
  }

  // Ensure state/sessions/
  const sessionsDir = join(IAGO_DIR, "state", "sessions");
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
    created.push(".iago/state/sessions/");
  }

  // config.json
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    created.push(".iago/config.json");
  } else {
    skipped.push(".iago/config.json");
  }

  // STATE.md
  if (!existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, DEFAULT_STATE);
    created.push(".iago/STATE.md");
  } else {
    skipped.push(".iago/STATE.md");
  }

  // PROJECT.md
  if (!existsSync(PROJECT_PATH)) {
    writeFileSync(PROJECT_PATH, DEFAULT_PROJECT);
    created.push(".iago/PROJECT.md");
  } else {
    skipped.push(".iago/PROJECT.md");
  }

  // ROADMAP.md
  if (!existsSync(ROADMAP_PATH)) {
    writeFileSync(ROADMAP_PATH, DEFAULT_ROADMAP);
    created.push(".iago/ROADMAP.md");
  } else {
    skipped.push(".iago/ROADMAP.md");
  }

  return { created, skipped };
}

/**
 * Parse STATE.md and return key-value pairs.
 * @returns {{ project: string, client: string, phase: string, task: string, branch: string, updated: string, decisions: string[], sessionLog: string[] }}
 */
export function readState() {
  if (!existsSync(STATE_PATH)) {
    return { project: "", client: "internal", phase: "init", task: "", branch: "", updated: "", decisions: [], sessionLog: [] };
  }

  try {
    const content = readFileSync(STATE_PATH, "utf8");
    const fields = {};
    const fieldRe = /^- \*\*(\w+):\*\*\s*(.*)$/gm;
    let match;
    while ((match = fieldRe.exec(content)) !== null) {
      fields[match[1].toLowerCase()] = match[2].trim();
    }

    // Extract decisions section
    const decisions = extractSection(content, "## Decisions");
    // Extract session log section
    const sessionLog = extractSection(content, "## Session Log");

    return {
      project: fields.project || "",
      client: fields.client || "internal",
      phase: fields.phase || "init",
      task: fields.task || "",
      branch: fields.branch || "",
      updated: fields.updated || "",
      decisions,
      sessionLog,
    };
  } catch {
    return { project: "", client: "internal", phase: "init", task: "", branch: "", updated: "", decisions: [], sessionLog: [] };
  }
}

/**
 * Extract non-empty lines from a markdown section (between header and next ## or EOF).
 * @param {string} content
 * @param {string} header
 * @returns {string[]}
 */
function extractSection(content, header) {
  const idx = content.indexOf(header);
  if (idx < 0) return [];

  const after = content.slice(idx + header.length);
  const nextSection = after.indexOf("\n## ");
  const block = nextSection >= 0 ? after.slice(0, nextSection) : after;

  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "(none yet)" && !l.startsWith("##"));
}

/**
 * Update specific fields in STATE.md. Only updates fields that are provided.
 * @param {{ project?: string, client?: string, phase?: string, task?: string, branch?: string }} fields
 */
export function updateState(fields) {
  if (!existsSync(STATE_PATH)) {
    init();
  }

  let content = readFileSync(STATE_PATH, "utf8");

  for (const [key, value] of Object.entries(fields)) {
    const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
    const re = new RegExp(`^(- \\*\\*${capitalized}:\\*\\*)\\s*(.*)$`, "m");
    if (re.test(content)) {
      content = content.replace(re, `$1 ${value}`);
    }
  }

  // Always update timestamp
  const tsRe = /^(- \*\*Updated:\*\*)\s*(.*)$/m;
  if (tsRe.test(content)) {
    content = content.replace(tsRe, `$1 ${new Date().toISOString()}`);
  }

  writeFileSync(STATE_PATH, content);
}

/**
 * Append a decision entry to the Decisions section in STATE.md.
 * @param {string} decision — one-line description of the decision
 */
export function appendDecision(decision) {
  if (!existsSync(STATE_PATH)) {
    init();
  }

  let content = readFileSync(STATE_PATH, "utf8");
  const marker = "## Decisions";
  const idx = content.indexOf(marker);
  if (idx < 0) return;

  const insertPoint = idx + marker.length;
  const after = content.slice(insertPoint);

  // Remove "(none yet)" placeholder if present
  const cleaned = after.replace(/\n\(none yet\)\n?/, "\n");
  const timestamp = new Date().toISOString().slice(0, 10);
  const entry = `\n- [${timestamp}] ${decision}`;

  content = content.slice(0, insertPoint) + cleaned.replace(/^\n/, entry + "\n");
  writeFileSync(STATE_PATH, content);
}

/**
 * Return the current workflow phase from STATE.md.
 * @returns {string} — one of: init, discuss, plan, execute, verify
 */
export function getPhaseStatus() {
  const state = readState();
  return state.phase;
}

/**
 * List plan files in .iago/plans/.
 * @returns {string[]} — array of filenames
 */
export function listPlans() {
  if (!existsSync(PLANS_DIR)) return [];

  try {
    return readdirSync(PLANS_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Read and return .iago/config.json, merging with defaults for any missing fields.
 * Preserves all keys from config (including routing, automation, etc.) while merging known sections with defaults.
 * @returns {{ project: { name: string, client: string, type: string }, workflow: { skip_discuss: boolean, auto_verify: boolean, auto_advance: boolean }, planning: { max_tasks_per_plan: number, context_budget_pct: number }, review: { mode: string }, [key: string]: unknown }}
 */
export function getConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
    return {
      ...raw,
      project: { ...DEFAULT_CONFIG.project, ...obj(raw.project) },
      workflow: { ...DEFAULT_CONFIG.workflow, ...obj(raw.workflow) },
      planning: { ...DEFAULT_CONFIG.planning, ...obj(raw.planning) },
      review: { ...DEFAULT_CONFIG.review, ...obj(raw.review) },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

/**
 * Append an entry to the session log (.iago/state/session-log.jsonl).
 * @param {{ event: string, [key: string]: unknown }} entry — must include an event field
 */
export function appendSessionLog(entry) {
  const logDir = join(IAGO_DIR, "state");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const record = { timestamp: new Date().toISOString(), ...entry };

  try {
    appendFileSync(SESSION_LOG_PATH, JSON.stringify(record) + "\n");
  } catch {
    // Non-fatal — don't block caller
  }
}
