---
name: dual-adversarial
description: Final pre-merge dual-adversarial gate over a PR or branch diff — an Opus 4.8 reviewer running in parallel with a Codex (GPT-5.5) cross-model reviewer, fully independent and aggressive. Asks which extra lenses (security / code-quality / test-coverage / completeness) to add, then runs the dual-adversarial Workflow. Read-only — reports a verdict and findings, never fixes or merges. Use as the final gate before a human merges, or any time you want a hard cross-model adversarial pass on a committed diff.
---

# /dual-adversarial

Final cross-model adversarial gate before merge. Two **independent** legs run in
parallel — an **Opus 4.8** reviewer and a **Codex (GPT-5.5)** reviewer — neither
sees the other's output; their findings are merged only after both finish.
Optionally adds extra independent lenses. **Read-only: never commits, pushes, or
merges. Santiago merges.**

## When to use
- After the async GitHub review-fix loop reports clean on a PR (pass #2 pre-merge gate).
- Any time you want a hard, aggressive, cross-model second opinion on a committed diff.

## Do NOT use when
- You want the change implemented or fixed — this is review-only (use `/iago-prfix` to fix).
- There is no committed diff to review (the Codex leg only sees committed history — commit first).

## Steps (orchestrator)

1. **Resolve the target.**
   - If invoked with a PR number, set `prNumber` and `base` to that PR's base branch (default `origin/main`).
   - Otherwise review the current branch: `base = origin/main`, `prNumber = ""`.
   - `projectDir` = repo root; `iagoRoot` = repo root (resolves `scripts/review-checks/`).

2. **Size the diff.** Run `git diff --shortstat <base>...HEAD`. If empty AND no PR number, tell the user there is nothing to review and stop.

3. **Ask which extra lenses to add.** Call `AskUserQuestion` ONCE (`multiSelect: true`). The two adversarial core legs (Opus 4.8 ∥ Codex GPT-5.5) ALWAYS run — this question only adds extra **independent** lenses on top:
   - **Security review** — auth/authz bypass, injection, secret leakage, crypto, tenant isolation, IAM. Same depth as `/security-review`. *Pre-select this when the diff touches `amplify/**`, auth, or payments.*
   - **Code review** — quality, maintainability, dead/duplicated code, complexity, repo standards. Same depth as `/code-review`.
   - **Test-coverage audit** — do the risky changed paths have a regression test that fails without the change and passes with it? Missing coverage is flagged Important (Critical on auth/data-loss paths).
   - **Completeness critic** — a meta-leg that asks "what did the other legs miss?" (a file no one read in full, an unverified cross-module effect, an unproven claim, an unhandled failure mode).

4. **Run the gate.** Invoke the Workflow once with the selected lenses:
   ```
   Workflow({ scriptPath: "C:/Users/sanal/dev/iago-os/.claude/workflows/dual-adversarial.js",
              args: { projectDir, iagoRoot, base, prNumber, lenses: [<selected lens keys>] } })
   ```
   Lens keys: `"security"`, `"codeQuality"`, `"tests"`, `"completeness"`. Pass `lenses: []` if none selected.

5. **Report.** The Workflow returns `{ clean, gateStatus, incompleteLegs, verdict, codexSource, crossModelDegraded, findings, blocking }`. **Lead with `clean` — it is the authoritative merge signal. Do NOT lead with `verdict`:** `verdict` reflects the Opus leg ONLY, so it can read `PASS` while the Codex leg surfaced a Critical (in that case `clean` is `false` and `blocking > 0`). Route on `clean` first, then `gateStatus`:
   - **`gateStatus === 'INCOMPLETE'`** (a core leg failed — see `incompleteLegs`) → the gate did NOT complete. Tell Santiago the gate is incomplete and **re-run the Workflow**. Do NOT offer `/iago-prfix` — a failed leg is not a fixable code defect, and `/iago-prfix` will not run the missing leg.
   - **`clean === true`** → tell Santiago it is safe to merge. If `crossModelDegraded === true` (codexSource is `claude-fallback`), add a caveat: the cross-model GPT-5.5 leg fell back to a same-family Claude pass, so there was no true cross-model coverage — re-run the gate if a hard GPT-5.5 second opinion is required before merge.
   - **`clean === false` AND `gateStatus === 'COMPLETE'`** (`blocking > 0`) → surface findings grouped by severity; offer `/iago-prfix` to fix. **Never run `gh pr merge` — Santiago merges.**

## Guarantees
- **Independent.** The Opus and Codex legs (and every extra lens) run as separate fresh subagents inside one `parallel()` call — no leg is primed with another's findings; results are merged only after all legs finish.
- **Aggressive.** Every leg defaults to skepticism, gives no credit for good intent or likely follow-up work, and treats happy-path-only behavior as a real weakness.
- **Model-pinned.** The reviewer leg is pinned to Opus (`model: 'opus'` = Opus 4.8); the cross-model leg uses Codex GPT-5.5 via `codex-companion.mjs` (model pinned in `~/.codex/config.toml`). A core leg that fails forces `clean = false` AND `gateStatus = 'INCOMPLETE'` (a re-run condition, not a `/iago-prfix` finding — see step 5); a failed extra lens is non-blocking (logged, not blocking).
- **Cross-model honesty.** If the Codex leg falls back to a same-family Claude pass, `codexSource` is `claude-fallback` and `crossModelDegraded` is `true` — the gate can still report `clean` but with no true GPT-5.5 coverage. Step 5 requires surfacing this caveat to the human at the merge decision.
