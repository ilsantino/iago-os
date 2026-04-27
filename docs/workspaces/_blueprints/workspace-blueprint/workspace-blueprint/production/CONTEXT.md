# Production

<!--
=======================================================================
TEACHING NOTE: This workspace demonstrates the PIPELINE pattern.

Production has two levels of CONTEXT.md:
  1. This file (workspace entry point) — routes to docs or workflows
  2. workflows/CONTEXT.md (pipeline entry point) — routes to stages

This is the most complex workspace in the template. It shows:
  - Sub-routing (workspace CONTEXT → pipeline CONTEXT)
  - Reference docs separate from workflow
  - Stage-specific tool integration
  - Creative freedom within constraints (specs vs builds)
=======================================================================
-->

## What This Workspace Is

The build shop. Finalized drafts from writing-room become production deliverables here — demo apps, videos, sample projects, interactive tutorials. This is **downstream** from writing:

```
writing-room (writing) → production (building)
```

---

## Where to Go

| You Want To... | Go Here |
|----------------|---------|
| **Understand the pipeline** | `workflows/CONTEXT.md` |
| **Look up technical standards** | `docs/tech-standards.md` |
| **Look up available components** | `docs/component-library.md` |
| **Look up design rules** | `docs/design-system.md` |

**Don't read everything.** Identify your task, load only what you need.

---

## Folder Structure

```
production/
├── CONTEXT.md                  ← You are here
│
├── docs/                       ← Reference docs (load per-task)
│   ├── tech-standards.md       ← Code quality, testing, deployment standards
│   ├── component-library.md    ← Reusable components + packages
│   └── design-system.md        ← Visual standards, layouts, color, typography
│
├── workflows/                  ← The 4-stage pipeline
│   ├── CONTEXT.md              ← Pipeline routing (READ THIS for builds)
│   ├── 01-briefs/              ← What to build (input from writing-room)
│   ├── 02-specs/               ← Technical plan (contract for the build)
│   ├── 03-builds/              ← Active build work
│   └── 04-output/              ← Finished deliverables
│
└── src/                        ← Source code (demos, sample apps, tools)
```

---

## What to Load

| Task | Load These | Skip These |
|------|-----------|------------|
| Brief → Spec | The brief from `01-briefs/`, `docs/tech-standards.md` | design-system, component-library |
| Spec → Build | The spec from `02-specs/`, `docs/design-system.md`, `docs/component-library.md`, `docs/tech-standards.md` | writing-room docs |
| Review a build | The spec (as contract), the build output | docs/ (unless checking specific standards) |

---

## Skills & Tools for This Workspace

<!--
TEACHING NOTE: Production is where tools get DENSE.
Different pipeline stages use different tools. This is the
workspace-level overview — workflows/CONTEXT.md has the
stage-by-stage specifics.

Notice the pattern: skills aren't listed generically.
Each one has a WHEN (which stage) and a WHY (what it does there).
-->

| Skill / Tool | Stage | Purpose |
|-------------|-------|---------|
| Context7 MCP | 02-specs | Fetch current library docs when speccing a demo. "What's the latest React Router API?" |
| `/frontend-design` | 03-builds | When building web-based demos or interactive tutorials |
| `/webapp-testing` | 03-builds | Verify built demos work — Playwright-based browser testing |
| `/pdf` | 04-output | Generate PDF versions of tutorials or guides |
| Web Search MCP | 02-specs | Research current best practices, check if approaches are still recommended |

### Skills You Might Add

- **Code review skill** — automated quality gate before anything moves to 04-output
- **Accessibility audit skill** — check WCAG compliance on web deliverables
- **Performance benchmark skill** — run Lighthouse or equivalent on built demos
- **Deployment skill** — auto-deploy demos to staging environment
- **Screenshot skill** — capture visual output of builds for documentation

---

## Hard Rules

1. **Specs are contracts, not blueprints.** A spec says WHAT to build and the acceptance criteria. It does NOT dictate implementation details. The builder has creative freedom.
2. **Output must be tested.** Nothing moves to `04-output/` without verification — automated or manual.
3. **Don't build without a spec.** Even small projects get a lightweight spec. It prevents scope creep and gives reviewers something to check against.
4. **Don't load writing-room docs here.** Voice doesn't matter in production — technical quality does.
