---
name: iago-onboard
description: >-
  Use when onboarding an existing codebase into the iaGO workflow (scan structure,
  identify patterns, produce architecture map, populate PROJECT.md). Not when
  starting a new project from scratch (use /iago:scaffold + /iago:init instead).
---

## Purpose

Scan an existing codebase to produce an architecture map, identify patterns and
tech debt, and populate `.iago/PROJECT.md` with discovered context — enabling the
full iaGO workflow on a project that wasn't built with it.

## Arguments

`/iago:onboard` — run in the root of the target codebase.

Optional flags:
- `--deep` — dispatch `research` agent for thorough multi-pass analysis
- `--skip-init` — only produce the analysis, don't write `.iago/` files

## Preconditions

- Must be run in a directory with source code (`package.json`, `src/`, or similar).
  If empty directory, redirect to `/iago:scaffold`.
- `.iago/PROJECT.md` must NOT exist (unless `--skip-init`). If it does, STOP and
  inform: "Already onboarded. Use `/iago:discuss` to plan next steps."

## Steps

### 1. Quick scan

Read the project root to identify:
- Package manager and dependencies (`package.json`, `requirements.txt`, etc.)
- Framework and language (React, Vue, Express, Django, etc.)
- Build tool (Vite, Webpack, Next.js, etc.)
- Directory structure pattern (feature folders, layer folders, flat)
- Test setup (Vitest, Jest, Playwright, pytest, etc.)
- Linter/formatter (Biome, ESLint, Prettier)
- Infrastructure (Amplify Gen 2, Docker, etc.)
- CI/CD (GitHub Actions, CircleCI, etc.)

### 2. Dispatch research agent (`--deep` flag or default)

Dispatch `research` agent with:
- The project root path
- CLAUDE.md (for stack comparison)
- Instruction: "Analyze this codebase and produce a structured report covering:
  architecture, patterns, dependencies, tech debt, test coverage, security concerns."

The researcher will:
- Scan directory tree and key configuration files
- Identify architectural patterns (monolith, microservices, feature-sliced)
- Catalog external dependencies and their versions
- Flag tech debt (outdated deps, missing types, no tests, dead code)
- Identify security concerns (exposed secrets, missing auth, injection risks)

If `--deep` is not set, perform the analysis inline (orchestrator-direct) using
a lighter single-pass approach.

### 3. Produce architecture map

Generate a structured analysis:

```markdown
## Architecture Map

### Stack
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Frontend | {framework} | {version} | {notes} |
| Backend | {runtime} | {version} | {notes} |
| Database | {db} | {version} | {notes} |
| Auth | {provider} | {version} | {notes} |
| Infra | {tool} | {version} | {notes} |

### Directory Structure
{Tree diagram of top-level and key nested directories}

### Key Patterns
{Identified patterns: state management, data fetching, routing, etc.}

### Tech Debt
| Priority | Issue | Location | Effort |
|----------|-------|----------|--------|
| High | {issue} | {path} | {estimate} |

### Stack Delta
{Comparison with iaGO default stack — what matches, what differs, what's missing}
```

### 4. Bootstrap .iago/ (unless `--skip-init`)

Call state engine `init()` to create `.iago/` directory structure.

Write `.iago/PROJECT.md` with discovered context:
- Vision: inferred from README or package.json description
- Client: from `--skip-init` context or ask user
- Stack table: populated from scan results
- Architecture Decisions: populated with key patterns found

### 5. Write analysis artifact

Save the full analysis to `.iago/context/00-onboard.md` for future reference.

### 6. Identify next steps

Based on the analysis, suggest:
- If stack matches iaGO default → "Run `/iago:init` to set up phases."
- If stack differs → list what needs migration and what can stay
- If significant tech debt → suggest a cleanup phase in the roadmap

## Output

Display:
1. Stack summary (matches vs. differs from iaGO default)
2. Codebase stats (file count, dep count, test coverage if detectable)
3. Top 3 tech debt items
4. Top 3 security concerns (if any)
5. Recommended next step

## Examples

**Standard onboard:**
```
/iago:onboard
```
Scans codebase, writes `.iago/PROJECT.md` and `.iago/context/00-onboard.md`.

**Analysis only (no .iago/ changes):**
```
/iago:onboard --skip-init
```
Produces analysis artifact only — useful for evaluating a codebase before committing.

## Boundaries

- Read-only on source code — never modifies existing project files
- Only writes to `.iago/` directory (unless `--skip-init`, then only displays)
- Does not install dependencies, run migrations, or execute builds
- Does not start planning or implementation — analysis only
- If researcher returns BLOCKED, fall back to inline single-pass analysis
