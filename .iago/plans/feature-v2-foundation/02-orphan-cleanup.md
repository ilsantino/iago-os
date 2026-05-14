# Plan 02 — Orphan Dev Server Cleanup + VPS Firewall Hardening

**Feature:** `feature-v2-foundation`
**Phase:** 0.5 (post-audit cleanup; before Phase 1 daemon work starts)
**Effort:** 0.5–1d
**Depends on:** Plan 01 (VPS audit complete) — `.iago/plans/feature-v2-foundation/01-vps-audit.md` + `runtime/migration/00-vps-audit.md`
**Blocks:** nothing critical (Phase 1 can proceed in parallel); v2 daemon install in Phase 2 should not coexist with orphan public-bound dev servers

---

## Why

Phase 0 audit surfaced two long-running dev servers on the Hostinger VPS bound to `0.0.0.0` (publicly reachable via 187.77.135.32) with no `ufw` firewall:

| Process | PID | Uptime | Bind | Purpose |
|---|---|---|---|---|
| `node /home/ilsantino/hq/backend/server.js` | 69266 | 70+ days | `0.0.0.0:3001` | iaguito-hq.service (user systemd unit) — Express+WebSocket backend, NOT a git repo, has `ecosystem.config.js` (PM2 leftover) |
| `node .../pulsara/node_modules/.bin/vite --host 0.0.0.0 --port 5173` | 267393 | 62+ days | `0.0.0.0:5173` | Vite dev server for "alfallo" project (React 19 + Amplify Gen 2 + Stripe, matches iaGO stack) — dormant, no file changes in last 30 days |

**Concrete exposure:** anyone on the internet can reach `http://187.77.135.32:3001` and `http://187.77.135.32:5173`. A Vite dev server exposes HMR endpoints, source maps, and `vite.config.ts`-derived debug routes. Express backends with WebSocket can leak business logic if route handlers aren't auth-gated.

Santiago decision 2026-05-13: "clean it up I guess." This plan executes the cleanup with all read-only investigation already complete, every destructive command listed for per-action authorization, and a rollback path documented.

## Garry standard applies

Stop the exposed servers cleanly. Install `ufw` with default-deny inbound + allow only Tailscale + SSH from Tailscale. Document what each server was doing so Santiago can decide later whether to bring them back (rebound to localhost or via Tailscale-only). No "we'll firewall later." The firewall lands in this PR.

## Pre-execution authorization (REQUIRED before any task runs)

Before executing tasks below, Santiago must confirm each of these (one per task, written reply OK):

- [ ] **Task 1 (stop `iaguito-hq.service`)** — confirm the `hq` backend is not actively serving traffic Santiago depends on. Audit found zero active TCP connections to :3001 right now, no recent logs in user journal. If Santiago confirms "stop it," Task 1 proceeds.
- [ ] **Task 2 (disable `iaguito-hq.service` auto-start)** — confirm we are NOT just stopping for a reboot; the unit should remain disabled until Santiago re-enables. Reversible via `systemctl --user enable iaguito-hq.service`.
- [ ] **Task 3 (kill pulsara vite PID 267393)** — confirm pulsara/alfallo project does not need the dev server running. The git repo at `/home/ilsantino/repos/pulsara/` is preserved; only the running vite process stops. Reversible by `cd /home/ilsantino/repos/pulsara && npm run dev` (but rebind to localhost, see Task 5).
- [ ] **Task 4 (install `ufw` + default-deny inbound)** — confirm Santiago wants firewall hardening now. New rules: allow SSH from Tailscale interface only (already the case — sshd binds `100.94.1.34:22`); allow Tailscale UDP 41641; deny everything else inbound. Reversible via `ufw disable` + `apt purge ufw` if it breaks something.
- [ ] **Task 5 (no rebind / future use)** — confirm we are NOT rebinding either dev server to localhost-only as part of this plan. If Santiago wants either rebound (e.g., pulsara on `127.0.0.1:5173` for Tailscale-tunneled dev), that's a separate Task 6 to add now.

**Default authorization if Santiago says "do it":** Tasks 1–4 proceed; Task 5 does not run; Task 6 stays out of scope unless asked.

## Tasks

### Task 1 — Inspect `iaguito-hq.service` unit file, then stop the service

**Read-only inspection FIRST (always safe):**

```bash
# Inspect the user unit file
ssh root@srv1456441 'sudo -u ilsantino XDG_RUNTIME_DIR=/run/user/1001 systemctl --user cat iaguito-hq.service 2>&1 | head -40'

# Confirm process is the one we expect
ssh root@srv1456441 'ps -p 69266 -ww -o pid,user,ppid,etime,command 2>&1'

# Check current connections one more time before stop
ssh root@srv1456441 'ss -tnp sport = :3001 2>&1 | head -10'
```

If `ss` shows ANY active connection (`ESTAB`), STOP and ask Santiago whether to proceed.

**Destructive (requires per-action approval):**

```bash
ssh root@srv1456441 'sudo -u ilsantino XDG_RUNTIME_DIR=/run/user/1001 systemctl --user stop iaguito-hq.service 2>&1'
# Verify stopped
ssh root@srv1456441 'sudo -u ilsantino XDG_RUNTIME_DIR=/run/user/1001 systemctl --user status iaguito-hq.service 2>&1 | head -10'
# Confirm port released
ssh root@srv1456441 'ss -tlnp sport = :3001 2>&1'
```

**Acceptance:**
- ✅ `systemctl --user status iaguito-hq.service` shows `inactive (dead)`
- ✅ `ss -tlnp | grep :3001` returns no rows
- ✅ Audit doc field `Active dependencies` for hq backend marked stopped in follow-up edit

**Rollback (if anything depends on it):**
```bash
ssh root@srv1456441 'sudo -u ilsantino XDG_RUNTIME_DIR=/run/user/1001 systemctl --user start iaguito-hq.service'
```

### Task 2 — Disable `iaguito-hq.service` from auto-start

**Destructive (requires per-action approval):**

```bash
ssh root@srv1456441 'sudo -u ilsantino XDG_RUNTIME_DIR=/run/user/1001 systemctl --user disable iaguito-hq.service 2>&1'
# Verify disabled
ssh root@srv1456441 'sudo -u ilsantino XDG_RUNTIME_DIR=/run/user/1001 systemctl --user is-enabled iaguito-hq.service 2>&1'
```

**Acceptance:**
- ✅ `systemctl --user is-enabled iaguito-hq.service` returns `disabled`

**Rollback:**
```bash
ssh root@srv1456441 'sudo -u ilsantino XDG_RUNTIME_DIR=/run/user/1001 systemctl --user enable iaguito-hq.service'
```

### Task 3 — Stop pulsara vite dev server (PID 267393)

No systemd unit found for pulsara — process must be killed directly. SIGTERM first; SIGKILL only if it doesn't exit.

**Read-only verification FIRST:**

```bash
# Confirm PID still alive and is what we expect
ssh root@srv1456441 'ps -p 267393 -ww -o pid,user,etime,command 2>&1 || echo "process already gone"'

# Check active connections
ssh root@srv1456441 'ss -tnp sport = :5173 2>&1 | head -10'
```

If `ss` shows any active connection, STOP and ask Santiago.

**Destructive (requires per-action approval):**

```bash
# Send SIGTERM (graceful) — vite handles SIGTERM and shuts down esbuild workers cleanly
ssh root@srv1456441 'kill -TERM 267393 2>&1'
sleep 3
# Verify exit
ssh root@srv1456441 'kill -0 267393 2>&1 && echo "STILL ALIVE" || echo "EXITED OK"'
# If still alive after 5s:
ssh root@srv1456441 'sleep 5 && kill -0 267393 2>&1 && kill -KILL 267393 2>&1 || true'
# Verify port released
ssh root@srv1456441 'ss -tlnp sport = :5173 2>&1'
# Cleanup any lingering esbuild service workers (they're children of the vite process, should die with parent)
ssh root@srv1456441 'pgrep -f "esbuild --service" 2>&1 | head -5 || echo "no orphan esbuild workers"'
```

**Acceptance:**
- ✅ `kill -0 267393` returns non-zero (process gone)
- ✅ `ss -tlnp | grep :5173` returns no rows
- ✅ No orphan `esbuild --service` worker processes from PID 267393's tree

**Rollback (re-launch dev server, but BOUND TO LOCALHOST — not 0.0.0.0):**
```bash
# DO NOT use --host 0.0.0.0 in rollback. Default vite bind is localhost.
ssh root@srv1456441 'sudo -u ilsantino bash -c "cd /home/ilsantino/repos/pulsara && nohup npm run dev > /tmp/pulsara-vite.log 2>&1 &"'
```

### Task 4 — Install `ufw` + default-deny inbound + allow Tailscale only

**Read-only verification FIRST:**

```bash
# Confirm ufw still not present
ssh root@srv1456441 'command -v ufw 2>&1 || echo "ufw not installed (expected)"'

# Confirm Tailscale interface name (typically tailscale0)
ssh root@srv1456441 'ip addr show 2>&1 | grep -E "^[0-9]+: |inet " | head -20'

# Confirm current listening sockets one more time
ssh root@srv1456441 'ss -tlnp 2>&1 | head -25'
```

**Destructive (requires per-action approval):**

```bash
# Install ufw (Debian repo, signed package)
ssh root@srv1456441 'apt-get update 2>&1 | tail -5'
ssh root@srv1456441 'apt-get install -y ufw 2>&1 | tail -10'

# Default deny inbound, allow outbound
ssh root@srv1456441 'ufw default deny incoming 2>&1'
ssh root@srv1456441 'ufw default allow outgoing 2>&1'

# Allow SSH on Tailscale interface (not the public interface)
# NOTE: if 'ip addr show' above showed a Tailscale interface name other than 'tailscale0'
# (e.g., ts0), substitute that name in the command below before running it.
ssh root@srv1456441 'ufw allow in on tailscale0 to any port 22 proto tcp 2>&1'

# Allow Tailscale wireguard UDP on any interface
ssh root@srv1456441 'ufw allow in 41641/udp 2>&1'

# Allow ICMP (ping diagnostics) — optional but useful for ops
# NOTE: this allows ping from the public internet, increasing VPS discoverability.
# Low risk, but remove this rule if minimal surface area is preferred.
ssh root@srv1456441 'ufw allow in proto icmp from any 2>&1'

# Enable ufw — this APPLIES the rules. Confirm sshd binding survives the apply.
# CRITICAL: Tailscale SSH must remain reachable post-enable. Verify the allow rule for tailscale0 is in place BEFORE running 'ufw enable'.
ssh root@srv1456441 'ufw status verbose 2>&1'  # dry-run check (should show rules NOT yet active)
ssh root@srv1456441 'ufw --force enable 2>&1'

# Verify
ssh root@srv1456441 'ufw status verbose 2>&1 | head -30'

# Persist on reboot (ufw enables itself on boot once enabled)
ssh root@srv1456441 'systemctl is-enabled ufw 2>&1'
```

**Acceptance:**
- ✅ `ufw status verbose` shows `Status: active`
- ✅ Inbound default is `deny`, outbound default is `allow`
- ✅ Rule `Anywhere on tailscale0 ALLOW IN tcp/22` present
- ✅ Rule `41641/udp ALLOW IN` present
- ✅ SSH session from Tailscale (this one) remains alive post-enable
- ✅ External port scan from outside Tailscale shows no open TCP ports (test with `nmap` from Santiago's local machine against `187.77.135.32` — should show all ports filtered/closed)

**Rollback (CRITICAL — if Tailscale SSH drops after enable):**

If the Tailscale-allow rule is wrong and we lock ourselves out, the fallback is Hostinger's VPS console (browser-based, in their dashboard) which bypasses SSH. Steps:
1. Hostinger console → KVM Console → log in as root with VPS root password
2. `ufw disable`
3. Investigate, fix rule, re-test before re-enabling

To minimize lockout risk: this plan applies the allow rule BEFORE enabling, and a 30-second `ufw --force enable && sleep 30 && ufw disable` "dry-enable" test can be inserted before the persistent enable. Recommend executing the persistent enable with Santiago at the keyboard.

### Task 5 — Update audit doc + memory + write Obsidian session digest

After Tasks 1–4 complete:

1. Edit `runtime/migration/00-vps-audit.md` § "Orphan processes" section — mark both processes stopped, ufw enabled, document timestamps and remaining state (preserved repos at `/home/ilsantino/hq/` and `/home/ilsantino/repos/pulsara/`).
2. Append note to `memory:reference_iago_v2_vps.md`: "VPS firewall: ufw enabled with default-deny inbound + Tailscale-only SSH (configured 2026-05-XX). To allow new inbound: `ufw allow in on tailscale0 to any port <N>` (Tailscale-only) or `ufw allow <N>/tcp` (public, requires justification)."
3. Write Obsidian session digest at `sessions/2026-05-XX-vps-cleanup.md` referencing this plan + the post-cleanup state.

## Deliverable artifacts

- Updated `runtime/migration/00-vps-audit.md` (orphan processes section reflects post-cleanup state)
- Memory update to `reference_iago_v2_vps.md`
- Obsidian session digest

## Non-goals (explicitly out of scope this plan)

- ❌ Delete the `/home/ilsantino/hq/` directory or the `/home/ilsantino/repos/pulsara/` directory. Plan stops the running processes; preserves the codebases.
- ❌ Touch OpenClaw or any other actively-used service.
- ❌ Modify Tailscale ACLs.
- ❌ Install or configure any other software beyond `ufw`.
- ❌ Rebind either dev server (covered by an optional Task 6 if Santiago asks).

## Verification (per Garry standard)

- [ ] Pre-flight authorization received from Santiago for each destructive task
- [ ] Tasks 1–4 executed in order; each task's acceptance criteria met before moving on
- [ ] Post-execution port scan from outside the tailnet confirms no public exposure on :3001, :5173, or anything else not allowlisted
- [ ] Tailscale SSH session from `surface-san` to `srv1456441` continues to work after `ufw --force enable`
- [ ] `iaguito-hq.service` is `inactive` AND `disabled` (will not restart on reboot)
- [ ] Pulsara vite process is gone (PID 267393 → "no such process") AND no orphan esbuild workers
- [ ] Audit doc updated with post-cleanup state
- [ ] Memory entry updated
- [ ] Session digest written to Obsidian
- [ ] PR description includes: screenshot of `ufw status verbose` post-enable + before/after `ss -tlnp` comparison + screenshot of external port scan confirming no public exposure

## Pipeline note (per master prompt §Acceptance Criteria #7)

This plan executes destructive operations against production infrastructure (the VPS). It is NOT a `/iago-fast` shape (which is for trivial code edits). Verification path:
- **Skill routing:** **`/iago-quick`** (1-3 tasks, clear scope, runs full 8-stage pipeline review including Codex adversarial). Manual execution outside a skill is not the equivalent path.
- **Build gate:** N/A (no code shipped; ops only)
- **Tests:** N/A (no code)
- **Review:** plan compliance review + Codex adversarial review on the executed actions + diff to audit doc + memory edit
- **Authorization:** per-task Santiago confirmation captured in PR description (paste Santiago's "do it" / "go" replies as comment timestamps)

## Open question (resolve before execution)

- **Pulsara/alfallo project status.** The dev server is dormant (no file changes in last 30 days). Is this an active iaGO client project, a Santiago personal project, or fully abandoned? If active, schedule a separate work session to rebind to localhost and use Tailscale Funnel or a reverse SSH tunnel for remote dev access. If abandoned, this plan stops the server and the repo is preserved for archival. Answer needed for the audit doc's "Orphan processes" follow-up edit.
