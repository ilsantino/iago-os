# PR #68 — Aggressive Second-Pass Review (Round 3, opus)

**Reviewer:** Claude Opus 4.7 (aggressive adversarial frame)
**Target:** PR #68 Plan 03a — cutover + rollback executables + dry-run harness
**Focus commit:** `49b27ca` (Round 3 safety hardening — 6 fixes)
**Production cutover:** Sunday 2026-05-25 8pm US/Mexico — paranoia justified
**Files under review:**
- `runtime/deploy/cutover.sh` (673 lines)
- `runtime/deploy/rollback.sh` (401 lines)
- `runtime/scripts/test-cutover.mjs` (828 lines, 21 tests)
- `runtime/scripts/test-cutover.fixtures/stubs/tailscale` (213 lines)

---

## Verdict: **BLOCK_BEFORE_CUTOVER**

Two CRITICAL findings (one regression, one false-claim), three IMPORTANT findings, two MINOR findings. The Round 3 patch closes some gaps but leaves the largest one — the remote-pipefail class — open in the exact places the prior Codex HIGH demanded closed. Test harness reliability is also not what the dev claimed.

Direct quote from the brief: *"If you find ANY bug that could cause a bad cutover, classify as BLOCK_BEFORE_CUTOVER even if it's 'fixable later'. Be paranoid."* — C-1 alone meets that bar; T-1 independently meets it.

---

## CRITICAL findings

### C-1. T+50 (and T+08) retain the exact remote-pipefail gap the Codex HIGH fix was supposed to close

**Severity:** CRITICAL — silent false-pass on the verification checkpoints that gate the post-cutover go/no-go window.

**Codex HIGH said:** `journalctl ... | wc -l || echo 0` masks query failures; if journalctl fails the operator gets a fake "0 errors" pass.

**Dev's Round 3 fix (cutover.sh:618–646):** removed the `|| echo 0` masking and added explicit `if !` capture.

**Why the fix is incomplete:** the remote pipe `journalctl ... | wc -l` runs inside `tailscale ssh ... "cmd"` → the remote `sh -c` has NO `pipefail`. If `journalctl` exits non-zero (auth, journal corruption, transient sshd hiccup that survives connection but breaks the journal read), `wc` reads empty stdin, emits "`0`", exits 0. The whole pipeline exits 0. `ssh` exits 0. The `if ! err_count=$(vssh "...")` is false. Fallthrough. `err_count="0"`. Check passes. **Same class of bug as I-1, same gap, unfixed.**

Source verified — `cutover.sh:618–635`:

```bash
local err_count
if ! err_count=$(vssh "journalctl -u iago-os-v2-daemon.service --since '1 hour ago' -p err -o cat | wc -l"); then
  if [[ "${IAGO_CUTOVER_T50_TOLERATE_ERRORS:-0}" == "1" ]]; then
    echo "WARN: T+50 journalctl error-count query failed (TOLERATE override engaged)"
    err_count=0
  else
    trigger_rollback "T+50: journalctl error-count query failed"
  fi
fi
```

The remote command has no `set -o pipefail` prefix. The `if !` only catches the case where the whole ssh+pipe exits non-zero, which it won't if `wc -l` succeeds on empty stdin.

**Same gap, T+08 (cutover.sh:553):**

```bash
if vssh "journalctl -u iago-os-v2-daemon.service --since '5 minutes ago' --no-pager | grep -qE 'panic|Error: |Traceback|FATAL|terminated abnormally'"; then
  trigger_rollback "T+08: failure/stack-trace pattern observed in daemon journal"
fi
```

If `journalctl` fails, `grep -q` reads empty stdin, exits 1 (no match). Pipeline exits 1 (since `pipefail` is off remotely). `if vssh ...` is false. No rollback triggered. **Silent pass with zero log inspection actually performed.**

**Fix:** add `set -o pipefail;` prefix to both remote pipe commands:

```bash
vssh "set -o pipefail; journalctl -u iago-os-v2-daemon.service --since '1 hour ago' -p err -o cat | wc -l"
vssh "set -o pipefail; journalctl -u iago-os-v2-daemon.service --since '5 minutes ago' --no-pager | grep -qE '...'"
```

Or use bash explicitly: `vssh "bash -c 'set -o pipefail; ...'"`. Note the existing `vssh` helper invokes `tailscale ssh` which gives a non-login `sh`, so `bash -c` is the safer pattern.

The I-1 fix at T+05 (line 469) works around this by capturing the length and comparing it — which is what T+50 should also do, but T+50 captures the count and compares to `0`, and `0` is exactly what the failure mode produces. Without `pipefail`, the comparison cannot distinguish "0 errors" from "query failed".

Why this is BLOCK and not IMPORTANT: T+50 is the spec §8 "no errors in last hour" gate that drives the go/no-go on whether to proceed to T+55 (heartbeat/IPC) and ultimately to T+60 (WhatsApp revoke). A false-pass here lets a quietly-failing daemon ride through into the irreversible WhatsApp deauth window. That is precisely the failure class this cutover script exists to prevent.

---

### T-1. Test harness shows 19/21 in concurrent mode; test 7 hangs even serially. Dev's 21/21 claim is incorrect.

**Severity:** CRITICAL — the test claim that gates this PR's review confidence is false. Both spec §9 ("dry-run all green") and Round 3 implementation notes assert 21/21.

**Evidence:** Ran the harness twice via `node --test runtime/scripts/test-cutover.mjs`. Test 7 ("happy-path rollback skip-token") consistently hangs past 60s, even with `--test-concurrency=1`. Hang occurs after the "ROLLBACK COMPLETE." banner emits — the script appears to finish its body but the test process never returns.

Test 17 also hangs in the full concurrent run but **passes in isolation in 17.8s** — that is a load/concurrency artifact, not a regression. Test 7 is a real regression.

Reproduced isolated `vssh "cat >> file" <<< "$line"` × 5 calls outside the suite in 459ms, so the NDJSON `<<<` pattern is not the smoking gun in isolation. Most likely candidate: the EXIT trap in rollback.sh interacts with `release_remote_lock` (the owner-checked release added in this commit) in a way that holds open the foreground process when `STUB_LOG`/`STUB_STATE_DIR` are set. Not root-caused — but **the test does not return**, which is sufficient to block.

**Why this is BLOCK:**

1. The dev's confidence ("21/21 green") is the artifact of an incomplete harness run, not the actual state.
2. The hang is in the **happy-path rollback** test — i.e., the most important test in the suite for this commit, because it exercises the exact code path Sunday's operator will run if anything goes wrong.
3. If the production rollback script hangs in the same way (lock release? EXIT trap?), the operator will be stuck mid-rollback with no clean way out.

**Fix:**
- Reproduce the hang (run `test 7` alone with `IAGO_TEST_DEBUG=1` and trace EXIT trap firing).
- Confirm whether the rollback completes cleanly and the test framework is just not seeing process exit, OR whether rollback itself is hanging on the owner-checked release.
- Either way, do not cut over until the test passes deterministically and the cause is understood.

---

## IMPORTANT findings

### I-1A. `len > 1` threshold accepts 2-byte garbage as a valid Telegram token

**Source:** `cutover.sh:472`

```bash
if (( len > 1 )); then
  echo "  OK systemd-creds round-trip verified (${len} bytes)"
else
  trigger_rollback "systemd-creds decrypt round-trip empty/failed for iago-telegram-token (len=${len})"
fi
```

A real Telegram bot token is 46+ characters (`<digits>:<35-char alphanumeric>`). Threshold of `> 1` means any of these silently pass:
- A 2-byte `"x\n"` from a corrupt cred file
- A truncated decrypt
- A literal "0" + newline (which is 2 bytes — `len=2 > 1`)

**Fix:** Either pin a length floor that matches the credential class (`len >= 40` for telegram tokens), or — much better — capture the local plaintext length when provision-credentials.sh writes the cred, and compare the remote length against the local length:

```bash
expected_len=$(wc -c < "$LOCAL_TOKEN_PLAINTEXT_FILE")
(( len == expected_len )) || trigger_rollback "..."
```

The stub's 16-byte echo on line 114 of `tailscale` is a hint the author was thinking about exact-length matching but didn't wire it through to production.

---

### I-2A. PATCH_EOF leaves fresh bot token world-readable briefly (mv → chmod race)

**Source:** `rollback.sh:325–332`

```bash
jq --arg t "$FRESH_TOKEN" '.channels.telegram.botToken = $t' \
  ~ilsantino/.openclaw/openclaw.json > ~ilsantino/.openclaw/openclaw.json.tmp
mv ~ilsantino/.openclaw/openclaw.json.tmp ~ilsantino/.openclaw/openclaw.json
chown ilsantino:ilsantino ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
chmod 0600 ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
```

Race window:
1. `jq > .tmp` — created with the *running shell's* umask. The PATCH_EOF script does not set `umask` and runs under `bash ${remote_patch}` invoked from a `tailscale ssh` session. Root's interactive shell umask is typically `0022` → `.tmp` is mode `0644`. **The .tmp now holds the freshly-rotated bot token, world-readable.**
2. `mv` preserves mode → `openclaw.json` is `0644` for the duration between mv and chmod.
3. `chmod 0600` finally clamps.

The I-2 fix only addresses **steady state** (final file ends 0600). It does not address the **race window** — short, but real. On a VPS that may have other users with shell access, or with logging that captures `/proc/<pid>/io` etc., this is a token disclosure window. The whole reason this rollback exists is that the original token leaked.

**Fix (one line):** add `umask 0077` at the top of the PATCH_EOF script body (right after `: "${FRESH_TOKEN:?...}"`). Then `jq > .tmp` lands at 0600 from birth.

Alternative: `chmod 0600` the `.tmp` before `mv`.

---

### I-3. T+05 false-positive forces operator to re-rotate BotFather token

**Source:** Same code path as I-1A, plus I-1's underlying remote-pipefail fragility.

Scenario: T+05 systemd-creds verification fires immediately after `provision-credentials.sh` finishes. If the **first** `vssh "systemd-creds decrypt ..."` call hits a transient ssh blip, retry timeout, or a brief journal lock — `len=0`, rollback triggered. But the rollback path runs `revoke-leaked-token.sh` (or its equivalent on the operator's checklist), invalidating the token they just rotated. **Operator now has to start over from BotFather:** generate a third token within minutes of the second, re-encrypt, re-deploy.

**Fix:** Retry-once on the T+05 verification before triggering rollback. The check is read-only and idempotent — a single retry adds 1-3 seconds, eliminates 99% of transient false-positives, costs nothing in real failure paths.

```bash
for attempt in 1 2; do
  len=$(vssh "set -o pipefail; bash -c 'systemd-creds decrypt ... - | wc -c'" 2>/dev/null || echo 0)
  len="${len//[[:space:]]/}"; len="${len:-0}"
  if (( len >= 40 )); then break; fi
  sleep 2
done
(( len >= 40 )) || trigger_rollback "..."
```

(Note: this also folds in the I-1A and C-1 fixes.)

---

## MINOR findings

### M-1. T+08 grep patterns biased to Go/Python output, may miss Node structured logger

**Source:** `cutover.sh:553`

```bash
grep -qE 'panic|Error: |Traceback|FATAL|terminated abnormally'
```

- `panic` — Go runtime panics
- `Traceback` — Python
- `FATAL` — common but not Node default
- `terminated abnormally` — systemd
- `Error: ` — generic but the daemon uses structured JSON logging

If the v2 daemon uses Pino, Bun.serve, or any JSON logger (likely — it's a Node 20 daemon), errors emit as `{"level":50,"msg":"..."}` or `{"level":"error","msg":"..."}` and the grep misses them. The daemon could be vomiting `level:50` errors at startup and T+08 would silently pass.

**Fix:** add `level":50|level":"error"|level":"fatal"|UnhandledPromiseRejection|"err":` to the alternation. Verify against the daemon's actual log format before cutover.

---

### M-2. Test 21 covers only the happy fail-closed path, not the bypass or query-failure paths

**Source:** `test-cutover.mjs` test 21 + `tailscale` stub

Test 21 uses `RESUME_FROM=T+45` + `STUB_INJECT_T50_ERRORS=5` to confirm that 5 error lines triggers rollback. It does NOT cover:

1. **`IAGO_CUTOVER_T50_TOLERATE_ERRORS=1` bypass** — the WARN branches (lines 630, 640) are completely untested. If a future edit breaks the WARN logging path, no test catches it.
2. **journalctl query failure path** — i.e., the path C-1 is concerned with. The stub at line 186 of `tailscale` always succeeds and returns `STUB_INJECT_T50_ERRORS` or `0`. There is no `STUB_FAIL_JOURNALCTL` to simulate the failure mode. Without that stub, the C-1 gap is not testable from the harness — meaning even if you add `pipefail` to fix C-1, there is no regression test to keep it fixed.

**Fix (paired with C-1):**
- Add `STUB_FAIL_JOURNALCTL_PATTERN` knob to the stub.
- Add test 22 that injects a journalctl failure at T+50 and asserts rollback triggers (or, if `IAGO_CUTOVER_T50_TOLERATE_ERRORS=1`, asserts WARN logged and cutover continues).
- Add test 23 for the bypass-with-errors path.

---

## What is correctly fixed (not findings, just noting)

- **I-1 (T+05 length capture):** the fix is mechanically correct, just the threshold is too low (I-1A).
- **I-2 (chmod 0600 steady state):** correct at rest; race at write (I-2A).
- **Split-brain fatal check (rollback.sh:266–285):** the case-statement allow-list is paranoid in the right direction. `ssh-failed`/`activating`/`deactivating` correctly fall through to FATAL. Good.
- **M-1 (NDJSON stdin pipe):** correct refactor away from heredoc-in-ssh fragility.
- **Stub realism:** the `OPENCLAW_STATE_FILE` and `V2_STATE_FILE` state-tracking pattern in the tailscale stub is genuinely good — it lets the same stub script give consistent answers across the multi-checkpoint flow rather than a static echo. The `STUB_HIJACK_LOCK_AFTER_ACQUIRE` regression for owner-checked release is exactly right.

---

## Recommended sequence to clear BLOCK

1. **Fix C-1** — add `set -o pipefail` (via `bash -c`) to T+08 grep and T+50 wc commands.
2. **Add stub knob + tests** for journalctl-failure path (regression coverage for C-1).
3. **Root-cause T-1** — run test 7 alone with debug tracing, identify whether EXIT trap or `release_remote_lock` is blocking. Fix or document.
4. **Re-run full suite** — must be 21/21 in concurrent mode AND 21/21 in `--test-concurrency=1` serial mode. Both. If concurrent is flaky on Windows, document and pin the serial mode for the gate.
5. **Fix I-1A** — bump threshold to length-match the local plaintext, or floor at 40.
6. **Fix I-2A** — `umask 0077` at top of PATCH_EOF body.
7. **Fix I-3** — retry-once wrapper around T+05 verification.
8. **Address M-1** — add Node JSON logger error patterns.
9. **Re-tag for review.**

Estimated effort: 90 minutes total. Cutover slot Sunday 2026-05-25 is still very comfortable.

---

## What I checked but did not find a problem with

- `release_remote_lock` owner-check logic (rollback.sh + cutover.sh): correctly compares marker bytes before rm. The `STUB_HIJACK_LOCK_AFTER_ACQUIRE` test confirms behavior.
- `flock` + sidecar pid marker pattern: survives ssh disconnect via flock's reliance on file lock + the pid marker as visible owner state. Sound.
- `SendEnv=FRESH_TOKEN` for token forwarding: correctly avoids argv disclosure. The pre-flight SendEnv probe (test 19, stub line 202) confirms `AcceptEnv FRESH_TOKEN` is in remote sshd config.
- `tailscale file cp` fallback to `cat | vssh "cat >"`: works, the cat-pipe pattern leaves no on-disk artifact.
- spec §8 ordering: T+05/07/08/10/15/30/45/50/55/60 sequence matches spec §8 step-by-step.
- spec §9 rollback timing: T+R+0:30 / 1:00 / 2:00 / 2:30 / 3:00 / 5:00 matches spec §9 ladder.
- NDJSON one-line-per-event invariant: preserved through the stdin-pipe refactor.

---

**Bottom line:** the dev did real Round 3 work and the patch is directionally correct, but the largest gap (remote pipefail) was treated symptomatically at T+05 and left unfixed at T+50 and T+08 — and the "21/21" claim doesn't hold. Both block. The rest are tractable in <2 hours. Do not cut over until C-1 and T-1 are clean.
