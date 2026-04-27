# Spec: iaGO Brand-as-Code System

## Problem

iaGO delivers multi-client web projects but has no versioned brand system — neither for itself (consulting site, proposals, pitch decks all ad-hoc) nor for clients (Tailwind config + ShadCN defaults + drifting CSS). With 3 clients live (Munet, Sentria, Fulldata) and 7 MemPalace wings already, brand drift compounds every project. Agents writing UI have no deterministic source of truth for color, type, spacing, motion, or voice.

## Solution

Adopt the **eduba-brand pattern**: git-versioned brand packages with tokens as precedence #1, `AGENT_BRIEF.md` for non-negotiables, and a per-brand Claude Code skill. **Defer Claude Design integration** — it is UI-only, subscription-gated, no API yet, and Anthropic's own "handoff bundle" format is undocumented. Durable brand state must live in git; Claude Design can be layered in later as an *input* to our system once its export stabilizes.

**Sequence: dogfood on iaGO itself → extract template → retrofit one quiet client. Munet stays untouched mid-M2.**

## Scope

### In Scope (4 weeks)

- `brand/iago/` — meta-brand package for iaGO consulting identity (tokens, fonts, voice, animations, HTML preview)
- `.claude/skills/brand-iago/SKILL.md` — invokable as `/brand-iago` in Claude Code
- `AGENT_BRIEF.md` precedence rules adapted to iaGO stack
- Tailwind 4 `@theme` integration pattern (tokens.css → Tailwind CSS-first config)
- Framer Motion variant library + GSAP timeline presets as first-class motion tokens
- `.claude/skills/iago-brand/` — scaffold skill that stamps the package structure into `clients/{slug}/brand/` on project init
- `/iago-scaffold` wiring — brand scaffold runs after repo init
- One non-Munet client retrofit (fulldata or sentria) as end-to-end proof
- `scripts/review-checks/brand.md` — review gate that flags hardcoded colors/spacing/motion when a brand package exists

### Out of Scope (future specs)

- **`/iago-brand` generator** — skill that generates a brand package from prompt/Figma/existing website. Needs the template to exist first; scope as a follow-up spec after Phase 4 ships.
- **Munet retrofit** — mid-M2, disruptive. Defer to post-MVP (aligns with existing Munet scope-cut memory dated 2026-04-17).
- **Claude Design integration** — wait for stable export API. Re-evaluate in 4-6 weeks.
- **Voice/copy authoring as client deliverable** — v1 ships visual tokens only. Voice is a README placeholder.
- **ShadCN fork or custom primitives** — brand package overrides CSS variables that ShadCN already reads; no source-level changes.

## Technical Approach

### Package structure (per brand)

```
brand/{slug}/                          # or clients/{slug}/brand/ for clients
├── tokens/
│   ├── colors.json                    # raw palette + semantic aliases
│   ├── typography.json                # font stack, scales, weights
│   ├── spacing.json                   # scale + container widths
│   ├── motion.json                    # durations, easings, Framer variants, GSAP timelines
│   └── tokens.css                     # @theme block for Tailwind 4 CSS-first config
├── fonts/                             # self-hosted woff2
├── assets/
│   ├── logo/                          # SVG + variations
│   └── svgs/                          # decorative, icons
├── components/                        # brand-specific primitives (optional)
├── animations/
│   ├── variants.ts                    # Framer Motion variant library
│   └── timelines.ts                   # GSAP timeline factories
├── voice/
│   ├── tone.md                        # voice guidance
│   └── copy.md                        # canonical strings, prohibitions
├── preview/                           # HTML reference tabs (color, type, spacing, motion, components)
├── AGENT_BRIEF.md                     # precedence rules, non-negotiables
└── BRAND.md                           # rationale, human-readable
```

### Skill structure (co-located)

```
.claude/skills/brand-{slug}/
├── SKILL.md                           # frontmatter + instructions, points to brand package
└── references/                        # symlinks or copies of tokens + brief
```

### Precedence rules (AGENT_BRIEF.md)

1. `tokens/*.json` + `tokens/tokens.css` — absolute source of truth
2. `AGENT_BRIEF.md` — non-negotiables (colors that don't change, prohibited patterns)
3. `SKILL.md` — invocation recipes
4. `voice/` — copy guidance
5. `BRAND.md` — rationale only, not authoritative

### Stack integration

- **Tailwind 4**: `tokens.css` provides `@theme { --color-* ... }` block. Imported first in `src/index.css`. Tailwind v4 CSS-first config picks up all tokens natively — no `tailwind.config.ts` plugin needed.
- **ShadCN**: Brand tokens override the CSS custom properties (`--background`, `--primary`, `--radius`, etc.) that ShadCN components consume. No forking.
- **Framer Motion**: `animations/variants.ts` exports named variants (`fadeIn`, `slideUp`, etc.) with brand-specific durations/easings pulled from `motion.json`. Every feature imports from here — no inline variants in components.
- **GSAP**: `animations/timelines.ts` exports timeline factories for scroll-triggered sequences. ScrollTrigger + Lenis wiring standard across brands.
- **Review pipeline**: `scripts/review-checks/brand.md` added to the baseline loader. Triggered only when the plan touches `src/**/*.tsx` or `src/**/*.css` AND the project has a `brand/` folder. Findings flag hardcoded hex/rgb/px values that should pull from tokens.

## Delivery Path

### Phase 1 — Week 1: iaGO meta-brand (dogfood)

**Deliverable:** `brand/iago/` fully populated with tokens, fonts, voice, animations, preview HTML. Applied to one iaGO-facing surface (proposal template or consulting-site landing stub). Validates the structure end-to-end on a brand Santiago owns fully.

**Acceptance:**
- `brand/iago/tokens/tokens.css` drives Tailwind 4 `@theme`
- One proposal template or landing renders using only tokens + brand components
- `AGENT_BRIEF.md` written with iaGO-specific non-negotiables

### Phase 2 — Week 2: Template extraction + scaffold skill

**Deliverable:** `.claude/skills/iago-brand/` skill that copies `brand/iago/` structure (tokens emptied to placeholders) to `clients/{slug}/brand/`. Wired into `/iago-scaffold` to run after repo init.

**Acceptance:**
- New client scaffold produces `clients/{slug}/brand/` with placeholder tokens and working Tailwind config
- Skill invocation works standalone (can retrofit existing clients)
- SKILL.md references correct token paths

### Phase 3 — Week 3: First client retrofit

**Deliverable:** Fulldata OR Sentria (pick based on which is quieter) has a filled brand package. Proves end-to-end: scaffolded from template, tokens hand-tuned, Tailwind picks them up, one feature screen rebuilt against tokens.

**Acceptance:**
- Client renders visually consistent across 3+ screens using only brand tokens
- No regressions on existing Amplify/data pipeline
- Brand skill invocable via `/brand-{slug}` in Claude Code

### Phase 4 — Week 4: Review gate + post-merge-branch skill

**Deliverable:** `scripts/review-checks/brand.md` reviews token adherence. `.claude/rules/brand-system.md` path-scoped rule for `brand/**` and `clients/**/brand/**`. Post-mortem doc covering gaps surfaced in retrofit, prioritized for follow-up `/iago-brand` generator spec.

**Acceptance:**
- Pipeline review flags hardcoded design values in PRs touching retrofitted client
- CLAUDE.md updated with brand-system reference
- Next-spec stub written for `/iago-brand` generator

## Open Questions

These go to `/council` for stress-testing before `/iago-plan` commits.

1. **Package location** — `brand/{slug}/` at iago-os root, or `clients/{slug}/brand/` inside the client repo? Trade-off: root = cross-client discoverability + shared scaffold easier. Client-repo = portable on handoff + self-contained if we ever ship a client their repo. **Working assumption: client-repo for clients, `brand/iago/` at root for iaGO itself.** Council should push on this.

2. **Token generation strategy** — `tokens.css` hand-written alongside `tokens/*.json`, or generated from JSON at build time? Generation removes drift but adds a build step. **Working assumption: hand-written both, linted by review gate. Generator is Phase 5+.**

3. **Which client first** — Fulldata or Sentria for Phase 3 retrofit? Depends on which has fewer active plans. **Working assumption: check STATE.md for both, pick the one not in an active ROADMAP phase.**

4. **Claude Design timing** — Anthropic said integrations "coming in weeks." If stable export API lands in 2-4 weeks, does Option E (hybrid) beat pure B+C? **Working assumption: ship B+C anyway — durable state in git is the right architecture regardless, and Claude Design becomes an *input* layer, not a replacement.**

5. **Motion tokens in JSON schema** — Framer Motion variants are JSX objects, GSAP timelines are factories. How to express in `motion.json` without losing type safety? **Working assumption: `motion.json` stores primitives (durations, easings, distances), `animations/variants.ts` composes them into typed Framer variants. JSON is tokens, TS is bindings.**

6. **Voice scope** — ship v1 visual-only or include minimal voice (tone, prohibitions)? Minimal voice is ~2 hours of work and prevents copy drift. **Working assumption: include `voice/tone.md` + `voice/copy.md` as 1-page stubs per brand, not full guidance docs.**

7. **Naming collision** — `/brand-iago` vs `/iago-brand` (the scaffold skill) vs existing `/iago-*` pattern. **Working assumption: per-brand invocation is `/brand-{slug}` (the skill name), scaffold generator is `/iago-brand`. Aligns with "iago-* = workflow, brand-* = asset".**

8. **ShadCN variant conflicts** — what if a ShadCN component's default CSS var pattern doesn't match our token structure? Need a documented override pattern. **Working assumption: document a `shadcn-overrides.css` file inside each brand that maps brand tokens → ShadCN vars explicitly. One extra file, no surprises.**

---

**Status:** 8 open questions. Run `/council "stress-test iago-brand spec"` (or `/iago-stress docs/specs/iago-brand.md --deep`) before `/writing-plans`.
