---
description: >-
  60/30/10 task triage — deterministic / rule-based / AI layer routing. Applies
  when designing plans, specs, daemon components, or research artifacts.
globs:
  - ".iago/plans/**/*.md"
  - "docs/specs/**/*.md"
  - "runtime/**/*.ts"
  - "runtime/**/*.py"
  - ".iago/research/**/*.md"
---

# Layer Triage — 60/30/10

Route every task to the lowest layer that handles it. Target split: ~60% deterministic (scripts, DB, file ops, exact calculations, formatting), ~30% rule-based (cron, webhooks, n8n, if/then routing), ~10% AI (judgment, synthesis, creative work, fuzzy classification of unstructured input).

Diagnostic — apply in order, stop at first hit:

1. One computable or lookup-able right answer → script / database / spreadsheet.
2. Expressible as if/then with known criteria → cron / webhook / automation flow.
3. Requires judgment over unstructured information → AI agent (the genuine 10%).

Never route deterministic work through an LLM call. When writing plans, mark each task's layer; repeatable deterministic tasks ship with a script.
