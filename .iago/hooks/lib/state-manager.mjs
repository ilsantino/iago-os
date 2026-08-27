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
const CONTEXT_PATH = join(IAGO_DIR, "CONTEXT.md");
const GITIGNORE_PATH = join(IAGO_DIR, ".gitignore");
const PLANS_DIR = join(IAGO_DIR, "plans");
const SESSION_LOG_PATH = join(IAGO_DIR, "state", "session-log.jsonl");

// The `.iago/` schema — .iago/plans/feature-doc-standard/README.md §2. Four of
// the directories this used to create (`context/`, `reviews/`, top-level
// `learnings/`, `hooks/`) are banned at `.iago/` root and have one home each
// under `_config/` or `state/`.
//
// Every directory ships a REAL seed file. Git cannot track an empty directory,
// and `.gitkeep` is itself a zero-byte file that `scripts/organize/iago-lint.py`
// reports (W004) with no auto-fix — deleting one silently removes a directory
// the workflow depends on. So the seed says what belongs in the directory, which
// is the thing a `.gitkeep` never did.
const SUBDIR_SEEDS = {
  "_config/runbooks": ["README.md",
    "# `_config/runbooks/`\n\nRepeatable operational how-tos, one per file: `{slug}.md`.\nWritten the second time a procedure is carried out by hand.\n"],
  "_config/context": ["README.md",
    "# `_config/context/`\n\nStable framing that is neither a decision nor a plan: voice, vocabulary,\nintegration briefs, handoff notes. Feature-scoped framing goes in that\nfeature's `plans/feature-{slug}/SPEC.md` instead.\n"],
  "_config/decisions": ["README.md",
    "# `_config/decisions/`\n\nArchitecture Decision Records: `YYYY-MM-DD-{slug}.md`, frontmatter `date`,\n`status`, `plan`. STATE.md keeps the 3-5 most recent inline; older ones move\nhere so STATE.md stays under its 80-line budget.\n"],
  "_config/learnings": ["patterns.md",
    "## Review Patterns\n\n| # | Pattern | Occurrences | Last Seen | Source |\n|---|---------|-------------|-----------|--------|\n"],
  "_config/prompts": ["README.md",
    "# `_config/prompts/`\n\nReusable prompt fragments: `{use-case}.md`. A fragment earns a file the moment\na second dispatch would otherwise copy it. Per-run substituted prompts are\nregenerable and belong in `state/`.\n"],
  plans: ["naming.md",
    "# Plan naming\n\n- Feature stack — `plans/feature-{slug}/`: `README.md` (the brief), then\n  `NN-{slug}.md` per plan.\n- One-off — `plans/quick-{YYMMDD}-{slug}.md`.\n- Superseded stack — `plans/_archive/{YYYY-MM}-{slug}/`, with a pointer README.\n\nThis directory carries no `README.md` of its own — that belongs to each\n`feature-{slug}/`, where it is the brief for that stack.\n"],
  research: ["README.md",
    "# `research/`\n\nOne dated artefact per question: `YYYY-MM-DD-{slug}.md`. Superseded research is\ndeleted; decision-bearing research moves to `_archive/` with a pointer.\n"],
  summaries: ["README.md",
    "# `summaries/`\n\n`{plan-slug}.md`, one per executed plan, written by the pipeline's summary\nstage. Dispatch logs, PR-body drafts and review dumps belong in `state/`.\n"],
};

// Gitignored, skipped by the linter, written on every pipeline run — no seed.
const STATE_SUBDIRS = ["state", "state/sessions"];

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

// L1 routing — a required file (§2). Without it `iago-lint.py` reports W001 on
// every workspace `/iago-init` bootstraps.
const DEFAULT_CONTEXT = `# \`.iago/\` — workspace (MWP L1)

L1 routing. Read after \`CLAUDE.md\` (L0), before anything under \`.iago/\`.
Budget <= 300 tokens — routing only, no content.

| Path | Layer | Holds |
|---|---|---|
| \`PROJECT.md\` | L3 | what and why, architecture, constraints |
| \`ROADMAP.md\` | L3 | the one roadmap — phase tables, not prose |
| \`STATE.md\` | L4 | the digest: <= 80 lines, \`Updated:\` mandatory |
| \`_config/\` | L3 | runbooks/ context/ decisions/ learnings/ prompts/ hooks/ |
| \`plans/\` | L4 | feature-{slug}/NN-{slug}.md, quick-{YYMMDD}-{slug}.md, _archive/ |
| \`research/\` | L4 | YYYY-MM-DD-{slug}.md |
| \`summaries/\` | L4 | {plan-slug}.md, written by the pipeline |
| \`state/\` | L4 | gitignored — locks, logs, per-run scratch |

Each directory carries a seed file saying what belongs in it.

## Sub-workspaces

None yet. An inner app repo earns a row here the day it is added.

## Conformance

\`python scripts/organize/iago-lint.py check\` from the iaGO-OS checkout.
Schema: \`.iago/plans/feature-doc-standard/README.md\` §2.
`;

const DEFAULT_GITIGNORE = `# Per-run artefacts — locks, logs, review dumps, session scratch.
state/
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

  // Ensure subdirectories, each with its seed file
  for (const [sub, [seedName, seedBody]] of Object.entries(SUBDIR_SEEDS)) {
    const dir = join(IAGO_DIR, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(`.iago/${sub}/`);
    } else {
      skipped.push(`.iago/${sub}/`);
    }
    const seed = join(dir, seedName);
    if (!existsSync(seed)) {
      writeFileSync(seed, seedBody);
      created.push(`.iago/${sub}/${seedName}`);
    } else {
      skipped.push(`.iago/${sub}/${seedName}`);
    }
  }

  // Ensure state/ and state/sessions/ — gitignored, no seed
  for (const sub of STATE_SUBDIRS) {
    const dir = join(IAGO_DIR, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(`.iago/${sub}/`);
    }
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

  // CONTEXT.md — the fifth required file
  if (!existsSync(CONTEXT_PATH)) {
    writeFileSync(CONTEXT_PATH, DEFAULT_CONTEXT);
    created.push(".iago/CONTEXT.md");
  } else {
    skipped.push(".iago/CONTEXT.md");
  }

  // .gitignore — state/ is per-run, never committed
  if (!existsSync(GITIGNORE_PATH)) {
    writeFileSync(GITIGNORE_PATH, DEFAULT_GITIGNORE);
    created.push(".iago/.gitignore");
  } else {
    skipped.push(".iago/.gitignore");
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
