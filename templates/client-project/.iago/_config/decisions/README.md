# `_config/decisions/`

Architecture Decision Records, one per file: `YYYY-MM-DD-{slug}.md`, with
frontmatter `date`, `status`, `plan`.

`STATE.md` carries the 3–5 most recent decisions inline. When a sixth lands, the
oldest moves here in this shape, so `STATE.md` stays under its 80-line budget:

| # | Decision | Verdict | Phase | Date |
|---|----------|---------|-------|------|
| 1 | {What was the question?} | {What was decided and why} | {NN-slug} | {YYYY-MM-DD} |

L3 — a decision recorded here binds later work until another decision supersedes
it. Decisions are rewritten, never archived silently.
