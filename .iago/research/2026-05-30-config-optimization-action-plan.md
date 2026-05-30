# Config Optimization — Executable Action Plan

**Date:** 2026-05-30
**Supersedes the provisional figures in:** `.iago/research/2026-05-30-cc-config-optimization-audit.md`
**Status:** PARTIALLY APPLIED 2026-05-30 (branch `chore/cc-config-optimization`). Built from 7 verified audit tracks (critical-verify, mcp-cost, skills-audit, agents-audit, plugins-audit, hooks-audit, markdown-audit) reconciled against the prior audit.

## Applied 2026-05-30 (branch `chore/cc-config-optimization`)

Stress-gated repo-local batch — applied + committed:

- **P0-1** `unlinkSync` import restored in `context-persistence.mjs`; 430 stale session snapshots pruned (440→10).
- **P0-2** `/council` skill renamed `skill.md`→`SKILL.md`.
- **AG3** `profiles/e2e.md` model opus→sonnet.
- **AG4** `trust-boundary` wired into research/content/infra profiles (was wired into zero); false self-claim corrected.
- **AG5** new `profiles/general.md` no-capability fallback + fullstack fallback-role removed + routing repointed in `subagent-driven-development/SKILL.md`.
- **S3 + Lever 5** `available-skills.md`: dual-adversarial row added; 3 duplicated sections → pointers; stale agent counts reconciled in `CLAUDE.md` (14 capabilities / 13 profiles).
- **Lever 6** `execution-pipeline.md` bash-legacy narrative moved to the teardown research doc (operational lock-recovery facts kept in place).

**Deferred — repo-local but gated (need a verification step first):** Lever 2 (relocate path-scoped rules — Q4), Lever 7 (compress layer-triage/context-hygiene — Q5), AG2 (capability byte-divergence CI gate), Lever 4 (pin `model:` on execute-pipeline.js — low value, edits the live pipeline), H2/H3 (hook output-shape/matcher — verify hook spec first), S1/S2/S4 (skill doc-routing + deprecation + frontend-bug-bounty split).

**Deferred — §6-B, NEEDS SANTIAGO CONFIRM (global scope):** disable the Vercel plugin (PL1, ~2K tok/session + routing noise + greenfield hook), gate 4 non-core MCP servers (~5,880 tok), prune MEMORY.md, hooks H4/H5/H6 (async + graphify-nudge narrowing).

## Reconciliation vs the prior audit (what changed)

The prior audit flagged its two CRITICAL findings as "VERIFIED-but-unconfirmable" (Q11) and its headline token + MCP figures as PROVISIONAL (Q1, Q2). This plan resolves those:

| Prior-audit provisional claim | Now |
|---|---|
| unlinkSync bug "re-verify before fix" (Q11) | **VERIFIED** — confirmed at `context-persistence.mjs:8` (import) + `:83` (call). 440 stale snapshots measured in `.iago/state/sessions/`. |
| `STAGE_MODELS` map edit "at lines 25-36" (lever 5, Q11) | **REFUTED FRAMING** — no `STAGE_MODELS` symbol exists. Model is per-`agent()`-call inline `model:`. Only create-pr + tag-claude pinned (sonnet); 11 stages inherit harness default (opus). Severity drops Critical→Medium. |
| MCP schema "plausibly 15-40K tok, unmeasured" (Q1) | **MEASURED** — always-on stdio schema in an iago-os session ≈ **22,700+ tok**. The 4 gateable non-core servers = **~5,880 tok/session**. claude.ai connectors (Apollo+HF live now) ≈ **+4,200 tok**, UI-toggle only. |
| "~23K markdown always-loaded, byte÷4" (Q2) | **RE-MEASURED at byte÷3.5 = 26,262 tok markdown.** Recoverable ≈ 9,000–11,000 tok with zero/low information loss. |
| Path-scoped rules "verify loader honors globs" (lever 1, Q4) | **MEASURED** — `globs:` frontmatter is **inert** in this build; all 4 path-scoped files injected this session with no matching file open. Path-scoping is a no-op; relocation is the only fix. |
| Cache-hit reality (Q3) | **STILL OPEN.** Token savings below are token-count reductions; the $-value depends on cache state. Treated as upside, not load-bearing for the plan ordering. |

---

## 1. Executive Summary

- **Biggest levers (measured):** (1) gate 4 non-core MCP stdio servers out of global → **~5,880 tok/session** recovered in every project; (2) relocate the 4 inert path-scoped rules + skill-authoring out of `.claude/rules/` → **~4,200 tok/session, zero info loss**; (3) markdown dedup/trim (available-skills, execution-pipeline bash-legacy, MEMORY.md prune, layer-triage/context-hygiene compress) → **~7,500 tok/session**.
- **Total estimated token saving:** ~9,000–11,000 tok/session markdown + ~5,880 tok/session MCP file-gating + ~4,200 tok/session UI-toggled connectors ≈ **~19,000–21,000 tok/session always-loaded removed** in a typical iago-os coding session. $-value scales with cache-miss rate (Q3 open).
- **The one confirmed data-loss-class bug:** `context-persistence.mjs` calls `unlinkSync` without importing it → `ReferenceError` swallowed by an empty catch → session pruning has **never run since 2026-04-20**; `.iago/state/sessions/` has grown unbounded to **440 files**. One-line import fix + one-time backlog cleanup. Repo-local, safe to auto-apply.
- **Model routing:** no central map; pin `model:` explicitly on all 13 `agent()` calls (6 mechanical → sonnet, 7 judgment → opus) to match the sibling `dual-adversarial.js` convention. Modest $/run saving; primary value is removing implicit-default ambiguity. Repo-local.
- **One CRITICAL portability bug:** `/council` skill tracked as lowercase `skill.md` — silently undiscoverable on Sebas's Mac and Linux CI. `git mv` fix.

---

## 2. P0 — Verified Critical Fixes (verified=true only)

### P0-1 — unlinkSync missing from fs import (data-loss-class, repo-local) — VERIFIED

**File:** `C:/Users/sanal/dev/iago-os/.iago/hooks/context-persistence.mjs:8`
**Evidence:** import omits `unlinkSync`; `pruneSessions()` (L79-85) calls `unlinkSync(s.path)` at L83 inside an empty `catch{}`; runs at SessionStart (L90). `MAX_SESSIONS=10` (L19) never enforced. 440 `.json` files measured in `.iago/state/sessions/` (oldest 2026-04-20 == file mtime/bug-ship date). Sibling `usage-tracker.mjs:7` imports `unlinkSync` correctly — proves intended pattern.

**Exact edit (L8):**
```diff
-import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, existsSync, statSync } from "fs";
+import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, existsSync, statSync, unlinkSync } from "fs";
```

**One-time backlog cleanup** (after the import fix, keep 10 newest, delete the rest):
```powershell
Get-ChildItem "C:/Users/sanal/dev/iago-os/.iago/state/sessions/*.json" |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 |
  Remove-Item -Force
```

**Optional hardening (separate commit):** the empty catch at L83 hid this for the file's lifetime — log caught errors to stderr so a future missing-import regression is visible.

### P0-2 — `/council` skill filename is lowercase `skill.md` (portability, repo-local) — VERIFIED

**File:** `C:/Users/sanal/dev/iago-os/.claude/skills/council/skill.md`
**Evidence:** `git ls-files .claude/skills/council/` returns only `skill.md`; all 38 other skills tracked as `SKILL.md`. NTFS case-insensitivity masks it locally. `skill-authoring.md` warns case-sensitivity on Linux/Mac → `/council` silently fails to load on Sebas's Mac + GitHub Actions.

**Exact command (two-step to force the case change through git on a case-insensitive FS):**
```bash
cd C:/Users/sanal/dev/iago-os
git mv .claude/skills/council/skill.md .claude/skills/council/tmp.md
git mv .claude/skills/council/tmp.md .claude/skills/council/SKILL.md
git ls-files .claude/skills/council/   # expect: SKILL.md
```

> No other finding carries `verified=true AND severity=Critical`. The prior audit's "STAGE_MODELS Critical model-routing fix" is REFUTED as framed and demoted to a Medium token lever (see §3 lever 4 and §6-A).

---

## 3. Token Levers — Ranked by Measured Impact

Method: bytes ÷ 3.5 (markdown-audit calibration). MCP: ~120 tok/tool (mcp-cost calibration).

### Lever 1 — Gate 4 non-core MCP stdio servers out of global (~5,880 tok/session) — HIGH

**Action:** In `C:/Users/sanal/.claude.json`, DELETE from the **top-level** `mcpServers` object and ADD only to the `projects[path].mcpServers` blocks that use them — mirror the existing github/sentry/posthog pattern at lines 665-681.

| Server | Top-level lines | ~tools | Relocate to project block(s) |
|---|---|---|---|
| workspace-mcp | 1081-1098 | ~36 | iago-os, iago-content-engine, iago-workspaces |
| markitdown | 1042-1050 | ~1 | iago-os, iago-content-engine |
| scrapling | 1099-1106 | ~11 | iago-os (or dedicated leadgen project) |
| youtube-transcript | 1051-1059 | ~1 | iago-os |

**Pre-step:** `cp ~/.claude.json ~/.claude.json.bak` (already in allow-list).
**Saving:** ~5,880 tok/session in every project; frontend/client-only sessions (munet-web, sentria, din) then carry zero of these ~49 tools. **GLOBAL scope → §6-B.**
**Keep global (do NOT gate):** obsidian/graphify/mempalace/context7 (~5,760 tok justified — memory.md routing + hooks depend on them). github/sentry/posthog/supabase already correctly project-scoped — do NOT promote to global (would add ~3,600 tok everywhere).

### Lever 2 — Relocate 4 inert path-scoped rules + skill-authoring out of `.claude/rules/` (~4,200 tok/session, zero info loss) — CRITICAL (structural)

**Evidence:** `globs:` frontmatter is inert in this build — react-vite.md, aws-amplify.md, e2e-testing.md, mcp-server-patterns.md all injected this session with no matching file open. No loader/hook/settings reads `globs:`.

**Action:** Move out of `.claude/rules/` into a non-auto-loaded dir (`.claude/rules/patterns/` per CLAUDE.md doc-routing for domain-skill refs, or `.claude/docs/`). Reference on-demand from the matching skills / explicit Read.

| File | tok | Move to |
|---|---|---|
| aws-amplify.md | 1,000 | `.claude/rules/patterns/` (or docs), Read on amplify/** work |
| react-vite.md | 726 | same, Read on src/** work |
| e2e-testing.md | 598 | same, Read on test work |
| mcp-server-patterns.md | 542 | same, Read on mcp/ work |
| skill-authoring.md | 1,353 | `.claude/skills/meta/` — consulted only when authoring skills |

**Total recovered ≈ 4,219 tok/session.** Repo-local → §6-A.
**Q4 correctness gate (carry-forward, MUST verify before relocating):** confirm the pipeline implement/fix subagent prompts inject the matching rule for files they edit. If they do NOT, these files are load-bearing for coding-standard enforcement (no-any, named-exports, ShadCN-verify, data-testid) and relocation strips standards from the exact agents that need them. Resolve Q4 first; otherwise wire an explicit Read of the matching pattern file into the implement/fix prompt.

### Lever 3 — Prune MEMORY.md superseded entries (~2,000–2,500 tok/session) — HIGH

**Evidence:** 16,507 B ≈ 4,716 tok, ~70 flat pointers, several explicitly superseded (v2 council overrides, Codex pipeline no-op vs Codex-on-Windows, 2026-04-27 pipeline-bug entries the Workflow rebuild obsoletes). Loads in full every session incl. `claude -p` subagents.
**Action:** Collapse superseded entries into an archive note; keep only live preferences/state (target ≤30 active). **GLOBAL scope (`~/.claude/projects/.../memory/`) → §6-B.**

### Lever 4 — Pin `model:` on all 13 pipeline `agent()` calls (~6 stages opus→sonnet) — MEDIUM

**File:** `C:/Users/sanal/dev/iago-os/.claude/workflows/execute-pipeline.js`
**Evidence:** no `STAGE_MODELS` map. Only create-pr (L650) + tag-claude (L668) pinned sonnet; 11 stages inherit opus implicitly. Sibling `dual-adversarial.js` pins `model:'opus'` explicitly (L170,176) — codebase convention is to pin.
**Action (decision: pin EVERY call for clarity):**
- → `model:'sonnet'` (mechanical): lock-acquire (L497-500 options obj), commit (L575), build:{attempt} (L562), rebuild:{rounds} (L612), summary (L681-685), lock-release (L692).
- → `model:'opus'` (judgment, pin explicitly): stress (L512), prep (L526), implement (L540), fix:{rounds} (L602), review (L430), codex (L440).
**Saving:** modest $/run (mechanical stages are short-output: lock×2 + commit + build + summary); primary value = removing implicit-default ambiguity across 11 stages. Repo-local → §6-A.

### Lever 5 — Dedup available-skills.md against CLAUDE.md + execution-pipeline.md (~600–900 tok/session) — HIGH

**Evidence:** available-skills.md = 3,746 tok (2nd-largest rule). L191-206 "Agent Architecture" restates CLAUDE.md Agents+Model-Routing; L66-79 "Pipeline Stages" + L35-58 "Delivery Pipeline" restate execution-pipeline.md stage breakdown — paid ~3x/session.
**Action:** Cut Agent-Architecture block + Pipeline-Stages table + Delivery-Pipeline diagram; replace with one-line pointers. Keep the "All Skills" catalog tables (unique value). Repo-local → §6-A.

### Lever 6 — Move execution-pipeline.md bash-legacy narrative to research (~1,500–2,000 tok/session) — HIGH

**Evidence:** execution-pipeline.md = 4,264 tok (largest always-loaded file); Legacy-bash-fallback + teardown rationale + Robustness-vs-bash are transitional one-cycle narrative.
**Action:** Move those sections to the already-cited `.iago/research/2026-05-28-execute-pipeline-teardown.md`. Keep only the enforceable rule (skill-invocation-required, violation detection, severity handling, never-merge). Repo-local → §6-A.

### Lever 7 — Compress layer-triage.md + context-hygiene.md (~2,500–2,800 tok/session) — MEDIUM

**Evidence:** layer-triage.md 1,755 tok (most is illustrative tables/examples); context-hygiene.md 1,488 tok (taxonomy + 6 probes + 3 worked examples). Both reference-grade essays paid every session + every subagent.
**Action:** Keep layer-triage's 3-step diagnostic + move-to table; keep context-hygiene's mode→bucket table + 6 probes. Move worked examples, ICM citations, v2-daemon application tables to `.iago/research/` and link.
**Q5 gate (carry-forward):** verify no automated compaction path (`claude -p` stages, CI, `context-persistence.mjs` summaries) depends on the 6-probe eval before relocating it. Resolve Q5 first. Repo-local → §6-A.

### Lever 8 — Dedup global CLAUDE.md / obsidian.md Obsidian routing (~300–400 tok/session) — LOW

**Evidence:** global CLAUDE.md "Obsidian/Retrieval-Routing" overlaps obsidian.md "Context-Loading/Routing" + repo memory.md routing table; all three auto-load.
**Action:** Keep routing table in one place, reduce others to a pointer. **GLOBAL scope → §6-B.** Low priority.

**Subagent payload (Q9, carry-forward):** per-dispatch base+capability+profile composition is still unquantified and multiplies ×8+ dispatches/plan. Not actioned here — flagged for a follow-up measurement before the budget invariant (prior-audit structural rec 1/7) is set.

---

## 4. Skills / Agents / Plugins Redundancy

| # | Action | Rationale | Scope |
|---|---|---|---|
| S1 | **Redirect doc-routing offenders:** brainstorming → `.iago/research/{date}-{slug}.md`; writing-plans → `.iago/plans/feature-{slug}/01-{name}.md`; santa-method → `.iago/research/{date}-{slug}-santa.md`. Update cross-skill suggestion strings. | brainstorming/SKILL.md:55,83 / writing-plans:61 / santa-method:85 write to `docs/specs`, `docs/plans`, `docs/analysis` — violates CLAUDE.md routing; `docs/plans` + `docs/analysis` aren't in the table. Re-creates the dumping ground PR #79 collapsed. (HIGH) | repo-local → §6-A |
| S2 | **Deprecate writing-plans** (recommended option a): iago-plan --feature subsumes it with stress-test + pipeline. Keep subagent-driven-development as the explicit no-pipeline executor. | 4-skill ambiguity (iago-plan/writing-plans × iago-execute/subagent-driven-development) the router disambiguates only on "pipeline?". subagent-driven-development already has `--pipeline`. (MEDIUM) | repo-local → §6-A |
| S3 | **Add dual-adversarial row** to available-skills.md Codex/Audit section: `/dual-adversarial — final pre-merge Opus∥Codex gate over a PR/branch diff (read-only)`. | Live skill (4119 B), referenced as Workflow gate in CLAUDE.md/execution-pipeline.md, but 0 hits in available-skills.md → un-routable by name. Closes catalog/disk parity (38 vs 39). (MEDIUM) | repo-local → §6-A |
| S4 | **Split frontend-bug-bounty into references/:** react-hooks.md, tailwind-vite.md, section-q-data-correctness.md; keep SKILL.md as orient + module-index (~120 lines). | 499 lines / 50KB — 2.6× the next-largest; skill-authoring.md mandates references/ split >150 lines. The one genuine candidate. Do NOT split amplify-bug-bounty (238) or 230-263-line skills — under threshold, read linearly. (MEDIUM) | repo-local → §6-A |
| S5 | **No action now** on 5 experimental skills (agent-payment-x402, autonomous-loops, continuous-agent-loop, liquid-glass-design, santa-method). Mark autonomous-loops + continuous-agent-loop for re-eval at v2 daemon cutover (behavior moves to rule-based/deterministic layer per layer-triage.md). | All catalog-referenced, none dead. Premature deletion risk. (LOW) | repo-local (deferred) |

**Model re-routing (agents):** prior-audit lever 6 (demote profiles/debug.md opus→sonnet now; gate profiles/e2e.md behind a real flaky-render validation run) was NOT re-tested by these 5 tracks — carry forward as-is. **GLOBAL/profile scope, plus correctness risk on e2e → §6-B.**

**Non-collision confirmed (no action):** iago-fast/iago-quick/iago-plan triad anti-triggers tile the space cleanly (files≤3+obvious / 1-3 tasks / 4+ tasks). council vs santa-method and deep-research vs brainstorming likewise. Prior "routing collision" hypotheses refuted.

---

## 5. Hooks Consolidation

| # | Action | Rationale | Scope |
|---|---|---|---|
| H1 | **(= P0-1)** Fix unlinkSync import + 440-file backlog cleanup. | Session pruning silently dead since 2026-04-20. (CRITICAL) | repo-local → §6-A |
| H2 | **Fix hookSpecificOutput shape** in 4 repo hooks: emit `{hookSpecificOutput:{hookEventName,additionalContext}}` not `{hookSpecificOutput:"text"}`. Sites: context-persistence.mjs (L128/152/158/199), commit-quality.mjs (L144), post-edit-console-warn.mjs (L40), post-edit-typecheck.mjs (L74). | Plain-string form likely silently dropped — resume context, snapshot summary, tsc/console warnings never reach the model. Global graphify/precompact hooks use the correct object shape (settings.json:9,19). **Verify exact per-event shape against current Claude Code hook spec before editing.** (MEDIUM) | repo-local → §6-A |
| H3 | **Broaden post-edit PostToolUse matcher** `Edit` → `Edit|Write|MultiEdit` (repo settings.json:57). | Files created via Write/MultiEdit bypass format/typecheck/console-warn. Hooks already guard on existsSync+extension, so widening is safe. (LOW) | repo-local → §6-A |
| H4 | **Add `async:true` to blocking mempalace Stop hook** (settings.local.json:25-29) — matches settings.json:31,37 pattern. Then de-dup: decide session-diary.py OR mempalace.cli owns the diary write, remove the other. | Two diary writers run every Stop; mempalace one blocks exit up to 30s in EVERY project. **CONFIRM with Santiago which writer is canonical (same wing/collision check) before deleting either.** (HIGH) | GLOBAL → §6-B |
| H5 | **Add `async:true` to blocking mempalace PreCompact hook** (settings.local.json:37-41). Assess whether global echo "SESSION DIGEST REQUIRED" (settings.json:14-22) is redundant given context-persistence.mjs already snapshots on PreCompact; if so drop the echo. | mempalace PreCompact blocks compaction up to 30s every project. (HIGH) | GLOBAL → §6-B |
| H6 | **Narrow graphify PreToolUse matcher** `Glob\|Grep\|mcp__obsidian__search_notes` → `mcp__obsidian__search_notes` only (settings.json:5) — or delete (guidance already in CLAUDE.md). | Re-injects the same ~50-word paragraph on every code-repo Grep/Glob (confirmed live this session) where graph-over-vault is irrelevant noise. Recommended: narrow to obsidian-search. (MEDIUM) | GLOBAL → §6-B |
| H7 | **No action** — safety-guard.mjs double-registration (Bash chain + Edit chain) is by design (disjoint matchers, internal tool_name branch). Optional cosmetic single-block collapse. | Not a duplicate firing. (LOW) | repo-local (none) |

---

## 6. Apply Plan

### A) SAFE TO AUTO-APPLY — repo-local + reversible (ride `/iago-fast` or `/iago-quick`)

> All items below touch only `C:/Users/sanal/dev/iago-os/` and are git-reversible. Group by reversibility/size.

**Batch A1 — `/iago-fast` (trivial, ≤3 files each, obvious):**
- P0-1: add `unlinkSync` to context-persistence.mjs:8 import (+ backlog cleanup command).
- P0-2: `git mv` council/skill.md → SKILL.md.
- H3: broaden post-edit matcher to `Edit|Write|MultiEdit` (settings.json:57).
- S3: add dual-adversarial row to available-skills.md.

**Batch A2 — `/iago-quick` (multi-file, still reversible):**
- AG3: flip `profiles/e2e.md:7` `model: opus` → `model: sonnet` (E2E authoring is mechanical pattern-application; Sonnet-safe, low blast radius). Leave debug.md opus (CLAUDE.md sanctions it).
- AG5: add `profiles/general.md` (base executor, model sonnet, `capabilities: []`) + remove the "also the FALLBACK" sentence at `fullstack.md:25`; repoint unmatched-task routing to `general` — stops the 16.9K-byte React+Dynamo+Lambda+Framer payload loading on doc/script/config edits (~4–4.8K tok/unmatched dispatch).
- AG4: wire `trust-boundary` into the 3 operator profiles — `research.md:9` (add to dynamic selection: ALWAYS inject trust-boundary), `content.md:9` → `[content, trust-boundary]`, `infra.md:9` → `[infra, trust-boundary]`; fix the "loads automatically" self-claim at `trust-boundary.md:73-78` to "load explicitly in operator profiles." Security gap fix (adds ~1.07K tok/operator dispatch — justified).
- Lever 4: pin `model:` on all 13 execute-pipeline.js agent() calls.
- Lever 5: dedup available-skills.md (Agent-Arch + Pipeline-Stages + Delivery-Pipeline) → pointers.
- Lever 6: move execution-pipeline.md bash-legacy → `.iago/research/2026-05-28-execute-pipeline-teardown.md`.
- H2: fix hookSpecificOutput object shape across 4 repo hooks (verify spec first).
- S1: redirect brainstorming/writing-plans/santa-method doc-routing paths.
- S3/S4: add dual-adversarial row (if not in A1) + split frontend-bug-bounty into references/.

**Batch A3 — `/iago-quick`, gated on a carry-forward verification (do NOT apply blind):**
- Lever 2: relocate 4 path-scoped rules + skill-authoring — **GATE: resolve Q4** (confirm implement/fix subagents inject matching rules, else wire explicit Read into the prompt).
- Lever 7: compress layer-triage + context-hygiene — **GATE: resolve Q5** (confirm no compaction path depends on the 6-probe eval).
- S2: deprecate writing-plans — decision item; mechanically reversible but a workflow change, batch as its own `/iago-quick`.
- AG2: add a byte-divergence CI gate (Node, Windows-safe) asserting each of the 5 capability files (react-19, tdd, e2e, lambda, cognito) is a normalized-whitespace superset of its `rules/` counterpart section — react-19 + tdd already drifted (rules are richer). **GATE: same Q4 dependency as Lever 2** (if implement/fix subagents load the capability not the rule, the drift is already under-informing agents). Prefer the CI check (Option A, 0 tok) over collapsing the bodies (Option B needs the composer to inline the rule section first).

### B) NEEDS SANTIAGO CONFIRM — global `C:/Users/sanal/.claude` scope or irreversible

> Every finding touching global config, the claude.ai connector UI, or a data-bearing deletion lives here. None ride a skill until Santiago confirms.

| Item | What | Why it needs confirm |
|---|---|---|
| Lever 1 | Edit top-level `mcpServers` in `~/.claude.json` (move 4 servers to per-project). | GLOBAL — affects every project on the machine. Back up `~/.claude.json` first. |
| MCP connectors | `/mcp` (or claude.ai connectors UI) toggle OFF Apollo, HuggingFace, Figma, Stripe, Gamma, Supabase, Drive/Gmail/Calendar when idle (~4,200+ tok; Apollo+HF live now). | claude.ai-managed, NOT in `~/.claude.json` — manual UI toggle, re-enable on demand. Per-session judgment. |
| Lever 3 | Prune MEMORY.md superseded entries → archive note. | GLOBAL (`~/.claude/projects/.../memory/`) — affects every iago-os session + every subagent. Frozen-snapshot rule makes it safe but it's user-owned memory. |
| Lever 8 | Dedup global CLAUDE.md / obsidian.md Obsidian routing. | GLOBAL `~/.claude/` — applies to every project. Low priority. |
| H4 | `async:true` on mempalace Stop hook + delete one of two diary writers. | GLOBAL settings.local.json; **deleting a diary writer is data-bearing — confirm same-wing/collision and which is canonical first.** |
| H5 | `async:true` on mempalace PreCompact hook + possibly drop global echo nudge. | GLOBAL settings — affects every project's compaction. |
| H6 | Narrow/delete graphify PreToolUse nudge. | GLOBAL `~/.claude/settings.json` — cross-project blast radius. |
| Agents | Demote profiles/debug.md opus→sonnet now; gate profiles/e2e.md behind a flaky-render validation run. | Profile/model change + correctness risk on e2e (carried from prior audit, not re-tested this round). |
| PL1 | **Disable/uninstall `vercel-plugin@vercel`** (user-scoped). Backup `installed_plugins.json` + `known_marketplaces.json` first, then `claude plugin disable vercel-plugin@vercel` (or `uninstall` + `marketplace remove vercel`); verify `claude plugin list` no longer shows it and `codex@openai-codex` SURVIVES. | GLOBAL (user-scoped, every project incl. clients). ~2,017 tok/session of off-stack catalog text + 25 routing-collision skills + 4 unowned hooks (incl. a greenfield-mode context injector that contradicts iaGO planning discipline). NOTE: `enabledPlugins` is NOT in `.claude.json` on this version — state lives in the two plugin registries; disable via CLI, not a `.claude.json` key edit. Do NOT touch the `openai-codex` marketplace (pipeline hard-depends on its `codex-companion.mjs`). |

---

## 7. Agents — deep dive (gap-fill re-run)

Re-run of the §4 "subagent payload (Q9)" carry-forward against `.claude/agents/` (3 bases, 14 capabilities, 12 profiles). Confirmed: no code-level composer — composition is the orchestrator concatenating the YAML `capabilities:` list into the dispatch prompt; `loadAgentConfig` (`runtime/daemon/main.ts:425`) is the v2 daemon JSON reader, unrelated. So per-dispatch payload = literal sum of base + every listed capability file. 4 High, 1 Medium.

| # | Action | Rationale | Scope | Est saving |
|---|---|---|---|---|
| AG1 | **No edit — baseline metric.** Heaviest profile fullstack composes executor + 6 caps = 16,932 B ≈ **~4,838 tok/dispatch** (VERIFIED via `wc -c`); ×3+ executor stages/plan (implement + ≤2 fix rounds) ≈ 14.5K tok/plan, 70K+/phase. The saving comes from AG2+AG5 reducing this baseline. | Quantifies Q9: the per-dispatch capability boilerplate the other agent fixes cut against. (High, VERIFIED) | repo-local | baseline metric (AG2+AG5 cut it ~30–45%) |
| AG2 | **Add byte-divergence CI gate** for the 5 capability files that are stale-prone byte-copies of `rules/` (react-19↔react-vite, tdd↔tdd, e2e↔e2e-testing, lambda↔aws-amplify, cognito↔aws-amplify). Each opens with a hand-written `<!-- Sync with -->` comment but no generator/CI enforces it. **react-19 + tdd already drifted — rules are richer (capability omits ShadCN-verify/Vite-env + Test-Runner/E2E + 3 rationalization rows), so agents loading the capability already miss standards the main session enforces.** Option A (CI check) = 0 tok, recommended; Option B (collapse to header+delta) ≈ 1.5K tok off any loading profile but needs the composer to inline the rule section first. | Silent drift: edits to the declared source-of-truth (`rules/`) never propagate to the capability the implement agent actually loads. (High, VERIFIED) | repo-local → §6-A3 (gated on Q4) | Option A = 0 (correctness); Option B ≈ 1.5K tok/loading-profile |
| AG3 | **Flip `profiles/e2e.md:7` `model: opus` → `sonnet`.** E2E authoring is mechanical pattern-application (selector priority, `expect` auto-retry, POM — all in the e2e capability), not the high-judgment code-writing Opus is reserved for; low blast radius (tests). Leave debug.md opus (CLAUDE.md explicitly lists debug under Opus; only safe to Sonnet-split for tsc/biome/lint, NOT race/data-loss/auth bugs). security-audit/frontend/backend/fullstack opus pins are correct. | CLAUDE.md Model Routing reserves Opus for orchestrator + code-writing; e2e is mechanical. (Medium, VERIFIED) | repo-local → §6-A2 | cost cut (Sonnet ≈ 1/5 Opus input), no quality risk |
| AG4 | **Wire `trust-boundary` into the 3 operator profiles** (research, content, infra). Grep `trust-boundary` across `.claude/agents/` = **zero matches** — the 3,758-B prompt-injection / secret-redaction / stay-in-domain hardening is committed but reaches NO agent. Its self-claim "loads automatically into the operator base" (`trust-boundary.md:73-78`) has no enforcing mechanism. The operator base (research/content/infra) is exactly the set with WebFetch/WebSearch — fetches untrusted external content with zero defense. Add to `research.md:9` (dynamic-selection: ALWAYS inject), `content.md:9`→`[content, trust-boundary]`, `infra.md:9`→`[infra, trust-boundary]`; fix the self-claim to "load explicitly in operator profiles." | Live security gap: external-content-fetching agents run undefended. (High, VERIFIED) | repo-local → §6-A2 | **negative** — adds ~1,075 tok/operator dispatch; justified (security, not bloat) |
| AG5 | **Add a no-capability fallback profile + repoint fallback.** `fullstack.md:25` declares fullstack the universal fallback "when no other profile matches," and its `capabilities:` statically force-loads react-19+dynamodb+lambda+tdd+forms+animation (no conditional loading). Any unmatched task (doc/`.sh`/config/runtime-TS/non-React util) dispatches with the full 16.9K-B React+Dynamo+Lambda+Framer payload — animation (3,912 B) + dynamodb (4,019 B) are pure dead weight. Create `profiles/general.md` (base executor, model sonnet, `capabilities: []`); remove the FALLBACK sentence at `fullstack.md:25`; route unmatched → general, escalate to fullstack only on a real full-stack match. | Largest recoverable saving in the agents tree; force-loading 6 stack caps on doc/script edits. (High, VERIFIED) | repo-local → §6-A2 | ~4.0–4.8K tok/unmatched dispatch (16.9K B → ~2.2K B) |

## 8. Plugins (gap-fill re-run)

Audit of enabled plugins (user-scoped) against stack fit + injection cost + disable path. State lives in `~/.claude/plugins/installed_plugins.json` + `known_marketplaces.json` — **NOT** an `enabledPlugins` key in `.claude.json` (VERIFIED absent on this version). 4 Important, 1 Minor (keep-confirmation). Verdict: disable vercel (GLOBAL), keep codex.

| # | Action | Rationale | Scope | Est saving |
|---|---|---|---|---|
| PL1 | **Disable/uninstall `vercel-plugin@vercel`** (user-scoped, v0.40.1, installed 2026-05-05). Adds ~25 off-stack skills + 3 agents + 5 commands to every session's routing catalog. Stack is AWS Amplify Gen 2 + Vite (NOT Next.js); CLAUDE.md bans raw CF/CDK/SAM/Serverless and mandates Amplify — zero usage fit. The vercel `shadcn`/`workflow`/`auth`/`bootstrap` skill names collide with iaGO concepts (routing-confusion risk). | Pure dead weight on every session; ~25 high-collision skills the orchestrator must consider and reject. (Important, VERIFIED) | GLOBAL → §6-B (PL1) | **~2,017 tok/session** of always-loaded catalog description text (7,059 chars ÷ 3.5) + unquantified routing-dilution |
| PL2 | **(folded into PL1 disable)** Vercel ships 3 SessionStart hooks (`startup\|resume\|clear\|compact`) + 1 SessionEnd hook that spawn node every lifecycle event. `inject-claude-md.mjs` injects a `GREENFIELD_CONTEXT` block telling the agent to skip planning and scaffold with `--yes` when greenfield-detected — directly contradicts iaGO planning discipline ("NEVER implement plan/spec/task by editing code directly"). Fires on `compact` too (mid-long-session). | Unowned context-injection vector + 3 uncompensated node spawns per session lifecycle event. (Important, VERIFIED) | GLOBAL → §6-B (PL1) | small per-event (greenfield-gated); removes 3 node spawns + the planning-discipline-violating injector |
| PL3 | **(folded into PL1 disable)** The ~25 irrelevant Vercel skills dilute skill-selection routing on every iaGO session — the project ships a rubric-based skill-selection eval discipline (`skill-authoring.md` §2) precisely because overlapping skills degrade routing. Generic names (`auth`, `bootstrap`, `verification`, `env-vars`, `routing-middleware`) are high-collision on common intents. | Routing-accuracy harm (larger but unquantifiable than the token cost). (Important, VERIFIED catalog membership / inferred dilution) | GLOBAL → §6-B (PL1) | subsumed in PL1's ~2,017 tok |
| PL4 | **EXACT disable path (with backup, do in order):** (1) `copy installed_plugins.json{,.bak}` + `copy known_marketplaces.json{,.bak}`; (2) `claude plugin disable vercel-plugin@vercel` (or full removal: `claude plugin uninstall vercel-plugin@vercel` + `claude plugin marketplace remove vercel`); (3) verify `claude plugin list` drops vercel and KEEPS `codex@openai-codex`; (4) manual fallback only if CLI unavailable — delete the two registry entries + restart (not while a session is live). Do NOT hand-delete `cache/vercel/...` without removing the registry entries (orphaned pointer errors on startup). | `enabledPlugins` is NOT in `.claude.json` on this version — prefer the CLI so both registries + cache stay in sync. (Important, VERIFIED config mechanics / inferred CLI surface) | GLOBAL → §6-B (PL1) | remediation, not a defect |
| PL5 | **KEEP `codex@openai-codex` — no change.** Hard dependency of the pipeline: `execute-pipeline.js:272-276` + `dual-adversarial.js:117-118` resolve and run its `codex-companion.mjs` as the cross-model leg. Footprint is small (3 skills + 1 agent + 7 commands ≈ 295 tok, one-seventh of vercel). Disabling vercel must NOT touch the `openai-codex` marketplace. | Intentional, load-bearing cost; CLAUDE.md + MEMORY name Codex GPT-5.5 the standard cross-model reviewer. (Minor, VERIFIED) | GLOBAL → §6-B (keep) | 0 (intentional) |

## Open carry-forwards (must resolve before the gated items)

- **Q3 (cache-hit reality):** unresolved. Token savings above are token-count reductions; the $-value is ~10× higher if the prefix is cache-miss, ~10× lower if cached. Does not change the plan ordering (token-count reduction is good either way) but is required before any $-claim.
- **Q4:** gates Lever 2 (path-scoped relocation).
- **Q5:** gates Lever 7 (context-hygiene probe relocation).
- **Q9:** subagent per-dispatch payload still unquantified — measure before setting a budget invariant.
