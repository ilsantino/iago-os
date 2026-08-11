---
name: Munet-web restructure playbook v2
description: Council-revised playbook for munet-web MVP restructure; canonical version lives in MUNET repo at clients/munet-web/docs/PLAYBOOK-v2.md (evolved 1189-line version with role-fix amendments) — operational split at docs/playbook/{spine,parallel}/
type: project
originSessionId: 4d139d2a-e94b-4659-a7ea-2c3bb0296d30
---
**M06 STATUS — DONE (2026-04-28).** The Munet-web restructure playbook was already moved to the Munet repo on 2026-04-28 at `clients/munet-web/docs/PLAYBOOK-v2.md` (verified 2026-05-04 against Munet `origin/main` commits `9f4a767 docs(playbook): import PLAYBOOK-v2 to munet-web docs/` and `2249334 docs(playbook): carve operational split from PLAYBOOK-v2.md`).

**Why path is `docs/PLAYBOOK-v2.md` (not `.iago/research/`):** Munet's `.iago/` is in `.gitignore` (line 21) — only grandfathered files like `.iago/STATE.md` are tracked. The audit's `clients/{name}/.iago/research/` proposal was blocked by that gitignore in practice; `docs/` is the workable client-repo-side colocation path.

**Canonical version (in Munet repo):**
- `clients/munet-web/docs/PLAYBOOK-v2.md` — 1189 lines, "Council-Revised + Role-Fix Iteration", amended 2026-04-28 with calendar/visitas-grupales/panic-button additions
- Operational split at `clients/munet-web/docs/playbook/{spine,parallel}/*.md` for day-to-day execution
- File header explicitly says: "moved from `iago-os/docs/research/munet-web-playbook.md` on 2026-04-28 for project-side colocation"

**Stale iago-os branches (905-line older snapshots, superseded):**
- `wip/munet-web-playbook-v2` (commit `08d68a5`, original at `research/munet-web-playbook.md`)
- `docs/munet-web-playbook` (commit `aab3f1e`, identical content at `docs/research/munet-web-playbook.md`)

Both are SAFE TO DELETE — verified the Munet canonical is a strict superset (1189 vs 905 lines, includes Role-Fix amendments not present in iago-os snapshots). Drop locally + remote when convenient. Not a blocker.

**Why v2 (council content):** v1 (22 prompts) failed council stress-test on 2026-04-27 — four of five advisors said not execution-ready. Key pivot: ditch Cognito group migration in favor of Cognito `custom:capability` user attribute — reversible, no staging branch, ships faster. Kills v1's R12 (staging) and G6 (group migration) risks entirely.

**How to apply (in Munet sessions):**
- Three gates: P-1 production bug fixes (H1, H2 — DONE) → Gate 0 (P0 ROADMAP setup) → Phase 1 capabilities → Phase 2 incidents → Phase 3 dashboard → Phase 4 cleanup → V1 verify.
- Strict serial (file-collision matrix in §6 proves no parallel safety in spine; parallel tracks live in `playbook/parallel/`).
- Hard blockers before any prompt runs: R1 (capability values Spanish/English), R3 (downgrade path), R11 (parking coords/Place IDs from Santiago).
- Async @claude loop is the de facto QA gate — manual merge breakpoint between every wave (G9).
- Every prod-write prompt includes G8 rollback rehearsal (pre-write export, revert command, blast-radius bound, revert SLA).
- DEFERRED to v1.1 backlog: panic button (2.3), notifications scaffold (4.4), staging branch (P3), contenido-guia UI (4.2), bug-bounty sweeps (S1/S2), iago-os skill harvest.
- Session digest: `obsidian-brain/sessions/2026-04-27-munet-web-playbook.md`. Council decision: `obsidian-brain/decisions/2026-04-27-munet-web-playbook-council.md`.

**Next-action paths:**
- For Munet execution: open `clients/munet-web/docs/playbook/README.md` to pick the next phase prompt.
- For iago-os hygiene: drop the two stale branches above (no PR needed; remote delete is one-shot).
