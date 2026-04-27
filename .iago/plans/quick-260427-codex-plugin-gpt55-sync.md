---
phase: quick
plan: quick-260427-codex-plugin-gpt55-sync
wave: 1
depends_on: []
created: 2026-04-27
branch: chore/codex-plugin-gpt55-sync
base: main
---

# Quick: Sync codex-plugin-cc to v1.0.4 + pin GPT-5.5

## Goal

Bring iago-os's Codex bridge current with upstream and the new GPT-5.5
release. Three deliverables:

1. **Plugin upgrade** — `openai-codex` marketplace from v1.0.2 → **v1.0.4**.
2. **Model pin** — create `~/.codex/config.toml` with `model = "gpt-5.5"`
   so every `/codex:*` invocation (including the pipeline adversarial
   step) uses GPT-5.5 instead of whatever Codex CLI's rolling default is.
3. **Documentation truth** — fix the stale "GPT-5.4" strings in
   `scripts/execute-pipeline.sh` and `CLAUDE.md` so logs and routing
   notes reflect the actual model.

Out of scope: no behavioral changes to the pipeline itself, no new
flags, no fallback model logic. If GPT-5.5 isn't available on this
account, Codex CLI errors and the pipeline already falls through to
Claude adversarial — that path is intentional and unchanged.

## Context

**Upstream state.** `openai/codex-plugin-cc` is at v1.0.4 (released
2026-04-18). Local install at
`~/.claude/plugins/marketplaces/openai-codex/.claude-plugin/marketplace.json`
reports v1.0.2. v1.0.3 added Windows/Git-Bash SHELL handling and
prevented embedding of large adversarial-review diffs; v1.0.4 fixed
`--cwd`, removed the broken `xhigh` effort reference, and routed
`/codex:rescue` through the Agent tool. All four are relevant on this
machine.

**Model state.** Codex CLI 0.118.0 is installed (`/c/Users/sanal/bin/codex`).
No `~/.codex/config.toml` exists, so Codex falls back to its baked-in
default. GPT-5.5 shipped 2026-04-23 and OpenAI's docs say "start with
gpt-5.5" — but only ChatGPT-subscription auth has access during rollout
(API-key auth still 5.4).

**Pipeline state.** `scripts/execute-pipeline.sh:586` calls
`node "$CODEX_COMPANION" adversarial-review --base "$PRE_IMPL_SHA" --wait`
with no `--model` flag. The companion at line 100
(`normalizeRequestedModel`) passes `null` through unchanged, so the
runtime model is whatever Codex CLI resolves on this machine. The log
string "GPT-5.4" at lines 585 and 589 is hardcoded text, not a flag.

**Why pin in `config.toml` instead of `--model`.** Single source of
truth: every `/codex:*` skill picks it up automatically. A flag at
line 586 only affects the pipeline; `/codex:rescue`, `/codex:review`,
manual `codex exec` calls would all stay on the rolling default.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| reinstall | `~/.claude/plugins/marketplaces/openai-codex/` | Upgrade marketplace v1.0.2 → v1.0.4 (out-of-tree, executed via `/plugin` commands) |
| create | `~/.codex/config.toml` | Pin `model = "gpt-5.5"`, set `model_reasoning_effort = "high"` for adversarial work (out-of-tree) |
| modify | `scripts/execute-pipeline.sh` | Replace stale "(GPT-5.4)" log strings at lines 585 and 589 |
| modify | `CLAUDE.md` | Update line 197 "Codex (GPT-5.4)" → "Codex (GPT-5.5, configured via `~/.codex/config.toml`)" |

Two of four changes are outside the repo (`~/.claude/`, `~/.codex/`).
Only the in-repo edits land in the PR — the plugin upgrade and config
file are operator steps documented in Task 1 below.

## Tasks

### Task 1: Plugin upgrade + Codex config (operator steps, no commit)

Order matters: smoke-test auth FIRST (before any config or upgrade
side-effects). Stress-test finding #1 — creating `config.toml` with an
unsupported model would silently break Codex on every other project on
this machine until the file is removed.

- **action:**
  1. Confirm current state of installed plugin:
     `cat ~/.claude/plugins/marketplaces/openai-codex/.claude-plugin/marketplace.json`
     — expected `"version": "1.0.2"` for both the marketplace `metadata.version` and the `plugins[0].version`.
  2. **Codex CLI binary upgrade (added during execution 2026-04-27):**
     The original plan assumed Codex CLI 0.118.0 supported GPT-5.5. It
     does not — the API returns `"The 'gpt-5.5' model requires a newer
     version of Codex"`. Upgrade required:
     `npm install -g @openai/codex@latest`
     Verify: `codex --version` → expect `0.125.0` or newer.
     Rollback if needed: `npm install -g @openai/codex@0.118.0`.
     **STATUS:** ✅ Completed 2026-04-27. Codex CLI is now 0.125.0.
  3. **Auth + model smoke test BEFORE creating config.toml:**
     `codex exec --skip-git-repo-check --model gpt-5.5 "Reply with the model name you are running."`
     - **PASS:** response references `gpt-5` (model self-reports as "GPT-5", not "GPT-5.5"; a successful response with `--model gpt-5.5` accepted is the real signal) → proceed.
     - **FAIL with "model not available" or auth error:** STOP. Do not
       create `config.toml`. Do not proceed to plugin upgrade. Escalate
       to Santiago — likely API-key auth and we need to switch to
       ChatGPT sign-in or pin to `gpt-5.4` instead.
     **STATUS:** ✅ Completed 2026-04-27. Smoke test passed with Codex CLI 0.125.0. Auth: ChatGPT sign-in (working).
  4. Upgrade plugin via Claude Code's `/plugin` interface (USER MUST TYPE THESE — they are interactive slash commands, not shell commands):
     - `/plugin marketplace remove openai-codex`
     - `/plugin marketplace add openai/codex-plugin-cc`  *(see version-pin note below)*
     - `/plugin install codex@openai-codex`
     - `/reload-plugins`
  5. **Version-pin verification (stress-test finding #2):**
     `cat ~/.claude/plugins/marketplaces/openai-codex/.claude-plugin/marketplace.json`
     — both `metadata.version` and `plugins[0].version` MUST be exactly `1.0.4`.
     - If version is `1.0.4` → proceed.
     - If version is newer (e.g., `1.0.5`) → STOP. We have not validated newer
       versions. Either (a) revert via the rollback procedure in Risk and pin
       this plan to the new version after re-research, or (b) accept the
       newer version explicitly with a note in the PR body.
     - If version is still `1.0.2` → reinstall failed; check `/plugin marketplace add`
       output and Claude Code logs.
  6. Verify the stable companion path still resolves after upgrade:
     `[[ -f "$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs" ]] && echo OK`
     — the pipeline at line 563 depends on this exact path. If missing,
     the pipeline silently falls through to raw `codex review` (line 589)
     or Claude adversarial (line 596). Required: prints `OK`.
  7. Create `~/.codex/config.toml` (only if it does NOT already exist):
     ```toml
     model = "gpt-5.5"
     model_reasoning_effort = "high"
     ```
     - If the file already exists with other keys, do NOT overwrite — open it,
       add `model = "gpt-5.5"` and `model_reasoning_effort = "high"` while
       preserving existing keys, and back up the original to
       `~/.codex/config.toml.bak-260427`.
  8. Final smoke test (now exercising config-file resolution, no `--model` flag):
     `codex exec --skip-git-repo-check "Reply with the model name you are running."`
     — response should still reference `gpt-5.5`. This confirms config.toml is being read.
- **verification:**
  - Step 3 smoke test passed (with `--model gpt-5.5` flag).
  - `marketplace.json` reports exactly `1.0.4` for both entries (step 5).
  - Stable companion path exists (step 6).
  - `~/.codex/config.toml` exists and contains `model = "gpt-5.5"` (step 7).
  - Step 8 smoke test passed (without `--model` flag, exercising config).

### Task 2: Update pipeline log strings

- **files:** `scripts/execute-pipeline.sh`
- **action:**
  1. Line 585: change
     `log "Running codex-companion adversarial-review (GPT-5.4)"`
     to
     `log "Running codex-companion adversarial-review (model from ~/.codex/config.toml)"`
  2. Line 589: change
     `log "Running codex review (GPT-5.4) — companion plugin not found, using raw CLI"`
     to
     `log "Running codex review (model from ~/.codex/config.toml) — companion plugin not found, using raw CLI"`
- **rationale:** The pipeline does not pass `--model`. Hardcoding any
  model name in the log is a lie that drifts with each Codex release.
  Pointing at the config file is accurate and self-documenting.
- **verification:** `grep -n "GPT-5.4" scripts/execute-pipeline.sh` returns nothing.

### Task 3: Update CLAUDE.md model routing

- **files:** `CLAUDE.md`
- **action:**
  1. Find the line (currently around line 197) that begins with
     `- **Codex (GPT-5.4):**` and replace it with:
     `- **Codex (GPT-5.5):** Cross-model adversarial review, \`/codex:rescue\` — model pinned in \`~/.codex/config.toml\` (each operator must create their own; no machine-level default in repo)`
     Match by string content, not line number — line numbers may drift
     if other CLAUDE.md edits have landed since the plan was written.
- **verification:** `grep -n "GPT-5" CLAUDE.md` returns exactly one line, the new one.

## Acceptance Criteria

- `~/.claude/plugins/marketplaces/openai-codex/.claude-plugin/marketplace.json` reports `"version": "1.0.4"` for both marketplace and plugin entries.
- `~/.codex/config.toml` exists with at minimum `model = "gpt-5.5"`.
- `codex exec` smoke test responds successfully (or auth blocker is escalated).
- `grep -rn "GPT-5.4" scripts/ CLAUDE.md` returns zero matches.
- `scripts/execute-pipeline.sh` and `CLAUDE.md` both reference `~/.codex/config.toml` as the source of truth for the Codex model.
- No behavioral change to pipeline flow — same fallback to Claude adversarial when Codex is unavailable.

## Risk

- **Auth gap:** GPT-5.5 is ChatGPT-sign-in only during rollout. If
  Santiago's Codex is API-key-authed, the smoke test in Task 1 step 2
  fails BEFORE any config or plugin changes. Plan stops cleanly.
- **Plugin breaking change:** v1.0.4 routed `/codex:rescue` through
  Agent tool. Possible regression risk on rescue invocations. Mitigation:
  the pipeline does not call `/codex:rescue`; it calls the companion
  directly. Rescue is a manual operator skill — any regression is
  caught on first manual use, not in CI.
- **Config drift:** Adding `~/.codex/config.toml` changes the default
  for every project on this machine, not just iago-os. Acceptable
  because it's the user's account-level default and matches OpenAI's
  documented recommendation ("start with gpt-5.5").
- **Cross-machine non-determinism (stress-test finding #3, accepted):**
  Plan does NOT add `--model gpt-5.5` to `execute-pipeline.sh:586`.
  Consequence: on Sebas's Mac (no `~/.codex/config.toml`), the pipeline
  resolves to whatever Codex CLI defaults to on his machine. Accepted
  because (a) Sebas runs the pipeline rarely, (b) adding a hard-coded
  `--model` flag pins the pipeline to a model that may be wrong for
  Sebas's account auth (mirror of the auth-gap risk above), and (c) the
  follow-up — documenting the per-machine config requirement — lands in
  the CLAUDE.md edit (Task 3).
- **Plugin upgrade rollback procedure (stress-test finding #4):** If
  v1.0.4 (or a newer version accidentally fetched) breaks the stable
  companion path or introduces a regression, revert with:
  ```
  /plugin marketplace remove openai-codex
  cd ~/.claude/plugins/marketplaces && git clone --branch v1.0.2 https://github.com/openai/codex-plugin-cc openai-codex
  /reload-plugins
  ```
  Pipeline behavior degrades gracefully even without rollback — falls
  through to raw `codex review` (line 589), then Claude adversarial
  (line 596). No data loss.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-04-27
**Mode:** standard (single-pass, opus analyst)

### Important findings (address before execution)

1. **Auth gate ordering inverted.** Task 1 step 5 (smoke test) currently runs
   *after* `~/.codex/config.toml` is created (step 4). If GPT-5.5 is API-key-only
   blocked, the config file is already in place and silently breaks every other
   `codex exec` call on this machine (munet pipeline, other clients) until
   removed. **Fix:** reorder — smoke-test auth FIRST without config, then create
   config only on success.

2. **Plugin version not pinned at install time.** `/plugin marketplace add openai/codex-plugin-cc`
   fetches latest. If OpenAI ships v1.0.5 between now and execution, the
   implementer gets an untested version. **Fix:** investigate whether the
   `/plugin` interface supports `@v1.0.4` pin syntax; if not, add a
   post-install version-check step that aborts and reverts if fetched version
   is not exactly 1.0.4.

3. **Pipeline flag omission deserves explicit decision.** Research doc recommended
   adding `--model "${CODEX_MODEL:-gpt-5.5}"` to `execute-pipeline.sh:586`.
   Plan rejects this in favor of config.toml-only. Consequence: on Sebas's Mac
   (no config.toml), pipeline silently resolves to whatever Codex CLI defaults
   to — non-deterministic across machines. **Fix:** either (a) accept and
   document the non-determinism in Risk, or (b) add the `--model` flag as a
   second source of truth (8 chars of diff, additive not conflicting).

4. **No rollback procedure for plugin upgrade.** If v1.0.4 (or accidentally a
   newer version) breaks the stable companion path at `execute-pipeline.sh:563`,
   plan provides no recovery guidance. **Fix:** add a one-line rollback note in
   Risk section: "To revert: `/plugin marketplace remove openai-codex` then
   reinstall from a known-good commit hash."

### Minor findings (acceptable as-is)

- Task 1 step 3 says "shows 1.0.4" but acceptance criteria correctly requires
  *both* marketplace and plugin entries to be 1.0.4. Tighten task language to
  match acceptance criteria.
- Task 2/3 reference line numbers (585, 589, 197). Line numbers drift if other
  edits land first. Prefer string-content matching in instructions.
- Task 1 does not specify behavior if `~/.codex/config.toml` already exists
  (overwrite vs. merge).
- `model_reasoning_effort = "high"` applies globally to all `/codex:*` calls,
  not just adversarial review. Could slow `/codex:rescue` and `/codex:status`.
  No bound on cost/latency impact provided.
- Smoke test (`codex exec ... "Reply with the model name"`) is a best-effort
  heuristic; model could respond with any string. Acceptance is weak.
- CLAUDE.md update doesn't note that Sebas (Mac) needs his own `config.toml` —
  reads as if GPT-5.5 is automatically active everywhere.
- No explicit `[[ -f "$_companion_stable" ]]` check post-upgrade.
- Concurrent Claude session running pipeline mid-upgrade could pick up a
  partially-replaced companion. Low probability on single-dev machine.

### Findings summary

- Files analyzed: 5 (plan, CLAUDE.md, execute-pipeline.sh:540-625, research doc, marketplace.json)
- Critical: 0
- Important: 4
- Minor: 8
