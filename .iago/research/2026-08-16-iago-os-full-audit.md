# iago-os — full audit

**Date:** 2026-08-16
**Question:** Keep, rethink, or migrate? What do we actually have, and what do we actually use?
**Method:** Direct inspection — no subagents, no workflow. Live VPS probe over Tailscale, 2,587-entry usage log mined deterministically, full test-suite run, prompt/code mass measured, doc-vs-reality drift checked.

---

## Headline

**iago-os is two products in one repo. One ships daily. The other has never executed a single task.**

| | Product A — delivery harness | Product B — agentic OS |
|---|---|---|
| What | skills, pipeline, review gates, hooks | daemon, Telegram, cron, file-bus, VPS |
| Built | yes | yes — 100% |
| Tested | yes | 722 passing tests |
| **Running** | **yes, daily, on 5 client repos** | **never, not once** |

The repo's problem is not quality. It is that Product B was engineered to production standard and then never turned on, while four months of effort went into making Product A review itself more rigorously.

---

## Evidence

### F1 — iago-os v2 has never run. (CORRECTED 2026-08-17 — the box is NOT empty.)

> **Correction.** As first published, this finding claimed "the VPS is empty … stock Debian + tailscaled … Node installed and never used," and concluded the cutover was a greenfield install. **That was wrong and it inverted the cutover decision.** OpenClaw is live on that box and was active the same day. The corrected finding is below; the original probes were individually accurate but the generalization drawn from them was not.

Probed live over Tailscale (`srv1456441` / 100.94.1.34):

**What is genuinely absent — iago-os v2, in full:**

```
iago-os-v2-daemon         → inactive / not-found (no unit file)
/etc/systemd/system/*iago → NO_IAGO_UNIT
/opt/iago-os              → does not exist   (/opt is empty)
/var/lib/iago-os          → does not exist
/etc/credstore.encrypted/ → empty
id iago                   → no such user
```

**What is genuinely running — the predecessor system:**

```
ilsantino  UID 1001  LINGER=yes  lingering
openclaw-gateway          pid 2865688, up 5d+, 2 ESTAB TLS → 149.154.166.110 (Telegram)
8× claude-agent-acp       up 145 days
hq/backend/server.js      running
~ilsantino/.openclaw/cron/     written 2026-08-17 17:16   ← same day
~ilsantino/.openclaw/devices/  written 2026-08-17 05:02   ← same day
/home/ilsantino           21G
```

**Why the original probe missed it.** OpenClaw runs as a *user-level* systemd unit under `user@1001.service`. User units never appear in `/etc/systemd/system` and do not surface in a root-context `systemctl list-units`. The original sweep checked exactly the paths iago-os v2 would occupy, found them empty, and generalized to "the box is empty" — a claim it never tested. `systemctl --user -M ilsantino@` also fails (`Failed to connect to system scope bus`), so the obvious follow-up probe is itself a dead end; what actually detects OpenClaw is the cheap filesystem check for `~ilsantino/.openclaw`.

`cutover.sh:481-489` documents this precise trap — a Codex P0 finding that root SSH cannot reach ilsantino's user systemd bus, which once made OpenClaw falsely report as stopped. The audit re-walked into a hazard the codebase had already logged.

**What survives unchanged:** iago-os v2 has never executed. `runtime/` contains the complete daemon (`agent-manager`, `cron-scheduler`, `file-bus`, `heartbeat`, `ipc-server`, `cred-bootstrap`, `markers`), the Telegram surface (`bot`, `commands`, `approval-bus`), and the full deploy kit — none of it installed, started, or provisioned. The Product A / Product B split in the headline stands.

**What reverses:** the cutover is a **migration, not a greenfield install**. T+00 (archive OpenClaw) and T+02 (BotFather rotation) are load-bearing, not stale steps. The split-brain they prevent is real and immediate: start the v2 Telegram bot on a token `openclaw-gateway` is already long-polling and Telegram hands each update to whichever poller wins the race. `IAGO_CUTOVER_GREENFIELD=1` must **not** be used on this box — and correctly aborts at pre-flight if it is.

**Separate gap, still open:** `cutover.sh` asserts a provisioned box (iago user, state root, `/opt/iago-os` checkout, built dist) and creates none of it — it fails closed. Those commands lived only as a human "Day -1" checklist in `runtime/migration/02-cutover-runbook.md § 3a`, never automated, and `runtime/deploy/README.md` wrongly claims cutover.sh performs them. `runtime/deploy/bootstrap-greenfield.sh` (written 2026-08-16, uncommitted) closes that gap and is reusable on the migration path despite its name. Migration pre-flight checks 3, 5, 6, 7 and 9 all fail today: no `/opt/iago-os` checkout (so `archive-openclaw.sh` is not on the box), no `/etc/iago-os/santiago-age.pub`, no `iago` user, no state root, no `op` on the operator machine.

### F2 — The public README describes a system that has never run.

`README.md` is public and states in present tense:

> "**iaGO-OS is a multi-agent OS** that hosts agents … on a Hostinger VPS reached over Tailscale, controlled from a phone via Telegram, observed through a web dashboard."
>
> "**Two layers, one repo.** The OS (v2) runs on the VPS."

Badges: `Runtime — Hostinger VPS + Tailscale`, `Phone-controlled — Telegram`, `Delivery layer — 37 skills + 12 agents`.

Against F1: no VPS runtime, no Telegram control, no dashboard. Skill count is 30, not 37 (agent count, 12, is correct). This is the single most misleading artifact in the repo — and it is also, plausibly, why the system *feels* like it should already be working.

### F3 — We measure the one repo that matters least.

`usage-tracker.mjs` is wired through `$CLAUDE_PROJECT_DIR` in **iago-os's own** `.claude/settings.json`. Result:

```
iago-os                     2,587 entries   (2026-04-03 → 2026-08-13)
clients/{din,fulldata,iago,munet-web,palazuelos,rsf,sentria}   no log at all
```

All telemetry describes work on the harness. Zero telemetry describes work delivered *with* the harness — which is the only work that pays. Every usage conclusion below is therefore about harness-development sessions only, and that limitation is itself the finding.

### F4 — 14 of 30 skills have never been invoked. Not once, in 388 sessions.

345 skill invocations, 28 distinct skills (including plugins). Real distribution:

```
iago-execute 59 · iago-prfix 43 · iago-plan 39 · iago-stress 30 · iago-quick 27
council 25 · iago-fast 24 · deep-research 22 · brainstorming 16 · dual-adversarial 8
dual-adversarial-fix 7 · xlsx 7 · codex:rescue 4 · graphify 3 · iago-discuss 3
frontend-bug-bounty 3 · iago-init 3 · artifact-design 3 · amplify-bug-bounty 2
subagent-driven-development 1 · iago-verify 1 · lead-hunt 1 · security-review 1 · loop 1
```

**Never used (14):** `code-review`, `content-engine`, `frontend-slides`, `iago-agents`, `iago-n8n`, `iago-onboard`, `iago-pause`, `iago-proposal`, `iago-scaffold`, `industry-patterns`, `investor-materials`, `investor-outreach`, `prompt-optimizer`, `visa-doc-translate`.

Six skills (`iago-execute/plan/stress/quick/fast/prfix`) carry 222 of 345 invocations — **64%**. That six-skill core plus `council`, `deep-research`, `brainstorming` and the dual-adversarial pair is the whole real product.

### F5 — 84% of agent dispatches go to two generic agents.

1,452 dispatches, 24 distinct agents:

```
analyst 675 · general-purpose 541          → 1,216 = 83.7%
research 207 · Explore 142 · executor 122 · content 74 · implementer 51
fullstack 48 · review-single 46 · frontend 35 · codex-rescue 26 · operator 22
backend 21 · review-full 14 · security-audit 12 · … · e2e 2 · infra 2
```

**Correction to the 2026-08-13 eval:** that document claimed the 9 `profiles/` were dead weight because "the live pipeline references none of them." That was too narrow. The profiles register as harness agent types and account for ~460 dispatches. They are used — just not by `execute-pipeline.js`. The cut recommendation was wrong; withdraw it.

The real signal is different: specialised routing is mostly theatre. `backend` 21, `frontend` 35, `e2e` 2, `infra` 2 against `analyst` 675 means the dispatcher reaches for a generic agent five times out of six.

### F6 — Structural sediment.

`.iago/` is 17 directories, ~700 files:

```
_archive 233 · reviews 136 · plans 101 · state 86 · summaries 47 · research 40
```

Live duplication:

- **Five** run-artifact directories — `.iago/runs`, `.iago/pipeline-runs`, `.iago/state/pipeline-runs`, `.iago/logs`, `.iago/state/pipeline-logs`. 77 files, newest **2026-05-29**. All dead.
- **Two** runbook directories — `.iago/runbooks/` (2 files) and `.iago/_config/runbooks/` (3). CLAUDE.md's routing table names only the second.
- **Three** worktrees, two stale: `pr100-fix` (PR #100 already merged as `01d9529`) and `caja-exec` (holding `main` four commits behind).

Note the scaffold is *not* the problem: `templates/client-project/` is **12 files**. That instinct was aimed at the wrong target.

### F7 — The code is healthy.

Full `runtime/` suite, run live:

```
Test Files  2 failed | 24 passed (26)
Tests       2 failed | 722 passed | 24 skipped (748)     18.2s
```

Both failures are the **known Windows-only fs-permission flakes** already documented in STATE.md — `cred-bootstrap` (can't `chmod 000` on Windows, so the unreadable-credential path never triggers) and `approval-bus` (same root cause). Not real defects. They do mean the daemon's failure paths are **untested on the platform you develop on**, which is worth knowing before a cutover you drive from this box.

### F8 — Mass: this is a real codebase, not a prompt pile.

```
prompt (.md)   41,512 words / 81 files   ← skills alone 32,014 (77%)
code           runtime      14,940 lines non-test + 20,747 test
               workflows     4,704
               scripts       7,274
               hooks           992
```

~28k lines of production code against ~41.5k words of prompt. The "it's all prompts" worry is unfounded. The 1.4:1 test-to-code ratio in `runtime/` is high — that's where the engineering went.

---

## anydoc (firecrawl/anydoc)

Rust library, document → clean GitHub-Flavored Markdown. Handles Word/PowerPoint/Excel/OpenDocument/RTF/EPUB/CSV/PDF. Ships CLI (`npx @firecrawl/anydoc file.docx`), Node/Python/WASM bindings, **and an Agent Skill for Claude Code**. Local conversion, no API key, no hosted dependency. No MCP server. Known limits: encrypted docs, image-only PDFs.

**Verdict: adopt, but size it honestly — this is a 30-minute job, not a project.**

It overlaps MarkItDown MCP, which we already use for exactly this. The case for adding it: anydoc is Rust and local (no Python dependency), and its office-format output is materially cleaner than MarkItDown's — which matters because client deliverables start as `.docx`/`.xlsx`. The case against replacing MarkItDown outright: MarkItDown covers YouTube transcripts and large-PDF ingestion, which anydoc does not.

**Recommendation:** install the agent skill, route office formats (`.docx/.pptx/.xlsx/.odt/.rtf/.epub`) to anydoc, keep MarkItDown for YouTube and PDF. One skill file plus an `npx` call. No MCP server to run.

Flagging the pattern, though: this is the third external repo evaluated in four days. The eval instinct is healthy; the throughput cost is not. Adopt this one because it's cheap and concrete, then close the intake for a while.

---

## What this means

The audit does not change the verdict from two days ago — it hardens it and corrects one point.

1. **Do not migrate.** Nothing in `addyosmani/agent-skills` replaces a 28k-line runtime, a review pipeline, or a daemon. Confirmed by measurement, not preference.
2. **Ship Product B.** It is finished, tested, and unplugged. **Blocked on a business decision, not a technical one (F1, corrected):** OpenClaw is live and was active on 2026-08-17, so the cutover is a migration that stops a system running continuously for 5 days. Santiago decides whether OpenClaw is abandoned. Then the migration path needs provisioning work that does not exist yet — `/opt/iago-os` checkout, an age key at `/etc/iago-os/santiago-age.pub`, the `iago` user, the state root, and `op` on the operator machine.
3. **Cut Product A to its real shape.** 14 unused skills, 5 dead run directories, 2 runbook directories, 2 stale worktrees. Keep the six-skill core and the profiles (F5 correction).
4. **Fix the README** (F2). It is public and it describes a system that has never run. Either ship Product B and make it true, or mark it roadmap. Right now it is neither.
5. **Move telemetry to where the work is** (F3). Ship the usage hook into client repos via the scaffold template. Without that, every future "are we using this right" conversation is speculation — including this one.
6. **Adopt anydoc**, then stop evaluating repos for a while.

**Open decision (Santiago's, unchanged):** the cutover. Production operation on the VPS — creates the `iago` system user, provisions credentials from 1Password into `/etc/credstore.encrypted/`, installs and starts the unit. `rollback.sh` exists, box is clean, blast radius low. Needs him at the keyboard for BotFather rotation and `op signin`.

---

# Addendum — stage attribution (2026-08-16)

**Question:** which review stage actually finds the findings that matter? Run before cutting any gate.

**Corpus:** 24 PRs with paired Opus/Codex review artifacts (`pr41–47`, `49–57`, `60–68`, `71–80`), 6 `synthesis-and-fixes.md` attribution tables, 1 `CONSOLIDATED.md`, plus round-commit history.

**Correction to the figure quoted in session:** review-round commits are **65**, not 171. The larger number came from an OR'd grep that matched any commit containing "round". 65 is the accurate count.

### SA1 — The two review systems are blind to each other. This is the real redundancy.

From `2026-05-28-dual-pr80-aggressive/CONSOLIDATED.md`, verbatim:

> "**Codex C-1 + C-2 remain unaddressed** because the async bot never saw the dual-adversarial findings; the loop only fixes what its own pass flagged."

The local dual-adversarial gate and the async GitHub `@claude` loop review the same diff, independently, and neither can see the other's findings. That produces **both** failure modes at once:

- **Duplicate work** — two full review systems re-deriving the same findings.
- **Dropped Criticals** — C-1 (duplicate dispatch race) and C-2 (shutdown path that resolves a task without ever sending it — silent data loss on every restart coinciding with a pending task) were found locally, and the async loop closed the PR loop without touching them.

This is worth more than any stage deletion. It is also subtraction: wire the dual-gate findings into the async loop's input and the loop stops re-deriving what's already known.

### SA2 — Codex is high-variance, and that variance is worth paying for.

Head-to-head, unique findings per leg:

| PR | Codex unique | Opus unique | Both | Note |
|---|---|---|---|---|
| 71 | **5** (4 High) | 1 Critical | 1 | Codex dominant |
| 72 | 1 High | **8** | 2 | Opus dominant |
| 76 | **0** | 7 | 2 Critical | Codex added nothing |
| 78 | **0** | 5 | 2 | Codex leg produced *nothing at all* |
| 80 | **3** (2 Critical) | — | — | Opus missed both |

PR #80 is the decisive case. On C-1 Opus rated the duplicate-dispatch race "negligible for daily cadence"; Codex called it Critical. The synthesis records: *"Codex is right."* On C-2, *"Opus missed that the C1 fallback actively resolves the task"* — a data-loss path.

So the cross-model leg contributes nothing on 2 of 5 PRs and catches ship-stoppers the primary reviewer missed on 2 others. That asymmetric payoff is exactly the shape you keep.

**But it fails silently.** On PR #78 the leg is logged as *"partial — context-read only, no structured findings written."* Zero output, no alarm. That matches the already-logged `codex-pipeline-noop` incident (call `codex-companion` directly with `--base`; verify a non-empty target diff). **Fix the no-op; keep the leg.** A gate that silently produces nothing is worse than no gate, because it reports success.

### SA3 — Round depth: the tail is a fix-quality problem, not a review-quantity problem.

```
round1  36        round2   8        round3   3        round4   6        round5   4
```

63% of fix commits land in round 1. But rounds 4–5 still account for 10 commits, so the tail is not empty — and PR #72 shows why: **Round 1 fixed 2 findings and left 8 OPEN.** Later rounds exist because fixes are incomplete, not because reviews keep finding new things.

**This reverses my earlier recommendation.** Capping the async loop 5 → 2 would truncate the fix cycle without addressing why fixes are incomplete, and would strand exactly the findings SA1 shows already get stranded. Fix the blindness (SA1) and the fix-completeness first; rounds should collapse on their own. Then measure, then cap. Not before.

### SA4 — What I can't answer from artifacts

Nothing in the corpus attributes findings to pass 1 vs pass 2 vs pass 3 of the Opus reviewer — the legs are logged whole. The "3-pass → 1-pass" cut therefore has **no evidence behind it either way**. Instrument the passes before cutting rather than guessing; that's a one-line telemetry change.

### Revised Plan A

| Item | Before | After data |
|---|---|---|
| Async cap 5→2 | cut | **Hold.** Fix SA1 blindness first, then measure |
| Opus 3-pass → 1 | cut | **Hold.** Instrument passes first — zero evidence |
| Codex leg | keep | **Keep + fix silent no-op** (SA2) |
| Wire dual findings → async loop | — | **NEW, top priority** (SA1) |
| `code-review` skill | delete | delete — 0 invocations, duplicate gate |
| `stress --deep` | delete | delete — `/council` covers it |
| 5 run dirs → 1, 2 runbook dirs → 1 | delete | delete — 77 dead files |
| Agent `profiles/` | ~~cut~~ | keep — ~460 dispatches (F5) |

Net: fewer deletions than I proposed in session, one new item that matters more than all of them. Two of my three headline cuts were unsupported by evidence, and the data said so.

## Sources

- Live VPS probe over Tailscale, 2026-08-16
- `.iago/state/usage-log.jsonl` — 2,587 entries, 2026-04-03 → 2026-08-13, 388 sessions, 76h
- `runtime/` vitest run, 2026-08-16 — 722 pass / 2 known Windows flakes / 24 skipped
- `README.md`, `runtime/deploy/README.md`, `runtime/deploy/cutover.sh`, `.claude/settings.json`
- Prior: `.iago/research/2026-08-13-agent-skills-eval.md` (F5 correction applies to it)
