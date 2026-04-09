# State — iaGO-OS

> **Phase:** hardening | **Status:** in-progress
> **Plan:** adversarial-review-fixes | **Updated:** 2026-04-08

## Recent Decisions

| Date | Decision | Phase |
|------|----------|-------|
| 2026-04-07 | Adversarial review → 4x iago:quick runs (not SDD) | hardening |
| 2026-04-07 | Pipeline build gate: skip when no tsconfig/vite | hardening |
| 2026-04-07 | PreToolUse hooks fail-closed, PostToolUse stay fail-open | hardening |

## Blockers

| Blocker | Since | Owner |
|---------|-------|-------|

## Quick Tasks

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
| 2026-04-07 | quick | Security hardening: fail-closed hooks, bash secrets, safe staging | 476e82c |
| 2026-04-07 | quick | Agent/skill config: model routing, dynamic paths, experimental tags | dc3b80b |
| 2026-04-07 | quick | Housekeeping: ECC comments, archive research, STATE.md | 2f20a3f |
| 2026-04-07 | quick | Harden SDD: --pipeline flag, Codex fallback | pending |
| 2026-04-08 | quick | Fix review-fix silent no-op (custom_instructions → prompt) | [iago-os#8](https://github.com/ilsantino/iago-os/pull/8), [munet-web#19](https://github.com/bas-labs/munet-web/pull/19) |
| 2026-04-08 | fast | Compress CLAUDE.md (~19% token reduction) | ab6d5b2 |
| 2026-04-08 | fast | Add caveman-lite output rules for orchestrator | ae528fd |
| 2026-04-08 | fast | Add allowedTools, fix clean detection, compress prompts | f4e64e0 |
| 2026-04-09 | quick | Review pipeline control flags + pr-review-pipeline docs | 40c3ac7 |
