---
name: feedback-plan-folder-readmes
description: "No root README in .iago/plans/; every feature-{slug}/ folder gets its own short README (status + what each plan does)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8238acd1-7ae0-4e78-bd1d-758e884550fd
---

No `README.md` at the root of any `.iago/plans/` tree (iago-os or client subtrees). Instead, every
`feature-{slug}/` folder carries its own short `README.md`: status line, one-paragraph description,
and a table of what each plan does (+ PR numbers once executed). `_archive/` gets its own README.
Cross-feature status/order lives in `STATE.md`, not in a plans-root index.

**Why:** Santiago directive 2026-06-10 (sentria). A root index goes stale the moment any feature
advances (the sentria one claimed "planes por generar" for turnos-horarios while 4 plans sat on
disk); per-feature READMEs are updated by whoever touches that feature.

**How to apply:** When `/iago-plan` cuts plans for a feature, write/update that feature's README in
the same pass — alongside `execution-order-analysis.md` + `excel-workbook-prompt.md` (sentria
convention: both generated at plan time for every planned feature). When a plan merges, update the
README's status/PR column. Related: [[feedback-plan-folder-grouping]].
