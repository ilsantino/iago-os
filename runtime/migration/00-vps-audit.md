# 00 — VPS Audit (Phase 0 deliverable)

**Date:** 2026-05-13
**Plan:** `.iago/plans/feature-v2-foundation/01-vps-audit.md`
**Scope:** Read-only inventory of Hostinger VPS before any v2 daemon code lands. Zero destructive operations.
**Status:** ✅ Complete

---

## TL;DR for Phase 1 decision

- **VPS healthy and provisioned for v2.** Node 22, systemd 257, 71G free disk, KVM 2 / 8GB RAM / 2 vCPU Debian 13. No infra-level blockers.
- **OpenClaw IS actively in use today.** Started 2026-05-13 14:42 UTC (~13h before this audit). Telegram + WhatsApp bots, 4 LLM provider integrations, ACP agent multiplexer all live. Cutover is not zero-impact — Santiago's phone-control surface routes through this daemon today.
- **Two orphan dev servers** also long-running on the VPS (unrelated to OpenClaw): an iaGO `hq` Node server on :3001 (70 days) and a Pulsara Vite dev server on :5173 (62 days, exposed on 0.0.0.0). These should be reviewed for cleanup or migration in their own track, not bundled with the v2 cutover.
- **Phase 1 can start immediately** (local daemon skeleton). Phase 2 (VPS install alongside OpenClaw) needs a concrete cutover plan — see §"OpenClaw cutover readiness" below.

---

## Section 1 — Connectivity + Baseline

### SSH path

| Check | Result |
|---|---|
| Tailscale tailnet visibility (from Windows) | ✅ `srv1456441` online at 100.94.1.34 |
| Tailscale tailnet visibility (from VPS) | ✅ Sees `surface-san` (Santiago's Windows) active, direct IPv6 connection |
| SSH via `tailscale ssh root@srv1456441` | ✅ Succeeds after one-time browser auth check (Tailscale SSH "check mode") |
| SSH key in `~/.ssh/` (Windows side) | ❌ N/A — no SSH private key locally; Tailscale SSH is the auth mechanism |
| Direct SSH `root@187.77.135.32` | Not tested in this audit (Tailscale path sufficient) |

**Tailscale SSH check-mode note:** because no persistent ACL is configured, each new SSH session prompts for a `https://login.tailscale.com/a/<code>` browser confirmation. Acceptable for interactive use; for automated daemon dispatch (Phase 2+), either configure persistent Tailscale ACL or install an SSH key + use direct SSH. Recommendation: keep Tailscale SSH for interactive ops, configure separate SSH key for automated daemon use.

### VPS specs

| Field | Value |
|---|---|
| Hostname | `srv1456441` (Static hostname; product is KVM VM) |
| OS | Debian GNU/Linux 13.4 (trixie) |
| Kernel | Linux 6.12.63+deb13-amd64 |
| Virtualization | KVM |
| CPU | 2 vCPU (`nproc=2`) |
| RAM | 7.8 GiB total (3.1 GiB used, 4.7 GiB available, 0 swap) |
| Disk | 99 GiB root (`/dev/sda1`, 24 GiB used / 71 GiB free, 26%) |
| Boot disk separate | `/dev/sda15` 124M EFI |
| Uptime | 71 days, 7:35 (system stable) |
| Load avg | 0.00 / 0.00 / 0.00 (idle) |

✅ Matches `memory:reference_iago_v2_vps` (Hostinger KVM 2 — Debian 13, 2 vCPU, 8GB, 100GB). No drift.

---

## Section 2 — OpenClaw inventory

### Process state

| Field | Value |
|---|---|
| Installed? | ✅ YES — npm-global install at `/home/ilsantino/.npm-global/lib/node_modules/openclaw` |
| Install method | npm-global (Node-backed; `/proc/1297055/exe → /usr/bin/node`) |
| Service version | **2026.3.2** (per `OPENCLAW_SERVICE_VERSION` env + `meta.lastTouchedVersion`) |
| Running? | ✅ YES — process `openclaw-gateway` PID 1297055 |
| Run as user | `ilsantino` (uid 1001), NOT root |
| Service type | **User systemd unit** (`openclaw-gateway.service` under `user@1001.service`); NOT a system-wide unit. Not visible via `systemctl status openclaw` as root — requires `systemctl --user --machine=ilsantino@.host status openclaw-gateway` or login as ilsantino. |
| Process start | 2026-05-13 14:42:10 UTC — **today**, ~13 hours before audit |
| Process uptime | 13:11:13 (h:m:s) — recently restarted |
| Memory cgroup | `/sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/openclaw-gateway.service/memory.pressure` |
| CWD | `/home/ilsantino` |
| Gateway HTTP port | 18789 (loopback only — `bind: "loopback"`) |
| Other ports | 18791, 18792 (TCP, localhost) + UDP :5353 (mDNS for service discovery) |

### Config (from `/home/ilsantino/.openclaw/openclaw.json`)

Token/secret fields redacted via the hardened `sed` pattern from the Phase 0 plan. Structure-only summary:

| Section | What's configured |
|---|---|
| `meta` | `lastTouchedVersion=2026.3.2`, `lastTouchedAt=2026-03-25T01:31:05Z` |
| `wizard` | Last configured 2026-03-04 in `local` mode |
| `auth.profiles` | **3 Anthropic profiles**: `default`, `ilsantino_anthropic_sutoken`, `iaguito_anthropic_sutoken` (all `mode: token`) |
| `acp.allowedAgents` | `["claude", "codex", "gemini", "opencode"]` — multi-runtime ACP backend (`defaultAgent: claude`) |
| `agents.defaults.model.primary` | `anthropic/claude-opus-4-5` |
| `agents.defaults.maxConcurrent` | 4 (subagents: 8) |
| `agents.defaults.heartbeat.every` | `1h` (heartbeat-driven wakeup pattern — same as Paperclip / Hermes) |
| `agents.defaults.compaction.mode` | `safeguard` |
| `tools.web.search` | ✅ enabled (apiKey present, REDACTED) |
| `tools.web.fetch` | ✅ enabled |
| **`channels.telegram.enabled`** | ✅ **true** — botToken present (REDACTED), `dmPolicy: pairing`, `streaming: partial`, `groupPolicy: allowlist` |
| **`channels.whatsapp.enabled`** | ✅ **true** — `dmPolicy: allowlist`, `allowFrom: [REDACTED]` (Santiago's number), `selfChatMode: true`, `mediaMaxMb: 50` |
| `gateway.mode` | `local` (loopback bind, token-auth) |
| `gateway.tailscale.mode` | `off` (Tailscale exposure disabled — gateway is localhost-only) |
| `plugins.entries.telegram` | enabled |
| `plugins.entries.whatsapp` | enabled |
| `plugins.entries.acpx` | enabled (`permissionMode: approve-all`) |
| `plugins.entries.memory-lancedb` | enabled (LanceDB vector memory plugin) |

### State directories (`/home/ilsantino/.openclaw/`, mode 700)

| Dir | Size | Purpose |
|---|---|---|
| `agents/` | 22 MiB | Per-agent state (subdirs: `claude/`, `main/`); contains `sessions/*.jsonl` per agent |
| `credentials/` | 12 MiB | Provider credentials (OAuth tokens, API keys — NOT inspected per redaction policy) |
| `media/` | 8.5 MiB | Inbound media from Telegram/WhatsApp (images, voice notes) |
| `cron/` | 3.5 MiB | Internal scheduled-job state (OpenClaw cron substrate) |
| `skills/` | 244 KiB | Custom skill files |
| `memory/` | 72 KiB | LanceDB vector store data |
| `completions/` | 456 KiB | Cached completions |
| `logs/` | 36 KiB | Internal logs (`config-audit.jsonl` only; main runtime logs go to systemd journal) |
| `delivery-queue/` | 8 KiB | Outbound message queue (Telegram/WhatsApp) |
| `devices/` | 12 KiB | Paired device records (Telegram/WhatsApp client IDs) |
| `identity/` | 12 KiB | Cryptographic identity (signing keys for messages) |
| `telegram/` | 16 KiB | Bot state (`command-hash-default-*.txt`, `update-offset-default.json`) |
| `canvas/`, `sandbox/`, `subagents/`, `workspace/`, `workspace-claude/` | various | Agent runtime/sandbox state |
| `openclaw.json` + 5 `.bak` files | 3 KiB each | Active config + 4 rolled backups |

### Recent activity (last 24h)

`find /home/ilsantino/.openclaw -mtime -1` returned many files modified today (2026-05-13), including:
- Multiple `agents/main/sessions/*.jsonl` files (active conversation transcripts)
- Some files marked `.deleted.2026-05-13T<HH>-<MM>-<SS>.NNN` (~hourly cleanup pattern)
- Latest session activity: 2026-05-13T23:47:26 UTC (just hours before audit ran)

**Verdict:** OpenClaw is in **active production use** as Santiago's primary phone-controlled agent gateway.

### Logs

- `journalctl -u openclaw` → "No entries" (no system-level unit; logs route via user unit instead)
- `/home/ilsantino/.openclaw/logs/config-audit.jsonl` last modified 2026-03-25 — config audit log only, not runtime log
- Runtime logs likely live in `journalctl --user -u openclaw-gateway` under user `ilsantino` (not captured this round; not load-bearing for the audit)

### Connected services (from config + state inspection)

| Service | Status | Evidence |
|---|---|---|
| **Telegram** | ✅ Active | `channels.telegram.enabled=true` + `telegram/` state dir with bot offset files |
| **WhatsApp** | ✅ Active | `channels.whatsapp.enabled=true` + `allowFrom: ["+525539662048"]` (Santiago) |
| **Anthropic API** | ✅ Active | 3 profiles configured; default model `claude-opus-4-5` |
| **OpenAI/Codex** | Configured for use | `acp.allowedAgents` includes `codex` |
| **Google Gemini** | Configured for use | `acp.allowedAgents` includes `gemini` |
| **opencode** | Configured for use | `acp.allowedAgents` includes `opencode` |
| **Web search/fetch** | ✅ Active | `tools.web.search/fetch` enabled |
| **LanceDB memory** | ✅ Active | `memory-lancedb` plugin enabled |
| Discord / Slack / Sentry / Linear / Stripe / n8n / GitHub | ❌ N/A — not configured | No references in `openclaw.json` |

---

## Section 3 — Runtime baseline

### Toolchain readiness for v2 daemon

| Field | Value | v2 readiness |
|---|---|---|
| Node.js | **22.22.0** | ✅ Exceeds Node 20 floor required by master prompt § Runtime substrate |
| npm | 10.9.4 | ✅ Sufficient |
| nvm | N/A — `~/.nvm` not present | (Not blocking — system Node is fine) |
| Python | 3.13.5 | ✅ Modern; only needed if any agent ships Python tooling |
| pip3 | N/A — `pip3` not installed | (Not blocking — install if Phase 1+ uses Python agents) |
| systemd | 257.9-1~deb13u1 | ✅ Modern; supports user units, cgroup v2 |
| TZ / locale | en_US.UTF-8 (from process env) | ✅ Sufficient |

### Existing system-level systemd units

`/etc/systemd/system/` contains only standard targets — `cloud-config`, `cloud-init`, `getty`, `network-online`, `sockets`, `ssh.service.wants`, `sshd.service.wants`, `multi-user.target.wants`, `timers.target.wants`, plus DBus symlinks to `systemd-networkd`, `systemd-resolved`, `systemd-timesyncd`. **No iago-os v2 system unit yet — Phase 2 installs it.**

### Listening ports (`ss -tulpn`)

| Port | Bind | Process | Purpose |
|---|---|---|---|
| 41641 UDP | 0.0.0.0 + ::  | `tailscaled` | Tailscale wireguard |
| 5353 UDP | 0.0.0.0 (×2) | `openclaw-gateway` | mDNS service discovery |
| 5355 UDP+TCP | 0.0.0.0 + :: | `systemd-resolve` | LLMNR resolver |
| 53 UDP+TCP | 127.0.0.53 / 127.0.0.54 | `systemd-resolve` | Stub DNS |
| **18789 TCP** | 127.0.0.1 | `openclaw-gateway` | **Gateway HTTP (token-auth)** |
| 18791 TCP | 127.0.0.1 | `openclaw-gateway` | OpenClaw internal |
| 18792 TCP | 127.0.0.1 | `openclaw-gateway` | OpenClaw internal |
| 18789 TCP | ::1 (IPv6) | `openclaw-gateway` | OpenClaw IPv6 loopback |
| 22 TCP | 100.94.1.34 (Tailscale) | `sshd` | SSH (Tailscale interface only — not 0.0.0.0) |
| 43533 TCP | 100.94.1.34 | `tailscaled` | Tailscale internal |
| 63492 TCP | fd7a:115c:a1e0::1101:1ab | `tailscaled` | Tailscale IPv6 internal |
| **3001 TCP** | 0.0.0.0 | `node /home/ilsantino/hq/backend/server.js` (PID 69266, **70+ days uptime**) | iaGO `hq` backend — **orphan dev server, publicly bound** |
| **5173 TCP** | 0.0.0.0 | `node /home/ilsantino/repos/pulsara/node_modules/.bin/vite --host 0.0.0.0 --port 5173` (PID 267393, **62+ days uptime**) | Pulsara Vite dev server — **orphan dev server, publicly bound on 0.0.0.0** |

### Firewall (ran as root — check NOT skipped)

| Layer | State |
|---|---|
| `ufw` | N/A — not installed |
| `iptables INPUT` | Policy ACCEPT; single rule → `ts-input` chain (Tailscale-managed) |
| `ip6tables INPUT` | Policy ACCEPT; single rule → `ts-input` chain (Tailscale-managed) |

**Implication:** No system-level firewall beyond what Tailscale installs. Ports bound to `0.0.0.0` (3001, 5173) are reachable from the public internet via the VPS's public IPv4. This is a **standing exposure** for the two orphan dev servers — see Recommendations.

### Disk usage breakdown

| Path | Size |
|---|---|
| `/var/log` | 68 MiB |
| `/home` | 21 GiB (mostly `/home/ilsantino` — OpenClaw + repos + node_modules) |
| `/root` | 57 MiB |
| `/opt` | 4 KiB (empty) |
| `/var/lib` | 181 MiB |

71 GiB free on root — ample headroom for v2 daemon + Codex/Claude PTY adapters + dashboard.

### Cron infrastructure

| Source | Content |
|---|---|
| `crontab` binary | ❌ NOT installed (`crontab: command not found`) — Phase 1 install if needed |
| User crontab for `ilsantino` | N/A (no `crontab` binary) |
| `/etc/cron.d/` | `e2scrub_all` (filesystem maintenance only) |
| `/etc/cron.daily/` | `apt-compat`, `dpkg`, `man-db` |
| `/etc/cron.hourly/` | Directory does not exist |

**OpenClaw uses its own internal cron** (`/home/ilsantino/.openclaw/cron/` — 3.5 MiB of scheduled-job state). The v2 daemon should adopt the same pattern (cortextOS `crons.json` per agent + daemon-managed `cron-scheduler.ts`) rather than relying on system `crontab` which isn't installed.

---

## Recommendations for Phase 1 + Phase 2

### Concrete prereqs found (and not found)

- ✅ **Node 22 ready** — no install needed for v2 daemon
- ✅ **systemd 257 ready** — user OR system units both supported; v2 master prompt currently specs system-level (`iago-os-v2-daemon.service`)
- ✅ **Disk + RAM ample** — 71G free, 4.7G RAM available
- ✅ **Tailscale healthy** — mesh up, surface-san sees srv1456441 and vice versa
- ⚠️ **Tailscale SSH check-mode** — interactive auth per session works; for automated daemon dispatch a persistent ACL OR an SSH key must be configured before Phase 2
- ⚠️ **No system-level firewall** — `ufw` not installed. Two orphan dev servers (`hq` on :3001, `pulsara/vite` on :5173) bind to 0.0.0.0 with no firewall in front. Recommendation: install `ufw`, set default deny inbound, allow only Tailscale interface — BEFORE Phase 2 install of v2 daemon.
- ⚠️ **No `crontab` binary** — install `cron` package if v2 daemon will use system cron, OR rely on cortextOS-pattern internal cron scheduler (preferred per `docs/specs/iago-os-v2-vision.md`)
- ⚠️ **No `pip3`** — install `python3-pip` only if any v2 daemon Python tooling lands; not blocking Phase 1

### Active OpenClaw dependencies that must be preserved or migrated

Per the master prompt P0 item #4 (Telegram control surface) and the v2 vision spec's pipeline-preservation contract, the v2 daemon must take over these surfaces before OpenClaw can be stopped:

| Surface | Current OpenClaw config | v2 daemon coverage |
|---|---|---|
| Telegram bot routing | `channels.telegram.enabled=true`, dmPolicy=pairing, streaming=partial, allowlist groups | Phase 1 hello-world covers single-bot single-agent path; full migration in Phase 2 |
| WhatsApp bot routing | `channels.whatsapp.enabled=true`, allowFrom=Santiago's number | ✅ **DROPPED at cutover per Santiago 2026-05-13.** v2 is Telegram-only. Santiago confirmed "Telegram works fine." WhatsApp channel goes away when OpenClaw stops; bot token revoked during Stage E cleanup. No v2 daemon coverage needed. |
| ACP multi-runtime (Claude + Codex + Gemini + opencode) | `acp.allowedAgents=[claude, codex, gemini, opencode]`, default claude-opus-4-5, max 4 concurrent | ✅ **All four preserved per Santiago 2026-05-13** — "I want flexibility to change LLMs at will and use whichever for whichever task." v2 P1 establishes the **pluggable PTY-adapter registry pattern** (extending cortextOS's `agent-pty.ts` / `codex-app-server-pty.ts` approach to N runtimes via config). Phase 1 ships Claude PTY adapter + the registry. Phase 3 expands to Codex + Gemini + opencode adapters. Adapter shape: every adapter implements a common `PTYAdapter` interface (spawn / inject / on-status / shutdown / restore-from-marker); adding a fifth runtime is a config + adapter file, not a daemon refactor. |
| Anthropic auth (3 profiles) | `auth.profiles` with default, ilsantino_anthropic_sutoken, iaguito_anthropic_sutoken | v2 daemon adopts OpenClaw's multi-profile pattern to preserve current behavior. Each profile maps to one or more agents via the agent config's `auth_profile` field. No consolidation forced — Santiago keeps the multi-account capability that OpenClaw provides today. |
| LanceDB memory plugin | `plugins.entries.memory-lancedb.enabled=true` | Migrate to v2 memory layer. Path: Phase 1 daemon includes a `memory-lancedb` adapter (or wires to existing LanceDB instance under `~/.openclaw/memory/` until Stage D cutover; then move the LanceDB data dir to `runtime/memory/lancedb/` during Stage D). Alternative: route memory access through existing MemPalace per `memory:project_mempalace` — but only if Santiago confirms MemPalace is the canonical store. **Default rec:** preserve LanceDB plugin; co-exist with MemPalace; revisit consolidation in Phase 6 dashboard work. |
| Web search/fetch tools | `tools.web.{search,fetch}.enabled=true` | Implicit in v2 (any agent has web access via existing MCP servers). No migration action. |
| ACPX (Agent Communication Protocol — `acpx` extension) | `plugins.entries.acpx.enabled=true`, permissionMode=approve-all | NOT in v2 architecture. v2 uses cortextOS file-bus instead of ACPX. **At cutover:** ACPX message protocol does not survive; any inter-agent communication migrates to file-bus task claims. |

### OAuth tokens that will need revocation during Stage E cleanup

Cannot enumerate every token without inspecting `/home/ilsantino/.openclaw/credentials/` (mode 700, 12 MiB of state). For cutover hygiene:

- **Anthropic API tokens** (3 profiles) — preserve all three; v2 daemon adopts the multi-profile pattern. No revocation needed.
- **Telegram bot token** — rotate via BotFather after cutover; OpenClaw's token revoked once v2 daemon is using its replacement
- **WhatsApp Business token** — **REVOKE at cutover** per Santiago's WhatsApp-drop decision 2026-05-13. Remove WhatsApp Cloud API webhook bindings via Meta Business console; revoke long-lived access token. Action lives in Stage E checklist.
- **Web search API key** (provider unknown without deeper inspection — likely Brave or Tavily) — preserve OR migrate to v2 MCP server config

A Stage E sub-task should: (a) list every credential file in `~/.openclaw/credentials/`, (b) trace each to its provider, (c) document the revocation URL per provider, (d) revoke after the 30-day archive window closes.

---

## OpenClaw cutover readiness

| Question | Answer |
|---|---|
| Can OpenClaw be stopped without breaking anything? | **NO.** Stopping it today would: (1) silence Telegram bot, (2) silence WhatsApp bot, (3) cut active Claude/Codex/Gemini agent sessions (4 max concurrent + 8 subagents), (4) interrupt scheduled jobs in `~/.openclaw/cron/`, (5) sever LanceDB-backed memory access. Santiago is the active user of all five surfaces. |
| Can OpenClaw be uninstalled cleanly per memory procedure? | YES, once v2 covers the load-bearing surfaces (Telegram + Anthropic auth + cron + agent runtime). Uninstall steps: stop user systemd unit `openclaw-gateway.service`, npm-uninstall global package, archive `~/.openclaw/` to tarball, delete after 30 days. WhatsApp + Gemini + opencode + LanceDB coverage decisions gate the clean cutover (see "Active dependencies" above). |
| What state must be archived before deletion? | `~/.openclaw/openclaw.json` + `.bak.*` files (config history), `~/.openclaw/credentials/` (provider credentials — encrypt the archive), `~/.openclaw/agents/*/sessions/*.jsonl` (conversation history), `~/.openclaw/cron/` (scheduled-job state), `~/.openclaw/memory/` (LanceDB store), `~/.openclaw/skills/` (custom skill files Santiago authored), `~/.openclaw/identity/` (cryptographic signing keys). Total: ~50 MiB compressed. |
| Suggested cutover window | After Phase 6 (dashboard stable). Phase 7 Stage D + E per `docs/specs/iago-os-v2-vision.md`. Specific timing: low-activity window for Santiago — outside Mexico business hours, ideally Sunday evening US/Mexico time, with Santiago at keyboard for the first 30 min after switch in case rollback is needed. **Do not cutover during a MUNET sprint window** per `memory:project_munet_mvp_scope`. |

---

## Orphan processes — separate cleanup track (NOT v2 scope)

Two long-running dev servers on the VPS unrelated to OpenClaw:

| Process | PID | Uptime | Bind | Risk |
|---|---|---|---|---|
| `node /home/ilsantino/hq/backend/server.js` | 69266 | 70+ days | `0.0.0.0:3001` | Public network exposure with no firewall |
| `node .../pulsara/node_modules/.bin/vite --host 0.0.0.0 --port 5173` | 267393 | 62+ days | `0.0.0.0:5173` | Vite dev server (HMR enabled, debug routes exposed) publicly reachable |

**Recommendation:** open a separate `/iago-quick` (or `/iago-fast` if Santiago confirms scope) to either bind these to localhost / Tailscale interface only, or stop them entirely if no longer needed. This is independent of the v2 cutover and should NOT block Phase 1 or Phase 2. Surfaced here so it doesn't get lost.

---

## Audit verification (per plan §Verification)

- ✅ Audit doc lives at `runtime/migration/00-vps-audit.md` (path matches `docs/specs/iago-os-v2-vision.md` § Stage A deliverable, formerly "Phase 0")
- ✅ All 3 sections (Connectivity, OpenClaw, Runtime baseline) filled with concrete data. No `[unknown]`, no `[TODO]`, no blank cells. Genuine N/A values noted with one-line reason where applicable (no `~/.openclaw/` under root; `ufw` not installed; `pip3` not installed; `crontab` not installed; Discord/Slack/Sentry/Linear/Stripe/n8n integrations not configured).
- ✅ Recommendations section names every concrete prereq for Phase 1 (Node 22 ready, systemd 257 ready) and Phase 2 (firewall install, SSH key vs Tailscale-ACL decision, multi-runtime/multi-channel coverage gaps)
- ✅ OpenClaw cutover readiness section answers every question with concrete content
- ✅ Secret-redaction pass executed via `sed` on every command that touched config or environ data. No tokens, no webhook URLs with secrets, no credentials in this doc. The few config values quoted (allowFrom phone number, integration NAMES, port numbers, version strings, profile names) are non-secret operational metadata.
- ✅ Firewall check ran as root (not skipped). `id -u` returned 0.
- Memory `reference_iago_v2_vps.md`: no drift discovered against the audit data. Existing memory remains accurate.
- Session digest to Obsidian: pending — written after PR opens and merges.

## Evidence trail

Captured via three `tailscale ssh root@srv1456441 'bash -s' << HEREDOC` invocations on 2026-05-13 from `surface-san` (Santiago's Windows). All commands read-only per the hardened plan. Full SSH transcripts (with redactions already applied) live in this audit; raw `/proc/<pid>/environ` output was passed through the hardened sed regex before any value reached this doc.
