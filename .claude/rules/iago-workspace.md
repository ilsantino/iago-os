---
description: >-
  The `.iago/` workspace schema is machine-enforced. Run the linter instead of
  memorising the tree.
globs:
  - ".iago/**"
  - "templates/**/.iago/**"
---

## iaGO Workspace Schema

- One `.iago/` grammar for the iago-os root and every client. It is **checked by a script, not memorised**: `python scripts/organize/iago-lint.py check --root .` (`--all` adds the client sub-workspaces).
- Run it before restructuring a workspace, before moving anything under `.iago/`, and on any freshly scaffolded tree. Non-zero exit is the worklist — each finding prints its own fix.
- The schema itself (required files, banned directories, the `_config/`/`_archive/` carve-out, the lifecycle table) lives in `.iago/plans/feature-doc-standard/README.md` §2 and §6. It is deliberately not restated here.
- Report mode only — the linter never moves a file.
