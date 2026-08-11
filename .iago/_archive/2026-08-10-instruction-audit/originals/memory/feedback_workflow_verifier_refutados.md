---
name: feedback-workflow-verifier-refutados
description: A verify stage that writes its refutations in place is useless unless the apply stage is told the exact path and key to read them from
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cd45f32a-19a5-489a-b4d2-264bc3a06cdb
  modified: 2026-07-31T17:00:24.291Z
---

In a fan-out → verify → apply workflow, telling the apply agent "don't apply
anything the verifier refuted" is not enough. It must be told **where the
refutations live** — exact file path and exact JSON key.

**Why:** RSF manuals extraction (2026-07-31). Seven verify agents each moved
their refuted items into a `refutados[]` array inside
`build2/extracciones/{slug}.json` — 73 refutations total, all on disk before the
apply stage started. The apply agent reported *"la Pasada C no ha corrido: no hay
lista de refutados en disco"* and applied 8 refuted values anyway, including a
fabricated word ("Sabo" → "sabor") and an unsupported conclusion that would have
changed a client recommendation. It looked for a separate refutations file
because the prompt never said the refutations were nested inside the same JSON it
was already reading.

**How to apply:** in the apply-stage prompt, spell it out — *"cada
`{dir}/{slug}.json` trae un arreglo `refutados[]` en la raíz; leelo primero y
excluye cada item que aparezca ahí"* — and make the downstream gate check for
reapplied refutations explicitly. The gate is what caught it here; it is the
stage that pays for itself. Related: [[feedback_subagent_git_wander_and_structuredoutput]],
[[feedback_diagnose_before_fix]].
