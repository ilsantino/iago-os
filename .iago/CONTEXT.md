# `.iago/` — iaGO-OS workspace (MWP L1)

**Layer:** L1 routing. Read after root `CLAUDE.md` (L0), before anything under `.iago/`. Budget ≤ 300 tokens. Routing only — no content, and no second "where does X go" table: that one lives in root `CLAUDE.md` (council decision 2026-05-04), and the `.iago/` schema itself is machine-enforced (`.claude/rules/iago-workspace.md`).

This workspace is **iago-os**, the consultancy's own operating system: `.claude/` (rules, skills, agents), `runtime/` (v2 daemon), `scripts/`, `templates/`, `docs/specs/`, and this `.iago/` planning tree. Every client engagement is a **sub-workspace** carrying its own `.iago/` on the same schema, versioned in its own private planning repo.

## Sub-workspaces

| Path | App repo | Planning repo | Inner repo? |
|---|---|---|---|
| `clients/din` | `ilsantino/dinpro-pricing` | `bas-labs/din-planning` | yes — `dinpro-app/` |
| `clients/fulldata` | `onetuweb/Fulldata`, `onetuweb/Fulldata-back`, `ilsantino/fulldata-bot-asistente`, `ilsantino/fulldata-pricing-mock` | `bas-labs/fulldata-planning` | yes — four |
| `clients/iago` | `bas-labs/iago-web` | `bas-labs/iago-web-planning` | yes — `iago-web/` (PRs base `iago-web-qc`) |
| `clients/munet-web` | `bas-labs/munet-web` | `bas-labs/munet-planning` | no — the folder **is** the app repo |
| `clients/palazuelos` | — (discovery engagement, no app) | `ilsantino/palazuelos-erp-discovery` | no — the folder **is** the planning repo |
| `clients/rsf` | `bas-labs/rsf-flow-tool` | `bas-labs/rsf-planning` | yes — `flow-tool/` |
| `clients/sentria` | `bas-labs/sentria` | `bas-labs/sentria-planning` | no — the folder **is** the app repo (PRs base `sentria-qc`) |

App repos gitignore `.iago/`; the planning tree is its own private git repo at `{path}/.iago/` and is the engagement's memory. App-repo changes go as PRs to that repo — never `git add -f` from here.

## L2 stage contracts — retired

The L2 stage-contract convention (a `CONTEXT.md` per phase declaring Inputs / Process / Outputs) is retired. `runtime/CONTEXT.md` survives as the v2 daemon build's standing brief and still reads after this file. New phases write no stage contract: the plan folder's `README.md` is the brief, and `.iago/plans/{phase}/NN-{slug}.md` is the contract.

## Conformance

`python scripts/organize/iago-lint.py check --root .` reports every schema violation in this workspace; `--all` extends the scan to the sub-workspaces above. The schema, the banned list and the lifecycle table are in `.iago/plans/feature-doc-standard/README.md` §2 and §6.
