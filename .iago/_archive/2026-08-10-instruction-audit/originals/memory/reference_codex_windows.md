---
name: Codex adversarial on Windows via companion + GPT-5.5 via config.toml
description: Pipeline step 4 uses codex-companion.mjs adversarial-review (works on Windows). Model is now GPT-5.5, pinned per-operator in ~/.codex/config.toml — pipeline does NOT pass --model. Codex CLI must be 0.125.0+ for gpt-5.5.
type: reference
originSessionId: 2b6abc0c-144d-43e5-b6fd-04aea72f19d3
---
## The rule

Step 4 of `scripts/execute-pipeline.sh` (iago-os pipeline) uses `codex-companion.mjs adversarial-review`, which bypasses the Codex agent sandbox via the app-server turn API. This runs on Windows, Mac, and Linux identically. Raw `codex review sha..HEAD` is kept as a secondary path for machines that have the Codex CLI but not the plugin; it still fails on Windows due to the sandbox-git-block.

## Model resolution

The pipeline does NOT pass `--model` to either the companion or the raw CLI. Model resolves through `~/.codex/config.toml` (per-operator, not in repo). Santiago's machine pinned to `model = "gpt-5.5"`, `model_reasoning_effort = "high"` as of 2026-04-27 (PR #20). Sebas's Mac will resolve to whatever Codex CLI defaults to until he creates his own config.toml.

**Hard requirement:** Codex CLI ≥ 0.125.0 for gpt-5.5. Older binaries (e.g., 0.118.0) reject with `"The 'gpt-5.5' model requires a newer version of Codex"`. Upgrade with `npm i -g @openai/codex@latest`.

## Why this matters

Before PR #18 (2026-04-20), the pipeline auto-skipped step 4 on MSYS/Cygwin/MINGW and fell back to Claude Opus — same model as steps 1/3, so no cross-model signal. A future session seeing "Codex doesn't work on Windows" in old docs or STATE entries might reintroduce the OS-detection branch. Do not. Verified working by live pipeline run on Windows Git Bash producing structured findings (originally GPT-5.4, now GPT-5.5 via config.toml).

## Where the companion lives

Pipeline resolves path in this order:
1. `$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` (stable)
2. `$HOME/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs` (versioned cache, glob fallback)

If neither exists, `CODEX_COMPANION` stays empty and the raw `codex` CLI path is tried next. Claude fallback only fires when both Codex entry points are unavailable.

## Output format note

Companion emits findings with `[high]`, `[medium]`, `[low]` markers and a `Verdict: needs-attention` line — not the `[P0]/[P1]/[P2]` or `Critical/Important` markers used by `codex review`. The pipeline's findings-detection grep (step 4b trigger, lines ~570 and ~598) must recognize both formats. Stripping any of the companion markers from the grep will silently drop Codex findings on Windows.

## Related

- PR: https://github.com/ilsantino/iago-os/pull/18 (companion adoption)
- PR: https://github.com/ilsantino/iago-os/pull/20 (GPT-5.5 pin + plugin v1.0.4 + log truth-up)
- Plan: `.iago/plans/quick-260420-codex-companion-windows.md`
- Plan: `.iago/plans/quick-260427-codex-plugin-gpt55-sync.md`
- Research: `docs/research/codex-plugin-cc-gpt-5-5-audit.md`
- Audit predecessor that documented the old Windows-skip decision: `.iago/plans/audit-06-codex-windows.md` (now superseded — option 3 "OS detection + Claude fallback" is no longer the guaranteed path; the companion is)
