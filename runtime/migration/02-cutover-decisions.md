# 02 — Cutover Decisions Log (Phase 2)

**Plan:** `.iago/plans/feature-phase-2-vps-bootstrap/03b-cutover-rollback-runbooks.md`
**Spec source:** `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` §§ 1, 3, 6, 7 + Santiago overrides 2026-05-13 + 2026-05-16

---

## 1. Purpose

Locked decisions made for Phase 2 cutover. Re-litigating these without
new evidence wastes cycles. **New evidence = explicit ADR overriding.**
If you reach for one of these decisions and find yourself wanting to
revisit it without a written-down argument that goes beyond what's in
this log, stop. The wanting-to-revisit is the bias; the entry below is
the considered position.

Each section ends with a **Reversibility** line stating what would need
to be true to revisit the decision. Reversibility is the explicit
escape hatch — it tells future-Santiago when the entry's reasoning has
genuinely expired vs. when re-litigation is just fatigue.

---

## 2. LanceDB drop (spec § 6)

**Verdict:** Option (b) — drop LanceDB, commit to MemPalace canonical.

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Move data dir to `runtime/memory/lancedb/` at cutover | Preserves continuity; OpenClaw's 72 KiB of facts not lost | LanceDB plugin adapter must land in v2 Phase 2 (out of scope per master prompt — adapters are Phase 3); creates a memory layer that competes with canonical MemPalace; carries forward Santiago's stated discomfort with "having a daemon and a memory store and a vector DB and..." complexity creep | REJECT |
| **(b) Drop LanceDB, commit to MemPalace canonical** | Single canonical memory layer (`memory:project_mempalace` already says this); ZERO v2 adapter work for memory in Phase 2; v2 daemon can call MemPalace MCP from Santiago's local box via Tailscale when memory recall is needed; the 72 KiB OpenClaw LanceDB content survives in the encrypted archive for 30 days if Santiago ever needs to extract a specific fact | LanceDB content needs explicit fact-extraction-to-MemPalace migration if any facts are load-bearing — but at 72 KiB this is one afternoon of work, not a Phase | **ACCEPT** |
| (c) Defer — keep LanceDB reading from old path during Phase 2, decide canonical store in Phase 6 | Lowest immediate change | Forces Phase 2 to wire a LanceDB adapter (out of scope); two memory systems coexist for 6+ weeks burning Santiago's cognitive load on a decision that's already made (MemPalace is canonical per memory) | REJECT |

**Action at cutover:** the 72 KiB of LanceDB data is preserved inside
the encrypted OpenClaw archive (Plan 02a `archive-openclaw.sh`). No
active migration. If Santiago wants to extract facts from it later, he
decrypts the archive (`age -d`), inspects `~/.openclaw/memory/`, and
either re-stores into MemPalace by hand or writes a small extraction
script — but this is **post-Phase 2 housekeeping**, not a cutover
blocker.

**Post-Phase 2 housekeeping path:** if/when Santiago decides any
LanceDB content is load-bearing, the extract path is
`age -d -i ~/.age/santiago.key -o openclaw.tar.gz openclaw-pre-cutover-*.tar.gz.age`
+ tar extract + `~/.openclaw/memory/` inspection + manual
MemPalace ingest. The 30-day archive retention (Plan 02a retention
timer) is the time-bounded budget for this decision. Past 30 days,
the archive is gone.

**Reversibility:** Re-add a LanceDB adapter to v2 (Phase 3+ work) only
if (a) MemPalace proves insufficient for a specific use case the
daemon cannot service via MCP-over-Tailscale, AND (b) the use case
requires sub-100ms vector recall (the only thing LanceDB-on-VPS would
buy vs. MemPalace-via-Tailscale). Until both conditions hold, the
decision stands.

---

## 3. User=iago system user (spec § 1)

**Verdict:** dedicated `iago` system user — NOT `ilsantino`, NOT `root`.

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `User=ilsantino` (current OpenClaw user) | Zero new user provisioning; existing SSH access | `ProtectHome=true` becomes useless (daemon would need /home/ilsantino access); daemon can read ilsantino's interactive-session data; daemon's state under /home/ilsantino is mixed with ilsantino's personal files | REJECT — fights ProtectHome= and leaks blast radius |
| `User=root` | No permission gymnastics | Daemon never needs root; violates least privilege; one Node CVE = root compromise | REJECT — Garry standard fails on day one |
| `User=iago` (new system user) | Clean isolation, `ProtectHome=true` meaningful, future multi-tenant cleanup trivial | One-time provisioning (5 lines in bootstrap script) | **ACCEPT** |

Provisioning command (lands in `runtime/deploy/cutover.sh` Day -1 prep
+ pre-flight gate):

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin --comment "iaGO-OS v2 daemon" iago
```

The `--system` flag assigns a UID below 1000 (system range), keeping
the user out of the interactive-login range and visually distinct in
`getent passwd` listings. `--no-create-home` is critical:
`ProtectHome=true` blocks `/home` access; if the iago user had a home
dir, it would be there too, defeating the sandboxing.

**Reversibility:** Switch to a different system user only if a specific
multi-tenant deployment shape (Phase 6 Sebas-joins-as-second-user)
proves that `iago` collides with another v2 system identity. No such
collision is currently anticipated.

---

## 4. Telegram Option A — rotate, don't replace (spec § 3)

**Verdict:** Option A — revoke + reissue same bot via BotFather at
cutover.

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Same bot, rotate token via BotFather** | Same `@bot_handle` (zero Santiago-side reconfiguration); same chat IDs (no allowed-user-ID migration); BotFather revocation is atomic (old token dies instantly when new is issued) | Requires interactive BotFather session at cutover-time (no scripted rotation API) | **ACCEPT** |
| B. New bot, new handle | Clean break; old bot remains for sentimental rollback test | Santiago must re-`/start` the new bot on phone; allowed-user-ID rebuild; chat ID changes invalidate any saved approval chat references; rollback requires reverting Santiago's phone session too | REJECT — friction for zero benefit |
| C. Keep same token (no rotation) | Zero work | OpenClaw process retained the token for 30 days while archive sits; if archive leaks, token leaks | REJECT — security carry-over violates Garry standard |

The atomic moment: at BotFather's "Revoke current token" tap, the old
token dies; the new token is shown immediately. Santiago copies it
into the 1Password vault item `v2-daemon-telegram-bot::token`, then
runs `provision-credentials.sh telegram-token` (Plan 01a artifact).
Total wall clock: ~3 minutes.

**Reversibility:** Switch to Option B (new bot, new handle) only if a
specific Phase 3+ requirement makes the old `@handle` unusable
(spam-classification blacklist, BotFather rate-limit on the handle,
trademark complaint, etc.). No such reason is currently in scope.

---

## 5. FAST cutover (Santiago override 2026-05-16)

**Verdict:** FAST single-hour cutover. NOT "alongside OpenClaw"
parallel-run.

The original v2 vision spec
(`docs/specs/iago-os-v2-vision.md` § Phase Sequencing) framed Phase 2
as a parallel-run period during which OpenClaw and the v2 daemon both
handle traffic, with a progressive cutover over days. **Santiago
overrode this 2026-05-16** to a FAST single-hour cutover. Reasoning:

- Parallel-run requires two Telegram bots (or two tokens against the
  same bot, which Telegram doesn't permit) — friction for zero gain
  since the v2 daemon's job is to *replace* OpenClaw, not *coexist
  with* it.
- OpenClaw's state and v2 daemon's state are in different directories
  (`~/.openclaw/` vs `/var/lib/iago-os/daemon-state/`); coexistence
  doesn't share state, it just runs two daemons. Two daemons → two
  failure surfaces.
- The Garry standard says ship done, not ship gradually. A
  one-hour cutover with a four-minute rollback is the right shape; a
  multi-day parallel-run with no clean revert point is not.

**Rollback path:** stop v2 daemon, restart OpenClaw from archive,
re-rotate Telegram token. Documented in
`runtime/migration/02-rollback-runbook.md`. Tested locally via
`runtime/scripts/test-cutover.mjs` (Plan 03a Task 3).

**Reversibility:** Revisit only if a specific Phase 3+ adapter (HTTP
shape, Sentry webhook) lands that genuinely requires a coexistence
period for traffic-warm-up. No such case is in v2's near-term
roadmap.

---

## 6. No staging VPS — Santiago override (I3 carry-over)

**Verdict:** NO staging VPS. Cutover dry-run runs locally via
`runtime/scripts/test-cutover.mjs` (Plan 03a Task 3).

Spec § 10 criterion 3 (Integration test) proposed provisioning a
second Hostinger KVM 2 for staging at $9/mo for ~1 week of testing.
**Santiago overrode this** in favor of a local Vitest harness that
stubs every external command (`systemctl`, `systemd-creds`,
`tailscale`, `age`, `tar`, `op`) and exercises the exact invocation
order + every documented failure path of `cutover.sh` and
`rollback.sh`.

**Trade-off:**

| Path | Cost | Coverage |
|---|---|---|
| Staging VPS ($9/mo Hostinger KVM 2) | $9 + ~1 week of dual-host setup overhead | Catches Tailscale ACL differences, real systemd behavior, real network-side surprises |
| Local `test-cutover.mjs` harness | ~5 min CI run; ~0 ongoing cost | Catches every command-order regression, every documented exit code, every prompt-handling bug; CANNOT catch network/ACL/distro-version surprises that exist only in real-VPS-state |

**Risk:** the harness cannot catch a production-only issue — e.g., a
Tailscale ACL difference between Santiago's home network and the VPS,
or a Debian 13 package drift after the audit was taken.

**Mitigation:**

- `cutover.sh` pre-flight gate (Plan 03a Task 1) has 12 real-VPS
  checks that run against the actual production VPS state at T-15.
  These checks catch the production-vs-local-harness gap as the gate
  for whether cutover proceeds.
- The 30-min stay-at-keyboard monitoring window after T+60
  (cutover-runbook § 6) catches most in-flight surprises while
  rollback is still cheap.
- Plan 05b ships `phase-2-vps.test.ts` with opt-in Tailscale-SSH
  e2e checks (`IAGO_VPS_E2E=1`) for routine + post-handoff
  verification against the live VPS.

The combination of `test-cutover.mjs` (locally) + the pre-flight gate
(against real VPS) + the monitoring window (after cutover) + the e2e
suite (post-handoff) provides equivalent confidence to a staging KVM
without the $9/mo + 1-week overhead.

**Reversibility:** Provision a staging KVM only if (a) a production
cutover failure mode is traced to a difference the local harness
could not have caught, AND (b) that class of failure is likely to
recur in future v2 phases. Single-incident learning belongs in an
incident note + harness extension, not a permanent staging spend.

---

## 7. Anthropic profiles — provisioned-not-activated (spec § 5)

**Verdict:** all 3 Anthropic profiles (`default`, `ilsantino`,
`iaguito`) PROVISIONED at Phase 2 (credentials land on the VPS in
`/etc/credstore.encrypted/`). **Activated at Phase 3** (when the
claude-pty adapter and HTTP-SDK adapter wire the env-var resolution).

Plan 01b ships the schema slot (the `authProfile?: "default" |
"ilsantino" | "iaguito"` field on `AgentConfig` in
`runtime/daemon/config.ts`) AND the credential-bootstrap helper that
reads `$CREDENTIALS_DIRECTORY/iago-anthropic-*` into env vars. The
adapter changes that **resolve** the profile to an env var at spawn
time and **pass** the resolved env var to the spawned process are
Phase 3 work.

**Why provision now, activate later:**

- Provisioning is the high-coordination step (requires extracting
  tokens from the OpenClaw archive + 1Password staging + Tailscale
  push). Doing it at Phase 2 takes advantage of the cutover window
  when Santiago is already at keyboard with all 3 tools open. Phase
  3 then just needs adapter-code changes — no credential dance.
- Credentials sitting unused on disk for ~2 weeks until Phase 3
  ships are encrypted at rest under TPM/host-key combo;
  unused-but-present is acceptable; alternative
  (provision-then-revoke-then-reprovision) burns ops cycles for no
  security gain.

Phase 2 hello-world + PR-triage agent (Plan 04) use the `default`
profile only — no multi-profile behavior is in scope.

**Reversibility:** Revoke any of the 3 profiles before Phase 3 ships
only if Santiago needs to rotate the source Anthropic API key (e.g.,
suspected exposure). Rotation re-runs the provisioning step against
the same systemd-creds path — no schema or adapter changes needed.

---

## 8. WhatsApp deauth at cutover (Santiago decision 2026-05-13)

**Verdict:** WhatsApp deauthed at T+30 of the cutover window. v2 is
Telegram-only.

WhatsApp was an OpenClaw inbound channel (Cloud API webhook to
OpenClaw's HTTP endpoint). When OpenClaw stops, the webhook URL goes
dead, but Meta will retry indefinitely and the long-lived access
token remains valid. **Both must be revoked at Meta's side** —
otherwise:

- Meta retries the webhook indefinitely against a dead endpoint
  (wastes Meta-side resources, eventually triggers webhook
  health-check disabling, but only after days).
- The long-lived access token remains valid → if leaked, an attacker
  can send messages from Santiago's business phone number.

The deauth procedure lives in
`runtime/migration/02-whatsapp-deauth.md` (Plan 02b artifact) — a
runbook executed manually at T+30 of cutover. **NOT scripted in CI**
because (a) the credentials are Meta-side-only (not in 1Password),
and (b) running it is a one-time operation, not idempotent
automation. A thin script wrapper at
`runtime/deploy/revoke-whatsapp.sh` (Plan 02b) takes the IDs as args
for the deterministic Graph API calls; the click-path through Meta
Business Suite remains operator-driven.

**Not undone on rollback** — per `02-rollback-runbook.md` § 7. A
successful WhatsApp deauth is intentionally one-way. Re-enabling
WhatsApp on the rolled-back daemon would require:

1. Re-running URL verification handshake (`hub.challenge` round-trip),
   which requires the OpenClaw webhook URL to be reachable and
   responsive.
2. Re-subscribing the WABA to the app via `POST /<WABA_ID>/subscribed_apps`.
3. Re-creating the system user token (the prior one was revoked).

This is a Phase 6+ effort. Acceptable because WhatsApp is **out of
scope** for v2 (Telegram-only); the deauth standing across the
rollback is the correct end state. OpenClaw on the rolled-back path
continues to serve Telegram; WhatsApp inbound is permanently dead.

**Reversibility:** Re-enable WhatsApp only if a future phase (Phase
6+) re-introduces it as an inbound channel for the v2 daemon. No
such phase is currently planned.

---

## References

- Spec: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md`
  §§ 1, 3, 5, 6, 7
- Migration scope: `.iago/research/2026-05-16-v2-operational-migration-scope.md`
- Cutover runbook: `runtime/migration/02-cutover-runbook.md`
- Rollback runbook: `runtime/migration/02-rollback-runbook.md`
- WhatsApp deauth procedure: `runtime/migration/02-whatsapp-deauth.md`
- Telegram bot rotation procedure: `runtime/migration/02-telegram-bot-rotation.md`
- ADR (HTTP-shape adapter auth): `.iago/decisions/2026-05-15-agent-shape-taxonomy.md`
- v2 vision (FAST cutover supersedes): `docs/specs/iago-os-v2-vision.md`
- Memory references: `feedback_garry_impressed_standard`, `project_iago_v2_vision`,
  `project_mempalace`, `reference_iago_v2_vps`
