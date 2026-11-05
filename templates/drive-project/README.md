# drive-project — template for `My Drive/IAGO/Projects/<Project>/`

Three files every Drive project folder carries. Conventions (folder set, naming) are in Drive `IAGO/Projects/README.md`;
the audit that produced them is `.iago/research/2026-11-03-projects-folder-conventions.md`.

| File | Goes to | Purpose |
|---|---|---|
| `CLAUDE.md.template` | `Projects/<P>/CLAUDE.md` | Auto-loaded when Claude Code opens the Drive folder: points at README.md and the repo, states the write-by-id rule. |
| `README.md.template` | `Projects/<P>/README.md` | The router («I want to … → open»), folder table, done criteria, what not to do, log. |
| `deliverables-README.md.template` | `Projects/<P>/deliverables/README.md` | One row per send: folder, what, sent to, notes. |

Fill the `{{…}}` placeholders; create the files through the Drive connector by id (never through the Finder mount);
overwriting content of an existing file through the mount is fine. Dated folders are `YYYY-MM-slug` or `YYYY-MM-DD-slug`.
