---
name: iaGO v2 VPS + Tailscale credentials (2026-05-13)
description: Hostinger KVM 2 Debian 13 (Kuala Lumpur); SSH root@187.77.135.32 via Tailscale node srv1456441; OpenClaw running, must be inventoried + uninstalled during Phase 0 + Phase 2 of v2 build
type: reference
originSessionId: f67f8e4e-ccef-4f01-9b2f-792dbd289bed
---
**Hostinger VPS (production runtime for iaGO v2):**

| Field | Value |
|---|---|
| Plan | KVM 2 (auto-renew, expires 2027-03-03) |
| OS | Debian 13 |
| Location | Malaysia - Kuala Lumpur |
| CPU | 2 cores |
| RAM | 8 GB |
| Disk | 100 GB |
| Hostname | `srv1456441.hstgr.cloud` |
| IPv4 | `187.77.135.32` |
| SSH user | `root` |
| Uptime (as of 2026-05-13) | 71 days |

**Tailscale mesh:**
- VPS node name: `srv1456441` (Linux)
- Operator node: `surface-san` (Santiago's Windows)
- Both owned by `santiago@iagoag.com`

**OpenClaw status:** Running on VPS as of 2026-05-13. Santiago hasn't used it in months — unknown active dependencies. Phase 0 of v2 build = audit before any destructive action.

**OpenClaw uninstall procedure (apply during Phase 2 cutover, NOT before):**
1. `openclaw gateway stop`
2. Either `openclaw uninstall --all --yes --non-interactive` OR `npm uninstall -g openclaw` (depending on install method — audit first)
3. `rm -rf ~/.openclaw`
4. Revoke OAuth tokens for OpenClaw at Discord / Slack / Google / GitHub (whichever were connected)

**Permissioned operations:** Santiago shared root SSH credentials with Claude on 2026-05-13. Read-only audit (`ls`, `systemctl status`, `ps aux`, `cat ~/.openclaw/config.*`) is in scope for Phase 0. **Destructive operations (`rm`, `uninstall`, `systemctl stop`) require explicit per-action confirmation per CLAUDE.md "Executing actions with care."**

**SSH from Santiago's Windows (via Tailscale, no public IP exposure needed):**
```bash
ssh root@srv1456441.hstgr.cloud
# OR (over public internet)
ssh root@187.77.135.32
```
