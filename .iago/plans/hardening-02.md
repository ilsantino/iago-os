---
phase: hardening
plan: 02
wave: 1
depends_on: []
created: 2026-04-06
---

# Plan: hardening-02 — Add package.json and fix hook dependencies

## Goal

Create a root package.json so hooks that depend on biome and typescript work
out of the box after `npm install`. Fix the post-edit hooks to handle the
case where tools aren't available gracefully.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `package.json` | Declare devDependencies for hooks (biome, typescript) |
| modify | `.iago/hooks/post-edit-format.mjs` | Improve error message when biome is missing |
| modify | `.iago/hooks/post-edit-typecheck.mjs` | Improve error message when tsc is missing |
| modify | `docs/SETUP.md` | Add `npm install` step to setup instructions |
| modify | `docs/MANUAL.md` | Add `npm install` to getting started section |

## Tasks

### Task 1: Create root package.json
- **files:** `package.json`
- **action:** Create a minimal package.json with `"name": "iago-os"`, `"private": true`, `"type": "module"`, and devDependencies: `@biomejs/biome` (latest 1.x), `typescript` (latest 5.x). No scripts section needed — hooks call npx directly. Add `"engines": { "node": ">=20" }`.
- **verify:** `node -e "const p = require('./package.json'); console.log(p.devDependencies['@biomejs/biome'] && p.devDependencies['typescript'] ? 'PASS' : 'FAIL');"`
- **expected:** `PASS`

### Task 2: Run npm install
- **files:** `package.json`, `package-lock.json`
- **action:** Run `npm install` to generate node_modules and package-lock.json. Verify biome and tsc are available via npx. Add `node_modules/` to .gitignore if not already there.
- **verify:** `npx biome --version && npx tsc --version`
- **expected:** Both print version numbers without errors

### Task 3: Add graceful error messages to post-edit hooks
- **files:** `.iago/hooks/post-edit-format.mjs`, `.iago/hooks/post-edit-typecheck.mjs`
- **action:** In post-edit-format.mjs, wrap the execSync call in a try/catch that outputs a helpful message if biome is not found: "iaGO: biome not installed. Run `npm install` in the iaGO-OS root." Same for post-edit-typecheck.mjs with tsc. Currently both swallow errors silently — the user gets no feedback about why formatting/typechecking isn't happening.
- **verify:** `echo '{"tool_name":"Edit","tool_input":{"file_path":"test.ts"}}' | node .iago/hooks/post-edit-format.mjs 2>&1`
- **expected:** Either runs biome successfully, or prints the helpful error message (both are acceptable outcomes)

### Task 4: Update setup docs
- **files:** `docs/SETUP.md`, `docs/MANUAL.md`
- **action:** In SETUP.md, add an `npm install` step after cloning iaGO-OS (before the global sync step). In MANUAL.md "Getting Started" section, add the same `npm install` step after clone. Make it clear this installs biome and typescript for hooks.
- **verify:** `grep -c "npm install" docs/SETUP.md && grep -c "npm install" docs/MANUAL.md`
- **expected:** Both return 1 or more

## Verification

After all tasks: `npx biome --version && npx tsc --version && echo "PLAN-02 PASS"`

Expected: version numbers followed by `PLAN-02 PASS`
