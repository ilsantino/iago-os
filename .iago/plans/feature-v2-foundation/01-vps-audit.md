# Plan 01 — VPS Audit (Phase 0 of iaGO v2 build)

**Feature:** `feature-v2-foundation`
**Phase:** 0 (read-only audit before any v2 daemon code lands)
**Effort:** 0.5d
**Depends on:** nothing (this IS the first move)
**Blocks:** Phase 1 (daemon skeleton — needs VPS inventory to know what coexistence shape looks like)

---

## Why

Before any v2 daemon code touches the VPS, we need to know:
1. What is OpenClaw running RIGHT NOW that v2 must not break during cutover?
2. What systemd services are alive?
3. What's in `~/.openclaw/` (config, sessions, state)?
4. What OAuth tokens are connected and to which third-party services?
5. Is Tailscale healthy? Does the VPS appear as `srv1456441` on Santiago's tailnet?
6. Is the Node.js / Python / Docker baseline ready for v2 daemon install?

Santiago verbatim 2026-05-13: "i have no clue honestly, how can we check this? I havent used it in months." Therefore: cold audit, read-only, document everything, ship the artifact.

## Garry standard applies

Ship a complete inventory in one PR. Document what's there, what depends on what, what can be safely removed, what cannot. Include rollback steps for every recommended action. No "we'll figure out the OAuth tokens later" — list every connected service, every token, every revocation URL. Five more minutes of thoroughness saves an hour of recovery work if cutover hits a snag.

## Tasks

### Task 1 — SSH connectivity check + Tailscale validation

**Inputs:**
- VPS credentials per `reference_iago_v2_vps.md` memory: `root@187.77.135.32` (or `root@srv1456441.hstgr.cloud` via Tailscale)
- Tailscale node `srv1456441` should be online

**Process:**
1. From Santiago's Windows: `tailscale status` — confirm `srv1456441` appears online
2. SSH in via Tailscale: `ssh root@srv1456441.hstgr.cloud`
3. If Tailscale SSH fails, fall back to public IP: `ssh root@187.77.135.32`
4. On VPS: `uptime`, `cat /etc/os-release`, `free -h`, `df -h`, `nproc` — confirm specs match memory
5. `tailscale status` on VPS side — confirm it sees `surface-san`

**Outputs:**
- Section in `runtime/migration/00-vps-audit.md` titled "Connectivity + baseline" with:
  - SSH success confirmation
  - Tailscale tailnet members from VPS perspective
  - System specs (CPU/RAM/disk) for paper trail
  - Any anomalies (drift from memory, unexpected processes)

**Acceptance:**
- ✅ SSH session opens via Tailscale
- ✅ VPS sees `surface-san` on tailnet
- ✅ Specs match `reference_iago_v2_vps.md` (or drift documented)

---

### Task 2 — OpenClaw inventory (read-only)

**Inputs:**
- SSH session from Task 1
- OpenClaw uninstall procedure documented in `reference_iago_v2_vps.md` (DO NOT execute — read-only inventory only)

**Process — READ-ONLY commands only:**

1. **Is OpenClaw installed as a binary?**
   ```bash
   command -v openclaw && openclaw --version 2>&1
   which openclaw
   ```
2. **Is it running as a service?**
   ```bash
   systemctl status openclaw 2>&1 | head -30
   systemctl list-units --all | grep -i claw
   ps aux | grep -i openclaw | grep -v grep
   ```
3. **Gateway / daemon status?**
   ```bash
   openclaw gateway status 2>&1 || echo "no gateway command or not running"
   openclaw status 2>&1 || echo "no status command"
   ```
4. **Config + session state?**
   ```bash
   ls -la ~/.openclaw/ 2>&1 | head -30
   du -sh ~/.openclaw/* 2>&1 | head -20
   cat ~/.openclaw/config.json 2>&1 | head -50 || cat ~/.openclaw/*.config 2>&1 | head -50
   ```
5. **Connected OAuth tokens? (look for service names in config)**
   ```bash
   grep -riE "discord|slack|google|github|telegram|sentry|linear" ~/.openclaw/ 2>&1 | head -40
   ```
6. **Logs — last 200 lines?**
   ```bash
   journalctl -u openclaw --since "7 days ago" --no-pager 2>&1 | tail -200
   ls -la ~/.openclaw/logs/ 2>&1 | head -10
   ```
7. **Install method?**
   ```bash
   npm list -g 2>/dev/null | grep -i openclaw
   pnpm list -g 2>/dev/null | grep -i openclaw
   dpkg -l | grep -i openclaw 2>&1
   which openclaw && file $(which openclaw)
   ```

**Outputs:**

Section in `runtime/migration/00-vps-audit.md` titled "OpenClaw inventory" with:

| Field | Value |
|---|---|
| Installed? | yes/no + binary path |
| Install method | npm-global / .deb / standalone-binary / unknown |
| Service status | running / stopped / not-a-service |
| Gateway running? | yes/no + PID |
| Config directory size | du output |
| Connected services | discord/slack/google/github/etc. with config-line evidence |
| Recent activity (last 7d) | yes/no, last timestamp from logs |
| Active dependencies | list of workflows / scheduled jobs / webhooks defined in config |

**Acceptance:**
- ✅ Every read-only command above ran and was captured
- ✅ Section in audit doc filled with concrete values, no `[unknown]` placeholders
- ✅ Active dependencies list is complete — if config references e.g. `discord_webhook_url`, list it

---

### Task 3 — Runtime baseline (what v2 daemon will need)

**Inputs:**
- SSH session

**Process — READ-ONLY:**

1. **Node.js + npm:**
   ```bash
   node --version 2>&1 || echo "not installed"
   npm --version 2>&1 || echo "not installed"
   nvm list 2>/dev/null || echo "nvm not installed"
   ```
2. **Python:**
   ```bash
   python3 --version 2>&1
   pip3 --version 2>&1
   ```
3. **systemd version + user units:**
   ```bash
   systemctl --version | head -1
   ls -la /etc/systemd/system/ | grep -v "@" | head -20
   ```
4. **Disk usage breakdown:**
   ```bash
   df -h
   du -sh /var/log /home /root /opt /var/lib 2>/dev/null
   ```
5. **Open ports + listening services:**
   ```bash
   ss -tulpn 2>/dev/null | head -30
   ```
6. **Firewall:**
   ```bash
   ufw status 2>&1 || iptables -L -n 2>&1 | head -30
   ```
7. **Existing cron jobs:**
   ```bash
   crontab -l 2>&1
   ls -la /etc/cron.{daily,hourly,weekly,monthly,d}/ 2>&1 | head -30
   ```

**Outputs:**

Section in `runtime/migration/00-vps-audit.md` titled "Runtime baseline" with:

| Field | Value |
|---|---|
| Node.js version | per node --version |
| npm version | per npm --version |
| Python version | per python3 --version |
| systemd version | per systemctl --version |
| Existing user units | filenames |
| Disk free | per df -h on / |
| Open ports | port + service mapping |
| Firewall posture | ufw / iptables summary |
| Existing cron jobs | per crontab -l + /etc/cron.* |

**Acceptance:**
- ✅ Every command captured
- ✅ Section in audit doc has concrete values
- ✅ Identifies what v2 daemon install needs to provision (e.g. "Node.js 20 not installed — Phase 1 will need to install")

---

## Deliverable artifact

`runtime/migration/00-vps-audit.md` — single file. Three sections (Connectivity, OpenClaw, Runtime baseline). Each section a filled-in table. End-of-doc:

```markdown
## Recommendations for Phase 1

Based on this audit, Phase 1 (daemon skeleton local + Phase 2 VPS install) must:
- [LIST CONCRETE BLOCKERS OR PREREQUISITES FOUND, e.g. "install Node.js 20 via nvm" or "Tailscale link is fine, no firewall changes needed"]
- [LIST OPENCLAW ACTIVE DEPENDENCIES THAT MUST BE PRESERVED OR MIGRATED]
- [LIST OAUTH TOKENS THAT WILL NEED REVOCATION DURING PHASE 4 CLEANUP]

## OpenClaw cutover readiness

| Question | Answer |
|---|---|
| Can OpenClaw be stopped without breaking anything? | yes / no — and what would break |
| Can OpenClaw be uninstalled cleanly per memory procedure? | yes / no — caveats |
| What state must be archived before deletion? | list |
| Suggested cutover window | when (timezone-aware, accounting for client work) |
```

## Non-goals (explicitly out of scope this plan)

- ❌ Run ANY destructive command (`rm`, `uninstall`, `systemctl stop`, OAuth revocation). This plan is READ-ONLY.
- ❌ Install Node.js or any package on VPS. Phase 1 handles install.
- ❌ Touch OpenClaw config or state. Phase 2 handles that, with explicit Santiago approval per step.
- ❌ Modify Tailscale ACLs.

## Verification (per Garry standard)

- [ ] Audit doc lives at `runtime/migration/00-vps-audit.md` (path matches v2 vision doc Phase 0 deliverable)
- [ ] All 3 sections filled with concrete data (no `[unknown]`, no `[TODO]`)
- [ ] Recommendations section names every concrete prereq for Phase 1
- [ ] OpenClaw cutover readiness section answers every question
- [ ] PR description includes: terminal screenshot or log excerpt proving the SSH session ran (evidence, not assertion)
- [ ] Memory `reference_iago_v2_vps.md` updated if any spec drift discovered
- [ ] Session digest written to Obsidian referencing the audit doc

## Pipeline note (per master prompt §Acceptance Criteria #7)

This plan is a READ-ONLY audit producing a single documentation deliverable. The full 8-stage pipeline is overkill. Verification path:
- **Tests:** N/A (no code shipped)
- **Build gate:** N/A
- **Review:** self-review + Santiago review of the audit doc before any Phase 1 work
- **Codex adversarial:** N/A
- **PR:** standard PR with audit doc as the diff

Equivalent to `/iago-fast` shape (single-doc deliverable). Invoke via `/iago-fast` OR manually via standard git workflow. Either is acceptable per pipeline-optional rule.
