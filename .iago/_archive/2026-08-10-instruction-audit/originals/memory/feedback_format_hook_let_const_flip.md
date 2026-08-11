---
name: feedback_format_hook_let_const_flip
description: "post-edit-format hook flips a not-yet-reassigned `let` to `const`, breaking a later edit that adds the reassignment"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c1a2eb51-52b9-4715-99bc-5ab7448bdb28
---

The iaGO `post-edit-format.mjs` hook runs biome after EVERY Edit. Biome's `useConst` auto-fix fires on a `let` that has no reassignment **at that moment** — so if you add `let x = false;` in one Edit and the `x = true;` reassignments in *later* Edits, the hook converts it to `const x = false;` after the first Edit, and the later assignments then throw `Assignment to constant variable` at runtime (tests fail with that message in a `catch`).

**Why:** the hook is per-edit, not per-final-state; biome can't see the reassignment you haven't written yet.

**How to apply:** when introducing a mutable local across a fix, declare the `let` AND at least one reassignment in the SAME Edit (e.g. the `try { x = true } catch {}` block together). If you must split, after finishing re-grep `const <name> = ` and flip it back to `let`. Hit this on PR #92 round-2 (`let consumed` in main.ts send-handler). Related: [[feedback_subproject_format_hook]], [[feedback_config_protection_bypass]].
