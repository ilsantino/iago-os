# Santiago — Global Context

CEO of iaGO (3-person AI consultancy; CTO Sebas, on Mac). Give opinionated verdicts with reasoning — never option menus.

## Where everything lives (Mac, since 2026-10-27)

- **Code and development context:** `~/Developer/<repo>/` — one folder per GitHub repo, flat. The map (repo → project → Drive folder → branch rules) is `~/Developer/CLAUDE.md`; read it before touching a project you have not seen this session.
- **Documents, deliverables, received files, media:** Google Drive `My Drive/IAGO/` → `Projects/<Project>/` (clients inside `clients/<Client>/`), `Company/`, `Content/`, `Reference/`, `Backups/`. Mounted at `~/Library/CloudStorage/GoogleDrive-santiago@iagoag.com/My Drive/IAGO/`. Also reachable through the Google Drive connector.
- **Project state:** `<repo>/.iago/STATE.md` (≤ 80 lines) is the single status file per product; `.iago/plans`, `.iago/research`, `.iago/runbooks` hold the rest (taxonomy: `~/Developer/iago-os/.iago/README.md`). RSF is the exception: a documentation repo whose state is `~/Developer/rsf/STATE.md` (start at its `CONTEXT.md`).
- **Finder:** Favorites are Developer · Projects · IAGO · Personal · Downloads (set 2026-10-28; lowercase `rsf` = repo, Capitalized `RSF` = Drive project folder). Guide: Drive `IAGO/README.md`.
- **Personal:** the sanalvcham@gmail.com Drive, mounted at `~/Library/CloudStorage/GoogleDrive-sanalvcham@gmail.com/My Drive/`. Never business material there.
- **Claude memory:** per repo, keyed by path (`~/.claude/projects/-Users-alvarez-Developer-<repo>/memory/`). RSF's memory is versioned in the repo (`rsf/_memory/claude/`).
- **Delivery system:** `~/Developer/iago-os` — skills `/iago-*`, agents `executor`/`analyst`/`operator`, rules, templates, hooks. This machine's Claude config is versioned in `iago-os/home/`; `bash ~/Developer/iago-os/home/install-mac.sh` re-wires a machine.
- **Secrets:** 1Password → gitignored `.env`. Never in Drive, never in a repo, never in chat.
- **Migration staging (temporary, delete in Phase 5):** `~/migration-2026-10/` holds the Surface archives, extracted; transcripts of past sessions are searchable there (`extracted/claude-code/claude-code/.claude/projects/*/*.jsonl`), never copied into `~/.claude/projects`.

## Language (all projects)

English for everything written to disk or handed to an agent: code, comments, commit messages, PR titles and bodies, plans, specs, research, runbooks, READMEs, and every prompt written for a terminal or subagent. Spanish ONLY for client-facing strings: UI copy, end-user guides (e.g. `docs/usuarios/`), client emails and deliverables. When a comment or doc quotes UI copy, keep the quoted Spanish verbatim. Chat replies follow the language Santiago writes in.

## Token budget (all projects — from the 2026-09-14 usage audit)

Measure with `python3 ~/.claude/scripts/usage-audit.py --detail` (zero tokens). Playbook: `~/.claude/playbooks/claude-operating-playbook.md`.

**Model by complexity** — Opus 5 high is the default:
- Mechanical (move/rename, format, run-and-report, commit/PR) and read/extract (docs, frames, web, criteria-based triage) → `sonnet`.
- Build and judge (coordinate, implement, review, debug, reconcile, draft) → `opus`; xhigh only for a bug that survived 2 fixes or a real architecture trade-off.
- Plan and synthesize (phase or engagement plans, features with 4+ tasks, agent briefs, final synthesis, expensive-if-wrong decisions) → `fable`, in a fresh session fed curated inputs (≤150k). Never for reading, fan-out, coordination or status. NEVER as the model of a subagent, Workflow script, background task or scheduled routine: those are always `sonnet` or `opus`.

**Agents — as many as the task needs, none beyond that:**
- Every Agent call sets `model` explicitly; never inherit the session model.
- Spawn one only for an independent unit of work: its inputs don't overlap another agent's, and neither a script nor the current session can do it as well. Deterministic work (audits, merges, frame extraction, diffs, status) → script.
- Print the roster before dispatching: agent → model → why.
- Over a shared corpus, build one compact index first, then fan out over the index.
- Every brief carries a read budget (Grep to locate, Read with offset/limit, stop near 150k context) and an output contract (write to a file, reply ≤150 words: path + status).

**Sessions and terminals:**
- The main chat coordinates: decisions, status from STATE.md + `gh`/`git`, small edits, terminal prompts, reading reports. Multi-file, long-running or different-model work goes to a side terminal. The main chat never babysits builds or deploys.
- A side-terminal handoff gives the launch line (`claude --model X --effort Y -n {project-task}` from the right folder) and a self-contained prompt: folder and branch, state, steps, done criteria, what not to touch, report path. The terminal writes its report there and stops.
- Keep sessions under ~150k context; at that point or a phase boundary, write the handoff and tell Santiago to open a fresh session. Never resume a >200k session.
- Never change model or effort mid-session on a large context; pick at session start.

## Brand (all projects)

The only iaGO logo source is Drive `IAGO/Company/brand/2026-09-logo-final/` (wordmark · horizontal with «ΛGENCY GROUP» across the full width · stacked; light/dark; JPG + transparent PNG). Never take a logo from `iago-web` `public/brand/` or from an older deliverable: the `feat/rebrand` lockup-02 (AGENCY GROUP under GO, off-centre) is wrong. Quotes and proposals use the horizontal light PNG.

## Knowledge Stores

Obsidian vault `~/Developer/obsidian-brain` — access ONLY via Obsidian MCP tools, never raw filesystem. Navigate from `Home.md` + `CRITICAL_FACTS.md`; client/project hubs in `clients/{slug}/` and `projects/{slug}/`; digests → `sessions/`, meetings → `meetings/`, dailies → `daily/`, business docs → `_context/`. Search the vault before asking Santiago for context he's already documented. Project meeting notes from 2026-10-27 on go to Drive `Projects/<P>/meetings/`; the vault's `clients/` and `meetings/` folders are frozen (kept, not extended).

| Need | Tool |
|---|---|
| Notes, decisions, meetings | Obsidian MCP (`search_notes`, `read_note`) |
| Received documents, deliverables, client files | Google Drive connector, or the mount under `~/Library/CloudStorage/` |
| Entity relationships, vault navigation | Graphify MCP (`query_graph`, `get_node`) or `graphify-out/wiki/index.md` — Graphify not yet installed on this Mac |
| Past conversation recall | MemPalace (`mempalace_search`) — data restored at `~/.mempalace`, tool not yet installed on this Mac |
| Library/framework docs | Context7 |
| YouTube transcripts | youtube-transcript MCP |
| DOCX/PPTX/XLSX/PDF to markdown | MarkItDown MCP (`convert_to_markdown`) |

## Obsidian Procedures (on request)

- Session digests auto-captured by the Stop hook (`iago-os/scripts/hooks/session-obsidian.py`). Manual digest only if asked: `sessions/YYYY-MM-DD-{project}[-NN].md` — What Was Done / Decisions Made / Files Changed / Open Questions, [[wikilinks]].
- Meeting import: raw transcripts in `meetings/_inbox/` → extract date/attendees/project/decisions/action items → write `meetings/YYYY-MM-DD-{topic}.md` → remove raw from `_inbox/`.
- Daily summary: roll today's `sessions/` + `meetings/` notes into `daily/YYYY-MM-DD.md` with [[wikilinks]].
