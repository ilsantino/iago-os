---
name: Codex adversarial via /codex:adversarial-review skill
description: When running dual aggressive adversarial post-async-review, invoke the /codex:adversarial-review skill rather than calling codex-companion.mjs directly from bash
type: feedback
originSessionId: 00ba628e-0250-41c2-a6fd-960e85aa8755
---
For the dual aggressive independent adversarial pass (Opus 4.7 subagent + Codex GPT-5.5, ran AFTER the async @claude review-bot loop completes — PR #71/#72/#80 pattern), use the `/codex:adversarial-review` skill for the Codex side. Do NOT shell out to `codex-companion.mjs adversarial-review` directly.

**Why:** Skill wrapper carries the canonical prompt + logging conventions; ensures parity with prior dual-adversarial audits in `.iago/reviews/{date}-dual-pr{N}-aggressive/`. Direct companion-script invocation works (same GPT-5.5 engine, same `~/.codex/config.toml` model pin) but skips the standardized framing Santiago has been refining across dual-adversarial passes.

**How to apply:** When the user authorizes "deploy the independent double adversarial" on an open PR after async review completes:
- Opus side: `Agent(subagent_type=review-full, ...)` — write to `opus-aggressive.md`
- Codex side: invoke `/codex:adversarial-review` skill — output captured to `codex-aggressive.md`
- Consolidate both + any new CI failures into `CONSOLIDATED.md` with merged severity table
- Report verdict; await Santiago's go for fix-session

The pipeline's stage-4 codex-companion direct call remains correct for in-pipeline use — this rule is specifically for the post-async aggressive dual-pass.
