---
name: iago-scaffold
description: >-
  Use when starting a new client project that needs a full project directory with
  the iaGO stack (React 19 + Vite + TS + Tailwind + ShadCN + AWS Amplify Gen 2).
  Not when bootstrapping .iago/ for an existing codebase (use /iago-onboard instead)
  or when .iago/PROJECT.md already exists.
---

## Purpose

Scaffold a new client project directory from the iaGO template, configure the
stack, initialize git, and bootstrap the `.iago/` workflow state — ready for
`/iago-init` to gather vision and produce the roadmap.

## Preconditions

- Target directory must not already contain a `package.json` or `.iago/PROJECT.md`.
  If either exists, STOP and suggest `/iago-onboard` or `/iago-init` instead.
- `templates/client-project/` must exist in the iaGO-OS repo.

## Arguments

`/iago-scaffold {project-name}` — kebab-case project name (e.g., `acme-dashboard`).

Optional flags:
- `--dir {path}` — target directory (default: `../{project-name}` relative to iaGO-OS)
- `--skip-amplify` — skip Amplify Gen 2 init (for frontend-only projects)
- `--skip-git` — skip git init (for repos that already have git)

## Steps

### 1. Copy template

Copy `templates/client-project/` to the target directory.
This includes the `.iago/` skeleton with default config, state templates, and hooks.

### 2. Configure package.json

Update the template's `package.json`:
- `name`: `{project-name}`
- `description`: empty (filled during `/iago-init`)
- Verify all dependencies match the iaGO stack:
  - React 19, Vite, TypeScript (strict), TailwindCSS 4, ShadCN/UI
  - Vitest, Playwright, Biome
  - `@aws-amplify/backend`, `aws-amplify`

### 3. Configure TypeScript

Ensure `tsconfig.json` has:
- `strict: true`
- Path alias `@/*` → `src/*`
- No `any` allowed (`noImplicitAny: true`)

### 4. Configure Vite

Ensure `vite.config.ts` has:
- React plugin
- Path alias matching tsconfig
- Server port 5173

### 5. Configure TailwindCSS 4 + ShadCN/UI

- Verify TailwindCSS 4 setup (CSS-based config, not `tailwind.config.js`)
- Verify ShadCN/UI components path (`src/components/ui/`)
- CSS variables in `src/index.css`

### 6. Initialize Amplify Gen 2 (unless `--skip-amplify`)

Ensure `amplify/` directory has:
- `backend.ts` — entry point with `defineBackend`
- `auth/resource.ts` — Cognito config stub
- `data/resource.ts` — DynamoDB schema stub
- `functions/` — empty directory for Lambda handlers

### 7. Initialize git (unless `--skip-git`)

```bash
git init
git add -A
git commit -m "chore: scaffold {project-name} from iaGO template"
```

### 8. Initialize state engine

Call `init()` from the state engine to ensure all `.iago/` subdirectories
and default files are in place.

### 9. Install dependencies

Run `npm install` in the target directory.

### 10. Verify scaffold

Run verification commands:
- `npx tsc --noEmit` — TypeScript compiles
- `npx biome check` — no lint errors
- `npx vite build` — Vite builds successfully

## Output

Display:
1. Project location (absolute path)
2. Stack summary (versions of key deps)
3. What was skipped (if any flags used)
4. Suggest: "Run `/iago-init` in the new project to set up the roadmap."

## Examples

**New client project:**
```
/iago-scaffold acme-dashboard
```
Creates `../acme-dashboard/` with full stack, git initialized, deps installed.

**Frontend-only project:**
```
/iago-scaffold acme-landing --skip-amplify
```
Same but without `amplify/` directory or AWS dependencies.

## Boundaries

- Does not gather project vision or create ROADMAP.md — that's `/iago-init`
- Does not modify the iaGO-OS repo itself — only creates a new project directory
- Does not deploy anything — local scaffold only
- Does not dispatch any agents — orchestrator handles everything inline
- Template must exist — if `templates/client-project/` is missing, STOP and report
