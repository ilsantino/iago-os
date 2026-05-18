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

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let lastN = 10;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--last") {
    const v = parseInt(args[i + 1], 10);
    if (!Number.isNaN(v) && v > 0) lastN = v;
    i++;
  }
}

const projectDir = process.cwd();
const runsDir = path.join(projectDir, ".iago", "state", "pipeline-runs");

let files;
try {
  files = readdirSync(runsDir).filter((f) => f.endsWith(".ndjson"));
} catch {
  console.error(`No pipeline runs directory at ${runsDir}`);
  process.exit(1);
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

if (complete.length === 0) {
  console.error("No complete runs found.");
  process.exit(1);
}

// Sort by filename ascending (YYYYMMDD-HHMMSS prefix is format-agnostic).
complete.sort((a, b) => a.file.localeCompare(b.file));

// Take last N.
const taken = complete.slice(-lastN);

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
