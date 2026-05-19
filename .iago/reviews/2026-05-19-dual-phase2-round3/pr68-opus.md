# PR #68 — Opus adversarial review (Round 3)

**PR:** Plan 03a — cutover + rollback executables + dry-run harness
**Branch:** `start/03a-base` (worktree `C:\Users\[redacted]\dev\iago-os-d`)
**Pre-impl base:** `fd9f27c`
**Reviewer:** Opus 4.7 (adversarial pass post-Codex-fix)
**Date:** 2026-05-19

## Scope verification

- `runtime/deploy/cutover.sh` (609 lines)
- `runtime/deploy/rollback.sh` (374 lines)
- `runtime/scripts/test-cutover.mjs` (608 lines, 15 tests)
- `runtime/scripts/test-cutover.fixtures/{openclaw.json, openclaw.expected.json, stubs/{tailscale, op, _generic-noop}}`

`bash -n` passes both scripts. `node --test scripts/test-cutover.mjs` → **15/15 pass** locally (137s wall clock).

## Codex fix verification (per orchestrator brief)

| Codex finding | Fix location | Test coverage | Verdict |
|---|---|---|---|
| P0-1 wrong-user systemctl openclaw query | cutover.sh:381 + cutover.sh:401 (`su - ilsantino -c …`) + rollback.sh:340 | test 13 (regression — pre-archive query failure fails closed) | ✅ Applied correctly. Pre-archive AND post-archive both use `su - ilsantino -c`. Rollback's `is-active openclaw-gateway` query at line 340 uses same path. |
| P0-2 stop && disable swallow disable failure | rollback.sh:188–211 (separate `stop` warn + `disable` fatal + `is-enabled` assertion) | test 14 (regression — disable failure → exit 2, openclaw NOT started, no `ROLLBACK COMPLETE` banner) | ✅ Applied correctly. `is-enabled` case statement covers all systemd states. Fails closed on unexpected state. |
| P1-5 owner-mismatched lock cleanup | cutover.sh:231–251 + rollback.sh:145–163 (sentinel `# release-lock-with-owner-check expected_marker=…` heredoc; conditional rm only if file contents equal local marker) | test 15 (regression — hijacker marker preserved on EXIT trap) | ✅ Applied to BOTH scripts. Sentinel parseable, marker comparison reads actual file. Test 15 also adds `verify_lock_still_ours` mid-flight check (cutover.sh:222–229) which catches hijacks between major remote ops. |

The local-review Criticals also verified:
- **Octal parse `T+08`/`T+09`** — `stage_to_number()` at cutover.sh:122–132 uses `num=$((10#$num))` to force base-10. Test 12 (`RESUME_FROM=T+05`) exercises the T+08/T+09 boundary. ✅
- **30s daemon-start window** — cutover.sh:478–491 polls `is-active` every 2s up to 30s before triggering rollback. Matches the documented rollback trigger ("not active within 30s of enable"). ✅

## Findings

### Critical

None.

### Important

**I-1. `systemd-creds decrypt | wc -c` round-trip check is silent-success on decrypt failure.**

- **File:** `runtime/deploy/cutover.sh:435`
- **Evidence:**
  ```bash
  if vssh "systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c" > /dev/null 2>&1; then
    echo "  OK systemd-creds round-trip verified"
  else
    trigger_rollback "systemd-creds decrypt round-trip failed for iago-telegram-token"
  fi
  ```
  The remote ssh runs the pipeline under `sh -c` (no `pipefail`). If `systemd-creds decrypt` fails (corrupt ciphertext, missing key, wrong owner), it writes the error to stderr and exits non-zero, but `wc -c` reads empty stdin, prints "0", and exits **0**. Without `pipefail`, the pipeline exit code is `wc`'s (=0). The local `if vssh …` sees success and bypasses rollback. The whole point of this check — catching a busted credential before T+07 — is silently neutered.
- **Why the harness misses this:** the tailscale stub at fixtures/stubs/tailscale:105–110 unconditionally returns "16" + exit 0 for the `systemd-creds decrypt` pattern, so the success path is exercised but the failure path is not.
- **Recommended fix:**
  ```bash
  if vssh "set -o pipefail; systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c" > /dev/null 2>&1; then
  ```
  Or, more defensive: capture the output, assert it's a positive integer:
  ```bash
  local len
  len=$(vssh "systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c" 2>/dev/null || echo 0)
  if (( len > 1 )); then
    echo "  OK systemd-creds round-trip verified (${len} bytes)"
  else
    trigger_rollback "systemd-creds decrypt round-trip empty/failed for iago-telegram-token (len=${len})"
  fi
  ```
  Add a 16th harness test that injects `STUB_FAIL_TAILSCALE_PATTERN=systemd-creds decrypt` and asserts the cutover exits 2 with the rollback-trigger banner — without it, this regression can re-land freely.

**I-2. Rollback's OpenClaw config patch leaks bot-token file mode to 0644.**

- **File:** `runtime/deploy/rollback.sh:296–306` (the `PATCH_EOF` heredoc body)
- **Evidence:**
  ```bash
  jq --arg t "$FRESH_TOKEN" '.channels.telegram.botToken = $t' \
    ~ilsantino/.openclaw/openclaw.json > ~ilsantino/.openclaw/openclaw.json.tmp
  mv ~ilsantino/.openclaw/openclaw.json.tmp ~ilsantino/.openclaw/openclaw.json
  chown ilsantino:ilsantino ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
  ```
  The `jq … > …tmp` redirection creates `.tmp` with the shell's default umask. Run as root, umask is typically 0022 → new file is **0644**. `mv` preserves that mode (mv does not rewrite mode unless `--no-preserve=mode`). After `chown ilsantino:ilsantino`, the file is `ilsantino:ilsantino 0644` — **world-readable**, holding the freshly-rotated BotFather token. Anyone with shell access on the VPS (and there are several non-root accounts on Hostinger by default) can `cat ~ilsantino/.openclaw/openclaw.json` and exfiltrate the live bot token.
  
  The pre-rollback file (`openclaw.json.pre-rollback`) inherits the mode from `cp src dst` of the original. Per POSIX cp without `-p`: destination mode = `source-mode & ~umask`. If original was 0600, copy is 0600. But if original was 0640 or 0644 (which we don't know), copy reflects that. The bigger concern is the .tmp → mv path on the freshly-tokened file.
- **Recommended fix:** Add an explicit mode set inside `PATCH_EOF`, after the chown:
  ```bash
  chown ilsantino:ilsantino ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
  chmod 0600 ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
  ```
  Or use `install -m 0600` instead of `mv`. Add an assertion to the harness: after running rollback in test 8, the `chmod 0600` invocation must appear in the stub log. (Currently impossible to test directly because `jq` is stubbed as noop and the patch script body never reaches a real chmod — but the `_generic-noop` stub for `chmod` could capture the call. Worth wiring up.)

**I-3. Test 8's byte-for-byte JSON assertion is fake — it re-applies the transformation in JS, doesn't validate the real jq run.**

- **File:** `runtime/scripts/test-cutover.mjs:363–368`
- **Evidence:**
  ```js
  const fixture = JSON.parse(readFileSync(fixtureOpenclawIn, "utf8"));
  fixture.channels.telegram.botToken = "DRYRUN_TOKEN_AAA";
  const expected = JSON.parse(readFileSync(fixtureOpenclawExpected, "utf8"));
  assert.deepStrictEqual(fixture, expected);
  ```
  The plan (Task 3, test 8) requires asserting "the post-patch JSON matches the expected output byte-for-byte". This assertion mutates a parsed copy of the input fixture in JS, then compares it to the expected fixture. It proves the *fixture pair* is internally consistent. It proves **nothing about the real patch script**:
  - The script's jq invocation is intercepted by `_generic-noop` (jq is in `NOOP_BINARIES`, test-cutover.mjs:82–89). The real jq binary is never invoked.
  - The script's `cp openclaw.json openclaw.json.pre-rollback` runs against `~ilsantino/.openclaw/openclaw.json` on the (simulated) VPS — which doesn't exist; the cp + mv + chown are all swallowed by the tailscale stub's default-case `exit 0`.
  - The fixture file path `runtime/scripts/test-cutover.fixtures/openclaw.json` is read by the test, never touched by the script.
  
  Net result: a regression that broke jq's `--arg` quoting or the `.channels.telegram.botToken` path would still pass test 8.
- **Recommended fix:** Two options:
  1. **Inline the real patch transformation** — invoke `jq --arg t DRYRUN_TOKEN_AAA '.channels.telegram.botToken = $t' fixtures/openclaw.json` locally via spawnSync (using whatever jq is on the host PATH; skip the test with `it.skip` if jq is absent rather than passing falsely). Compare its stdout byte-for-byte to `openclaw.expected.json`. This is the assertion the plan describes.
  2. **Extract the jq expression to a shared constant** in both the patch script and the test, and assert the constant's exact text matches. Less valuable but cheaper.
  
  Option 1 is correct. The Garry-impressed-completeness standard rules out leaving this as "we verify the test verifies itself".

### Minor

**M-1. NDJSON `result` field with single quotes breaks remote `echo '…'` quoting and silently loses telemetry.**

- **Files:** `runtime/deploy/cutover.sh:162–170` (`ndjson_write`) and `runtime/deploy/rollback.sh:104–112`
- **Evidence:** `ndjson_write` builds `line` via `printf`, then sends `vssh "echo '${line}' >> /var/log/iago-os/cutover.ndjson" 2>/dev/null || true`. When the `result` field contains a single quote (very plausible — see cutover.sh:412 `"openclaw-gateway did not stop after archive (state='${state}')"`), the local string substitution produces `echo '{"…","result":"…state='inactive'…"}' >> …`. Remote shell parses this as: open-quote → `…state=` → close-quote → `inactive` → re-open-quote → `…` → close-quote → unparseable `}` outside quotes → exit non-zero. The `|| true` swallows the error → telemetry line is **lost**, no warning emitted.
- **Recommended fix:** Use a safer remote-write pattern. Either base64-encode the line or use a heredoc:
  ```bash
  vssh "cat >> /var/log/iago-os/cutover.ndjson" <<< "$line" 2>/dev/null || true
  ```
  This pipes the line as stdin instead of inlining it into a quoted shell string — no quote-escaping required.
- **Why classified Minor:** telemetry-quality issue, doesn't affect the cutover/rollback control flow. But the lost lines are exactly the ones an operator wants during incident review.

**M-2. `tailscale file cp` syntax is wrong; the fallback `cat | ssh "cat > …"` runs every time.**

- **File:** `runtime/deploy/rollback.sh:311–316`
- **Evidence:**
  ```bash
  tailscale file cp "$local_patch" "${VPS_USER}@${VPS_HOST}:${remote_patch}" > /dev/null 2>&1 || {
    cat "$local_patch" | vssh "cat > ${remote_patch}"
  }
  ```
  `tailscale file cp` syntax is `tailscale file cp <src> <dst-hostname>:` (drop-in-Downloads idiom — no path component allowed). The `user@host:path` form is `scp`/`rsync` shorthand and isn't honored. So the primary path **always fails**, falling through to the cat-pipe fallback. Functionally fine, but the dead code obscures intent and adds a misleading 2026-05 commit message.
- **Recommended fix:** Drop the `tailscale file cp` attempt entirely; use the cat-pipe directly. Or use proper tailscale-file-cp semantics + a remote mv to the canonical path. The cat-pipe is good enough — keep it minimal.

**M-3. `should_run` + `set -e` interaction (no actual bug; verifying).**

- **File:** `runtime/deploy/cutover.sh:135–144`
- **Verification:** `if should_run "T-15"; then … fi` — the `should_run` returns 0 or 1 via `(( cur >= resume ))`. `set -e` does not abort on conditional contexts (`if …; then`), so a return-1 cleanly takes the `else` (skipped) branch. ✅ Not a bug, but worth noting because the `(( … ))` arithmetic inside a function looks like a `set -e` foot-gun. The octal-fix tests (test 12) cover the original concern.

**M-4. Tmp file leak on trigger_rollback path.**

- **Files:** `runtime/deploy/cutover.sh:452–496` (`local_rendered`) and `runtime/deploy/rollback.sh:292–325` (`local_patch`)
- **Evidence:** Both scripts `mktemp` a local file and `rm -f` it at the END of the block. If a `trigger_rollback` (cutover side) or an `exit 2` (rollback side, e.g., failed jq) fires before the rm, the temp leaks. On Windows `$TMPDIR` defaults to `%USERPROFILE%\AppData\Local\Temp` which is OS-cleaned only on logout. On Linux VPS, `/tmp` is wiped on reboot but accumulates between.
- **Recommended fix:** Use an EXIT-trap-managed cleanup (small refactor — add to the existing `release_remote_lock` trap):
  ```bash
  cleanup_local_tmps() {
    rm -f "${local_rendered:-}" "${local_patch:-}" 2>/dev/null || true
  }
  trap 'release_remote_lock; cleanup_local_tmps' EXIT
  ```
- **Why Minor:** local tmp files; no secret content (rendered unit file is the templated systemd unit, which is non-secret; patch script content is the jq invocation literal). Token never lands on local disk (forwarded via SendEnv).

**M-5. Transient network blip during 30s daemon-start poll falsely triggers rollback.**

- **File:** `runtime/deploy/cutover.sh:478–490`
- **Evidence:** The poll loop uses `active=$(vssh "systemctl is-active iago-os-v2-daemon.service 2>/dev/null" || echo inactive)`. A transient Tailscale disconnect during the 30s window causes `vssh` to fail → `echo inactive` → loop continues → eventually times out → unnecessary rollback. The daemon was actually fine.
- **Recommended fix:** Differentiate ssh failure from systemctl inactive. Track ssh-failure count; only count successful-but-inactive polls toward the 30s budget. Conservative because a 30s outage is unusual on Tailscale; not worth a Critical/Important but worth a defensive harden:
  ```bash
  if state_out=$(vssh "systemctl is-active iago-os-v2-daemon.service 2>/dev/null"); then
    active="${state_out//[[:space:]]/}"
  else
    active="ssh-failed"
    echo "  WARN ssh probe failed at +${waited}s; not counting as inactive"
  fi
  ```
  Note: the rollback trigger string would then need to handle `state=ssh-failed` distinctly from `state=activating`.

**M-6. trigger_rollback race window between cutover-release and rollback-acquire.**

- **File:** `runtime/deploy/cutover.sh:313–328`
- **Evidence:** `trigger_rollback` calls `release_remote_lock`, then invokes `rollback.sh` which calls `acquire_remote_lock`. Between these calls (a few hundred ms over Tailscale), a third concurrent operator could grab the lock and rollback.sh would abort with BUSY. In practice this is near-impossible (no other operator should be running concurrently during a cutover window), but it's a hand-off race that the current design exposes.
- **Recommended fix:** Pass the lock marker through, so rollback can re-use the same marker without a full release/re-acquire cycle. Or rollback could accept `IAGO_ROLLBACK_LOCK_ALREADY_HELD=1` and skip the acquire. Both require non-trivial refactor; not worth blocking on.

**M-7. `cat <heredoc> | vssh "cat > path && systemctl daemon-reload"` (cutover T+07) — non-fatal pipefail concern.**

- **File:** `runtime/deploy/cutover.sh:461`
- **Evidence:** `cat "$local_rendered" | vssh "cat > ${remote_unit_path} && systemctl daemon-reload"`. If local `cat` fails (file disappeared between mktemp and use — extremely unlikely), remote sees empty stdin, writes empty unit file (truncates an existing valid one), then runs daemon-reload. The daemon's unit is now empty.
- **Recommended fix:** Add a guard:
  ```bash
  [[ -s "$local_rendered" ]] || { echo "ABORT: rendered unit file is empty" >&2; exit 1; }
  cat "$local_rendered" | vssh "cat > ${remote_unit_path}.new && mv ${remote_unit_path}.new ${remote_unit_path} && systemctl daemon-reload"
  ```
  The `.new` → atomic-rename pattern means a partial write doesn't replace a working unit.

## Spec § 8 alignment

Walked every T-step in cutover.sh against spec § 8 (lines 1054–1199) and § 9 (lines 1221–1316).

| Spec step | cutover.sh | Verdict |
|---|---|---|
| Pre-cutover gate (12 checks) | run_preflight, 12 numbered preflight_check calls | ✅ Verbatim coverage |
| T-15 final confirmation | T-15 block, `read 'go'` | ✅ |
| T-10 (3 terminals open) | Manual; not in script (correct — humans-only step) | ✅ |
| T-05 baseline ping | Inside T-15 block, skippable via `IAGO_CUTOVER_SKIP_TMINUS5_BASELINE` | ✅ |
| T+00 archive-openclaw.sh | T+00 block; pre+post `is-active openclaw-gateway` via `su - ilsantino -c` | ✅ + hardening over spec |
| T+02 BotFather rotation | T+02 read prompt | ✅ |
| T+05 provision-credentials | T+05 calls `provision-credentials.sh telegram-token gh-token` (spec only names `telegram-token`; plan adds gh-token — intentional, plan supersedes spec) | ✅ |
| T+07 daemon-reload + enable | T+07 block; idempotent unit-file sha256 compare; 30s active poll | ✅ + idempotency + 30s poll fix |
| T+08 journalctl daemon-start + IPC socket | T+08 block | ✅ |
| T+10 bot reply | T+10 block; rollback on non-'y' | ✅ |
| T+15 canonical workflow | T+15 echoes spec block; manual ack | ✅ |
| T+25 (Telegram path proven) | No explicit step; absorbed into T+15 → T+30 wait | ⚠️ Minor divergence — no NDJSON event for this milestone, but Spec § 8 T+25 has no executable verify either |
| T+30 WhatsApp deauth | T+30 manual prompt | ✅ |
| T+45 sanity #1 | daemon active + heartbeat.json | ✅ + heartbeat check (spec only mentions telemetry — script adds heartbeat) |
| T+50 retention timer (spec) vs journalctl error count (script) | **Divergence**: script T+50 checks `journalctl -p err` line count; spec T+50 checks retention timer schedule | ⚠️ Minor. Both are valid health checks; plan should note the substitution OR add the retention-timer check too. Recommend forwarding to 03b runbook to keep the spec's check while preserving the script's. |
| T+55 no orphans | Script checks IPC socket; spec checks `pgrep -fa openclaw` and `pgrep -fa iago-os-v2-daemon` | ⚠️ Minor. The IPC socket reachability is a superset proof (no daemon → no socket) for the v2 daemon, but the openclaw pgrep check is dropped — relevant to confirm the archive worked. Forward to 03b runbook. |
| T+60 complete | T+60 reminder list | ✅ |

Rollback (§ 9) alignment is clean:

| Spec | rollback.sh | Verdict |
|---|---|---|
| T+R+0:30 stop+disable v2 | Now separated; disable failure is fatal; is-enabled assertion | ✅ + Codex P0 hardening |
| T+R+1:30 fresh BotFather token (skipped if SKIP_TOKEN) | T+R+1:30 block; `read -rs` (silent) | ✅ |
| T+R+2:00 patch OpenClaw config | T+R+2:00 temp-file-over-scp pattern (C3 fix); FRESH_TOKEN via SendEnv (not argv) | ✅ + C3 fix as designed |
| T+R+2:30 start OpenClaw | `su - ilsantino -c 'systemctl --user enable --now openclaw-gateway.service'` + verify is-active | ✅ |
| T+R+4:00 smoke test | Manual `read 'y'` | ✅ |

## NDJSON telemetry posture

Every T-step writes `ndjson_write cutover-step <stage> <result>` after success. No tokens, no full Meta response bodies, no FRESH_TOKEN value. ✅ Per orchestrator brief.

Only telemetry concern is M-1 (single-quote breakage). The result field for `rollback-triggered` events deliberately includes the reason string which may contain `state='inactive'` — these specific events will silently drop. Switch to heredoc/stdin pattern per M-1 fix.

## No-mocks-in-prod risk

- `test-cutover.mjs` lives under `runtime/scripts/` and is only invoked via `node --test` or vitest. Cutover.sh and rollback.sh do not source it.
- The fixture stubs (`fixtures/stubs/{tailscale, op, _generic-noop}`) are created in a fresh `mkdtemp` per test, prepended to PATH only for the spawned child process. They never land on the host's persistent PATH and are removed in `destroyTestEnv`. ✅
- `NOOP_BINARIES` stub names match real binaries (jq, systemd-creds, age, tar, curl, shred). An operator who accidentally cd's into the worktree's fixture dir and runs `./jq` would hit the noop. Mitigation: the stubs are not on PATH unless test-cutover.mjs prepends them. ✅ No risk.

## bash -n + shellcheck

`bash -n` exit 0 for both scripts. `shellcheck` not available on Windows host — Codex pipeline graceful-falls-back per project convention. ✅

## Test harness rerun

All 15 tests pass locally (Windows, node 22, bash from Git):

```
✔ 1.  cutover refuses without CONFIRM=YES         (146ms)
✔ 2.  cutover refuses without TELEGRAM_USER_ID    (854ms)
✔ 3.  preflight failure on stub-injected fail     (930ms)
✔ 4.  happy-path cutover                         (14052ms)
✔ 5.  rollback trigger at T+10                   (71803ms)
✔ 6.  rollback refuses without CONFIRM=YES        (151ms)
✔ 7.  happy-path rollback (SKIP_TOKEN)            (3419ms)
✔ 8.  rollback without SKIP_TOKEN (patch path)    (4997ms)
✔ 9.  RESUME_FROM=T+10 skips earlier steps        (7493ms)
✔ 10. contradictory NONINTERACTIVE+CONFIRM         (100ms)
✔ 11. SKIP_TMINUS5_BASELINE bypasses ping        (13407ms)
✔ 12. RESUME_FROM=T+05 reaches T+08 (octal fix)  (10990ms)
✔ 13. cutover fails closed on openclaw query err  (3978ms)  ← Codex P0-1 regression
✔ 14. rollback fails closed on disable failure    (1321ms)  ← Codex P0-2 regression
✔ 15. release_remote_lock owner check             (3792ms)  ← Codex P1-5 regression
```

Tests 13/14/15 directly cover the 3 Codex fixes per the orchestrator brief. ✅

## Verdict

**PASS_WITH_CONCERNS**

The 3 Codex P0/P1 findings are correctly addressed in both scripts and have dedicated regression tests (13, 14, 15). The local-review Criticals (octal parse, 3s→30s polling window) are fixed and tested. Lock semantics, idempotency, SCRIPT_DIR robustness, flag matrix, and FRESH_TOKEN handling all align with the plan.

Three new concerns surface from this pass that warrant action before the real cutover window:

1. **I-1 systemd-creds round-trip silent-success** — cutover.sh:435. Pre-cutover credential check returns OK on decrypt failure due to missing pipefail on remote pipe. Add `set -o pipefail;` to the remote command OR use the length-capture pattern. Add a 16th harness test that injects decrypt failure.
2. **I-2 OpenClaw config patch leaks 0644 mode** — rollback.sh:296–306 (PATCH_EOF body). Add `chmod 0600` after chown to prevent world-readable bot token after rollback.
3. **I-3 Test 8 byte-for-byte assertion is fake** — test-cutover.mjs:363–368. The "byte-for-byte" claim in the plan isn't actually verified; the test re-applies the transformation in JS. Either invoke real jq in the test, or extract a shared constant and verify exact text match.

These are not blockers in the strict sense — the cutover would still execute correctly on the happy path — but together they cover (a) a credential check that silently passes when it shouldn't, (b) a privacy regression on the rotated token file, and (c) a test that proves the test rather than the script. All three should land before the production cutover, ideally in a fast follow-up to PR #68 rather than blocking merge.

The Minors (M-1 NDJSON quote breakage, M-2 dead tailscale-file-cp path, M-4 tmp file leak, M-5 network blip → rollback, M-6 trigger_rollback race, M-7 atomic unit-file write) are quality polish — none invalidate the implementation.

Recommend merging PR #68 as-is + opening a stacked follow-up PR for I-1, I-2, I-3 before scheduling the cutover window.
