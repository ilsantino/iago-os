# `state/`

Gitignored. Everything the pipeline writes per run: locks, logs, review dumps,
session scratch, `pipeline-runs/*.ndjson`. Nothing here is a source of truth and
nothing here is committed.

The linter skips this directory entirely, and it is excluded from `STATE.md`
staleness — a pipeline run writes here on every invocation, so counting it would
make the digest permanently stale.
