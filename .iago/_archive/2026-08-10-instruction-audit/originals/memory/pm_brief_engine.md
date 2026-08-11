---
name: pm-brief-engine
description: "twice-weekly chief-of-staff brief (Mon Flight Plan + Fri Debrief) — local claude -p synthesis over inbox+git+vault, emailed to iagoag + saved to vault"
metadata: 
  node_type: memory
  type: project
  originSessionId: f8970735-dcb0-438e-a21c-e7a8544a09e1
---

Santiago's automated chief-of-staff briefs, set up 2026-06-30. Twice a week I email him an opinionated PM brief and save a copy to his Obsidian vault. Companion to the email automation in [[email-setup-iagoag]] (same Gmail token infra).

**Cadence (Windows Task Scheduler tasks):**
- **"iaGO Monday Flight Plan"** — Mondays 09:00, `--brief monday`. The week AHEAD: TL;DR, Needs-you-now, Inbox pulse, Project board, opinionated Top-5.
- **"iaGO Friday Debrief"** — Fridays 15:00, `--brief friday`. The week BEHIND + next week teed up: Shipped, Inbox this week, Loose ends, Next-week focus (seeds Monday).
- **"iaGO Daily Pulse"** — weekdays 18:30, `--brief daily` (added 2026-07-01). ALWAYS writes `obsidian-brain\daily\YYYY-MM-DD.md` (the auto-capture layer that was missing); EMAILS a short pulse only Tue/Wed/Thu (Mon/Fri skip the email — the strategic brief covers those days). Source = TODAY's raw Claude session transcripts (`~/.claude/projects/*/*.jsonl`, extract human-typed opening ask per session) + today's commits + today's new inbox. Sections: Today / Moved today / Still on you.
- All: StartWhenAvailable (catch missed runs), Interactive logon as Santiago (needs his user context for the Claude credential + Gmail tokens).

**Why the daily reads transcripts, not digests (grounded 2026-07-01):** session digests are written sparsely (9 in 14d, clustered on 3 days) and `daily/` was EMPTY — the "semi-auto" capture in the obsidian rules basically wasn't happening. Raw session `.jsonl` is the only reliable record of what we did (and catches non-committing work — e.g. building this brief engine produced 0 iago-os commits). So the daily job GENERATES the missing digest instead of consuming it; those digests then feed the Friday Debrief + Graphify nightly rebuild (compounds). Validated live 2026-07-01 (Wed): digest written + pulse emailed to inbox.

**How it works (per his 60/30/10 rule — gathering is deterministic, synthesis is the AI part):** `C:\Users\sanal\.iago-brief\pm-brief.py` collects a ~36k-char dossier from (1) BOTH Gmail inboxes via the stored google_workspace_mcp tokens — signal-only snapshot, promo/Newsletters/github-bot filtered out; (2) git log last-7d + `gh pr list` (authed as ilsantino) across iago-os + clients/{sentria,munet-web,din/dinpro-app,fulldata/web-pricing-mock}; (3) every `.iago/STATE.md`; (4) recent vault `sessions/` + `daily/` notes; (5) tail of the previous brief. It pipes dossier+persona prompt to a LOCAL headless **`claude -p`** (cwd = iago-os so MEMORY.md auto-loads → I get full project context for free; uses his Claude subscription, $0 extra, no API key). Output is emailed santiago@iagoag.com→self (gmail.send) and written to `obsidian-brain\briefs\YYYY-MM-DD-{flight-plan|debrief}.md`. Logs in `C:\Users\sanal\.iago-brief\logs\`.

**Scope (Santiago chose):** EVERYTHING, personal inbox (sanalvcham) in FULL detail — not business-only. Delivery = email + Obsidian copy.

**Validated 2026-06-30:** dry-run + a real live send both produced a high-quality brief (correctly fused RSF meeting, Fran/Absara cotización, Erika CASA ticket, ADRAC filings, the Supernal/Revolut/Incode/Kashio job pipeline, Sentria merged PRs, iago-os PR #99, IE masters, Finaccess BSI Miami). Live email confirmed in inbox (UNREAD,INBOX) + vault file written. `claude -p` headless via stdin works (claude.cmd for subprocess; claude.ps1 is the PS wrapper).

**Gotchas / how to change:**
- Console `print()` of emoji subjects crashes on Windows cp1252 — only affects interactive `--dry-run` console (run with `$env:PYTHONIOENCODING="utf-8"`); the scheduled/live path writes emoji only to email/vault/log (all utf-8) so it's unaffected. log() guards `sys.stdout` being None under pythonw.
- **Calendar NOT included** (stored token lacks calendar scope) — flagged gap; add by re-authing workspace-mcp with calendar scope or wiring the Google Calendar MCP.
- Test on demand: `python C:\Users\sanal\.iago-brief\pm-brief.py --brief friday --dry-run`. Change times/days: Task Scheduler. Disable: `Unregister-ScheduledTask "iaGO Monday Flight Plan" -Confirm:$false` (+ Friday).
- Tune content = edit the MONDAY/FRIDAY prompt templates in pm-brief.py; add a repo = REPOS list.
