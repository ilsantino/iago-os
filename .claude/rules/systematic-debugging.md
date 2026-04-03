---
description: >-
  4-phase debugging method and 3-fix escalation rule.
  Always active for all debugging and error resolution.
---

## 4-Phase Debugging

### Phase 1: REPRODUCE
- Get a reliable reproduction before touching any code
- Minimal case: strip away unrelated code until the bug is isolated
- Record exact steps, inputs, and observed vs expected output
- If you cannot reproduce it, say so — do not guess at fixes

### Phase 2: ISOLATE
- Form a hypothesis: "I think X is causing Y because Z"
- Verify the hypothesis with evidence (logs, breakpoints, binary search)
- Binary search: comment out half the suspect code, check if bug persists
- Git bisect for regressions: `git bisect start`, `git bisect bad`, `git bisect good <sha>`
- Do not change code during isolation — only observe and measure

### Phase 3: FIX
- Smallest change that addresses the root cause, not the symptom
- One fix per commit — if multiple issues found, fix them separately
- Write the regression test BEFORE writing the fix (RED step from TDD)
- Confirm the test fails without the fix, passes with it

### Phase 4: VERIFY
- Run the full test suite, not just the new test
- Check for side effects: did fixing this break something else?
- Run the original reproduction steps — confirm the bug is gone
- TypeScript: `npx tsc --noEmit` must pass
- Linter: `npx biome check` must pass

## 3-Fix Escalation Rule

| Attempt | Action |
|---------|--------|
| 1st fix | Apply hypothesis-driven fix, run tests |
| 2nd fix | Re-isolate — original hypothesis was wrong, form a new one |
| 3rd fix | Last attempt with a fundamentally different approach |
| After 3 | **STOP.** Report: what you tried, what failed, what you suspect. Escalate to orchestrator or user. No 4th attempt without new information. Consider `/codex:rescue` for a cross-model second opinion. |

## Anti-Patterns

- Do not retry the same fix with minor variations
- Do not add try/catch to suppress errors — find the root cause
- Do not blame external dependencies without evidence
- Do not widen the scope: fix the reported bug, not nearby code
