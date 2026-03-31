# The Architect — Research Analysis

> **Repo:** `github.com/Hainrixz/the-architect` (MIT, by tododeia.com)
> **Analyzed:** 2026-03-31
> **Total files:** ~20 (all markdown, zero code)

---

## What It Is

A Claude Code meta-agent that acts as a senior software design consultant. You describe what you want to build; it interviews you, designs the full architecture, and outputs a self-contained blueprint `.md` file that another Claude Code instance can use to build the entire project autonomously — without further clarification.

**It does NOT write code.** It is a structured prompting system: a shaped Claude identity + a library of knowledge documents that together produce high-quality, reusable project blueprints.

## What It Is Not

- Not a runtime tool, hook system, or session manager
- Not a multi-agent orchestrator
- Not a state persistence layer
- No Node.js, no dependencies, no installation

You clone the repo, run `claude` inside it, and Claude becomes The Architect. The repo IS the agent.

---

## Repo Structure

```
the-architect/
  CLAUDE.md                          # Agent identity + 4-phase workflow (100 lines)
  knowledge/
    archetypes/                      # 6 project-type templates
      saas-webapp.md                 #   Default stack, dir structure, build order, pitfalls
      marketing-site.md              #   Astro-based, SEO-focused
      mobile-app.md                  #   Expo + React Native
      api-backend.md                 #   Hono + Drizzle + PostgreSQL
      internal-tool.md               #   shadcn/ui + Recharts dashboards
      content-platform.md            #   Sanity + Algolia + Next.js
    building-blocks/                 # 8 cross-cutting decision guides
      auth-patterns.md               #   Clerk vs NextAuth vs Supabase Auth vs Firebase
      database-patterns.md           #   Postgres/Neon/Turso + Prisma vs Drizzle
      api-design-patterns.md         #   REST vs tRPC vs GraphQL vs Server Actions
      deployment-patterns.md         #   Vercel vs Railway vs Fly.io vs Cloudflare
      frontend-stacks.md             #   Next.js vs Astro vs Nuxt vs SvelteKit
      testing-patterns.md            #   Vitest + Playwright, priority-by-project-type
      styling-systems.md             #   Tailwind v4, design tokens, shadcn/ui
      state-management.md            #   Server Components + TanStack Query + Zustand
    skills-registry.md               # Maps Claude Code skills to blueprint sections
    stack-compatibility.md           # Validated combos + known bad pairings
  questions/
    phase-1-discovery.md             # Vision, audience, stage, tech prefs
    phase-2-branches.md              # Archetype-specific deep dive (3-5 Qs per type)
    phase-3-confirmation.md          # Present architecture, get sign-off
  templates/
    blueprint-template.md            # 16-section output skeleton
    claude-md-template.md            # Template for target project's CLAUDE.md
  output/                            # Generated blueprints written here at runtime
```

---

## Core Philosophy

1. **Separation of design from execution.** The Architect never writes code. It produces a blueprint. A separate Claude Code instance reads the blueprint and builds. Two distinct agent roles, clean file-based handoff.

2. **Opinionated recommendations, not option menus.** CLAUDE.md rule #9: "Be opinionated. Recommend what you believe is best with rationale. Don't present 5 options and ask the user to pick." Frame it as "Here's what I'd build" — not "here are your options."

3. **Autonomous buildability as the output goal.** The blueprint must be 100% self-contained. A Claude Code instance with zero prior context must build from it without asking clarifying questions. Build order (Section 9) is explicitly called the most critical section.

4. **Conversational design, not a form.** Max 3 questions per message. Match the user's energy. The Architect reads as a senior consultant, not an AI assistant.

5. **Progressively loaded context.** Knowledge files are loaded on demand during conversation (read archetype after classification, load building blocks as decisions arise). Lazy-loading for context efficiency.

6. **Fast-track as first-class.** "Just build it" mode: 3 essential questions + smart defaults for everything else.

---

## 4-Phase Workflow

### Phase 1: Discovery (`questions/phase-1-discovery.md`)
- Ask 2-3 questions: vision, audience, stage, tech preferences
- Classify into 1 of 6 archetypes using signal keywords
- Handle hybrids (primary archetype + secondary noted)
- Read matching `knowledge/archetypes/<type>.md` before proceeding

### Phase 2: Deep Dive (`questions/phase-2-branches.md`)
- Load archetype-specific question set (3-5 targeted questions)
- Load relevant building-block files as decisions arise (auth -> `auth-patterns.md`, etc.)
- Use `/deep-research` for unfamiliar tech comparisons
- Use `/find-skills` once to populate blueprint skills recommendation

### Phase 3: Architecture (`questions/phase-3-confirmation.md`)
- Present full proposed stack in a compact table with rationale
- Present high-level architecture, core features, rough build phases
- All in ONE message, dense, scannable, under 40 lines
- Get user confirmation; max 2 iterations before asking about sticking points
- Use `/ui-ux-pro-max` for frontend projects; `/playwright-cli` for reference site analysis

### Phase 4: Generate
- Read `templates/blueprint-template.md` + `templates/claude-md-template.md` + `knowledge/skills-registry.md`
- Compose and write complete blueprint to `output/<project-name>-blueprint.md`
- Present summary with file path

**Enforcement:** Purely prompt-based. CLAUDE.md rule #1: "NEVER generate the blueprint before completing Phases 1-3." No hooks, no code guards.

---

## Blueprint Template (16 Sections)

| # | Section | Purpose |
|---|---------|---------|
| 1 | Project Overview | Vision, goals, success metrics |
| 2 | Tech Stack | Every layer with technology + rationale (table format) |
| 3 | Directory Structure | Full annotated file tree |
| 4 | Data Model | Entities, fields, relationships, SQL/ORM schema |
| 5 | API Design | Routes table + detailed endpoint specs for critical 3-5 |
| 6 | Frontend Architecture | Pages/routes, component hierarchy, state management |
| 7 | Design System | Colors (hex), typography (font/size/weight), spacing scale, border radius |
| 8 | Auth & Authorization | Auth flow, protected routes, roles/permissions, session management |
| **9** | **Build Order** | **Most critical section.** Numbered steps (10-15) with exact deliverables per step, from zero to deployed |
| 10 | Environment Setup | Prerequisites, env vars table (name + description + where to get), bootstrap commands |
| 11 | Dependencies | Core + dev packages table with purpose |
| 12 | Deployment Strategy | Hosting, CI/CD pipeline, domain/DNS, environments |
| 13 | Testing Strategy | Unit + integration + E2E: what to test, framework, when to run |
| 14 | Skills to Use | Claude Code skills recommended for build phase, mapped to build steps |
| **15** | **CLAUDE.md for Target Project** | Complete CLAUDE.md content. Paste into project root. Must guide builder agent through entire build. |
| 16 | Non-Negotiable Rules | Hard constraints the builder must never violate (5-10 rules) |

### CLAUDE.md Template for Target Projects (Section 15)
Structured format under 120 lines: Commands -> Tech Stack (single line) -> Architecture (directory structure + data flow + key patterns) -> Code Organization Rules -> Design System (actual values) -> Environment Variables -> Non-Negotiable Rules.

---

## 6 Archetypes (Project Types)

Each archetype file contains: default stack recommendation (table with defaults + alternatives + when to switch), default directory structure, common patterns, build order (10-12 numbered steps), common pitfalls, and skills for build phase.

| Archetype | Default Stack | Key Patterns |
|-----------|--------------|--------------|
| **SaaS Web App** | Next.js 15 + TS + Tailwind v4 + shadcn/ui + Supabase + Clerk + Stripe + Vercel | Server Components for data, Server Actions for mutations, Stripe webhook handler, marketing + app route groups |
| **Marketing Site** | Astro 5 + TS + Tailwind v4 + Sanity + Vercel | Zero JS by default, React islands only for forms, SEO-first (metadata, sitemap, JSON-LD, OG), lead capture |
| **Mobile App** | Expo (React Native) + TS + NativeWind + Supabase + EAS Build | Expo Router file-based nav, tab + auth + modal route groups, AsyncStorage + SecureStore, OTA via EAS Update |
| **API / Backend** | Hono + TS + Drizzle + PostgreSQL (Neon) + Railway | Route-per-file pattern, Zod validation on every input, consistent JSON response shape, JWT auth with refresh tokens |
| **Internal Tool** | Next.js 15 + TS + Tailwind v4 + shadcn/ui + Prisma + Recharts + Vercel | TanStack Table with server-side pagination, CRUD pattern (list -> detail -> create -> edit), CSV/PDF export |
| **Content Platform** | Next.js 15 + TS + Tailwind v4 + shadcn/ui + Sanity + Algolia + Vercel | Portable Text rendering, ISR for content caching, Algolia InstantSearch, RSS feed, JSON-LD article schema |

---

## 8 Building Blocks (Cross-Cutting Decision Guides)

Each is a standalone decision matrix with recommendations, implementation patterns, and best practices.

### Auth Patterns
Decision matrix: Clerk (SaaS, fast MVP, free to 10k MAU) > NextAuth v5 (full control, open source) > Supabase Auth (integrated with Supabase DB + RLS) > Firebase Auth (mobile-first) > API Keys (B2B). Implementation patterns for each. Protected routes via Next.js middleware. Roles stored in user metadata or separate table.

### Database Patterns
PostgreSQL (Supabase or Neon) for most apps. ORM: Prisma (best DX) or Drizzle (performance, edge-compatible). Schema conventions: plural snake_case tables, UUID PKs, `created_at`/`updated_at` on every table. Soft deletes for audit-sensitive data. Cursor-based pagination for infinite scroll.

### API Design Patterns
REST for public/multi-client APIs; tRPC for full-stack TS monorepos; Server Actions for Next.js forms; GraphQL only if genuinely needed. Consistent response shape: `{ success, data, meta }` / `{ success: false, error: { code, message, details } }`. Zod validation on ALL inputs at API boundary.

### Deployment Patterns
Vercel for Next.js/Astro; Railway for backends/Docker; Fly.io for global edge; Cloudflare Pages for static. CI/CD: MVP = push-to-deploy + PR previews; Production = lint + test + preview -> staging -> production promote. Env vars validated at startup with Zod.

### Frontend Stacks
Next.js 15 for SaaS/dashboards/e-commerce; Astro 5 for content/marketing/blogs. Component libraries: shadcn/ui (recommended default). Rendering: Server Components by default, Client Components only for interactivity. ISR for semi-dynamic content.

### Testing Patterns
Vitest for unit/integration; Playwright for E2E. Priority by project type: MVP = skip tests; SaaS = unit + E2E critical paths (auth, payments, core CRUD); API = integration tests for every endpoint; Marketing = E2E smoke test. Rule: no mocking databases in integration tests.

### Styling Systems
Tailwind CSS v4 always. Design token architecture: primitive -> semantic -> component tokens via `@theme` in globals.css. shadcn/ui integration via CSS custom properties. Mobile-first responsive. Self-host fonts.

### State Management
Server Components (data display) + Server Actions (mutations) + TanStack Query (client-side server state) + Zustand (UI-only state). Covers 99% of cases. URL state via `useSearchParams` + `nuqs`. Real-time: Supabase Realtime for most, Socket.io only if self-hosted needed.

---

## Stack Compatibility Matrix

### Proven Combinations
| Name | Stack |
|------|-------|
| Modern SaaS | Next.js 15 + TS + Tailwind v4 + shadcn/ui + Supabase + Clerk + Stripe + Vercel |
| Lightweight SaaS | Next.js 15 + TS + Tailwind v4 + shadcn/ui + Supabase (Auth+DB) + Lemonsqueezy + Vercel |
| API-First | Hono + TS + Drizzle + PostgreSQL (Neon) + Railway |
| Content | Astro 5 + TS + Tailwind v4 + Sanity + Vercel |
| Mobile | Expo + TS + NativeWind + Supabase + EAS Build |
| Internal Tool | Next.js 15 + TS + Tailwind v4 + shadcn/ui + Prisma + PostgreSQL + Vercel |

### Known Bad Combinations
- Tailwind + Styled Components (conflicting paradigms)
- Prisma + Cloudflare Workers (Prisma doesn't run on Workers edge)
- NextAuth + Clerk (both do auth)
- GraphQL + simple CRUD (over-engineering)
- MongoDB + relational data (use PostgreSQL)
- Socket.io + Vercel (serverless can't hold WebSocket connections)
- Redux + small app (overkill; use Zustand)
- Firebase + Prisma (Firestore is NoSQL, Prisma is SQL)
- Next.js + Express (redundant; Next.js has API routes)
- Tailwind v3 patterns in v4 (config format changed)

### Pairing Guides
- **Auth + DB:** Clerk = any DB (sync via webhooks); Supabase Auth = Supabase Postgres (tight integration + RLS); NextAuth = any (via adapters)
- **Hosting + Framework:** Next.js = Vercel; Astro = Vercel/Cloudflare Pages; Hono/Express = Railway/Fly.io; React Native = EAS Build
- **ORM + DB:** Prisma = PostgreSQL (Supabase/Neon); Drizzle = PostgreSQL/SQLite (Turso); Mongoose = MongoDB

---

## Agent Design Analysis

### Identity Model
Single-agent, single-session. The entire agent identity is defined in CLAUDE.md (~100 lines): role definition ("senior software design consultant"), 4-phase workflow instructions, skill integration table, 10 non-negotiable rules, conversation style guidelines. No subagent spawning, no parallel agents. Handoff is file-based: blueprint written to `output/`, then a new Claude Code session reads it.

### Conversation Style Rules
- Confident architect reviewing a client brief, not a subservient assistant
- Lead with recommendations, not open-ended lists
- "Here's what I'd build" framing, never "here are your options"
- Keep messages concise, use tables and bullet points
- Architecture summary in ONE message, under 40 lines
- Match the user's energy (casual -> casual, detailed -> detailed)

### Skills Integration (During Design)
| Skill | Phase | Purpose |
|-------|-------|---------|
| `/deep-research` | Phase 2 | Compare unfamiliar technologies |
| `/ui-ux-pro-max` | Phase 3 | Design visual system (colors, fonts, spacing) |
| `/find-skills` | Phase 2 | Discover skills to recommend in blueprint |
| `/playwright-cli` | Phase 3 | Screenshot/analyze reference sites |

### Skills Recommended in Blueprints (For Builder)
`/frontend-design`, `/shadcn-ui`, `/seo-audit`, `/humanizer`, `/pdf-design`, `/playwright-cli`, `/web-reader`

---

## State & Memory

**There is no persistent state.** The Architect operates entirely within a single conversation session. No `.iago/` equivalent, no STATE.md, no DECISIONS.md. The only file written is the blueprint to `output/`.

**Blueprint as externalized state:** The generated blueprint captures all decisions. Section 15 (CLAUDE.md for target project) is the only artifact that persists to the next agent.

**Context management:** Files loaded on demand (archetype files avg ~100 lines, building blocks avg ~80 lines). Full knowledge base could fit in context simultaneously but lazy loading keeps each phase focused.

---

## Modularity Analysis

The repo has excellent modularity relative to its size:

**Highly modular:**
- `knowledge/archetypes/` — 6 independent files, each fully standalone. Adding a new archetype requires creating one file and adding one row to CLAUDE.md's routing table.
- `knowledge/building-blocks/` — 8 independent reference documents. Each can be updated without touching any other.
- `questions/` — 3 independent phase guides. Each phase can evolve independently.
- `templates/` — 2 standalone templates (blueprint, CLAUDE.md). Either can be used independently.

**Coupled:**
- CLAUDE.md ↔ archetype names — CLAUDE.md contains the routing table and file path references. Adding a new archetype requires updating both.
- `templates/blueprint-template.md` ↔ `knowledge/skills-registry.md` — Section 14 assumes the skills registry format.

**Independently extractable:** Blueprint template (any subset of 16 sections), CLAUDE.md template, stack compatibility matrix, any individual building block, any individual archetype, conversation style guidelines, non-negotiable rules pattern.
**Extract as a set:** CLAUDE.md + archetype routing table + archetype files (classification system).
**Skip as a unit:** Skills registry + skills integration (depends on specific Claude Code skills we don't have installed).

---

## Top Patterns to Extract (Ranked)

### Tier 1 — Direct Adoption

1. **Agent-produces-agent-config.** A design session produces a CLAUDE.md for the next agent. Apply to iaGO-OS: planning phase outputs a CLAUDE.md for the execution phase. This is the single most valuable pattern in the repo.

2. **Build order as most critical output.** When producing any plan (ROADMAP.md, task lists), the numbered, dependency-ordered build sequence is what enables autonomous execution. Always build-order-first.

3. **Opinionated consultant posture.** CLAUDE.md conversation style rules: lead with recommendations, not option lists. Incorporate into iaGO-OS persona configuration.

4. **Non-negotiable rules section.** Every project plan should include 5-10 hard constraints the builder must never violate. More reliable than hoping AI follows general guidelines.

5. **Stack compatibility matrix.** Directly reusable as `.iago/knowledge/stack-compatibility.md`. Validated combos + known anti-patterns.

### Tier 2 — Adapt and Integrate

6. **Structured blueprint template.** Adapt the 16-section template to a leaner 8-10 section "project brief" for iaGO-OS. Keep: overview, tech stack, directory structure, build order, env setup, dependencies, deployment, rules. Drop: design system, frontend architecture (for non-UI projects), skills-to-use.

7. **Archetype classification -> knowledge load.** Classification-then-load pattern is reusable. iaGO-OS could classify engagement types (greenfield, legacy integration, API layer, AI feature, audit) and load relevant context.

8. **Modular knowledge library.** Independent markdown files loaded on demand. Avoid context bloat. Structure `.iago/knowledge/` similarly for client-specific or domain-specific reference docs.

9. **Phased questioning structure.** Universal questions first (Phase 1), then type-specific deep dive (Phase 2). Adapt for client intake: Phase 1 qualifies engagement type, Phase 2 loads context specific to that type.

10. **Fast-track mode.** "3 questions + smart defaults" for smaller/repeat engagements. Not every project needs a full discovery session.

11. **CLAUDE.md template for target projects.** Create `.iago/templates/project-claude-md.md` as a template for generating client project CLAUDE.md files during kickoff. Under 120 lines, dense and scannable.

### Tier 3 — Skip

- **The 6 web archetypes as-is.** Web-product focused (SaaS, marketing, mobile, content). Our consultancy work spans different domains. Useful as reference, not as our taxonomy.
- **Multi-language detection.** English-only team.
- **Skill integration during design.** We don't have `/ui-ux-pro-max`, `/deep-research`, etc. installed. Pattern is interesting, specific skills irrelevant.
- **Full building-blocks library as prescriptive defaults.** They encode opinionated choices (Next.js, Supabase, Tailwind, Vercel) that may conflict with client constraints. Reference only.
- **No-code/no-hooks approach as a universal model.** Valid for single-session design tools; iaGO-OS needs hooks and automation for recurring workflows.

---

## Comparison vs ECC / Ruflo / GSD / Superpowers

| Dimension | The Architect | ECC | Ruflo | GSD |
|-----------|--------------|-----|-------|-----|
| **Purpose** | Design-phase planning; blueprint generation | Hook-based workflow automation; session management | Context lifecycle; archiving; token awareness | Spec-driven multi-phase development workflow |
| **Lifecycle phase** | Before coding starts | During any session | During any session | During feature development |
| **State persistence** | None (single session) | Moderate (session files, cost tracking) | Strong (importance scoring, archives) | Strong (STATE.md, PLAN.md, per-phase files) |
| **Agent complexity** | Single agent, pure markdown | Single agent + Node.js hooks | Single agent + Node.js hooks | Multi-agent orchestration |
| **Workflow enforcement** | Prompt-based (LLM honor system) | Hook-based (pre/post tool execution) | Context-threshold triggers | Code-gated phases + artifact dependencies |
| **Knowledge library** | Rich (archetypes + building blocks) | None (purely operational) | None (purely operational) | Moderate (references + templates) |
| **Opinionatedness** | Very high (explicit stack recommendations) | Low (config-driven, neutral) | Low (operational, neutral) | Medium (conventions encouraged) |
| **Output artifact** | Blueprint .md + CLAUDE.md for target project | Session state files, cost logs | Context archives | PLAN.md, SUMMARY.md, VERIFICATION.md |

**Key insight:** The Architect fills a gap that ECC, Ruflo, and GSD don't address — no tool helps you design a project from scratch before starting. The Architect's design-phase outputs (blueprint, CLAUDE.md, build order) are the inputs that GSD's workflow and ECC's session management need. In the iaGO-OS stack, The Architect's patterns belong at the beginning of the engagement lifecycle, before any other tool activates.

---

## How It Fits into iaGO-OS Architecture

| iaGO-OS Layer | Architect Contribution |
|---------------|----------------------|
| **Project kickoff** | Blueprint template -> `.iago/ROADMAP.md` generation; CLAUDE.md template -> client project CLAUDE.md |
| **Knowledge library** | Stack compatibility matrix, building-block decision guides as `.iago/knowledge/` reference docs |
| **Persona / conversation style** | Opinionated consultant posture, max 3 questions per message, "here's what I'd build" framing |
| **Planning outputs** | Build-order-first principle; non-negotiable rules section in every plan |
| **Workflow** | Classification -> context load pattern; fast-track mode for small engagements |

**What doesn't map:** No persistent state (we need multi-session continuity). No multi-client isolation. No hooks or automation. Web-product-only archetypes.

**Complementary fit:** The Architect handles the "before coding" phase. ECC handles "during session" operations. Ruflo handles "context health." GSD handles "during feature development." They don't conflict — they're different lifecycle phases.

---

## Adaptation Notes

1. Add CLAUDE.md conversation style guidelines (opinionated posture, max 3 Qs per message, "here's what I'd build" framing)
2. Create `.iago/templates/project-brief.md` (adapted 10-section blueprint template)
3. Create `.iago/templates/project-claude-md.md` (adapted CLAUDE.md template, under 120 lines)
4. Create `.iago/knowledge/stack-compatibility.md` (from The Architect's version, extended with our stack preferences)
5. Design engagement-type classification (greenfield, legacy integration, API layer, AI feature, audit/advisory)
6. Wire up: client intake conversation -> project brief -> `.iago/` state file initialization
