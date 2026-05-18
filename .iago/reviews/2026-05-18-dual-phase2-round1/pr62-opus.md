# Adversarial Review (Opus 4.7): PR #62

**Verdict:** APPROVE_WITH_NOTES
**Plan reviewed against:** .iago/plans/feature-phase-2-vps-bootstrap/01a-deploy-unit-and-provision-script.md
**Diff size:** 4 runtime/deploy/* files (~610 net insertions: 230 unit + 179 script + 148 test + 142 README). 11 unrelated `.iago/reviews/*` + `.iago/runs/*` artifact files swept in by `git add -A` are IGNORED per scope.

## Critical

- None. Stress-test C1 (gh-token in CRED_MAP + unit `LoadCredentialEncrypted=` ACTIVE + bats test #9) is fully addressed: `runtime/deploy/provision-credentials.sh:49` carries `[gh-token]=op://iago-os/v2-gh-token/token::iago-gh-token`; `runtime/deploy/iago-os-v2-daemon.service:99` carries `LoadCredentialEncrypted=iago-gh-token:/etc/credstore.encrypted/iago-gh-token.cred` uncommented; `runtime/deploy/provision-credentials.test.sh:144-148` exercises the gh-token-alone path. C2 (no build-time path-existence assertion against `/var/lib/iago-os/daemon-state` or `/opt/iago-os/runtime/dist/daemon/main.js`) is honored — ExecStartPre assertions only fire at *systemd start time on the VPS*, not at pipeline build gate.

## Important

- **I-1 — Plan verification gate `≥18` will fail against the shipped unit (actual=17).** The plan Task 1 expects `grep -c "^LoadCredentialEncrypted\|^Environment\|^Protect\|^Restrict" runtime/deploy/iago-os-v2-daemon.service` to return ≥18. Actual count on the shipped file is 17 (2 LoadCredentialEncrypted + 5 Environment + 7 Protect* + 3 Restrict*). The plan's threshold was derived assuming gh-token adds +1 LoadCredentialEncrypted and TZ=UTC adds +1 Environment on top of an assumed spec baseline of 16 — but the actual spec baseline is 15 (1 LoadCred + 4 Environment + 7 Protect + 3 Restrict). So +2 from impl yields 17, not 18. Fix EITHER by adjusting the plan's verification threshold to `≥17`, OR by adding one more genuine hardening flag (e.g., `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` — daemon needs UNIX domain sockets for IPC and INET for outbound HTTPS; no AF_NETLINK / AF_PACKET / AF_VSOCK needed). The latter is the better outcome — it tightens security AND makes the plan's own gate green. Today, anyone running the documented verify command exits non-zero with a misleading "off by one" signal.

- **I-2 — `iago-telegram-token` round-trip uses length-only verification.** `provision-credentials.sh:156-165` compares `wc -c` of decrypted ciphertext against `wc -c` of locally-captured plaintext. If `systemd-creds encrypt`/`decrypt` round-trips bytes in a different order, or if any single byte flips mid-transmission, the check passes silently because the byte count is preserved. The spec accepts the length-only trade-off, but for Garry-standard completeness a `sha256sum` round-trip would be one extra `tailscale ssh` call per credential and would close the corruption window entirely. Worth promoting to a follow-up cleanup task; not a Phase 2 blocker because systemd-creds uses AEAD (any flip surfaces as decryption failure, not silent corruption).

## Minor

- **M-1 — `--experimental-specifier-resolution=node` deprecation.** `iago-os-v2-daemon.service:78` carries the Node flag verbatim from spec. Node 20 issues a deprecation warning on stderr (lands in journald, harmless but noisy); Node 22 removes the flag entirely. Spec preserves it because Phase 1 build artifacts use it. Flag for Phase 3 Node-version bump tracking.

- **M-2 — Comment inconsistency: "journald only" vs `ReadWritePaths=/var/log/iago-os`.** `iago-os-v2-daemon.service:19` says "Logs: journald only." but `:184` exposes `/var/log/iago-os` as a writable surface (used by cutover NDJSON per CONTEXT.md). Cosmetic — either remove "only" from the header comment or add a comment near `ReadWritePaths` noting that telemetry NDJSON is the canonical event stream.

- **M-3 — README §4 step-numbering visual glitch.** The narrative paragraph at `runtime/deploy/README.md:59` ("The script's git mode is `100755`…") sits between numbered steps 3 and 4 without a list-continuation indent. Markdown auto-renumbering still works but the visual flow is broken. Either indent the paragraph (4 spaces, continues list-item 3) or promote it to a footnote.

- **M-4 — Test 5 stdout-only assertion is loose.** `provision-credentials.test.sh:111-117` only checks substrings in `${output}`. Adding `grep -q "systemd-creds encrypt" "${STUB_LOG}"` would prove the encrypt invocation actually fired in the remote command (catches future regressions where the encrypt branch is silently skipped). Same applies to test 9 (gh-token).

- **M-5 — Missing baseline hardening flags worth considering.** The shipped unit omits `RestrictAddressFamilies=`, `ProtectProc=invisible`, `ProcSubset=pid`, `UMask=0077`, `LockPersonality` is present but `ProtectHostname=true` is already in. Spec doesn't require them, but `systemd-analyze security` exposure score will not be as low as it could be. Optional Phase 3 hardening sweep.

- **M-6 — `Documentation=https://github.com/ilsantino/iago-os/...` URL not verifiable from review surface.** Verbatim from spec; presumably correct if the repo lives at github.com/ilsantino/iago-os. Worth a one-time `gh repo view ilsantino/iago-os` sanity check before merge to avoid shipping a dead Documentation link.

## Dimension verdicts

- **Auth/security: PASS** — plaintext never touches local OR remote disk (1Password → bash variable → stdin pipe → systemd-creds encrypt on VPS, all in-memory); credential files are `0600 root:root` in `/etc/credstore.encrypted/`; credstore dir is `0700`; `User=iago` system user with `--no-create-home --shell /usr/sbin/nologin`; `LoadCredentialEncrypted=` with `--name=` binding prevents cross-credential ciphertext swap; daemon does NOT auto-restart on credential rotation (Santiago triggers explicit restart for observability).

- **Data loss: PASS** — provisioning script is idempotent; `mv` provides atomic publish; `daemon-reload` does NOT restart the daemon (so no in-flight job loss on credential rotation); round-trip verification (length-only — see I-2) catches gross corruption. The `; printf 'X'` + `${var%X}` trick at `provision-credentials.sh:125-127` correctly preserves trailing newlines that bash command substitution would otherwise strip, ensuring the bytes that go through the pipe are identical to what `op read` emits.

- **Plan compliance: PASS_WITH_NOTES** — Tasks 1-4 all delivered; stress-test C1 + C2 fully addressed; I1 (bats-on-Windows) documented in README §8; I2 (`User=iago` literal grep) satisfied — `^User=iago$` is the literal at `iago-os-v2-daemon.service:55`; I3 (no build-machine path validation) satisfied — no path tests in the build gate. The ONE compliance miss is plan's own grep threshold being off-by-one against actual file (see I-1).

- **Code quality: PASS** — `set -euo pipefail` at script top; shellcheck-clean expected; careful credential lifecycle (capture-once → use → explicit `unset`); thoughtful TOCTOU mitigation in the capture-once pattern with rationale comment; remote command properly escapes shell variables that should expand locally vs remotely (`\$tmpfile` for remote-side expansion, `'${cred_name}'` for local expansion before transit); usage block lists all CRED_MAP keys via `${!CRED_MAP[@]}` so adding a key auto-updates the help text.

- **Test quality: PASS** — 9 tests cover: usage on no args (exit 64), unknown-key rejection, op-whoami failure, tailscale unreachable, happy path, length-mismatch, `all` expansion (5 keys), VPS_HOST env override, gh-token-alone (Plan 04 dependency). Stub binaries log invocations to `${STUB_LOG}` for assertion on call patterns. Tests are independent (setup/teardown create fresh tmpdir each test). Could be tighter (see M-4).

## Notes

- **The `op read` capture-once pattern is a real improvement over the spec.** Spec calls `op read` twice (once for the encrypt pipe at line 474, once for `local_len` at line 488), which opens a TOCTOU window if a concurrent 1Password rotation lands between calls. Implementation captures once into a shell variable, computes `local_len` from the captured bytes, and pipes the same bytes to ssh. This is strictly safer than the spec and the rationale is documented inline at lines 117-124. This is the kind of "ship better than spec when the spec has a real flaw" judgment that deserves a callout, not a "deviation from spec" complaint.

- **The `; printf 'X'` marker trick deserves a +1.** Bash command substitution strips trailing newlines, which would mean `local_len=$(printf '%s' "$plaintext" | wc -c)` could under-count by 1 if the 1Password vault item value happens to end in a newline. The `op read "$op_ref"; printf 'X'` capture + `${plaintext_marker%X}` strip preserves trailing newlines exactly. Subtle but correct.

- **Set -e error propagation in the capture-once pattern is intact.** I traced: `plaintext_marker=$(op read "$op_ref"; printf 'X')` — with `set -e` inherited into the command-substitution subshell, an `op read` failure aborts the subshell BEFORE `printf 'X'` runs; the outer assignment then sees the non-zero exit and `set -e` aborts the script. No silent-success on missing 1Password item.

- **No security regression vs spec.** Plaintext lifetime: ~50ms (capture → encrypt pipe → explicit `unset`). Same order of magnitude as spec's pipe-then-call-op-again model.

- **mktemp template `'.${cred_name}.XXXXXX.cred'` is portable on coreutils 8+** (GNU mktemp treats characters after the last block of Xs as the suffix). Debian 13 ships coreutils 9.x — confirmed safe.

- **bats `run` captures stdout+stderr together by default** (older bats; newer bats with `BATS_VERSION` may differ). The `[[ "${output}" == *"ERROR:..."* ]]` assertions for stderr-emitted messages work in both modes; no change needed.

- **Unrelated artifact files ignored**: 11 `.iago/reviews/2026-05-17-*.md` and `.iago/runs/*` files in the diff are dual-review artifacts from earlier PRs swept up by `git add -A`. Per scope they are excluded from this review. Recommend a separate cleanup pass to either commit them deliberately (separate chore PR) or `git rm`/gitignore them before the next pipeline run.

- **The PR-triage agent dependency closure (Plan 04a/04b) is properly anchored here.** Three surfaces all align on `iago-gh-token`: CRED_MAP key, unit `LoadCredentialEncrypted=` line (uncommented + active), bats test #9. Plan 04b Task 2's failing-grep gate will pass when it lands.
