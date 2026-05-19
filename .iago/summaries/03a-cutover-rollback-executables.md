---
plan: 03a-cutover-rollback-executables
status: done
verified: 2026-05-19
pr: https://github.com/ilsantino/iago-os/pull/68
---

# Summary: 03a-cutover-rollback-executables

## Pipeline Result

- **Implement:** exit 0
- **Build gate:** passed
- **Review:** PASS
- **Codex:** exit 0
- **PR:** https://github.com/ilsantino/iago-os/pull/68

## Diff Stats

```
 .iago/runs/round-3-dispatch/03a.log                | 185 +++++++
 runtime/deploy/cutover.sh                          | 609 +++++++++++++++++++++
 runtime/deploy/rollback.sh                         | 374 +++++++++++++
 .../test-cutover.fixtures/openclaw.expected.json   |   7 +
 .../scripts/test-cutover.fixtures/openclaw.json    |   7 +
 .../test-cutover.fixtures/stubs/_generic-noop      |  10 +
 runtime/scripts/test-cutover.fixtures/stubs/op     |  25 +
 .../scripts/test-cutover.fixtures/stubs/tailscale  | 175 ++++++
 runtime/scripts/test-cutover.mjs                   | 608 ++++++++++++++++++++
 9 files changed, 2000 insertions(+)
```
