# Spec: iaGO Visual Taste System

## Problem

iaGO frontends ship architecturally clean (hooks correct, types tight, builds green, KPIs accurate) but visually generic — the recognizable AI fingerprint of Inter font, purple/blue gradients, three centered cards, default Lucide icons, "John Doe" placeholders. Our review pipeline catches *correctness* but no rule, skill, or capability covers *taste*.

CEO directive: "make our frontend designs more robust and less generic."

## Solution

Adopt taste-skill's content via a hybrid integration: one invocable skill, one pipeline gate, one capability injection — all wrapping a shared rules document. Drive enforcement off **four design profiles** keyed to project type, declared per project in `.iago/PROJECT.md`. Do not vendor the upstream repo (Lucide conflict, parallel skill grammar, no pipeline integration).

## Scope

### In Scope

- Shared rules: `.claude/rules/visual-taste.md` (path-scoped to `src/**/*.{tsx,jsx,css}`)
- New skill: `.claude/skills/iago-taste/SKILL.md` with `audit`, `apply`, `profile` modes
- New pipeline check: `scripts/review-checks/visual-taste.md` at **ALWAYS Important** severity floor
- New capability: `.claude/agents/capabilities/visual-taste.md` injected into `frontend` and `fullstack` agent profiles
- Four design profiles — `operator | premium | editorial | brutalist` — declared in `.iago/PROJECT.md` under `design.profile`. Default `premium` if unset.
- Per-profile dials (variance / motion / density), banned-pattern lists, mandatory primitives, font stacks, color discipline
- Lucide standardization rule: keep Lucide (ShadCN ships it), enforce one stroke-width and one icon family per project — no mixing
- Banned-content list: no John Doe / Acme / Lorem / `$99.99` / "Elevate"-class copy / `99.99%` round numbers
- Mandatory primitives across all profiles: skeleton loaders matching layout, composed empty states, inline error states, tactile `:active` feedback (`scale(0.98)` or `-translate-y-[1px]`), `min-h-[100dvh]` over `h-screen`
- iago-init / iago-onboard prompt to pick `design.profile` at project start
- `/liquid-glass-design` remains as a composable overlay on top of any profile

### Out of Scope (this drop)

- Migrating existing client projects to new profiles — handled per-client by a one-off `/iago-taste audit` pass after the system ships
- Replacing `liquid-glass-design` skill
- Image-generation skills (taste-skill ships `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`) — we already have `remotion-animation` for video and `frontend-slides` for slides; standalone image generation is not on the roadmap
- Brutalist as a default — available but only when explicitly requested by client brief
- Vendoring upstream taste-skill repo

## Technical Approach

### Architecture

```
.claude/rules/visual-taste.md          ← shared source of truth (path-scoped)
        ▲              ▲             ▲
        │              │             │
  ┌─────┴─────┐  ┌─────┴──────┐  ┌──┴──────────┐
  │  SKILL    │  │  CAPABILITY │  │ PIPELINE GATE│
  │ /iago-    │  │ visual-taste│  │  review-     │
  │  taste    │  │  injected to│  │  checks/     │
  │  invocable│  │   frontend  │  │  visual-     │
  │           │  │   profile   │  │  taste.md    │
  └───────────┘  └─────────────┘  └──────────────┘
```

One source, three surfaces:

- **Skill** — Santiago invokes manually for audit/apply/profile-set
- **Capability** — flows into agent prompts during `/iago-execute` automatically
- **Pipeline gate** — blocks the async fix loop on Important findings; runs only when diff touches `src/**/*.{tsx,jsx,css}`

### Profile dial values

| Profile | Variance | Motion | Density | Maps to taste-skill |
|---|---|---|---|---|
| operator | 3 | 3 | 7 | `minimalist-skill` |
| premium | 8 | 6 | 4 | `taste-skill` (core) |
| editorial | 5 | 4 | 3 | `soft-skill` |
| brutalist | 9 | 5 | 6 | `brutalist-skill` (beta) |

### Profile aesthetic specs (summarized; full version in `visual-taste.md`)

**operator** — B2B SaaS, dashboards, ops tools, admin panels (Munet, Sentria, Installflow archetype)
- Fonts: Geist + Geist Mono (numbers in mono, tabular figures)
- Colors: warm bone or pure white canvas; `#EAEAEA` 1px dividers; one accent ≤ 80% saturation
- Layout: data first; 1px dividers replace cards; `border-t`/`divide-y` for grouping; max-w-7xl
- Motion: hover/active only; no perpetual loops; `IntersectionObserver` for entry fades, 600ms cubic-bezier
- Banned: pill badges on KPIs, generic spinner on data load, big H1, perpetual carousels in admin

**premium** — marketing sites, landing pages, agency portfolio, investor-facing dashboards
- Fonts: Cabinet Grotesk or Satoshi (display) + Geist (UI)
- Colors: zinc/slate neutral base; one desaturated accent (emerald, electric blue, deep rose); no purple/blue "AI gradient"
- Layout: asymmetric hero (split 50/50 or left/right anchor); Bento 2.0 grids; `rounded-[2.5rem]`; diffusion shadow `0_20px_40px_-15px_rgba(0,0,0,0.05)`; labels OUTSIDE cards
- Motion: spring physics everywhere (`stiffness: 100, damping: 20`); staggered children on mount; magnetic hover via `useMotionValue` (never `useState`); GSAP for scrolltelling, Framer for UI; never mix in same tree
- Mandatory: 5 perpetual archetypes — Intelligent List, Command Input, Live Status, Wide Data Stream, Contextual UI
- Banned: Inter, centered hero with three feature cards, default ShadCN unmodified

**editorial** — long-form content, case studies, brand storytelling, narrative pages
- Fonts: Newsreader or Instrument Serif (display) + Switzer or Geist (body); body width capped at `max-w-[65ch]`
- Colors: warm monochrome canvas; muted pastels for tags/quotes only
- Layout: massive vertical padding (`py-32`); single-column body; full-bleed imagery between sections
- Motion: subtle scroll-entry only; `translateY(12px)` + opacity over 600ms; ambient background gradient blob (`opacity: 0.02-0.04`, slow drift)
- Banned: cards, dashboards, dense data tables, primary CTAs above the fold

**brutalist** — on-request only; agency manifestos, design-forward brand pages
- Fonts: Helvetica or Neue Haas Grotesk; mechanical, Swiss
- Colors: pure black + pure white + one screaming accent
- Layout: rigid grid; sharp corners; visible structure; intentional asymmetric breaks
- Motion: minimal; abrupt cuts over springs
- Banned: rounded corners > 4px, gradients, glass effects, soft shadows

### Cross-profile rules (always on)

- `min-h-[100dvh]` over `h-screen`
- Animate `transform`/`opacity` only — never `top/left/width/height`
- Skeleton loaders matching layout, never generic spinners
- Composed empty states with action paths, not "No data"
- Inline form errors via `setError`, never `window.alert`
- Tactile `:active` (`scale(0.98)` or `-translate-y-[1px]`) on all interactive elements
- No emojis in source — replace with icon or SVG primitive
- No "John Doe", "Acme Corp", `$99.99`, `99.99%`, "Elevate", "Seamless", "Unleash", "Next-Gen", Lorem Ipsum, exclamation marks in success messages
- Lucide icons standardized — single stroke-width project-wide, single style family, no mixing
- ShadCN customized via CSS variables in `src/index.css` — never edit component source

### Profile selection

`.iago/PROJECT.md` gains a frontmatter section:

```yaml
design:
  profile: premium       # operator | premium | editorial | brutalist
  overrides:             # optional, per-project deltas
    fonts:
      display: "Custom Brand Display"
    accent: "#3B82F6"
```

`/iago-init` and `/iago-onboard` prompt for profile selection. Default to `premium` if unset.

### Pipeline integration

`scripts/review-checks/visual-taste.md` declares severity floors:

| Pattern | Floor |
|---|---|
| Inter font referenced when profile bans it | ALWAYS Important |
| Centered hero with three feature cards in `premium` profile | ALWAYS Important |
| `h-screen` on full-height section | ALWAYS Important |
| Generic spinner where skeleton loader required | ALWAYS Important |
| Banned placeholder content (John Doe, Acme, Lorem, `99.99%`) | ALWAYS Important |
| Mixed icon families | ALWAYS Important |
| Cards used in `operator` profile when 1px divider would suffice | Minor |
| Centered hero in `premium` profile | Minor (style suggestion, not a bug) |

The pipeline review reads `.iago/PROJECT.md` to determine active profile, then applies profile-specific rules.

## Delivery Path

**Phase 1 — Foundation** (1 week)
- Write `.claude/rules/visual-taste.md` (shared rules + profile dial table + banned lists)
- Write `.claude/agents/capabilities/visual-taste.md` (capability injection)
- Add capability to `frontend` and `fullstack` agent profiles
- Write `scripts/review-checks/visual-taste.md` (Important severity floor)
- Update `scripts/execute-pipeline.sh` review step to load the new check module
- Add `design.profile` parsing to capability injection (read from `.iago/PROJECT.md`)

**Phase 2 — Skill: audit + profile** (1 week)
- `/iago-taste profile {name}` — write profile to `.iago/PROJECT.md`
- `/iago-taste audit {path}` — read profile, report violations against active profile rules with severity-ranked findings (mirrors taste-skill `redesign-skill`)
- Update `/iago-init` and `/iago-onboard` to prompt for profile

**Phase 3 — Skill: apply** (1 week)
- `/iago-taste apply {component or feature}` — generate or refactor toward profile (mirrors taste-skill core)
- Add capability injection sample fixtures (4 profiles × 1 hero + 1 dashboard)

**Phase 4 — Retroactive audit** (1 week, optional)
- Run `/iago-taste audit` on Munet, Din, Sentria, Installflow
- Assign profiles per client (likely all `operator` except investor-facing pages)
- Produce remediation tickets per project

Total: 3 weeks core, 4 weeks with retroactive audit.

## Open Questions

1. **Font licensing** — Cabinet Grotesk (free commercial via ITF), Geist (OFL/MIT), Satoshi (freemium with paid commercial), Newsreader (OFL), Instrument Serif (OFL). Verify each per project before shipping; document in `visual-taste.md`.
2. **Brutalist availability** — ship as Phase 1 with the others (zero added effort) or defer until requested? Suggest ship.
3. **Profile coupling with `liquid-glass-design`** — should `glass` be limited to certain profiles (e.g., not `editorial`)? Suggest no hard restriction; let the per-component choice ride.
4. **Cabinet Grotesk fallback for legacy projects** — if a project already loads Inter, do we force a swap on next plan touching `src/`, or only on greenfield? Suggest only on greenfield to avoid scope creep.

## Pre-council pressure points

The council will be asked to pressure-test:
- Whether 4 profiles is the right number (too many → coverage gaps; too few → wrong vibe forced on projects)
- Whether `Important` is the right severity (too soft → ignored; too hard → blocks delivery)
- Whether the skill + capability + gate triplet is over-engineered for a 3-person agency
- Whether profile selection in `.iago/PROJECT.md` actually drives behavior or becomes another field nobody reads
- Whether we're picking up taste-skill's *aesthetic* baggage (it has its own opinions) instead of just its *anti-slop* mechanics
