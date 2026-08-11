---
name: feedback_runtime_suite_flaky_tests
description: runtime/ vitest suite has latent full-suite-only flakiness + Windows-only fs-permission test failures; a red Runtime CI check on an unrelated PR is usually a flake — re-run before assuming regression
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d7fb8d7a-46a7-49b2-afca-b8f0511b26ec
---

The `runtime/` vitest suite (731 tests, 25 files) has latent flakiness that only
surfaces in the **full parallel suite**, never in isolation. Confirmed 2026-06-29
on PR #98 (`docs/evidence-template-and-fixtures`, commit 238283a).

**Why:** several error-path tests race on shared global state under parallel
vitest. The failing test VARIES run-to-run:
- CI (Linux) failed `agent-runtime/pty/claude-pty.test.ts > "emits crashed AND
  writes .daemon-stop marker …"` — it waits a single `setImmediate` tick for an
  async marker-file write, which isn't always enough under full-suite load → ENOENT.
- Same-day local (Windows) full run failed two *different* tests:
  `daemon/cred-bootstrap.test.ts:170` and `telegram/approval-bus.test.ts:828`.

The two Windows local failures are a **separate, platform** issue, not the CI
flake: they `fs.chmodSync(path, 0o000)` to fake an unreadable file, but Windows
ignores POSIX bits for reads, so the file is read anyway and the assertion fails.
The skip-guard only covers Linux root (`getuid()===0`), not Windows. They fail
deterministically on Windows and pass on Linux CI. So **Windows local `npm test`
is not a faithful repro of CI** — judge merge-readiness from CI (Linux), not local.

**How to apply:** when a `runtime/` PR shows a red "Runtime (typecheck + tests)"
check, do NOT assume a regression. First confirm the failing test is outside the
PR's diff (`git diff --name-only origin/main..HEAD`) and passes in isolation
(`npx vitest run <file>`). If both hold, it's a flake — `gh run rerun <id>
--failed`; a green same-commit re-run confirms it. Fixing the flake forward
(poll for the marker file instead of one `setImmediate`; skip the chmod-000 tests
on Windows) is a legitimate separate follow-up, NOT scope for an unrelated PR.
Related: [[feedback_async_claude_loop_stale_ref]], [[feedback_workflow_session_limit_incomplete]].
