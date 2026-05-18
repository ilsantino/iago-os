# `.iago/` — folder structure & file placement rules

Source: MWP method (Eduba vault-toolkit constraint 06; ICM paper §3.2). See `.iago/research/2026-05-13-mwp-source-synthesis.md` for the canonical synthesis.

The core MWP discipline: **don't mix the factory and the product.**

- **L3 — factory.** Stable, set once, internalized as constraints. Templates, configs, conventions, runbooks, ADRs.
- **L4 — product.** Per-run, per-PR, per-pipeline-invocation artifacts. Logs, drafts, generated diffs, review outputs.

Mixing L3 and L4 in the same folder forces every reader (human or LLM) to sort them at read time. The folder hierarchy below pre-sorts them.

## Directory map

```
.iago/
├── README.md             # THIS FILE — start here
├── CONTEXT.md            # L1 workspace routing — what lives where
├── STATE.md              # current state digest (keep under 80 lines)
├── config.json           # iaGO project config

├── plans/                # L3/L4 — implementation plans
│   ├── feature-{slug}/   # feature-scoped plan stacks
│   │   ├── 01-name.md
│   │   ├── 02-name.md
│   │   └── CONTEXT.md    # workstream brief
│   └── _archive/         # plans superseded by canonical roadmap
│       └── YYYY-MM-{slug}/

├── decisions/            # L3 — ADRs (decision records)
│   └── YYYY-MM-DD-{topic}.md

├── learnings/            # L3 — accumulated review patterns
│   ├── .writer-contract.md
│   └── patterns.md       # appended by review-fix sessions

├── runbooks/             # L3 — ops runbooks
│   └── {topic}.md

├── research/             # L3 — research outputs / synthesis docs
│   └── YYYY-MM-DD-{topic}.md

├── context/              # L1 — context docs loaded by skills
│   └── {topic}.md

├── prompts/              # L3 — reusable prompt templates
│   └── {use-case}.md

├── reviews/              # L4 — per-PR review outputs (consolidated by date)
│   ├── _templates/       # L3 — reusable review prompt templates
│   │   └── adversarial-opus.md
│   ├── adv-pr{N}-opus-{ts}.md       # pipeline review stage outputs
│   ├── codex-pr{N}-{ts}.md          # pipeline codex stage outputs
│   ├── YYYY-MM-DD-{label}/          # ad-hoc review batches (e.g. dual-review sweep)
│   │   ├── pr{N}-opus.md
│   │   └── pr{N}-codex.md
│   ├── raw/              # raw upstream review dumps
│   └── sentria-{date}/   # per-client review batches

├── summaries/            # L4 — plan-execution summaries (pipeline stage 6)
│   ├── {plan-id}-{slug}.md
│   ├── quick-{date}-{slug}.md
│   └── audit-{topic}.md

├── handoff/              # L4 — cross-session handoff prompts
│   └── YYYY-MM-DD-{slug}.md

├── runs/                 # L4 — ephemeral per-run artifacts
│   └── dispatch-logs/    # raw `tee` outputs from /iago-execute
│       └── YYYY-MM-DD-{plan-id}.log

├── state/                # L4 — NDJSON pipeline state (gitignored at file level via .gitignore)
│   ├── pipeline-runs/    # one NDJSON per pipeline run
│   └── .pipeline.lock.d/ # per-project execution lock

├── pipeline-runs/        # (legacy — being phased into state/pipeline-runs/)

├── hooks/                # L3 — git/Claude hook scripts referenced by .iago/config
└── logs/                 # L4 — general log dump (gitignored)
```

## Placement rules

| If you are writing... | It goes in... | Notes |
|---|---|---|
| A new plan | `plans/feature-{slug}/0N-{name}.md` | Frontmatter `phase`, `plan`, `wave`, `depends_on` required |
| A new ADR | `decisions/YYYY-MM-DD-{topic}.md` | Frontmatter `date`, `status`, `plan` (if scoped) |
| A research synthesis | `research/YYYY-MM-DD-{topic}.md` | Date prefix prevents shadow-overwrite |
| A pipeline summary | `summaries/{plan-id}-{slug}.md` | Written by pipeline stage 6 |
| A per-PR dual review | `reviews/YYYY-MM-DD-{label}/pr{N}-{model}.md` | Use a dated subfolder when reviewing >2 PRs in one sweep |
| A handoff prompt for the next session | `handoff/YYYY-MM-DD-{slug}.md` | Self-contained — assumes cold start |
| A dispatch log (`tee` output) | `runs/dispatch-logs/YYYY-MM-DD-{plan-id}.log` | Optional — keep only if a pipeline run hit something unusual; otherwise delete |
| A PR body draft | nowhere on disk | Pass the body to `gh pr create --body-file` from a temp path; do not commit the draft |
| A reusable prompt template | `prompts/{use-case}.md` OR `reviews/_templates/{name}.md` | The `_templates/` convention scopes templates to their consumer |

## Anti-patterns (what NOT to do)

- ❌ `summaries/_pr-body-{slug}.md` — PR bodies live in GitHub; don't commit drafts. Use `runs/` or `mktemp` if you need a transient file.
- ❌ `summaries/_dispatch-{slug}.log` — dispatch logs go to `runs/dispatch-logs/`, not summaries (those are L4 ephemera, summaries are L4 stage-6 outputs — different shapes, don't mix).
- ❌ `reviews/_opus-prompt-pr{N}.md` — per-PR substituted prompts are regenerable from the template; don't keep them.
- ❌ `reviews/pr{N}-diff.patch` — regenerable via `gh pr diff {N}`; don't commit.
- ❌ `reviews/pr{N}-{model}.md` at the top level — use a dated subfolder when running batch reviews so the L3 pipeline-output convention (`adv-pr{N}-opus-{ts}.md`) stays uncluttered.
- ❌ Frontmatter-less docs in `decisions/` or `research/` — readers (and graphify) rely on the frontmatter to route.
- ❌ Putting templates in the same folder as their outputs — the `_templates/` prefix is the boundary marker.

## When in doubt

Run the diagnostic from `.claude/rules/layer-triage.md`:

1. Is this artifact deterministic / reusable across runs? → L3 factory (templates, configs, conventions).
2. Is this artifact produced once per run / per PR / per execution? → L4 product (logs, drafts, review outputs).
3. Is it ambiguous? → put it in the more-ephemeral location (L4). It's easier to promote L4 → L3 later than to clean up an L3 folder full of L4 noise.
