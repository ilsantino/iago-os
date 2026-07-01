---
plan: 05b-evidence-checker-and-e2e
status: done
verified: 2026-07-01
pr: https://github.com/ilsantino/iago-os/pull/99
---

# Summary: 05b-evidence-checker-and-e2e

Final plan of the Phase 2 VPS-bootstrap acceptance surface. Ships the
`check-evidence.mjs --phase 2` acceptance gate (the master-prompt verification
path) plus the opt-in Tailscale-SSH VPS e2e suite. Merged squash `90fafa7`.

## Pipeline Result

Executed as a hand-driven dual-adversarial fix flow (not the auto Workflow) —
the `/dual-adversarial-fix` workflow flaked twice on this surface, so fixes were
hand-edited + test-verified per round.

- **Build gate:** `npx tsc --noEmit` + `npx tsc -p tsconfig.e2e.json` — exit 0
- **Gate suite:** `npm run test:gate` — 26/26
- **Phase-2 vitest:** `phase-2-vps.test.ts` + `phase-2-evidence-template.test.ts`
  — 29 pass / 15 skipped (opt-in e2e default-skips in CI)
- **Review:** 3 local dual-adversarial Team gates (Opus ∥ Codex GPT-5.5) +
  async @claude GitHub loop — all converged clean
- **PR:** https://github.com/ilsantino/iago-os/pull/99 (single @claude tag)

## What shipped

- `runtime/scripts/check-evidence.mjs` — phase-2-default acceptance gate:
  sentinel-replacement block check, fence-aware checkbox + cited-artifact-path
  scanning (unbalanced-fence reject, raw §3/§6 structural-section counting),
  DEFAULT-gate block-(h) security-band check (`isAcceptedLiveScore` — rejects
  EXPOSED/UNSAFE/DANGEROUS + >5.0), and `--strict` block-(h) ≤2.0 target parse
  (paste-order independent).
- `runtime/scripts/check-evidence.test.mjs` — 26 node:test cases, wired into CI
  via `npm run test:gate` + `.github/workflows/validate.yml`.
- `runtime/integration/phase-2-vps.test.ts` — 15 opt-in VPS e2e tests (0–14,
  `IAGO_VPS_E2E=1`, nondisruptive read-only subset via
  `IAGO_VPS_E2E_NONDISRUPTIVE=1`); shares the security-score regex with the gate.
- `runtime/tsconfig.e2e.json` — typechecks the `*.test.ts` tree (excluded from
  the main tsconfig) so test-only ReferenceErrors can't escape CI.

## Review rounds

- **R1** (local): 5 Important — retired false "not-wired/PASTE-" claims in
  PHASE-2-EVIDENCE.md; `--strict` reads block (h) live (not a fixture); every
  `- [ ]` box enforced; gate suite wired into CI; decrypt-length off the `>0`
  anti-pattern.
- **R2** (cross-model): blocking test-7 ReferenceError (unwired lazy-loader) +
  `bash -o pipefail` remote pipes, fence-aware parsing, paste-order-independent
  `--strict`, decrypt floor 46→40; follow-ups closed fence/section false-PASS
  holes (raw §3/§6 count, unbalanced-fence reject, PERFECT band).
- **R3** (`ccefa0f`): inverted-liveness e2e test 4 (`daemon-start` only reaches
  journald on `emit()` write-FAILURE → healthy daemon false-FAILed → repointed
  at the systemd `Started …` line); default gate now band-checks block (h);
  minor runStrict message.
- **Async @claude** (`2bd211f`): two doc-drift fixes — the `check-evidence.mjs`
  usage banner + PHASE-2-EVIDENCE.md block (h) note now match the round-3
  default-gate band-check behavior.

## Accepted residual

I5 cutover residual (real pr-triage workflow EXECUTION proof deferred to the
first post-cutover 14:00-UTC cron tick — physically unproducible at cutover
time). Owner-accepted 2026-06-29; the dual-adversarial gate re-flags by design —
do not re-fix. See `.iago/research/2026-06-17-cutover-t15-phase2-redesign.md`.

## Diff Stats

```
 .github/workflows/validate.yml                     |  18 +
 runtime/PHASE-1-EVIDENCE.md                        |  10 +-
 runtime/PHASE-2-EVIDENCE.md                        |  44 +-
 runtime/integration/phase-2-evidence-template.test.ts |  73 +-
 runtime/integration/phase-2-vps.test.ts            | 410 +++++++++++
 runtime/package.json                               |   1 +
 runtime/scripts/check-evidence.mjs                 | 816 ++++++++++++++++++++-
 runtime/scripts/check-evidence.test.mjs            | 569 ++++++++++++++
 runtime/tsconfig.e2e.json                          |  24 +
 9 files changed, 1873 insertions(+), 92 deletions(-)
```

## Remaining Phase 2

Plan 06 (SIGHUP cred reload) → 07a (cron) → 07b (agent-manager) →
human-gated VPS cutover off OpenClaw (Workstream C).
