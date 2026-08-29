# P8 — Home root & machine caches — execution summary

**Plan:** `.iago/plans/feature-filesystem-order/README.md` §P8 · **Run:** 2026-08-19, operations
**Tool:** `scripts/organize/reclaim.py tree` (new subcommand) · gate `test-reclaim.py` → PASSED
**Authorised by:** Santiago — "i also feel like we can do a LOT of cleanup here: C:\Users\sanal"

## What P0–P7 never looked at

Every prior phase worked on *zones* — `Downloads`, the OneDrive trees, `Pictures`. The home
directory itself and everything under `AppData` were out of scope, and that is where almost all
the mass turned out to be. `Downloads` at its worst was 10 GB. `AppData\Local` was **160 GB**.

| tree | before | disposition |
|---|---|---|
| `Microsoft\OneDrive\logs\ListSync` | 55.6 GB / 57,124 files | quarantined |
| `uv\cache` | 21.5 GB / 928k files | 5.2 GB cleaned; 16.3 GB blocked (see below) |
| `npm-cache` | 14.9 GB | 12.1 GB cleaned + 2.5 GB `_npx` quarantined |
| `.cache\huggingface` + `.cache\whisper` | 2.5 GB | 1.7 GB quarantined, **medium kept** |
| `.cache\puppeteer` | 1.3 GB | quarantined |
| `pip` | 2.3 GB | purged by `pip cache purge` |
| Claude Code update leftovers | 1.5 GB | quarantined |
| home-root scratch | 922 MB | quarantined |

**19.6 GB hard-reclaimed** via each tool's own cache command. **62.6 GB held in quarantine**,
purgeable **2026-08-26**. Disk went 324 GB used → 314 GB, and drops to roughly **252 GB** on purge.

## The tool this phase needed

`reclaim.py scan` classifies *files*. The biggest reclaimable things here are not file-shaped:
their meaning lives in the directory, not in any one file inside it. Classifying 57,000 telemetry
logs individually is both slow and wrong — the decision is "this cache is regenerable", made once,
about the tree.

`reclaim.py tree` moves a whole directory with one `os.rename`: instant at any size, because it
moves a directory entry rather than bytes, and journalled as a single op that `organize.py undo`
already reverses — `os.path.exists` and `os.rename` do not care whether their argument is a file
or a directory.

## The 56 GB mistake, and what it taught

The first implementation kept `reclaim.py`'s existing `shutil.move` fallback for when `os.rename`
fails. That is right for one file and **catastrophic for a tree**.

`os.rename` on the OneDrive log directory failed with `WinError 32` — OneDrive held
`microsoftNucleusTelemetryCache.otc` open. `shutil.move` then spent eleven minutes **copying** all
57,000 files, hit the same lock on its delete half, and left a 56 GB orphan beside a completely
untouched original. Free space fell 60 GB and the run reported that nothing had moved.

The reason a directory will not rename on Windows is almost never "different volume" — it is
"something has this open", and that same lock defeats the copy's delete half. The fallback is
gone. A failed rename now reports `IN USE` with the locking path, copies nothing, and says to stop
the owning process and re-run. `test_a_locked_tree_is_never_copied` monkeypatches `_safe_rename`
to fail and asserts **not one byte** reaches the quarantine.

Recovery: the orphan batch was verified against its journal (one op, `status: failed`, no `ok`
ops), the four sources were re-counted against the dry-run figures — `npm-cache` 175,699 and `pip`
4,289 exactly, `ListSync` 170 files lower purely from live log rotation — and then deleted.

## `CACHEDIR.TAG` outranks the git heuristic

`tree_refusal()` refuses any tree containing a `.git`, on the grounds that a cache never holds a
repository and swallowing one whole would leave no per-file record of what went. That guard fired
on uv's 21 GB cache, over `sdists-v9/.git` — a file unpacked from somebody's source tarball, not
even a valid repository (`git remote -v` → `fatal: invalid gitfile format`).

uv writes `CACHEDIR.TAG` at its cache root: the Cache Directory Tagging Standard signature
`8a477f597d28d172789f06886806bc55`. That is the tool declaring, in its own voice, that the tree is
regenerable — a fact, not a guess — so it now outranks the git heuristic. A forged or truncated
tag does not count, and the tag never unlocks the `dev\` frozen zone.

## Things that looked like junk and were not

Four folders read as dead leftovers and would have been deleted by anything working from age
alone. Checking the uninstall registry first is what stopped it:

| folder | reality |
|---|---|
| `~\RStudio` (771 MB, untouched since 2022) | **is the installation** — `bin\`, `R\`, `Uninstall.exe`. Deleting it orphans the uninstaller and leaves the registry claiming the app is present. |
| `~\Microsoft` (198 MB, 2024) | live data for **Power BI Desktop**, installed as an Appx package |
| `AppData\Local\Arduino15` (4.4 GB, 2024) | live data for **Arduino IDE 2.2.1**, installed |
| `AppData\Local\Mozilla` (1.0 GB, 2022) | live profile for **Firefox**, installed |

An installed-but-unused application is an *uninstall* decision, not a delete. Left for Santiago.

## Rescued rather than swept

Three documents existed nowhere else — two in an untracked stash folder from 2026-04-28, one loose
at the home root. Each was hash-verified against its new copy before the original was quarantined.

- `2026-03-23-openclaw-architecture-analysis.md` — the study behind the v2 multi-agent direction
- `2026-04-28-frontend-design-skills.md` — the Remotion evaluation the animation-studio-only call rests on
- `_config/runbooks/memory-system-setup.md` — a runbook, not research: the memory stack, for Sebas on Mac

`Desktop\munet-r2-handoff.zip` (5 plans + the fable workflow variants) went to
`iago/01-clientes/munet/04-insumos/20260705-munet-handoff-r2.zip`. `~\backups\openclaw-2026-08-17\`
was left exactly where it is — dated, recent, correctly named, and real.

## Reversibility

| batch | contents | size |
|---|---|---|
| `20260819-140533` | home-root scratch, stale config backups, duplicated stash docs | 922 MB |
| `20260819-142252` | superseded Claude versions, puppeteer, redundant whisper models | 3.0 GB |
| `20260819-145401` | `npm-cache\_npx` | 2.5 GB |
| `20260819-145638` | OneDrive ListSync telemetry logs | 55.6 GB |
| `20260819-145728` | Claude Code update leftovers | 620 MB |

All purgeable **2026-08-26**. `pip`, `npm _cacache` and part of `uv` were cleaned by their own
tools rather than quarantined: those commands keep the tool's index consistent and reclaim the
disk immediately, and the undo net is worth nothing when the undo is the tool re-downloading.

## Left open

- **`uv\cache\archive-v0` — 16.3 GB, blocked.** `uv cache clean` fails on
  `_yaml.cp312-win_amd64.pyd`: `uvx` runs `workspace-mcp` **directly out of the cache**
  (`archive-v0\Ap8Is1YZfXeQkoZgOUyuy\Scripts\python.exe`), so for uvx-launched MCP servers the
  cache is the live install. Clears on a run with Claude Code closed.
- **101 leaked MCP server processes**, oldest from 2026-08-14, across 15 running `claude`
  processes. Only 176 MB of RAM between them, and no safe way to tell a live server from an
  orphan mid-session — reported, not acted on.
- **Installed-but-unused apps** — RStudio + R 4.2.1, Logicly, Arduino IDE, Firefox. Roughly 6.5 GB
  of user profile plus their `Program Files` installs. Santiago's call, via their uninstallers.
- **Claude Code leaks ~326 MB per update** — each auto-update leaves a `claude.exe.old.<epoch>` in
  `.local\bin` that nothing collects. Three had accumulated; a fourth appeared during this session.
