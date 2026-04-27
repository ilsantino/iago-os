# Research: taste-skill integration into iaGO-OS

**Date:** 2026-04-27
**Question:** Should iaGO-OS adopt the patterns from `leonxlnx/taste-skill` to make our frontend output less generic, and if so, how?
**Repo studied:** https://github.com/leonxlnx/taste-skill (13.4k stars / 1.2k forks)

---

## Findings

### Sub-question 1 — What is taste-skill, exactly?

A portable SKILL.md library (framework-agnostic) that injects **anti-slop visual taste** into any AI coding agent (Claude Code, Cursor, Codex, Windsurf, etc.). Solves the problem that LLMs default to a recognizable AI design fingerprint: Inter font, purple/blue gradient hero, three centered cards, generic Lucide icons, "John Doe / Acme Corp" placeholders, `99.99%` round numbers.

The repo ships nine variants:

| Variant | Lens |
|---|---|
| `taste-skill` | All-purpose, parameterized |
| `gpt-taste` | Stricter for GPT/Codex |
| `redesign-skill` | Audit existing project, fix in place |
| `minimalist-skill` | Notion/Linear editorial |
| `soft-skill` | Calm, expensive, springy |
| `brutalist-skill` | Swiss/mechanical (beta) |
| `stitch-skill` | Google Stitch + DESIGN.md export |
| `output-skill` | No placeholder comments |
| `image-to-code-skill` | Generate visual first, then code |

Plus three image-only skills (`imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`).

### Sub-question 2 — What does the core taste-skill encode?

**Three parameter dials (1–10):**

- `DESIGN_VARIANCE` (default 8) — symmetry → asymmetric chaos
- `MOTION_INTENSITY` (default 6) — static → cinematic spring physics
- `VISUAL_DENSITY` (default 4) — airy gallery → cockpit data density

**Hard banned patterns ("AI Tells"):**

- Fonts: Inter, Roboto, Open Sans → use Geist / Outfit / Cabinet Grotesk / Satoshi
- Color: pure `#000`, oversaturated accents, more than one accent, purple/blue "AI gradient", warm + cool gray mixing
- Layout: centered hero with `text-center` over dark image, three equal feature cards, `h-screen` (mobile breaks — use `min-h-[100dvh]`), flexbox percentage math (use Grid)
- Components: generic card (border + shadow + white bg), default ShadCN unmodified, pill "New/Beta" badges, sun/moon dark toggle, 4-column footer link farm
- Icons: Lucide / Feather (the AI default) → Phosphor or Radix at fixed stroke width
- Content: "John Doe", "Acme Corp", `99.99%`, `$100.00`, "Elevate", "Seamless", "Unleash", "Next-Gen", Lorem Ipsum, exclamation marks in success messages
- Motion: `useState` for magnetic hover, scroll listeners, `top/left/width/height` animation, linear easing
- Surfaces: pure flat backgrounds, perfectly even gradients, generic `box-shadow` with pure black

**Mandatory engineered patterns:**

- Asymmetric layouts when variance > 4 (split-screen, left-aligned content / right-aligned asset)
- Skeleton loaders matching layout, not generic spinners
- Composed empty states + inline error states + tactile `:active` feedback (`scale(0.98)` or `-translate-y-[1px]`)
- Spring physics on every interactive element (`stiffness: 100, damping: 20`)
- Staggered orchestration on mount (Framer `staggerChildren` or CSS cascade with `--index`)
- True glassmorphism: `backdrop-blur` PLUS 1px inner border PLUS subtle inner shadow (refraction)
- Magnetic micro-physics with `useMotionValue` / `useTransform` (never `useState`)
- Bento 2.0: `rounded-[2.5rem]` cards, diffusion shadow, labels OUTSIDE cards, perpetual motion in 5 archetypes (Intelligent List, Command Input, Live Status, Wide Data Stream, Contextual UI)

**Stack-specific guards:**

- Tailwind v4: never put colors in `tailwind.config.ts`; use `@theme` in CSS
- React/Next: isolate motion in `'use client'` leaf components; perpetual loops must be `React.memo` islands
- ShadCN allowed but never default — always re-customize radii / colors / shadows
- Picsum (`picsum.photos/seed/...`) instead of Unsplash for placeholders

### Sub-question 3 — What does iaGO-OS already cover?

Current frontend stack and rules audited:

| Layer | What we have | What it covers |
|---|---|---|
| **Stack** | React 19 + Vite + TS + Tailwind 4 + ShadCN + Framer Motion + GSAP + Lenis | All taste-skill prerequisites are already in place |
| **`.claude/rules/react-vite.md`** | use() + Suspense, ShadCN install rules, TanStack Query keys, Vite aliases, RHF + Zod | Architecture, not aesthetics |
| **`.claude/rules/react-vite.md` (mirror in capability `react-19.md`)** | Same | Same |
| **`.claude/agents/capabilities/animation.md`** | Framer + GSAP + Lenis stack rules, integration boundaries, perf budget | Mechanics of motion, not design intent |
| **`.claude/skills/liquid-glass-design/SKILL.md`** | Glassmorphism with TailwindCSS 4 utilities, CSS custom properties, WCAG contrast | One narrow aesthetic; no edge refraction (1px inner border + inner shadow gap vs taste-skill) |
| **`.claude/skills/frontend-bug-bounty/SKILL.md`** | ~280 rules: hooks, effects, memoization, types, Vite, **Section Q data correctness** | **Functional bugs** — the numbers being right. Not the visual being premium. |
| **`scripts/review-checks/react.md`** | Render-cycle violations, eager imports, hook rules, error boundaries | Pipeline gate — purely architectural |
| **MEMORY: `feedback_framer_motion.md`** | "Every UI/UX change must include Framer Motion" | One global rule, no taste guidance |

**Gap:** there is no aesthetic / visual-taste layer anywhere. Every existing rule is about *correctness* (it works, it builds, it doesn't crash, the numbers are right) — none is about *taste* (it doesn't look like AI generated it).

The `feedback_framer_motion.md` memory enforces motion presence, but motion presence ≠ premium motion. A linear `transition: all 0.3s` satisfies the memory but is exactly the slop taste-skill bans.

### Sub-question 4 — Where does taste-skill conflict with iaGO-OS conventions?

| taste-skill rule | iaGO-OS reality | Conflict severity |
|---|---|---|
| Banned: Lucide/Feather icons | ShadCN/UI ships Lucide as the default icon set | **Hard conflict** — would force every project to swap icon library on `npx shadcn add` |
| Banned: Inter font | Many existing projects (and ShadCN docs) default to Inter | **Soft conflict** — fix per new project, document migration for legacy |
| Default to Geist/Satoshi/Cabinet Grotesk | Not currently installed in any client; license check needed (Cabinet Grotesk is Indian Type Foundry, free for commercial) | **Add-on**, not a conflict |
| Recommended: GSAP for full-page scrolltelling, Framer for UI; never mix | Already our `animation.md` rule | **Aligned** |
| Recommended: Tailwind v4 `@theme` config | Already our pattern | **Aligned** |
| Recommended: ShadCN customized, never default | Already our pattern (`src/index.css` CSS variables) | **Aligned, but underspecified** — we don't enforce *how* customized |
| `min-h-[100dvh]` over `h-screen` | Not in our rules | **Pure addition** |
| Magnetic / bento / parallax inventory | Not in our rules | **Pure addition** |
| Banned: "John Doe", "$99.99", "Elevate" | Not in our rules | **Pure addition** |

The only true conflict is Lucide. Everything else is additive.

### Sub-question 5 — What's the right shape of integration?

Three viable shapes:

| Option | What it is | Effort | Risk |
|---|---|---|---|
| **A. Vendor the whole repo** | `npx skills add ...` into `.claude/skills/taste-skill/` and let it run as-is | 1 day | Conflicts with our skill catalog grammar (frontmatter shape, `description`, no boundaries section), bypasses our pipeline, Lucide conflict bites every project |
| **B. Single new skill: `/iago-taste`** | One skill that fires *during planning and execution* of frontend work, references our stack, enforces our overrides; keep their dial structure but rewrite rules to our stack | 3 days | Low — composable, doesn't disturb existing skills, can be opt-in |
| **C. Distributed: rules + review-check + capability** | Three additions: (1) `.claude/rules/visual-taste.md` (path-scoped to `src/**/*.tsx`), (2) `scripts/review-checks/visual-taste.md` (Critical/Important/Minor floors), (3) capability module `visual-taste.md` injected into `frontend` profile | 5 days | Low, but five touchpoints to keep in sync |

Option B and C are not mutually exclusive — B is the *invocable* skill (`/iago-taste audit src/features/x` or `/iago-taste apply` during a plan), C is the *automatic* gate that runs on every frontend PR via the pipeline. Both wrap the same shared rules document so there is one source of truth.

## Sources

- **GitHub:** `leonxlnx/taste-skill` README and the SKILL.md files for `taste-skill`, `redesign-skill`, `minimalist-skill` — full ruleset, ban list, dial system, Bento 2.0 specs, performance guardrails
- **iaGO-OS codebase:** `.claude/skills/`, `.claude/agents/profiles/frontend.md`, `.claude/agents/capabilities/{react-19, animation}.md`, `.claude/rules/react-vite.md`, `.claude/skills/liquid-glass-design/SKILL.md`, `.claude/skills/frontend-bug-bounty/SKILL.md`, `scripts/review-checks/react.md`
- **Memory:** `feedback_framer_motion.md` (existing global motion rule — points to a gap, not a conflict)

## Recommendation

**Decision:** Adopt taste-skill's *content* via a hybrid of Options B + C. Do not vendor the upstream repo.

**Confidence:** High

**Reasoning:**

1. The diagnosis is correct — we ship architecturally clean React but visually generic React. Pipeline review catches "the count is wrong"; nothing catches "the hero is centered, three cards, Inter, purple gradient, looks like every Cursor demo."
2. Vendoring loses the iaGO-OS overrides (Lucide via ShadCN, our motion stack, Tailwind v4 patterns, our pipeline integration) and creates a parallel skill catalog. It also pollutes the global `npx skills add` registry into a project that already has its own skill grammar.
3. A single new invocable skill (`/iago-taste`) plus a pipeline review-check module + a capability injection into the `frontend` agent profile gives both **opt-in design audit** (skill) and **mandatory taste floor** (pipeline gate) without touching every existing skill.
4. Lucide stays — taste-skill's Phosphor mandate is wrong for a ShadCN-first stack. The gain (icon variety) is not worth the loss (every `npx shadcn add` re-introduces Lucide imports). We adapt the rule: "icons must have one consistent stroke width and one consistent style — Lucide allowed if standardized."

**Next step:** run `/brainstorming` on the integration shape — specifically: which dials are right for client work vs internal, how the skill interacts with `/iago-plan` and `/iago-execute`, and whether the review-check module should be Critical or Important on visual taste violations (Critical breaks delivery, Important degrades it gracefully).

**Risk if wrong:**

- *If we vendor instead:* Lucide conflict on every project, two skill grammars to maintain, no pipeline integration, taste floor remains optional and gets skipped under deadline pressure.
- *If we do nothing:* every iaGO frontend keeps shipping with the AI fingerprint. CEO has already flagged this directly ("designs more robust and less generic"). Future client briefs that want "premium" will fall through.
- *If we go too maximal:* we override ShadCN defaults so aggressively that the design system fights `npx shadcn add` upgrades. Mitigated by keeping the rules at the composition layer, not the source.
