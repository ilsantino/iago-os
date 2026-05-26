---
phase: feature-mwp-restructure-clients
plan: 04
wave: 1
depends_on: []
context: .iago/research/2026-05-25-mwp-restructure-audit.md
created: 2026-05-25
source: feature
---

# Plan: feature-mwp-restructure-clients/04-palazuelos-shell

## Goal

Add MWP wrapper to `clients/palazuelos/` (Class C — research/transcription engagement, no inner repo): CLAUDE.md (Layer 0), CONTEXT.md (Layer 1), physical L3/L4 split inside the minimal existing `clients/palazuelos/.iago/`, and move the loose `session-2026-05-04-palazuelos.md` from wrapper root into `.iago/_config/context/` (per `.iago/CONTEXT.md` doc-routing convention).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `clients/palazuelos/CLAUDE.md` | Layer 0 wrapper declaration |
| create | `clients/palazuelos/CONTEXT.md` | Layer 1 routing |
| create (dirs) | `clients/palazuelos/.iago/_config/`, `clients/palazuelos/.iago/product/`, `clients/palazuelos/.iago/_archive/` | physical L3/L4/archive split |
| move | `clients/palazuelos/.iago/learnings/` → `clients/palazuelos/.iago/_config/learnings/` | L3 factory artifact |
| move | `clients/palazuelos/.iago/config.json` → `clients/palazuelos/.iago/_config/config.json` | L3 factory artifact |
| move | `clients/palazuelos/session-2026-05-04-palazuelos.md` → `clients/palazuelos/.iago/_config/context/2026-05-04-palazuelos-session.md` | loose session log → proper home |

## Tasks

### Task 1: Create `clients/palazuelos/CLAUDE.md` (Layer 0)

- **files:** `clients/palazuelos/CLAUDE.md`
- **action:** Write Layer 0 declaration (~25 lines). Title: `# clients/palazuelos/ — Palazuelos Research/Transcription Engagement`. Paragraph: "Level B MWP sub-workspace inside iaGO-OS. Root workspace at `../../`. This is a **research/transcription engagement** — no inner deliverable repo, no app code, no Amplify backend. Wrapper holds iaGO-managed context (`.iago/`) and the active transcription deliverable (`transcription1/` — audio, Python transcription script, generated SRT/TXT transcripts)." Then `## Layer routing` table: L0=this file, L1=`./CONTEXT.md`, L3=`./.iago/_config/`, L4 product=`./.iago/product/` + `./transcription1/`. Then `## Hard rules`: (1) `transcription1/` is the active deliverable — `transcribe.py` regenerates `transcript.{srt,txt}` from `audio.wav`/`chunks/`; don't edit transcripts manually if a regeneration run is upcoming; (2) plans for palazuelos work live in `./.iago/product/plans/feature-{slug}/`, NOT in root `.iago/plans/`; (3) raw audio files (`audio.wav`, `grabación1-palazuelos.mp4`) are reference assets — don't delete without explicit instruction.
- **verify:** `test -f clients/palazuelos/CLAUDE.md && wc -l clients/palazuelos/CLAUDE.md && grep -q "transcription1" clients/palazuelos/CLAUDE.md && grep -q "Level B" clients/palazuelos/CLAUDE.md`
- **expected:** file exists; 20-35 lines; deliverable and Level-B framing present

### Task 2: Create `clients/palazuelos/CONTEXT.md` (Layer 1)

- **files:** `clients/palazuelos/CONTEXT.md`
- **action:** Write Layer 1 routing (~30 lines). Title: `# clients/palazuelos/ — Workspace L1 Routing`. Section `## Doc-routing — where palazuelos artifacts go`: table with rows: (1) Phase plan → `./.iago/product/plans/{NN-phase-slug}/{NN}.md`; (2) Feature plan → `./.iago/product/plans/feature-{slug}/{NN}.md`; (3) Execution summary → `./.iago/product/summaries/{plan-slug}.md`; (4) Meeting/session notes → `./.iago/_config/context/{YYYY-MM-DD}-{topic}-session.md`; (5) Research → `./.iago/product/research/{YYYY-MM-DD}-{slug}.md`; (6) Transcription deliverable (new) → `./transcription{N}/`. Section `## Layer assignments — what each .iago/ subdir is`: small table (`_config/`=L3 factory, `product/`=L4 product, `state/`=runtime). Section `## Sibling artifacts at wrapper level`: `transcription1/` (current deliverable: audio + transcripts + Python script).
- **verify:** `test -f clients/palazuelos/CONTEXT.md && grep -q "^## Doc-routing" clients/palazuelos/CONTEXT.md && grep -q "transcription" clients/palazuelos/CONTEXT.md`
- **expected:** file exists; routing section present

### Task 3: Scaffold physical `.iago/{_config, product, _archive}/` dirs

- **files:** `clients/palazuelos/.iago/_config/`, `clients/palazuelos/.iago/_config/context/`, `clients/palazuelos/.iago/product/`, `clients/palazuelos/.iago/_archive/`
- **action:** `mkdir -p clients/palazuelos/.iago/_config/context clients/palazuelos/.iago/product clients/palazuelos/.iago/_archive`. Add `clients/palazuelos/.iago/_config/README.md` (1-line "factory: stable across runs") and `clients/palazuelos/.iago/_archive/README.md` (1-line "archived plans/decisions from completed phases").
- **verify:** `test -d clients/palazuelos/.iago/_config && test -d clients/palazuelos/.iago/_config/context && test -d clients/palazuelos/.iago/product && test -d clients/palazuelos/.iago/_archive`
- **expected:** all dirs exist

### Task 4: Move existing `.iago/` factory contents to `_config/`

- **files:** `clients/palazuelos/.iago/{learnings, config.json}` → `clients/palazuelos/.iago/_config/{learnings, config.json}`
- **action:** `git mv clients/palazuelos/.iago/learnings clients/palazuelos/.iago/_config/learnings` (2 files per audit §11.4). `git mv clients/palazuelos/.iago/config.json clients/palazuelos/.iago/_config/config.json`. If `clients/palazuelos/.iago/hooks/` exists (audit noted palazuelos has hooks subdir — rare), `git mv clients/palazuelos/.iago/hooks clients/palazuelos/.iago/_config/hooks`.
- **verify:** `test -d clients/palazuelos/.iago/_config/learnings && test -f clients/palazuelos/.iago/_config/config.json && [ "$(ls clients/palazuelos/.iago/_config/learnings/ | wc -l)" -ge "2" ]`
- **expected:** learnings/ moved with 2 files; config.json moved

### Task 5: Move loose session log into `.iago/_config/context/`

- **files:** `clients/palazuelos/session-2026-05-04-palazuelos.md` → `clients/palazuelos/.iago/_config/context/2026-05-04-palazuelos-session.md`
- **action:** `git mv clients/palazuelos/session-2026-05-04-palazuelos.md clients/palazuelos/.iago/_config/context/2026-05-04-palazuelos-session.md`. The session log was at wrapper root — per `.iago/CONTEXT.md` doc-routing (rendered in new `CLAUDE.md` Task 1 here), meeting/session notes belong in `.iago/_config/context/`. Filename normalized to `{YYYY-MM-DD}-{topic}-session.md` pattern.
- **verify:** `! test -f clients/palazuelos/session-2026-05-04-palazuelos.md && test -f clients/palazuelos/.iago/_config/context/2026-05-04-palazuelos-session.md`
- **expected:** old loose path gone; new home exists

### Task 6: Verify wrapper structure clean + deliverable preserved + state/ disposition documented

- **files:** (verification only)
- **action:** **Stress-test fix — use `ls -A` (NOT `ls`)** because `.iago/` is a hidden directory; `ls` without `-A` excludes hidden entries and would count only `CLAUDE.md` + `CONTEXT.md` + `transcription1/` = 3, failing the "4 entries" assertion. **Step A (wrapper structure):** confirm wrapper-level entries are exactly: `CLAUDE.md` (created Task 1), `CONTEXT.md` (created Task 2), `.iago/` (restructured), `transcription1/` (untouched). No loose files. **Step B (deliverable preserved):** `ls clients/palazuelos/transcription1/` shows audio.wav, chunks/, grabación1-palazuelos.mp4, notes.md, transcribe.log, transcribe.py, transcript.srt, transcript.txt (8 entries per audit §11.4). **Step C (state/ + project-meta disposition documented):** confirm `clients/palazuelos/.iago/state/active-client.json` is still in place (runtime state, NOT moved). `clients/palazuelos/.iago/{PROJECT.md, ROADMAP.md, STATE.md}` also stay at `.iago/` root (project-meta files for visibility — minimal engagement does not warrant their move into `_config/`).
- **verify:** `[ "$(ls -A clients/palazuelos/ | wc -l)" = "4" ] && [ "$(ls clients/palazuelos/transcription1/ | wc -l)" -ge "7" ] && test -f clients/palazuelos/.iago/state/active-client.json && test -f clients/palazuelos/.iago/STATE.md && test -f clients/palazuelos/.iago/PROJECT.md && test -f clients/palazuelos/.iago/ROADMAP.md`
- **expected:** 4 wrapper entries (CLAUDE.md, CONTEXT.md, .iago/, transcription1/) via `ls -A`; transcription1/ has ≥7 entries; state/active-client.json + STATE/PROJECT/ROADMAP.md at .iago/ root all preserved

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-25
**Reviewer:** analyst (opus, read-only)

### Important (all fixed in this plan revision)
- **Task 6 verify used `ls` (not `ls -A`)** — would have excluded hidden `.iago/` and counted 3 not 4; verify would fail deterministically. **Fixed:** Task 6 now uses `ls -A` and the expected count comment clarifies hidden-file inclusion.
- **`state/active-client.json` disposition silently omitted.** **Fixed:** Task 6 Step C now explicitly documents and verifies `.iago/state/active-client.json` stays in place.
- **`PROJECT.md`, `ROADMAP.md`, `STATE.md` at `.iago/` root unaddressed.** **Fixed:** Task 6 verifies all three are preserved (stay at `.iago/` root for minimal-engagement project-meta visibility).

### Minor (acknowledged)
- Tasks 3+4 could collapse (mkdir + move) but separation preserves a verify-cycle on intermediate state.
- Session-md move has no `wc -c` content-integrity check; `git mv` won't corrupt, so deemed unnecessary.
- CONTEXT.md doesn't document `transcription{N}/` numbering convention for future deliverables; minor.

## Verification

After all 6 tasks complete:

```bash
test -f clients/palazuelos/CLAUDE.md                                            # exit 0
test -f clients/palazuelos/CONTEXT.md                                           # exit 0
test -d clients/palazuelos/.iago/_config/learnings                              # exit 0
test -f clients/palazuelos/.iago/_config/config.json                            # exit 0
test -f clients/palazuelos/.iago/_config/context/2026-05-04-palazuelos-session.md  # exit 0
! test -f clients/palazuelos/session-2026-05-04-palazuelos.md                   # exit 0 (loose file moved)
test -d clients/palazuelos/transcription1                                        # exit 0 (deliverable preserved)
test -d clients/palazuelos/.iago/_archive                                        # exit 0
```

All exit as expected.
