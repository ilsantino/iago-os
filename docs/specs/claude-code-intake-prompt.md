# Claude Code Intake Prompt: Wire Claude Design Handoff → `brand/iago/`

## When to use this

After you've iterated in Claude Design and exported the handoff bundle. This prompt runs in a **fresh Claude Code session** in `iago-os` and lands the export into a git-versioned `brand/iago/` package that matches the iago-brand spec structure.

## How to run

1. Export from Claude Design: **HTML bundle** + **Tokens (JSON)** + **tokens.css** + **Handoff bundle**.
2. Drop everything into a single folder — suggested: `C:\Users\sanal\dev\iago-os\_inbox\claude-design-export\`. Unzip if needed. Don't commit this folder.
3. Open a fresh Claude Code session at `C:\Users\sanal\dev\iago-os\`.
4. Paste the master intake prompt below. Edit the `INPUT_PATH` line if you dropped the export somewhere else.
5. Review the result, then commit.

## Master intake prompt (paste into Claude Code)

```
BRAND INTAKE — CLAUDE DESIGN HANDOFF → brand/iago/

Read CLAUDE.md and docs/specs/iago-brand.md for the target structure and conventions.

INPUT_PATH: C:/Users/sanal/dev/iago-os/_inbox/claude-design-export/
OUTPUT_PATH: C:/Users/sanal/dev/iago-os/brand/iago/

GOAL
Land the Claude Design export into a git-versioned brand package that matches the
iago-brand spec. Produce a single source of truth for tokens (JSON), generate
tokens.css from it (no dual-write drift), scaffold Framer Motion variants and GSAP
timelines from the motion specs, and wire the brand into src/index.css via Tailwind 4
@theme. Produce an AGENT_BRIEF.md that can be injected into any Claude Code session.

CONSTRAINTS
- Do NOT touch clients/ — Munet, Sentria, Fulldata are out of scope for this intake.
- Do NOT modify the review pipeline or .claude/skills/ unless creating the new
  brand-iago skill in step 7.
- Single source of truth: tokens/*.json drives tokens.css via generator script.
  If Claude Design also exported a tokens.css, treat it as a reference — regenerate
  from JSON and diff; reconcile any meaningful differences back into the JSON.
- Tailwind 4 CSS-first config — no tailwind.config.ts plugin. Use @theme block in
  tokens.css imported first in src/index.css.
- No pure white. Warm off-white only per brand rules.
- Every component must have a named Framer Motion variant. No inline variants.
- File layout must be identical on Mac and Windows (no symlinks, forward slashes in
  config, no case-sensitive filename collisions).

WORK PLAN — execute in order. Pause and report after each step.

STEP 1 — INVENTORY
- List everything under INPUT_PATH with file sizes and types.
- Identify: tokens files (JSON), tokens.css, HTML previews, logo assets, fonts,
  handoff manifest (if present), voice/copy docs, component specs.
- Flag anything Claude Design exported that doesn't fit the iago-brand spec.
- Do NOT copy anything yet. Report the inventory and wait.

STEP 2 — TOKENS (source of truth)
- Create OUTPUT_PATH/tokens/ with these files, schema-validated:
  - colors.json — { palette: {...}, semantic: { background, foreground, primary,
    accent, signal, muted, border, ring } } with light + dark modes.
  - typography.json — { families: { display, body, mono }, scale: { ... },
    weights: {...}, leading: {...}, tracking: {...} }.
  - spacing.json — { scale: [...], container: { sm, md, lg, xl }, radius: {...} }.
  - motion.json — { durations: { instant, quick, standard, deliberate },
    easings: { standard, out, in, sharp }, distance: { sm, md, lg } }.
- If Claude Design exported tokens in a different shape, transform into this shape.
- Validate: every semantic color maps to a palette entry; contrast ratios computed
  and stored on the semantic block (AA minimums).
- No hex in motion.json. No px values outside spacing.json scale.

STEP 3 — GENERATOR
- Write scripts/build-brand-tokens.mjs:
  - Node ESM, no dependencies outside devDeps already in package.json.
  - Reads OUTPUT_PATH/tokens/*.json.
  - Emits OUTPUT_PATH/tokens/tokens.css with a @theme block containing every token
    as a CSS custom property. Includes dark mode via [data-theme="dark"] selector.
  - Idempotent — running twice produces identical output.
  - Exits non-zero on schema violations.
- Add npm script: "brand:build": "node scripts/build-brand-tokens.mjs".
- Run it. Commit the generated tokens.css only after first run verifies clean.

STEP 4 — ASSETS + FONTS
- Copy fonts from INPUT_PATH/fonts/ (or wherever Claude Design placed them) to
  OUTPUT_PATH/fonts/. Only woff2. Flag any other formats for manual review.
- Copy logos to OUTPUT_PATH/assets/logo/ — SVG preferred; if only PNG, note it and
  add a TODO in BRAND.md to rebuild the vector.
- Copy decorative SVGs to OUTPUT_PATH/assets/svgs/.
- Do NOT inline assets in CSS. Reference by relative path.

STEP 5 — ANIMATIONS
- Create OUTPUT_PATH/animations/variants.ts:
  - Named Framer Motion variants pulled from motion.json primitives.
  - Must export at minimum: fadeIn, slideUp, slideDown, staggerChildren, pressScale.
  - Every variant fully typed. No any. No as casts.
- Create OUTPUT_PATH/animations/timelines.ts:
  - GSAP timeline factories for scroll-triggered sequences.
  - Factory functions return gsap.core.Timeline. ScrollTrigger + Lenis assumed.

STEP 6 — COMPONENTS (optional, only if Claude Design exported component HTML)
- Create OUTPUT_PATH/components/ only if there are brand-specific primitives beyond
  what ShadCN provides.
- Convert HTML previews to React 19 components using our conventions: named exports,
  functional components, use() + Suspense for data, Framer variants from
  animations/variants.ts.
- Do NOT fork ShadCN. Brand overrides happen via CSS vars in tokens.css, not
  component source.

STEP 7 — AGENT BRIEF + SKILL
- Create OUTPUT_PATH/AGENT_BRIEF.md:
  - Precedence rules (tokens > brief > skill > voice > rationale).
  - 10 non-negotiables (always do these — colors, type, radius rules, motion
    requirement).
  - 10 prohibitions (never do these — pure white, emoji in UI, purple gradients,
    oversized radii, inline Framer variants, etc.).
  - Copy guidance summary, 5 headline examples.
- Create OUTPUT_PATH/BRAND.md — human-readable rationale, not authoritative.
- Create .claude/skills/brand-iago/SKILL.md:
  - Frontmatter with name, description, auto-trigger rules for src/**/*.tsx files
    touching iago-owned surfaces.
  - Points at brand/iago/AGENT_BRIEF.md as primary reference.
  - Short recipe: "When writing UI for iaGO, load brand/iago/AGENT_BRIEF.md and
    brand/iago/tokens/*.json before making any design decision."
- Create .claude/skills/brand-iago/references/ with symlinked or copied tokens and
  brief for direct skill access.

STEP 8 — TAILWIND 4 WIRING
- Create OUTPUT_PATH/preview/index.html as a standalone HTML reference tab index
  pointing to: colors, type, spacing, motion, components. Use the HTML previews
  Claude Design exported as source material.
- Do NOT modify src/index.css yet. Instead, write a patch file to
  OUTPUT_PATH/INSTALL.md describing the two lines to add when iaGO's consulting
  site is wired up:
  ```
  @import "../../brand/iago/tokens/tokens.css";
  @import "tailwindcss";
  ```
- Flag that iago.live is currently a stub; full wiring happens when the site
  rebuild starts.

STEP 9 — VOICE
- Create OUTPUT_PATH/voice/tone.md — 1 page, voice principles.
- Create OUTPUT_PATH/voice/copy.md — canonical strings, prohibitions, examples.
- These are stubs only if Claude Design exported voice content; otherwise produce
  full pages from the AGENT_BRIEF voice section.

STEP 10 — VERIFICATION
Run each of these and report output:
1. node scripts/build-brand-tokens.mjs → should exit 0, emit identical tokens.css
   on second run.
2. Open OUTPUT_PATH/preview/index.html in a browser (or note the path so Santiago
   can open it manually on Windows).
3. Grep for hardcoded hex values in OUTPUT_PATH (excluding tokens/ and assets/) —
   should return zero matches.
4. Grep for inline Framer variants in OUTPUT_PATH/components/ — should return zero
   matches (all variants must import from animations/variants.ts).
5. Confirm fonts/ contains only woff2.
6. Confirm .claude/skills/brand-iago/SKILL.md loads (check frontmatter with
   `head -20`).

STEP 11 — REPORT
Write a single summary to .iago/summaries/brand-iago-intake-{YYYY-MM-DD}.md:
- Inventory of what came in vs what shipped.
- Any Claude Design exports that didn't map cleanly (and what you did about it).
- TODOs (vector logos, voice gaps, component coverage).
- Exact next step: either "Apply INSTALL.md when rebuilding iago.live" or "Run
  /iago-quick 'apply brand/iago tokens to iago.live rebuild'".

OUTPUT FORMAT — each step
- Report what you did.
- Show the file tree of what was created.
- Show any errors or decisions you made on ambiguous input.
- Wait for approval before moving to the next step only if the step produced
  unexpected output. Otherwise continue.

FINISH WITH
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- Summary path.
- One-line next action.
```

## If you want to run this through the review pipeline

Paste this into the orchestrator instead (runs the 8-stage pipeline):

```
/iago-quick "intake Claude Design handoff at _inbox/claude-design-export/ into brand/iago/ per docs/specs/claude-code-intake-prompt.md — three tasks: tokens + generator, animations + components, brief + skill + wiring"
```

`/iago-quick` will stress-test, implement, build-gate, review, codex-review, PR, and tag @claude. Overkill for a mechanical intake, but gives you the full audit trail if you want it.

## Post-intake sanity check

Before merging the PR:

1. Run `node scripts/build-brand-tokens.mjs` yourself on Windows. Confirm idempotent — second run = zero diff.
2. Open `brand/iago/preview/index.html` in your browser. Scan color, type, spacing, motion tabs.
3. Run `git status` — confirm only `brand/iago/`, `scripts/build-brand-tokens.mjs`, `.claude/skills/brand-iago/`, `package.json` (for the script entry), and `.iago/summaries/` touched. Nothing in `clients/`, nothing in `src/` yet.
4. Ask Sebas to clone the branch on Mac and run the same generator. Confirm same output byte-for-byte.

That's the Phase 0 the council flagged — the Sebas-alignment check. Built into the workflow instead of a meeting.

## What this doesn't do

This prompt is **the intake only** — mechanical conversion of Claude Design export into the spec's file structure. It does NOT:

- Rebuild iago.live itself (that's a separate feature plan, post-intake).
- Retrofit any client (Munet stays untouched; Sentria/Fulldata are their own specs).
- Write the review-check module at `scripts/review-checks/brand.md` (Phase 4 in the original spec — still open).
- Build the `/iago-brand` scaffold generator (deferred to post-retrofit per council verdict).

Those come after. This just lands the brand in git, cleanly, once.
