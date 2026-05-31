#!/usr/bin/env node
// Per-stage telemetry aggregator. Reads NDJSON run files under
// .iago/state/pipeline-runs/, computes p50/p95/timeout/skip counts.
//
// Usage: node scripts/metrics-aggregate.mjs [--last N]
//   --last N    Aggregate the most recent N complete runs (default 10).
//
// Order: filter (drop incomplete) → sort by filename asc → take last N.
// Filter must come before sort/take so incomplete runs don't push valid ones out.
// Sort by filename (YYYYMMDD-HHMMSS prefix) to avoid ISO-format divergence between
// GNU date (+00:00) and BSD date (Z suffix) breaking localeCompare order.
//
// NDJSON record types (used by the by_session projection — Plan 03 Task 2):
//   stage_start, stage_end, pipeline_init, pipeline_finalize,
//   learnings_written, learnings_write_failed, learnings_written_to_fallback,
//   clean_tree_check.
//
// Per-record JSDoc:
//
// @typedef {object} TelemetryRecord
// @property {string} type — record kind (enumeration above)
// @property {string} [stage] — stage name (stage_start / stage_end)
// @property {string|null} [sessionId] — value of CLAUDE_CODE_SESSION_ID read
//   at emission time; legacy pre-Phase-1b records may omit this field and are
//   normalized to null by the aggregator (bucketed under `_unsessioned`).
// @property {number} [duration_ms] — stage duration (stage_end only)
// @property {boolean} [timed_out] — true if stage timed out (stage_end only)
// @property {string} [exit] — exit code string or "skipped" (stage_end only)
// @property {string} [ts] — ISO timestamp

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let lastN = 10;
// --allow-empty: opt into a SOFT exit 0 when there is no telemetry to read
// (a fresh checkout / nightly-cron context that legitimately has none yet).
// Default is fail-closed (exit 1) so a broken telemetry writer, wrong CWD, or
// wiped state root is not silently indistinguishable from "no runs yet".
let allowEmpty = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--last") {
    const v = parseInt(args[i + 1], 10);
    if (!Number.isNaN(v) && v > 0) lastN = v;
    i++;
  } else if (args[i] === "--allow-empty") {
    allowEmpty = true;
  }
}

const projectDir = process.cwd();
const runsDir = path.join(projectDir, ".iago", "state", "pipeline-runs");

// Absent / empty input is fail-closed by default and soft only under
// --allow-empty (dual-adversarial Important): without the flag, a missing or
// empty runs directory exits NON-ZERO with a descriptive stderr message so a
// misconfigured consumer (broken writer, wrong CWD, wiped state) is caught
// rather than reported as a healthy fresh checkout.
const emptyExit = allowEmpty ? 0 : 1;
let files;
try {
  files = readdirSync(runsDir).filter((f) => f.endsWith(".ndjson"));
} catch {
  if (allowEmpty) {
    console.log("no input files");
  } else {
    console.error(
      `No pipeline runs directory at ${runsDir} (pass --allow-empty to treat this as a soft no-op).`,
    );
  }
  process.exit(emptyExit);
}
if (files.length === 0) {
  if (allowEmpty) {
    console.log("no input files");
  } else {
    console.error(
      `No pipeline run files in ${runsDir} (pass --allow-empty to treat this as a soft no-op).`,
    );
  }
  process.exit(emptyExit);
}

const runs = [];
for (const f of files) {
  const fullPath = path.join(runsDir, f);
  const content = readFileSync(fullPath, "utf-8");
  const records = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  runs.push({ file: f, records });
}

// Filter — keep only runs with exactly one pipeline_finalize.
const complete = runs.filter((run) => {
  const finalizes = run.records.filter((r) => r.type === "pipeline_finalize");
  return finalizes.length === 1;
});

// dual-adversarial Important (#7): do NOT exit here. The stage-stats table
// needs complete runs, but the by_session projection below must still surface
// CRASHED runs (pipeline_init with no pipeline_finalize) even when nothing
// completed. Defer the non-zero exit (preserved below) until after by_session
// has rendered, so a crashed run is never silently invisible.
const noCompleteRuns = complete.length === 0;

// Sort by filename ascending (YYYYMMDD-HHMMSS prefix is format-agnostic).
complete.sort((a, b) => a.file.localeCompare(b.file));

// Take last N.
const taken = complete.slice(-lastN);

// by_session run window (Plan 03 Task 2 — dual-adversarial Important #7):
// The by_session lifecycle view must surface CRASHED runs — runs that emitted
// a pipeline_init but never a pipeline_finalize — because those are exactly
// the runs an operator scans this view to spot. The stage-stats table above
// legitimately requires complete runs, but by_session iterates a SEPARATE
// window: complete runs PLUS init-bearing crashed runs. A run with NEITHER
// lifecycle record (a malformed or legacy stage-only fixture) is not a real
// pipeline run and stays excluded, so it never leaks into the rollup.
const sessionEligible = runs.filter((run) => {
  const hasFinalize = run.records.some((r) => r.type === "pipeline_finalize");
  const hasInit = run.records.some((r) => r.type === "pipeline_init");
  return hasFinalize || hasInit;
});
sessionEligible.sort((a, b) => a.file.localeCompare(b.file));
const sessionRunWindow = sessionEligible.slice(-lastN);

// No complete runs → the stage-stats table cannot be computed. Still surface
// crashed runs (#7) in by_session, then preserve the non-zero exit contract
// (metrics-aggregate.test.sh Test 3). renderBySession is a hoisted function
// declaration defined below.
if (noCompleteRuns) {
  renderBySession(sessionRunWindow);
  console.error("No complete runs found.");
  process.exit(1);
}

// Walk stage_start/stage_end pairs per run.
const perStage = new Map();
for (const run of taken) {
  let pendingStart = null;
  for (const rec of run.records) {
    if (rec.type === "stage_start") {
      pendingStart = rec;
    } else if (
      rec.type === "stage_end" &&
      pendingStart &&
      pendingStart.stage === rec.stage
    ) {
      const stage = rec.stage;
      // Forward-compat per Plan 01: tolerate records with AND without
      // `sessionId`. Plan 03 owns the full per-session projection.
      const sessionId = rec.sessionId ?? null;
      if (!perStage.has(stage)) perStage.set(stage, []);
      perStage.get(stage).push({
        duration_ms: Number(rec.duration_ms) || 0,
        timed_out: rec.timed_out === true,
        exit: String(rec.exit),
        skipped: String(rec.exit) === "skipped",
        sessionId,
      });
      pendingStart = null;
    }
  }
}

// Compute per-stage stats.
// Linear interpolation: for n=2 q=0.5, returns average of both samples rather
// than always picking the upper value (which makes p50 == p95 == max at n=2).
const percentile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

const stats = [];
const stageOrder = [
  "stress_test",
  "implement",
  "build_gate",
  "console_gate",
  "review",
  "codex_review",
  "codex_fix",
  "create_pr",
  "tag_claude",
  "summary",
];
const sortedStages = Array.from(perStage.keys()).sort((a, b) => {
  const ia = stageOrder.indexOf(a);
  const ib = stageOrder.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
});

for (const stage of sortedStages) {
  const samples = perStage.get(stage);
  const ran = samples.filter((s) => !s.skipped);
  const durations = ran.map((s) => s.duration_ms).sort((a, b) => a - b);
  const n = durations.length;
  stats.push({
    stage,
    n,
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
    max_ms: n === 0 ? 0 : durations[n - 1],
    timeouts: ran.filter((s) => s.timed_out).length,
    skips: samples.filter((s) => s.skipped).length,
  });
}

// Print fixed-width table.
const cols = ["stage", "n", "p50_ms", "p95_ms", "max_ms", "timeouts", "skips"];
const rows = stats.map((s) => cols.map((c) => String(s[c])));
const widths = cols.map((c, i) =>
  Math.max(c.length, ...rows.map((r) => r[i].length), 0),
);
const fmt = (vals) => vals.map((v, i) => v.padEnd(widths[i])).join("  ");
console.log(fmt(cols));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log(`\n(${taken.length} run${taken.length === 1 ? "" : "s"} aggregated)`);

// ── by_session projection (Plan 03 Task 2) ─────────────────────────────────
// Group every record in the session window by session. Records lacking a
// session field (legacy pre-Phase-1b NDJSON) bucket under `_unsessioned` —
// emit, don't crash (CONTEXT.md OQ5 lenient default + "Backward-compat").
//
// dual-adversarial Important (#2/#6): a pipeline_init record carries
// `outer_session_id` (EMPTY on an orchestrator-less run) while stage/finalize
// records carry the SYNTHESIZED `sessionId`. Keying init by its own fields
// strands it in `_unsessioned`, splitting one logical run across two rows. So
// each run's pipeline_init records are folded into the run's RESOLVED session
// (the first non-empty `sessionId` on the run's records, else the first
// non-empty `outer_session_id`, else `_unsessioned`) — init then lands in the
// same row as the stages it belongs to. Hoisted so the no-complete-runs guard
// above can render before the deferred non-zero exit.
function renderBySession(window) {
  const NEW_EVENT_KINDS = new Set([
    "learnings_written",
    "learnings_write_failed",
    "learnings_written_to_fallback",
    "clean_tree_check",
  ]);

  /** @type {Map<string, {
   *   stage_start_count: number,
   *   stage_end_count: number,
   *   total_duration_ms: number,
   *   timed_out_count: number,
   *   pipeline_init_count: number,
   *   pipeline_finalize_count: number,
   *   failed_finalize_count: number,
   *   stages: Set<string>,
   *   event_counts: Record<string, number>,
   * }>} */
  const bySession = new Map();

  // Per-RECORD key for stage/finalize/event records (these normally carry a
  // real `sessionId`). The `outer_session_id` fallback is kept for the rare
  // record that carries only it.
  const sessionKey = (rec) => {
    let sid = rec.sessionId;
    if (sid === undefined || sid === null || sid === "") {
      sid = rec.outer_session_id;
    }
    if (sid === undefined || sid === null || sid === "") return "_unsessioned";
    return String(sid);
  };

  // Per-RUN resolved key — folds pipeline_init into the session its stages
  // bucket under (dual-adversarial #2/#6).
  const resolveRunSession = (run) => {
    for (const rec of run.records) {
      const sid = rec.sessionId;
      if (sid !== undefined && sid !== null && sid !== "") return String(sid);
    }
    for (const rec of run.records) {
      const osid = rec.outer_session_id;
      if (osid !== undefined && osid !== null && osid !== "") return String(osid);
    }
    return "_unsessioned";
  };

  const ensure = (key) => {
    if (!bySession.has(key)) {
      bySession.set(key, {
        stage_start_count: 0,
        stage_end_count: 0,
        total_duration_ms: 0,
        timed_out_count: 0,
        pipeline_init_count: 0,
        pipeline_finalize_count: 0,
        failed_finalize_count: 0,
        stages: new Set(),
        event_counts: Object.fromEntries(
          Array.from(NEW_EVENT_KINDS).map((k) => [k, 0]),
        ),
      });
    }
    return bySession.get(key);
  };

  for (const run of window) {
    // Resolve ONE key per run so this run's pipeline_init records fold into the
    // session its stages bucket under (orchestrator-less init has an empty
    // outer_session_id and would otherwise strand in _unsessioned — #2/#6).
    const runKey = resolveRunSession(run);
    for (const rec of run.records) {
      const t = rec.type;
      if (t === "stage_start") {
        const e = ensure(sessionKey(rec));
        e.stage_start_count += 1;
        if (rec.stage) e.stages.add(String(rec.stage));
      } else if (t === "stage_end") {
        const e = ensure(sessionKey(rec));
        e.stage_end_count += 1;
        e.total_duration_ms += Number(rec.duration_ms) || 0;
        if (rec.timed_out === true) e.timed_out_count += 1;
        if (rec.stage) e.stages.add(String(rec.stage));
      } else if (t === "pipeline_init") {
        // Folded into the run's resolved session (not keyed by its own
        // outer_session_id) so an init never splits off from its stages.
        const e = ensure(runKey);
        e.pipeline_init_count += 1;
      } else if (t === "pipeline_finalize") {
        // Lifecycle: complete runs that fail before a stage_end (or whose only
        // useful failure signal is pipeline_exit != "0") must surface here.
        const e = ensure(sessionKey(rec));
        e.pipeline_finalize_count += 1;
        // Treat any non-"0" pipeline_exit as a failed finalize. String compare
        // matches the telemetry emitter (printf "%s" on $exit_code).
        if (rec.pipeline_exit !== undefined && String(rec.pipeline_exit) !== "0") {
          e.failed_finalize_count += 1;
        }
      } else if (NEW_EVENT_KINDS.has(t)) {
        const e = ensure(sessionKey(rec));
        e.event_counts[t] += 1;
      }
    }
  }

  console.log("\nby_session");
  if (bySession.size === 0) {
    console.log("(no sessioned records)");
    return;
  }
  // Sort keys for stable output (insertion order is fine for Map in modern
  // Node, but tests should not rely on it — Stress I2).
  const keys = Array.from(bySession.keys()).sort();
  const sessionCols = [
    "sessionId",
    "starts",
    "ends",
    "inits",
    "finalizes",
    "failed_finalizes",
    "total_ms",
    "timeouts",
    "stages",
    "learnings_written",
    "learnings_write_failed",
    "learnings_written_to_fallback",
    "clean_tree_check",
  ];
  const sessionRows = keys.map((k) => {
    const e = bySession.get(k);
    const stagesList = Array.from(e.stages).sort().join(",");
    return [
      k,
      String(e.stage_start_count),
      String(e.stage_end_count),
      String(e.pipeline_init_count),
      String(e.pipeline_finalize_count),
      String(e.failed_finalize_count),
      String(e.total_duration_ms),
      String(e.timed_out_count),
      stagesList || "-",
      String(e.event_counts.learnings_written || 0),
      String(e.event_counts.learnings_write_failed || 0),
      String(e.event_counts.learnings_written_to_fallback || 0),
      String(e.event_counts.clean_tree_check || 0),
    ];
  });
  const sw = sessionCols.map((c, i) =>
    Math.max(c.length, ...sessionRows.map((r) => r[i].length), 0),
  );
  const sfmt = (vals) => vals.map((v, i) => v.padEnd(sw[i])).join("  ");
  console.log(sfmt(sessionCols));
  console.log(sw.map((w) => "-".repeat(w)).join("  "));
  for (const r of sessionRows) console.log(sfmt(r));
}

renderBySession(sessionRunWindow);
