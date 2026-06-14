---
phase: quick
plan: quick-260530-dual-adv-autoconfig
wave: 1
depends_on: []
created: 2026-05-30
branch: fix/dual-adv-autoconfig
base: main
---

# Quick: /dual-adversarial auto-configures from the diff (model B)

## Goal

Make `/dual-adversarial` configure itself from the PR/branch diff instead of
prompting four questions on every run. Extra-lens selection becomes a
deterministic helper derived from the changed-file paths; review depth defaults
to **Team**; the post-findings action defaults to **report-only**; two flags
(`--fix`, `--interactive`) cover the write path and the legacy manual prompt.
Explicit `lenses`/`mode` args passed by any caller still win unchanged
(back-compat).

## Context the implementer MUST honor (read before editing)

- `.claude/workflows/dual-adversarial.js` is a **harness Workflow body**. The unit
  harness `.claude/workflows/dual-adversarial.test.mjs` loads it by `readFileSync`,
  strips only `export const meta`, and wraps the WHOLE source in `new Function(agent,
  parallel, pipeline, log, phase, args, budget, workflow)`. Therefore:
  - **Do NOT add any `export` keyword** to new code in `dual-adversarial.js` — an
    `export` inside the `new Function` wrap is a syntax error and breaks every test.
    `deriveLenses` must be a plain top-level `function deriveLenses(...)` (like the
    existing non-exported `lensPrompt`, `normalizeLenses`, etc.).
  - The workflow body **cannot shell out** (no `fs`/`child_process` in the workflow
    vm). To get changed files you MUST dispatch an `agent()` that runs git and
    returns a structured list — do not call git directly in the body.
- Current lens wiring (do not break the indexing): `normalizeLenses(A.lenses)` at
  ~line 200 yields `const { keys: lenses } = ...`; legs are built at ~line 301-310
  (`for (const key of lenses) ... agent(lensPrompt(def), { label: def.title, ... })`);
  results are sliced `results.slice(2, 2 + lenses.length)`. The team legs and
  `lensResults`/`teamResults` slicing all depend on `lenses.length`, so `lenses` must
  be finalized BEFORE the `legs` array is built (line ~301).
- `LENS_DEFS` keys are: `security`, `codeQuality`, `tests`, `completeness`,
  `frontend`, `amplify`, `perf`. Each has a `.title` used as the agent `label`.
  `deriveLenses` must only ever emit keys that exist in `LENS_DEFS`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.claude/workflows/dual-adversarial.js` | Add `deriveLenses`; fetch changed files via an agent and auto-derive when `lenses` is absent/`"auto"`; honor explicit arrays |
| modify | `.claude/workflows/dual-adversarial.test.mjs` | Behavioral tests for the auto-derive path |
| modify | `.claude/skills/dual-adversarial/SKILL.md` | Rewrite steps 3 & 5: auto-config default + `--fix` + `--interactive` |

## Tasks

### Task 1: `deriveLenses` helper + async auto-derive wiring
- **files:** `.claude/workflows/dual-adversarial.js`
- **action:**
  1. Add a pure top-level (NOT exported) `function deriveLenses(changedFiles)` that
     takes a `string[]` of changed paths and returns a **deduped, stable-ordered**
     lens-key array by these rules:
     - any path under `amplify/` (i.e. starts with `amplify/` or contains `/amplify/`)
       → include `"amplify"`
     - any path under `src/` OR any path ending in `.tsx` → include `"frontend"`
     - any path whose lowercased string contains any of `auth`, `authz`, `cognito`,
       `payment`, `billing` → include `"security"`
     - ALWAYS include `"codeQuality"` and `"completeness"` (base lenses)
     - NEVER auto-emit `"perf"` or `"tests"` (those stay opt-in via `--interactive`)
     - guard non-array / empty input → return exactly `["codeQuality","completeness"]`
     - emit a stable order, e.g. fixed precedence `["security","amplify","frontend",
       "codeQuality","completeness"]` filtered to the matched set, so tests can assert
       exact arrays.
  2. Replace the synchronous lens resolution so the auto path works: keep
     `normalizeLenses` for the EXPLICIT case. Determine the source:
     - if `A.lenses` is an Array (including an explicit empty `[]`) → honor it via
       `normalizeLenses` exactly as today (NO derivation, NO changed-files agent).
     - else if `A.lenses` is absent/`null`/`undefined` OR the literal string `"auto"`
       → dispatch ONE structured agent BEFORE the `legs` array is built (≈ before
       line 301) that runs `git diff --name-only ${base}...HEAD` in `${projectDir}`
       and returns `{ files: string[] }` (label `"changed-files"`, its own `phase`,
       a small schema `{ files: { type:'array', items:{ type:'string' } } }`); then
       `lenses = deriveLenses(filesResult ? filesResult.files : [])`. Run the result
       through the same `LENS_DEFS` validity filter so an unknown key can never reach
       the dispatch loop. If the changed-files agent fails (null), fall back to
       `deriveLenses([])` (= base lenses) and `log` the degradation — never throw.
  3. `lenses` must be a single finalized array used by the existing leg-build/slice
     logic unchanged. Do not alter the team-mode, verification, or return-shape code.
  4. Update the early `log(...)` lens line to reflect the resolved lenses. Match the
     file's existing style and comment density.
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs`
- **expected:** the existing 9 tests stay green AND the new tests pass — `N passed, 0 failed`

### Task 2: behavioral tests for the auto-derive path
- **files:** `.claude/workflows/dual-adversarial.test.mjs`
- **action:** Add cases in the EXISTING harness style (`makeHarness` + `buildWorkflow`,
  scripted mock `agent` matched by label; the workflow is driven and you assert on the
  captured `calls` labels and/or the returned object). Set `args.lenses` to absent
  (or `"auto"`) to exercise the auto path, and add a mock rule for the new
  `"changed-files"` agent returning a controlled `{ files: [...] }`. Cover:
  - `files: ['amplify/data/resource.ts']` → the dispatched lens legs (labels =
    `LENS_DEFS[key].title`) include `amplify` + the two base lenses, and NOT `frontend`/`security`.
  - `files: ['src/features/x/Widget.tsx']` → includes `frontend` + base.
  - `files: ['packages/ui/Button.tsx']` (`.tsx` outside `src/`) → includes `frontend`.
  - `files: ['amplify/functions/auth/handler.ts']` → includes `amplify` AND `security` + base.
  - `files: ['docs/readme.md']` (no rule matches) → exactly the two base lenses, nothing else.
  - **explicit override:** `args.lenses = ['perf']` (an Array) → the `"changed-files"`
    agent is NEVER called and the dispatched lens leg is exactly `perf` (proves the
    explicit array bypasses derivation). Assert the `calls` contain no `changed-files` label.
  - Keep determinism: assert the EXACT derived set/order where practical.
  Ensure the pre-existing standard/team tests still pass — they set `args.lenses`
  explicitly, so they must NOT hit the new `changed-files` agent (if any existing test
  omits `lenses`, give it an explicit array or a `changed-files` mock so it stays green).
- **verify:** `node .claude/workflows/dual-adversarial.test.mjs && node scripts/validate-workflows.mjs`
- **expected:** all tests pass; `validate-workflows.mjs` prints OK for all 3 workflows

### Task 3: SKILL.md — auto-config default + `--fix` + `--interactive`
- **files:** `.claude/skills/dual-adversarial/SKILL.md`
- **action:** Rewrite **step 3** so the DEFAULT run issues ZERO prompts: invoke the
  Workflow with `lenses` omitted (or `"auto"`) so it auto-derives from the diff,
  `mode: "team"` (the final pre-merge gate always runs Team), and report-only. Add
  flag handling parsed from the skill invocation:
  - `--interactive` → restore the ORIGINAL four-question `AskUserQuestion` flow
    (lenses / deep lenses / depth / report-vs-fix) VERBATIM as the interactive branch,
    passing the collected answers as before.
  - `--fix` → after the gate, if `blocking > 0`, run the fix flow
    (`dual-adversarial-fix.js`) on the verified-KEPT blocking findings, commit, and
    re-gate (cycle cap 2, same as today) — still NEVER push/merge.
  Update **step 5** so the fix flow triggers ONLY under `--fix` (default = report-only).
  Leave **step 6** (Report — "lead with `clean`, not `verdict`") unchanged. Update the
  **Guarantees** so they stay accurate: add that, by default, extra lenses auto-derive
  from the diff (`amplify/**`→amplify, `src/**` or `*.tsx`→frontend, auth/payment/cognito
  paths→security, plus codeQuality+completeness always), and that an explicit `lenses`
  array or `--interactive` overrides the derivation. Do not change the Workflow arg
  contract beyond `mode`/`lenses` already covered by Tasks 1-2.
- **verify:** `grep -nE "\-\-fix|\-\-interactive|auto-deriv|report-only|deriveLenses|amplify" .claude/skills/dual-adversarial/SKILL.md`
- **expected:** both flags, the auto-derive default language, and report-only default all present

## Out of scope (do NOT touch in this plan)
- The Critical/Important findings the gate raised on PR #86 (fix-flow-after-INCOMPLETE,
  the never-push/merge verifier gaps in `dual-adversarial-fix.js`, the skeptic `:N`
  evidence regex in `dual-adversarial.js`). Separate decision.
- Unifying the lens-keyword taxonomy with the parked `classifyTier` risk-tiering
  keyword lists. Deferred follow-up once both features land.
- Editing `.claude/rules/execution-pipeline.md`. The documented post-async gate
  invocation omits `lenses`, so it auto-derives now — that is an intended improvement,
  not a break; no rules-doc edit required.
