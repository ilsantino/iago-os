# Research: codex-plugin-cc currency + GPT-5.5 in iago-os

**Date:** 2026-04-24
**Question:** Is iago-os up to date with `openai/codex-plugin-cc`? Is the Codex adversarial step using GPT-5.5? If not, how do we route GPT-5.5 through Claude Code?

## Findings

### 1. Is iago-os's installed plugin up to date?

**No — two patch versions behind.**

| Location | Version | Date |
|---|---|---|
| Upstream `openai/codex-plugin-cc` | **v1.0.4** | 2026-04-18 |
| Installed at `~/.claude/plugins/marketplaces/openai-codex/` | **v1.0.2** | 2026-03-31 |

Evidence: `~/.claude/plugins/marketplaces/openai-codex/.claude-plugin/marketplace.json` reports `"version": "1.0.2"` for both marketplace and plugin. Upstream GitHub shows v1.0.4 as current release.

**What changed in 1.0.3 → 1.0.4** (relevant to iago-os):
- **v1.0.3** (Apr 8): older Codex CLI version graceful handling; scoped resume-last/cancel to current Claude session; prevented embedding of large adversarial-review diffs; Git Bash on Windows respected via SHELL env.
- **v1.0.4** (Apr 18): fixed model declaration in codex-rescue agent; fixed `--cwd` flag for session runtime; removed invalid `xhigh` reasoning effort; `/codex:rescue` now routes through Agent tool (prevents skill recursion); better arg quoting on Windows in `cancel`/`result`/`status`.

Several of these directly affect our stack: Windows/Git Bash handling (we're on Windows), large-diff adversarial reviews (our pipeline feeds full diffs), and skill recursion (our orchestrator dispatches).

### 2. Is the Codex adversarial step using GPT-5.5?

**Almost certainly no — and the pipeline doesn't even pass a model flag.**

Three pieces of evidence:

**(a) The companion does not force a model.**
`scripts/codex-companion.mjs:100` — `normalizeRequestedModel(model)` returns `null` if model is null. `buildTaskRequest` at line 573 passes `model` through unchanged. The `adversarial-review` command path never sets a model flag. Whatever Codex CLI's default is, that's what runs.

**(b) iago-os's pipeline does not pass `--model`.**
`scripts/execute-pipeline.sh:586` invokes:
```bash
node "$CODEX_COMPANION" adversarial-review --base "$PRE_IMPL_SHA" --wait
```
No `--model` flag. The pipeline relies on Codex CLI's default model resolution.

**(c) User has no `~/.codex/config.toml`.**
Verified: `cat ~/.codex/config.toml` → no such file. That means Codex CLI falls back to its baked-in default, which per OpenAI's model picker docs was `gpt-5.4` before Apr 23 and is being rolled out to `gpt-5.5` now — but only for ChatGPT-subscription auth, not API-key auth. Rollout is still in progress.

The log line `"Running codex-companion adversarial-review (GPT-5.4)"` at `execute-pipeline.sh:585` is a **stale string**, not an enforced setting. Likewise `CLAUDE.md:197` claims "Codex (GPT-5.4): Cross-model adversarial review" — also outdated documentation, not enforced behavior.

### 3. Should we switch to GPT-5.5?

**Yes — GPT-5.5 released 2026-04-23 with strong coding benchmarks.**

- 88.7% SWE-bench (vs Claude Opus 4.7 at lower figure)
- 39.6% FrontierMath Tier 4 (vs Claude Opus 4.7 at 22.9%)
- 60% hallucination drop vs GPT-5.4
- Pricing: $5/M input, $30/M output (vs GPT-5.5 Pro at $30/$180)
- Available in Codex CLI for ChatGPT Plus/Pro/Business/Enterprise accounts
- **Not yet** available with API-key auth (ChatGPT sign-in only during rollout)

This matches the user's observation that "codex is outperforming claude for now" — the benchmark gap is real, especially on agentic coding.

### 4. How to route GPT-5.5 into Claude Code

**Bridge path is already in place — the plugin is the conduit.** Three levers:

**Lever 1 — Set Codex CLI default (cleanest, affects all codex usage):**
```toml
# ~/.codex/config.toml
model = "gpt-5.5"
```
Every `/codex:*` command and every pipeline adversarial step picks it up.

**Lever 2 — Pass `--model gpt-5.5` at invocation:**
- `/codex:rescue --model gpt-5.5 "investigate auth race"`
- `/codex:adversarial-review --model gpt-5.5` (supported via companion args)

**Lever 3 — Pipeline flag for our `execute-pipeline.sh`:**
Add `--model gpt-5.5` to the companion invocation at line 586. Pin the model so the pipeline is deterministic regardless of user config.

There is no way to run GPT-5.5 natively inside the Claude harness (different vendor, different SDK). The plugin is the only supported bridge. For `/codex:rescue` use cases the plugin already exposes `--model` — we just aren't using it.

## Sources

- [GitHub - openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — upstream repo, v1.0.4
- [Releases · openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc/releases) — v1.0.3/1.0.4 changelogs
- [Introducing GPT-5.5 | OpenAI](https://openai.com/index/introducing-gpt-5-5/) — release announcement
- [Models – Codex | OpenAI Developers](https://developers.openai.com/codex/models) — "start with gpt-5.5"; ChatGPT sign-in only during rollout
- [Config basics – Codex | OpenAI Developers](https://developers.openai.com/codex/config-basic) — `~/.codex/config.toml` schema
- [OpenAI releases GPT-5.5 (SiliconANGLE)](https://siliconangle.com/2026/04/23/openai-releases-gpt-5-5-advanced-math-coding-capabilities/) — benchmarks incl. SWE-bench 88.7%, FrontierMath 39.6%
- [Introducing Codex Plugin for Claude Code (OpenAI community)](https://community.openai.com/t/introducing-codex-plugin-for-claude-code/1378186) — plugin install flow
- Local: `~/.claude/plugins/marketplaces/openai-codex/.claude-plugin/marketplace.json` (v1.0.2)
- Local: `scripts/execute-pipeline.sh:585-590` (no `--model` flag, stale "GPT-5.4" log string)
- Local: `CLAUDE.md:197` (stale "Codex (GPT-5.4)" routing note)

## Recommendation

**Decision:** Ship a 3-part sync: (a) bump plugin to v1.0.4, (b) pin `gpt-5.5` in `~/.codex/config.toml`, (c) update pipeline + CLAUDE.md to reflect reality.
**Confidence:** High.
**Reasoning:** Plugin upgrade is low-risk (point release, Windows-relevant fixes). Pinning GPT-5.5 at the Codex-CLI level is one file and benefits every `/codex:*` path with no pipeline changes. Without a pin we're subject to opaque rollout timing — Codex CLI might still be resolving to 5.4 on this machine. Documentation is currently lying ("GPT-5.4") which erodes trust in the routing guidance.
**Next step:**
1. Reinstall/update the plugin: `/plugin marketplace remove openai-codex && /plugin marketplace add openai/codex-plugin-cc && /plugin install codex@openai-codex && /reload-plugins` — then verify `marketplace.json` shows 1.0.4.
2. Create `~/.codex/config.toml` with `model = "gpt-5.5"` and `model_reasoning_effort = "high"` for adversarial reviews.
3. Sanity check: `codex exec --model gpt-5.5 "reply with the model name you are running"` — confirm ChatGPT auth works (API-key auth is blocked during rollout).
4. Edit `scripts/execute-pipeline.sh:585` + `:589` log strings from "GPT-5.4" to "model=<codex-default>"; add optional `--model "${CODEX_MODEL:-gpt-5.5}"` to line 586 for explicit pinning.
5. Edit `CLAUDE.md:197` from "Codex (GPT-5.4)" to "Codex (GPT-5.5, configured via `~/.codex/config.toml`)".
**Risk if wrong:** If the Codex account is API-key-only (not ChatGPT sign-in), GPT-5.5 calls return an error and the pipeline falls through to Claude-adversarial fallback — a soft failure, not data loss. Mitigated by running step 3 (sanity-check) before pinning.

**Condition to revisit:** If OpenAI enables GPT-5.5 for API-key auth (watch Codex changelog), the ChatGPT-auth caveat disappears and pinning becomes unconditional.
