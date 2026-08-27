# Plan naming

- Feature stack — `plans/feature-{slug}/`: `README.md` (the brief), `SPEC.md`
  (optional), then `NN-{slug}.md` per plan.
- One-off — `plans/quick-{YYMMDD}-{slug}.md`.
- Superseded stack — `plans/_archive/{YYYY-MM}-{slug}/`, with a README saying what
  replaced it. An archived plan is never executed without being re-stress-tested
  against the current roadmap first.

This directory carries no `README.md` of its own. The README belongs to each
`feature-{slug}/`, where it is that stack's brief; a second one at this level is
how a plan tree grows a competing routing table.
