# ~/Developer — iaGO development root (read first)

One folder per git repo, named exactly like the repo on GitHub. Code, tests, technical docs and the
project's development context (`.iago/`) live here. Everything a client could receive or has sent lives in
Google Drive under `My Drive/IAGO/Projects/<Project>/`. Nothing is duplicated between the two.

## Map: repo → project → Drive folder

| Repo (this folder) | GitHub | Project / product | Drive folder (`My Drive/IAGO/…`) |
|---|---|---|---|
| `sentria/` | bas-labs/sentria (PRs → `sentria-qc`) | Sentria — industrial incident bot. Clients: Absara, Vaqueras | `Projects/Sentria/` (+ `clients/Absara`, `clients/Vaqueras`) |
| `sentria-predictive-maintenance/` | ilsantino | Sentria research spin-off | `Projects/Sentria/` |
| `munet-web/` | bas-labs | MUNET — museum site, QR ticketing, POS | `Projects/Munet/` |
| `rsf/` | ilsantino/ws-rsf | Red Sun Farms — Costos y rentabilidad engagement (documentation repo; its own `CONTEXT.md` → `STATE.md`) | `Projects/RSF/` (session material in `sessions/`, indexed in `rsf/FUENTES.md`) |
| `rsf-flow-tool/` | bas-labs | RSF flow tool (paused since 2026-09-14) | `Projects/RSF/` |
| `scientia-web/` | bas-labs | Scientia — law firm site rebuild | `Projects/Scientia/` |
| `valorarrend-web/` | bas-labs | Valorarrend — site | `Projects/Valorarrend/` |
| `vantek-web/` | bas-labs | Vantek — cancelería marketing site | `Projects/Vantek/` |
| `dinpro-pricing/` | ilsantino | DIN Pro — pricing module | `Projects/DIN/` |
| `fulldata-bot-asistente/` | ilsantino | FullData — assistant bot + TSM consulting | `Projects/Fulldata/` |
| `palazuelos-erp-discovery/`, `palazuelos-web/` | ilsantino, bas-labs | Grupo Palazuelos — ERP discovery (text repo) + site | `Projects/Palazuelos/` |
| `recibia/` | local git, no remote yet | Recibia — iaGO's own product (digital receipts) | `Projects/Recibia/` |
| `iago-os/` | ilsantino (public) | The delivery system: skills, agents, rules, templates, hooks, `home/` (this machine's Claude config) | `Company/` |
| `iago-web/` | bas-labs (PRs → `main`; the `iago-web-qc` model was retired 2026-09-06) | iaGO website | `Company/web/`, brand in `Company/brand/` |
| `iago-leadgen/`, `iago-workspaces/` | ilsantino | Lead generation; content pipeline | `Company/` |
| `obsidian-brain/` | ilsantino | Claude's memory vault (sessions, decisions, people, concepts). Edit via the Obsidian MCP only | — |
| `career-ops/` | santifer (personal) | Personal career ops | — |

Drive folder ids (for the Drive connector; writes go by id, never through the mount — `search_files` with `parentId` lists any subfolder):
`IAGO` 1R5OvQeAv-Mu-zUv-0ElSt3t3qVPBUeIm · `Projects` 11zpcpqQ7c-jrvZcuum6QBQExh0pDC2l6 · `Company` 1mO2SsG0tUBcE_TtFttL0kd0hquzLli4K ·
`Content` 1XP2XR67zaPO-_mA-Qy4w3lk-vpmdszT_ · `Reference` 1zhalRxhEaftkpekfySlOASKSdxy8SSPK · `Backups` 1YTmZ_XqeBI6X084kMarDpPFQoQTIPS8H ·
`Sentria` 1mFaMHthRZ3Ez893swcQ51sktygiUAuTj · `Munet` 1r8BQIkbhZPgCbD99s0PBoY19tuvit7u9 · `RSF` 1zPcEqDb64pfx_KeOw1C1inhaLidGaLSD ·
`Scientia` 1Xy75wolpkL0WOt6J3RKjSliPN6ydzNNo · `Valorarrend` 1_zsjcA9va5GEWI-ler0b9QsFNzm3-Oxt · `Vantek` 1ndHpYcSWeJC5M1cgctB-VuqLaAjAultm ·
`DIN` 1BkfNHEBfkkK69LZOvaOtEYHFonPMhLE_ · `Fulldata` 1ODUPEdHn6SEzySgwRH_J88eJLdmptt7k · `Palazuelos` 1SCrHjXPnfh9DOsnJCWBQCk6vVVKTlosF ·
`Recibia` 1kcDJrNyr9uLmq6HulW2YJLpXlpETSS_e · `_archive` 18qXBUIl_9mvpKCbrIIVJI2oZJjDiy7yj · `Google Meet` (inbox) 1H4DeHYHvD6dOydFWxPcZDCTRy3JUTyZu ·
«Información fiscal» (shared by francisco@, authoritative, invisible on the mount) 1yg_i2e4nJxEwa8I_2pKYQFc0p4lurPs9.

Dormant, not cloned: Dany, Crédito (Drive `Projects/_archive/`). Memory for each repo is keyed by its path:
`~/.claude/projects/-Users-alvarez-Developer-<repo>/memory/` (rsf's is a symlink into `rsf/_memory/claude/`).

## Where a new file goes

| Kind | Place |
|---|---|
| Code, tests, technical docs | the repo (`src/`, `docs/`) |
| Plans, STATE, ROADMAP, runbooks, agent briefs, technical research, decisions | `<repo>/.iago/` (taxonomy: `iago-os/.iago/README.md`) |
| Deliverable source (md, html, scripts) | `<repo>/.iago/` or `docs/`; the exported PDF/PPTX → Drive `Projects/<P>/deliverables/<YYYY-MM>-<slug>/` |
| Received documents, contracts, proposals, meeting notes, business research, brand, media | Drive `Projects/<P>/` (`received/`, `deliverables/`, `meetings/`, `research/`, `brand/`, `media/`; `clients/<C>/…` when a product has several clients) |
| Company docs, decks, legal, brand | Drive `Company/`; marketing content → `Content/`; corpora and courses → `Reference/` |
| Secrets | 1Password → gitignored `.env` in the repo. Never in Drive, never in git |
| Session digests, cross-project decisions, people | `obsidian-brain/` via the Obsidian MCP |

Rules every repo inherits: `iago-os/.claude/rules/` (linked at `~/Developer/.claude/rules`). Skills `/iago-*` and agents
`executor`/`analyst`/`operator` are linked from `iago-os` into `~/.claude`. Re-link on a new machine:
`bash ~/Developer/iago-os/home/install-mac.sh`.

Sentria PRs target its integration branch `sentria-qc` (promoted to `main` by PR), never `main` directly; every other repo targets `main`. Claude never merges.

## Finder (set 2026-10-28)

Sidebar Favorites, in order: **Developer** (this folder) · **Projects** (Drive `IAGO/Projects`) · **IAGO** (Drive `IAGO`, the
whole company tree) · **Personal** (the sanalvcham@gmail.com My Drive) · **Downloads**, then Applications and Desktop. No
per-project favorites: lowercase `rsf`, `munet-web` are repos here; Capitalized `RSF`, `Munet` are Drive project folders.
Path bar is on (View → Show Path Bar) so any window says where it is. Full guide: Drive `IAGO/README.md` and
`iago-os/.iago/research/2026-10-28-filesystem-architecture.md`.
