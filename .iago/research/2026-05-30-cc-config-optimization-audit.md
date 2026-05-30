# Claude Code Config Optimization Audit — iaGO-OS

**Date:** 2026-05-30
**Scope:** Always-loaded context, redundancy, model spend, hook topology, routing, correctness, and staleness across the iaGO-OS Claude Code configuration (`.claude/`, `.iago/`, global `~/.claude/`, MEMORY.md).
**Status:** Final. Merges the primary audit with the critic's gap analysis. Several headline figures are flagged as **provisional pending re-measurement** (see Open Questions / Risks).

---

## Executive Summary

The iaGO-OS Claude Code config carries roughly 92-94 KB of markdown always-loaded context per session before any user input. Counting **bytes** and dividing by ~4 yields ~23K tokens (~$0.069/session at uncached Opus input pricing). **Both of those numbers are now known to be materially understated and methodologically soft** — see the critic's gaps below. The single largest omission is **MCP tool-schema injection**: every globally-enabled MCP server pushes its full tool-schema (name + description + JSON input schema) into the system prompt on every session. With workspace-mcp (~70 tools), Apollo (~27), scrapling (~11), the Google suites, plus the five documented servers, this is plausibly **15-40K tokens of always-loaded context — larger than the entire markdown budget the rest of this audit optimizes**. The headline "~23K always-loaded" therefore counts only markdown and omits the biggest lever.

With that correction stated up front, the markdown-side levers, in order: (1) path-scope or lazy-load the four rules CLAUDE.md already declares path-scoped (react-vite, aws-amplify, e2e-testing, mcp-server-patterns = ~10KB) plus meta/reference files (skill-authoring, layer-triage explanatory half, context-hygiene probes) — none needed on most sessions; (2) split execution-pipeline.md (14.9KB) into an orchestrator-rules file (~2.5KB always-on) and a subagent-contracts file the workflow loads in fresh context; (3) dedupe available-skills.md (13KB) against CLAUDE.md and execution-pipeline.md. Combined with MEMORY.md grouping/archival, these cut the markdown budget toward ~10K. But the **new top lever is gating non-core MCP servers** (Apollo, scrapling, workspace-mcp, Figma, Gamma, Stripe, Supabase, Sentry, PostHog, Vercel, HuggingFace) to load-on-demand or per-project, since they are irrelevant to ~90% of iago-os coding sessions, while keeping obsidian/graphify/mempalace/context7 as load-bearing per memory.md.

Two non-token wins are equally urgent. A suspected critical bug: `context-persistence.mjs` calls `unlinkSync` without importing it, so session-snapshot pruning silently never runs and `.iago/state/sessions/` grows unbounded (the inner `catch{}` swallows the `ReferenceError`). A centralized model-routing fix: commit, build, and summary pipeline stages inherit Opus when they are mechanical Sonnet-class work, fixable in one edit to the `STAGE_MODELS` map. **Note:** the "VERIFIED" tags on these two findings could not be re-confirmed in the critic pass (the tool layer returned no output that round) — treat them as high-confidence-but-unverified and re-run before shipping. Hook duplication (3 PreCompact, 4 Stop, a per-Grep/Glob graphify nudge) adds latency and per-call token injection with no marginal value.

**Net (markdown only, provisional):** ~12-14K tokens/session saved on always-loaded markdown, plus model-routing **price** savings per pipeline run, plus one data-loss-risk bug closed. **The MCP-schema lever, once measured, likely dwarfs all of these** and must be quantified before the savings ranking is finalized.

---

## Top Token Levers (ranked)

Ranking is **provisional** — it reflects markdown bytes only. Once MCP tool-schema bytes and subagent prompt-composition bytes are measured (Open Questions Q1, Q9), levers 0 and the agent-payload lever almost certainly move to the top of this list.

### 0. (NEW — likely #1 once measured) Gate non-core MCP servers to load-on-demand / per-project

- **Impact:** plausibly 15-40K tokens/session of always-loaded system-prompt schema — larger than the entire markdown budget. Currently unmeasured.
- **Evidence:** every globally-enabled MCP server injects its full tool-schema on every session. The deferred-tool list in this session alone surfaces workspace-mcp (~70 tools), Apollo (~27), scrapling (~11), Google Drive/Gmail/Calendar suites, Vercel, Figma, Gamma, Stripe, Supabase, Sentry, PostHog, HuggingFace, plus the 5 documented servers (obsidian ~18, graphify ~8, mempalace ~20, context7 ~2, markitdown ~1, youtube-transcript ~1). At ~80-200 tokens/schema this is a five-figure token payload.
- **Action:**
  1. Measure per-server schema cost (count tools × representative schema size, or diff system-prompt token count with each server toggled).
  2. In `~/.claude.json` / project `enabledMcpjsonServers`, gate the non-core servers (Apollo, scrapling, workspace-mcp, Figma, Gamma, Stripe, Supabase, Sentry, PostHog, Vercel, HuggingFace) to per-project or load-on-demand — they are irrelevant to ~90% of iago-os coding sessions.
  3. Explicitly KEEP obsidian / graphify / mempalace / context7 globally per `memory.md` — but note even these cost tokens and could be project-scoped if a future session-type analysis shows they are unused in pure-coding sessions.

### 1. Path-scope / lazy-load the 4 rules CLAUDE.md already declares path-scoped (10,034 B)

- **Impact:** ~2,500 tokens/session on the 60-70% of sessions (docs, research, planning, ops) that touch none of `src/**`, `amplify/**`, tests, or mcp files.
- **Files:** `react-vite.md`, `aws-amplify.md`, `e2e-testing.md`, `mcp-server-patterns.md`.
- **Action:** Verify whether Claude Code's native rules loader honors path-scope frontmatter on `.claude/rules/*.md`. If yes, add YAML path patterns to each file (zero content change). If the loader does NOT support per-file path-scope (likely — `rules/*.md` auto-load globally today), move these 4 files out of `rules/` into a non-auto-loaded location and load-on-demand via a one-line stub in `rules/` that points the agent to Read them when working in the matching path. Do NOT ship the frontmatter-only fix until path-scoping is confirmed supported. **Correctness caveat (critic):** these rules are consumed by IMPLEMENTATION/FIX subagents that run in FRESH context where orchestrator path-scope state does not apply — before relocating, verify the pipeline's implement/fix subagent prompts actually inject the matching rule for the files they touch, or coding-standard enforcement (no-any, named-exports, ShadCN-verify, data-testid priority) is silently stripped from the exact agents that need it.

### 2. Split execution-pipeline.md (14,924 B) — ~40% is subagent-only contracts

- **Impact:** ~3,100 tokens/session.
- **Action:** Extract Fix Session Contract, Re-Review Integrity Check, Async Review-Fix Loop, Legacy bash fallback, and Observation-Masking examples into `execution-pipeline-subagent-contracts.md` (loaded only by workflow stages in their fresh context). Keep in `execution-pipeline.md` only: the Rule (skill-invocation-required), the stage list, and Control Flags (~2.5KB always-on). **Caveat (critic):** verify no automated compaction path (`claude -p` pipeline stages, CI, `context-persistence.mjs`) depends on the observation-masking probes before relocating them — see lever 7 / Open Questions Q5.

### 3. Dedupe available-skills.md (13,113 B) against CLAUDE.md + execution-pipeline.md

- **Impact:** ~1,100 tokens/session from dedup; ~1,600 more if the catalog is made load-on-demand.
- **Action:** Delete the Quick Reference, Size-Your-Task, Delivery-Pipeline diagram, Pipeline-Stages table (all duplicated in CLAUDE.md / execution-pipeline.md) and the Agent-Architecture section (duplicated in CLAUDE.md + `.claude/agents/`). Keep only the "All Skills" category tables. Rename to `skills-catalog.md`. Optionally make it load-on-demand since the full catalog is only needed when routing a fresh request, not during implementation.

### 4. Group + archive MEMORY.md (16,507 B — single largest markdown file, 68 flat entries, no eviction)

- **Impact:** ~2,000 tokens/session.
- **Action:** Group the 68 one-liners into 6-8 thematic blocks and move resolved/>90-day entries (e.g. Codex pipeline no-op, Sub-project format hook bug, Lambda Node-20 fire-and-forget) to `MEMORY_ARCHIVE.md` (never auto-loaded). Target ≤30 active entries (~8KB). The frozen-snapshot rule already makes pruning safe — entries only need to survive one session after being written.

### 5. Centralize pipeline model routing: commit, build, summary stages inherit Opus but are Sonnet-class

- **Impact:** model routing changes **price-per-token, not token count** (critic correction) — the saving is dollars, not tokens, across commit + 2-4 build-gate calls + summary at the Opus/Sonnet delta.
- **Action:** In `execute-pipeline.js` `STAGE_MODELS` (reported at lines 25-36, read by `runStage()` at line 106), change `commit`, `build`, and `summary` from `undefined` (inherit opus) to `'sonnet'`. Add `lock-acquire`/`lock-release` as `'sonnet'` IF they dispatch via `runStage` (verify they aren't plain inline JS first). One-edit fix to the central map — the per-call line edits in earlier drafts are unnecessary; `STAGE_MODELS` is the single source of truth.

### 6. Demote e2e + debug agent profiles from Opus to Sonnet

- **Impact:** Opus→Sonnet **price** delta per e2e or debug dispatch (not a token-count reduction).
- **Action:** `profiles/e2e.md` and `profiles/debug.md` set `model: opus`. Debug does pattern-matching (tsc/lint errors, capped at 3 fix attempts + maxTurns 20, escalates hard cases to orchestrator) — safe to demote. **e2e is riskier (critic):** Playwright selector/assertion debugging on flaky concurrent React 19 renders is genuinely judgment-heavy per `e2e-testing.md` ("use expect auto-retry for concurrent rendering"). Change `debug` to `sonnet` now; validate `e2e` on Sonnet against a real flaky-render spec before committing the change.

### 7. Move reference/meta rules out of always-loaded

- **Impact:** ~3,100 tokens/session combined.
- **Files & action:**
  - `skill-authoring.md` (4,737 B) — consulted only when authoring skills (<5% of sessions). Move to `.claude/skills/meta/` or `.iago/context/`, load-on-demand.
  - `layer-triage.md` (~5KB of 6,143 B is reference) — keep the 3-question diagnostic + quick-reference table (~1KB); move framework background + "Applied to iaGO/plan" tables + anti-patterns to `.iago/research/`.
  - `context-hygiene.md` (~1.8KB of 5,209 B is probes/examples) — keep taxonomy + mitigation buckets; move the 6-probe compression eval into the session-digest template. **Caveat (critic):** the probes are invoked by the frozen-snapshot/compaction path AND potentially by `context-persistence.mjs` compaction summaries — moving them to an Obsidian-only template means non-Obsidian compactions (`claude -p` stages, CI) lose the lossy-summary guard. Verify dependence before relocating (Open Questions Q5).

### 8. Kill the per-Grep/Glob graphify PreToolUse nudge

- **Impact:** ~2,000-8,000 tokens per active session (fires on every Grep/Glob/obsidian-search — the most frequent calls).
- **Action:** Delete the global PreToolUse hook (matcher `Glob|Grep|mcp__obsidian__search_notes`) from `~/.claude/settings.json`. The routing instruction already lives in CLAUDE.md + memory.md. If a reminder is wanted, emit it once via SessionStart `additionalContext`, not per-call. **Scope warning (critic):** this hook is in GLOBAL settings — deleting it affects EVERY project, not just iago-os. Assess cross-project blast radius before deleting, or scope the deletion to the iago-os project settings.

---

## Quick Wins (checklist)

- [ ] **CRITICAL BUG (re-verify first):** add `unlinkSync` to the `fs` import on line 9 of `.iago/hooks/context-persistence.mjs` → `import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, existsSync, statSync, unlinkSync } from 'fs'`. Reported: line 80 calls `unlinkSync` inside `pruneSessions`, the empty `catch` swallows the `ReferenceError`, so snapshot pruning has never run and `.iago/state/sessions/` grows unbounded. The logic (inner empty catch swallows the ReferenceError) is plausible and worth fixing regardless; re-run the file read to confirm line 9/line 80 before committing.
- [ ] **Model routing:** in `execute-pipeline.js` `STAGE_MODELS` (lines 25-36), set `commit`, `build`, and `summary` to `'sonnet'`. These currently inherit opus; `runStage()` (line 106) reads this map as the single source of truth — one edit covers all three. Re-confirm the line numbers before editing.
- [ ] Demote `profiles/debug.md` from `model: opus` to `model: sonnet` (pattern-matching, self-caps at 3 fixes, escalates hard cases). Validate `profiles/e2e.md` on Sonnet before demoting it (judgment-heavy flaky-render debugging).
- [ ] Delete the global PreToolUse graphify nudge (`Glob|Grep|obsidian search` matcher) from `~/.claude/settings.json` — duplicates CLAUDE.md/memory.md and injects tokens on every search call. **Confirm no other project relies on it first.**
- [ ] Delete the global PreCompact echo-nudge from `~/.claude/settings.json` — `context-persistence.mjs` already emits a richer compaction summary for iago-os; the echo is strictly weaker. **Confirm cross-project impact first (global hook).**
- [ ] Add `async: true` to the blocking mempalace CLI Stop hook in `~/.claude/settings.local.json` (and to context-persistence + usage-tracker Stop hooks) so session close is not blocked up to 30s on a vector-store write.
- [ ] Delete `available-skills.md` duplicated sections (Quick Reference, Size-Your-Task, Delivery-Pipeline diagram, Pipeline-Stages table, Agent-Architecture) — all exist in CLAUDE.md/execution-pipeline.md/`.claude/agents`; keep only the All-Skills tables.
- [ ] Delete the "Legacy bash fallback (deprecated)" section from `execution-pipeline.md` (it documents code its own text says never to touch) — fold the one-line deprecation notice into `scripts/execute-pipeline.sh`.
- [ ] Remove `post-edit-console-warn.mjs` (PostToolUse) — console detection is already enforced at the correct point (staged diff) by `commit-quality.mjs`; running both double-injects and reads the whole file on every JS/TS edit.
- [ ] Remove the duplicated TypeScript-strictness block from `capabilities/security.md` (any/as/@ts-ignore/non-null rules) and cross-reference `review-quality.md` — every review profile loads both, processing the same 4 rules twice.
- [ ] Update CLAUDE.md capability count from 13 to 14 (trust-boundary makes 14 capability files) — stale inventory note.
- [ ] Prune `iago-os/.claude/settings.local.json` from 37 one-off Bash permission entries (session-temp paths, `/tmp/design.tar.gz` chain, bot-asistente `mv`, hardcoded session UUIDs) down to the genuinely recurring git/npx/python/read/ls patterns. (Also check whether any permission entries gate MCP-server loading — see Open Questions Q10.)
- [ ] Delete (or move to `backups/`) the broken `~/.claude/statusline-command.sh` — superseded by `statusline.js`; references `jq` which is not on Windows Claude Code PATH; MEMORY.md already warns not to regenerate it. While here, measure what `statusline.js` injects per render and whether it spawns a subprocess on every turn (latency — Open Questions Q6).

---

## Structural Recommendations

1. **Adopt a hard always-loaded budget — but define it to include the real bloat.** A byte-sum of `rules/` + CLAUDE.md + MEMORY.md (the originally proposed check) ignores the two largest contributors: **MCP tool-schema bytes and subagent prompt-composition bytes**. The budget would show "green" at 10K while the actual session prefix is 30-50K. The tracked check (SessionStart or CI script) MUST include MCP schema bytes and a representative subagent prompt, or it measures the wrong thing. Allocation target for the markdown slice: MEMORY.md ~4K, CLAUDE.md files ~2K, every-session rules (stack, output-style, git-workflow, memory, trimmed execution-pipeline orchestrator-rules + context-hygiene taxonomy) ~3-4K; everything else path-scoped or load-on-demand.

2. **Establish a single source of truth per concept and enforce it.** The delivery-pipeline diagram, pipeline-stages table, size-your-task guidance, and agent-architecture summary each appear in 2-3 files (CLAUDE.md, available-skills.md, execution-pipeline.md). Pick one canonical home for each; make the others a one-line pointer. Root cause behind several redundancy findings and ongoing drift risk.

3. **Resolve the capability-module duplication strategy.** Five capability files (react-19, tdd, e2e, lambda, cognito) are manually-maintained byte-copies of their `rules/` counterparts and carry "Sync with:" comments — guaranteed drift. Decide: (a) generate capability files from `rules/` at write-time (no manual copies), or (b) if dispatched subagents already receive `rules/` context, collapse each capability to a short header + agent-specific behavioral additions. At minimum add a CI check flagging byte-divergence between each synced pair. **Tie-in (critic):** option (b) interacts with lever 1's correctness caveat — if subagents do NOT receive `rules/` context, the capability copies are load-bearing and collapsing them strips standards.

4. **Right-size the fullstack fallback profile.** It is the catch-all for every unmatched task yet statically loads 6 capabilities (~14KB) including animation (3,912 B) — so a doc/script/config task gets the full React+Dynamo+Lambda+Framer payload. Add a no-capability fallback profile (executor, maxTurns ~15) for tasks outside `src/` and `amplify/`, and inject animation dynamically only when the task touches `src/` and mentions motion/scroll — the dynamic-selection pattern research/debug profiles already use.

5. **Consolidate session-end and compaction hooks — after a uniqueness check.** There are 3 overlapping PreCompact hooks and 4 overlapping Stop hooks; `session-diary.py` and the mempalace CLI hook both appear to write the MemPalace diary collection. **Before dropping either (critic):** verify the two diary writers target the SAME collection/wing vs different wings — if different, dropping one loses data. Designate the authoritative diary writer, drop the true duplicate, keep `session-obsidian.py` (writes a different store). Target: 2 Stop hooks, no double-write.

6. **Implement or retract the security-audit auto-trigger, and wire trust-boundary.** `profiles/security-audit.md` documents an auto-trigger on Cognito/JWT/IAM diffs, but no gate in `execute-pipeline.js` or any skill implements it — aspirational docs create a false security expectation. Either add a `git diff --name-only` path-pattern gate in the pipeline that dispatches security-audit, or downgrade the profile text to "manual dispatch only." Separately, `trust-boundary` capability loads into NO profile/base — wire it into the operator-based research/content profiles (they WebFetch), or external-fetch profiles have no prompt-injection defense. This is a security gap, not a token cost.

7. **Quantify and budget the per-dispatch subagent payload.** With 3 bases + 13/14 capabilities + 12 profiles, the composed prompt per dispatch could rival the orchestrator's always-loaded budget — and it multiplies by every subagent the pipeline spawns (8+ per plan). This is the per-DISPATCH analogue of the always-loaded problem and is currently unquantified. Total the base+capability+profile payload for each of the 12 profiles and fold a representative one into the budget check from recommendation 1.

---

## Per-Category Findings

### Token bloat (always-loaded context)

Reported byte totals: `rules/*.md` = 64,996 B (15 files); iago CLAUDE.md = 6,909 B; global CLAUDE.md = 3,179 B; global obsidian.md = 2,487 B; MEMORY.md = 16,507 B. **Always-loaded markdown ~94 KB.** Token conversion is provisional (see Open Questions Q2). Largest single markdown file is MEMORY.md. **This table excludes MCP tool schemas and subagent prompt composition — the two largest real contributors (Q1, Q9).**

| Finding | Severity | Evidence | Recommendation | Est. saving (provisional) |
|---|---|---|---|---|
| MCP tool-schemas injected every session, unmeasured | **Critical** | workspace-mcp ~70 + Apollo ~27 + scrapling ~11 + Google suites + Vercel/Figma/Gamma/Stripe/Supabase/Sentry/PostHog/HF + 5 documented servers | Measure per-server; gate non-core to per-project/on-demand; keep obsidian/graphify/mempalace/context7 | plausibly 15-40K tok/session |
| ~23K+ markdown always-loaded before user input | Critical | 94 KB across 19 files; ~$0.069/session at uncached rate (cache status unconfirmed — Q3) | Hard budget incl. MCP+subagent bytes + tracked check | ~13K tok/session (markdown) |
| MEMORY.md 16,507 B, 68 flat entries, no eviction | High | largest markdown file, ~18% of markdown budget | Group into 6-8 blocks; archive >90-day resolved to non-loaded `MEMORY_ARCHIVE.md`; ≤30 active | ~2K tok/session |
| execution-pipeline.md 14,924 B, ~40% subagent-only | High | Fix Contract/Re-Review/Async Loop/Legacy/Obs-Masking are subagent contracts | Split: orchestrator-rules (~2.5KB always-on) + subagent-contracts (workflow-only) | ~3.1K tok/session |
| 4 path-scoped rules load globally (10,034 B) | High | CLAUDE.md declares them path-scoped; no scoping enforced | Confirm loader supports path-scope; else move out of `rules/` + load-on-demand stub; verify subagents still receive them (Q4) | ~2.5K tok on ~60-70% of sessions |
| layer-triage.md 6,143 B mostly reference | Medium | only 3-question diagnostic + quick-ref operational | Keep ~1KB diagnostic; move framework/tables/anti-patterns to `.iago/research/` | ~1.15K tok/session |
| skill-authoring.md 4,737 B meta-tooling | Medium | consulted only when authoring skills | Move to `.claude/skills/meta/` or `.iago/context/`, load-on-demand | ~1.18K tok/session |
| context-hygiene.md 5,209 B, ~60% probes/examples | Medium | taxonomy+buckets operational; 6-probe eval only for digests | Trim cross-ref header; move probes into digest template AFTER verifying no compaction path depends on them (Q5) | ~800 tok/session |
| fullstack fallback loads 6 caps (~14KB) incl animation | Low/Med | `profiles/fullstack.md`; fallback for all unmatched tasks | no-capability fallback profile; dynamic animation injection | ~3-14K tok per non-src/non-amplify dispatch |
| statusline render cost + output-style activation unmeasured | Medium | prompt named both; only the dead `.sh` was noted | Measure `statusline.js` per-render subprocess/latency; confirm an output-style is actually SET (else output-style.md is dead always-loaded weight) — Q6 | unknown |

### Redundancy

| Finding | Severity | Evidence | Recommendation | Est. saving |
|---|---|---|---|---|
| available-skills.md (13,113 B) duplicates CLAUDE.md + execution-pipeline.md | High | Quick-Ref/Size-Task/Delivery-diagram/Stages-table duplicated; only All-Skills tables unique. **Merged with the Agent-Architecture-dup finding** | Delete duplicated sections incl Agent-Architecture; keep All-Skills tables; rename `skills-catalog.md` | ~1.1K tok/session + ~1.6K if load-on-demand |
| 5 capability modules are byte-copies of `rules/` | Medium | react-19/tdd/e2e/lambda/cognito carry "Sync with:" comments — manual copies, drift risk | Generate from `rules/` at write-time OR collapse to header + deltas (only if subagents already get rules — Q4); add CI byte-divergence check | ~5-12K tok per dispatch if collapsed |
| TS-strictness rules duplicated in security + review-quality | Medium | same 4 rules same severities; review profiles load both | Remove block from security.md, cross-ref review-quality | ~200-400 tok/review |
| post-edit-console-warn duplicates commit-quality console check | Medium | edit-time whole-file scan + commit-time staged-diff scan | Remove post-edit-console-warn.mjs; keep commit-quality gate | ~100-200 tok/JS-TS edit |
| 3 overlapping PreCompact hooks | High | global echo + mempalace CLI + context-persistence all fire | Delete global echo (context-persistence is richer) — confirm cross-project impact (global hook) | ~200-400 tok/compaction |
| 4 overlapping Stop hooks; suspected diary double-write | High | session-diary.py + mempalace CLI both appear to write a diary collection | Verify same collection/wing FIRST; then keep one authoritative writer; drop the true dup; keep session-obsidian.py | latency; no token |

### Model spend

All pipeline model routing flows through one map — **`STAGE_MODELS` (execute-pipeline.js ~lines 25-36), read by `runStage()` at ~line 106** (reported; re-verify). Per-call line edits in earlier drafts are superseded by editing this one map. **Correction (critic):** every "tok/run" / "tok/dispatch" figure below is a category error — model routing changes **$/token, not token count**. The real metric is **dollars saved = price delta × per-stage token volume**, neither of which is measured. Re-frame all "savings" here as price reductions pending a $-denominated measurement.

| Finding | Severity | Evidence | Recommendation | Saving |
|---|---|---|---|---|
| commit stage inherits Opus | High | `STAGE_MODELS.commit = undefined`; git add + conventional-commit msg is mechanical (CLAUDE.md routes this to Sonnet) | `STAGE_MODELS.commit = 'sonnet'` | $ delta/run |
| summary stage inherits Opus | High | `STAGE_MODELS.summary = undefined`; writes templated `.md` from structured args | `STAGE_MODELS.summary = 'sonnet'` | $ delta/run |
| build gate inherits Opus | Medium | `STAGE_MODELS.build = undefined`; run tsc/vite + classify output (2-4 calls/run) | `STAGE_MODELS.build = 'sonnet'` (fixes still flow to dedicated fix stage = Opus) | $ delta × 2-4 calls/run |
| lock-acquire/lock-release at Opus | High | mkdir/rm-rf shell ops, not in STAGE_MODELS | If dispatched via runStage, add as `'sonnet'`; verify they aren't plain inline JS first | $ delta/run |
| e2e profile = Opus | Medium | `profiles/e2e.md`; BUT flaky concurrent React 19 render debugging is judgment-heavy (e2e-testing.md) | `model: sonnet` only after validating against a real flaky-render spec | $ delta/dispatch (correctness risk) |
| debug profile = Opus | Medium | `profiles/debug.md`; tsc/lint pattern-match, caps at 3 fixes + maxTurns 20, escalates hard cases | `model: sonnet` | $ delta/dispatch |

### Routing / skills

| Finding | Severity | Evidence | Recommendation |
|---|---|---|---|
| Global graphify PreToolUse nudge on every Grep/Glob/obsidian-search | High | `~/.claude/settings.json`; most frequent calls; already in CLAUDE.md+memory.md | Delete; move to one-time SessionStart if wanted. **Global hook — confirm cross-project blast radius first** (~2-8K tok/session) |
| Blocking mempalace Stop hook (no async, 30s timeout) | Medium | settings.local.json; session hangs up to 30s on vector write | Add `async:true` (also to context-persistence + usage-tracker Stop) |
| security-audit auto-trigger documented but unimplemented | Low | profile claims Cognito/JWT/IAM auto-dispatch; no gate in pipeline/skills | Implement git-diff path gate OR mark manual-only (false security expectation) |
| skill catalog needed only for routing, not implementation | — | available-skills.md loads every session | Make load-on-demand alongside the dedup |

### Correctness

| Finding | Severity | Evidence | Recommendation |
|---|---|---|---|
| unlinkSync used but not imported (context-persistence.mjs) | **Critical** | Reported: line 9 import omits `unlinkSync`; line 80 calls it inside `pruneSessions`; inner `catch{}` swallows the `ReferenceError` → pruning never runs, sessions/ grows unbounded. **Re-verify before fix — "VERIFIED" tag unconfirmable in critic pass; logic is plausible regardless** | Add `unlinkSync` to the `fs` import on line 9 |
| Path-scoped rules may not reach implement/fix subagents | High | those subagents run in FRESH context where orchestrator path-scope doesn't apply | Before moving levers 1/struct-3, verify subagent prompts inject the matching rule for files they edit, or coding-standard enforcement is silently stripped (Q4) |
| IAGO_DISABLED_HOOKS bypass functional despite "do not use" policy | Low | flags.mjs `isDisabled()` reads the env var; MEMORY.md says use Bash redirect instead | Add a stderr warn in `isDisabled()` when it returns true — auditable, not blocked |

### Staleness

| Finding | Severity | Recommendation |
|---|---|---|
| execution-pipeline.md "Legacy bash fallback" section | Low | Delete (subsumed by the high-severity pipeline split); fold notice into the `.sh` file |
| trust-boundary capability undispatchable | Medium | No profile/base loads it; add to research+content profiles (they WebFetch) — security gap, not token cost |
| CLAUDE.md says 13 capabilities, 14 files exist | Low | Update count to 14 |
| settings.local.json: 37 one-off Bash perms | Medium | Prune to recurring git/npx/python/read/ls patterns; also check permission↔MCP-loading interaction (Q10) |
| broken statusline-command.sh on disk | Medium | Delete or move to `backups/` (jq not on Windows PATH; superseded by statusline.js) |
| transcript.mjs scans ALL project dirs each PreCompact | Medium | Use `CLAUDE_PROJECT_DIR` to target one dir — O(1) not O(all projects); latency only |
| safety-guard runs 17 secret regexes on every .md edit | Medium | Early-exit extension filter for .md/.txt/.yaml; latency only |

---

## Open Questions / Risks

These incorporate the critic's gaps. Several invalidate or re-rank headline claims and must be resolved before acting on the savings estimates.

**Q1 — MCP tool-schema cost is unmeasured and is the single largest omission.** The audit's "~23K always-loaded" counts markdown only. Every active MCP server injects its full tool-schema into the system prompt every session: workspace-mcp ~70 tools, Apollo ~27, scrapling ~11, Google Drive/Gmail/Calendar suites, Vercel, Figma, Gamma, Stripe, Supabase, Sentry, PostHog, HuggingFace, plus obsidian/graphify/mempalace/context7/markitdown/youtube-transcript. At ~80-200 tokens/schema this is plausibly 15-40K tokens — larger than the entire markdown budget eight levers optimize. **Action:** measure per-server cost; gate non-core servers to per-project/on-demand; keep the four documented load-bearing servers. **Until measured, the headline number and lever ranking are understated and the top lever is missing.**

**Q2 — Token measurement methodology is unstated; the byte→token ratio is wrong/unjustified.** The audit uses ~4 B/token (94KB → ~23.5K). Markdown with tables, code fences, and pipe characters typically runs ~3.3-3.8 B/token, pushing the real figure to ~25-28K (still excluding MCP schemas). No tokenizer was named. Every "tok/session" estimate is a byte/4 division, not a token count. **Action:** re-measure with the actual Anthropic tokenizer (or a calibrated ~3.5 B/token) and re-rank levers — the ranking can shift once MCP schemas dominate.

**Q3 — Prefix-cache hit/miss reality is never established, and the cost model is internally contradictory.** $0.069/session for ~23.5K tokens implies ~$2.94/M — Opus input WITHOUT cache. But the whole framing is "always-loaded PREFIX," which prefix caching makes cheap (cache reads ~10% of input). If the prefix IS cached, per-session cost is ~$0.007 — an order of magnitude lower, weakening the urgency of the markdown-trimming levers. If NOT cached, the levers are 10× more valuable. The audit simultaneously cites "keep prefix-cache stable" (observation-masking rationale) AND prices the prefix at full input rate — a contradiction. **Action:** establish cache-hit reality before any savings claim is treated as credible.

**Q4 — Do path-scoped/moved rules still reach the implement/fix subagents that edit the matching files?** Those subagents run in fresh context where orchestrator path-scope state does not apply. If react-vite/aws-amplify/e2e-testing/mcp-server-patterns are moved to load-on-demand without the subagent prompts injecting them per touched file, coding-standard enforcement (no-any, named-exports, ShadCN-verify, data-testid priority) is silently stripped from the exact agents that need it. **This is a correctness-breaking risk the original audit treated as pure upside.** Resolve before lever 1, structural rec 3 (option b).

**Q5 — Do automated compaction paths depend on the context-hygiene 6-probe eval before it is relocated?** The probes may be invoked by the frozen-snapshot/compaction path and by `context-persistence.mjs` compaction summaries. Moving them to an Obsidian-only digest template means non-Obsidian compactions (`claude -p` pipeline stages, CI) lose the lossy-summary guard. **Action:** verify no automated compaction path depends on the probes before relocating (gates lever 7 / lever 2's obs-masking move).

**Q6 — Statusline runtime cost and output-style activation are unmeasured.** The prompt explicitly named both; the audit only noted the dead `.sh`. Open: (a) what does `statusline.js` inject per render, and does it spawn a subprocess every turn (latency)? (b) Is an output-style actually SET in settings — was `.claude/output-styles/` scanned? If `output-style.md` is an always-loaded rule but no output-style is activated, it is dead always-loaded weight.

**Q7 — Hook consolidation lacks a uniqueness check, and several deletions are GLOBAL-scope.** "Drop session-diary.py, keep session-obsidian.py" and "delete global PreCompact echo" assume duplication that was not confirmed: do the two diary writers target the SAME mempalace collection/wing or different wings? Deleting the global echo-nudge and global graphify nudge from `~/.claude/settings.json` affects EVERY project, not just iago-os — cross-project blast radius was not assessed. **Action:** confirm uniqueness and scope before any global-hook deletion.

**Q8 — Model-routing savings are mis-denominated and the e2e demotion carries correctness risk.** Switching models reduces $/token, not token count; the "~10-25K tok/dispatch" figures are a category error. The real saving is dollars and depends on the Opus/Sonnet price delta × measured per-stage token volume — neither is measured. Separately, demoting e2e to Sonnet risks correctness (judgment-heavy flaky concurrent React 19 render debugging); the "validate once" hedge understates this. Demote debug now; gate e2e behind a real validation run.

**Q9 — Subagent prompt-composition cost (per dispatch) is entirely unquantified.** 3 bases × 13/14 capabilities × 12 profiles compose into a per-dispatch prompt that could rival the orchestrator's always-loaded budget, multiplied by 8+ dispatches per plan. This is the per-DISPATCH analogue of the always-loaded problem and belongs in the budget invariant (structural rec 1, 7).

**Q10 — Permissions↔MCP-loading interaction is untested.** The 37 one-off Bash perms and the per-project `enabledMcpjsonServers` list are treated as cleanliness only, but the permission/enabled-server config may determine which MCP schemas load — tying directly to Q1. **Action:** check whether trimming permissions or the enabled-server list changes the loaded MCP schema set.

**Q11 — Re-verification of "VERIFIED" tags is outstanding.** The critic pass could not re-confirm the unlinkSync bug or the STAGE_MODELS line numbers (the tool layer returned no output that round). Treat both as high-confidence-but-unverified: re-read `context-persistence.mjs` (lines 9, 80) and `execute-pipeline.js` (lines 25-36, 106) before committing the fixes. The unlinkSync logic is plausible and worth fixing regardless of the tag.

---

*Audit merges the primary findings report with an adversarial critic pass. Byte sizes, STAGE_MODELS routing, and the unlinkSync bug were reported as source-verified but flagged for re-confirmation (Q11). Token figures, cost figures, and the savings ranking are PROVISIONAL pending MCP-schema measurement (Q1), tokenizer calibration (Q2), and cache-hit determination (Q3).*
