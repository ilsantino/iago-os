# `.iago/state/`

`.iago/state/` holds per-machine, per-run pipeline artifacts. Always gitignored. Anything cross-session must live in `.iago/summaries/` or `.iago/learnings/`, not here.

## Verification

Confirm a path under `.iago/state/` is gitignored before relying on the boundary:

```bash
$ git check-ignore -v .iago/state/exposicion-run/01-foundation.log
.iago/.gitignore:2:state/*	.iago/state/exposicion-run/01-foundation.log
```

The output names the rule (`.iago/.gitignore` line 2: `state/*`) that excluded the path.

## `_archive` boundary

Note: `.iago/plans/_archive/` is the *opposite* — explicitly tracked, not gitignored. When auditing a new write site under `.iago/`, run `git check-ignore -v` against it before committing; if no ignore rule fires, the path is tracked, and you must either move the write or extend `.gitignore`.
