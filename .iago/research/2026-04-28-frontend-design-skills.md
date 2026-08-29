# Research: Front-end Design Skills for iaGO-OS

**Date:** 2026-04-28
**Question:** How should we integrate Remotion, taste-skill, and huashu-design?

---

## Findings

### Remotion

Remotion is a React-based framework for programmatic video generation. It is at v4.0.454 as of April 28, 2026, on a rapid patch cadence (3-4 releases/week). The product suite includes Remotion Studio (local preview + editing), Remotion Player (embed rendered video in web apps), and Remotion Lambda (cloud rendering on AWS).

**Material changes since the council's prior downgrade (animation-studio only, trigger-gated):** The v4.x line has matured substantially. Notable additions relevant to iago-os: Claude Code integration shipped as an experimental Codex plugin (v4.0.448), HTML-in-Canvas API enabled for rendering (v4.0.447/452), HLS support added to `@remotion/media` (v4.0.454), and the web renderer now supports full CSS clip-path types (v4.0.450). macOS 15 (Sequoia) is now a hard requirement — this is a breaking platform change for Sebas (CTO, Mac). The prior downgrade rationale was scope (4-week spec too large); the technology itself has continued to mature, not regressed.

**License:** Free for individuals and companies with ≤3 employees — iaGO (3-person) is exactly on the free tier boundary. The relevant paid tier for a 4+ person company is a Company License (usage-based, $100/month minimum), or the Creator tier at $25/seat/month. Since iaGO is exactly 3 people and delivers client work, not an automated video SaaS, the free tier is technically applicable today. However, if iaGO grows to 4 people or begins delivering Remotion-rendered videos as a service product, a Company License becomes mandatory. This is a real compliance risk to track.

**What a minimal Remotion skill in iago-os would look like:** Folder at `.claude/skills/remotion-video/`, deps (`remotion`, `@remotion/player`, optionally `@remotion/lambda`), SKILL.md describing how to scaffold a composition, wire up `<Composition>`, and render. Outputs would be MP4 or a `<Player>`-embedded React component. No conflict with `frontend-slides` (that skill produces HTML/markdown decks, not video). Minimal conflict with `content-engine` (text/blog output). The prior council decision limits this to "animation-studio only, trigger-gated" — that constraint is still architecturally sound: Remotion adds a non-trivial Node.js build dependency and should only be introduced in projects that explicitly require programmatic video.

---

### taste-skill

taste-skill (github.com/leonxlnx/taste-skill) is an MIT-licensed collection of portable SKILL.md instruction files for AI coding agents. The repo ships 8 code-generation skills and 3 image-generation skills, all framework-agnostic (React, Vue, Svelte). The primary skill (`taste-skill`) is a Senior UI/UX engineering spec that corrects common AI design biases through metric-driven rules. Installation is via `npx skills add` or direct copy of the SKILL.md into a conversation.

**What it produces:** Production-ready frontend code with opinionated constraints: Geist/Satoshi/Cabinet Grotesk typography (no Inter), single accent color (AI purple forbidden), asymmetric layouts when variance >4, physics-based Framer Motion animations (`stiffness: 100, damping: 20`), and a 10-point pre-flight checklist on every output. Three global parameters (`DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`, each 1-10) function as tunable dials. The forbidden-patterns list is unusually specific and practically useful: no neon glows, no 3-column card rows, no "John Doe" placeholder data, no Unsplash links, no "Seamless / Unleash" copywriting.

**Fit with iago-os:** High alignment. The skill's motion engine explicitly mandates `useMotionValue` / `useTransform` (never `useState` for continuous animations), which maps directly to iago-os's rule that every UI change uses Framer Motion. Its Tailwind v3/v4 version-locking, Server Component defaults, and Phosphor/Radix icon sourcing are consistent with the stack. The "Bento 2.0" SaaS dashboard paradigm with perpetual micro-interactions is the aesthetic direction likely needed for iago-workspaces (content-pipeline, consulting portals). The `redesign-skill` variant ("audit the UI first, then fix layout, spacing, hierarchy, styling") is a direct complement to `/frontend-bug-bounty`. No meaningful conflict with existing skills — taste-skill is a prompt-level quality gate, not a pipeline tool, so it stacks on top of existing workflows rather than replacing them.

**Integration path:** Copy or reference the SKILL.md content into a iago-os skill at `.claude/skills/taste-design/SKILL.md`. The MIT license allows unrestricted commercial use. No new npm deps required — the SKILL.md is pure agent instructions.

---

### huashu-design

huashu-design (github.com/alchaincyf/huashu-design) is a SKILL.md-based design agent authored by "花生" (Alchain, @AlchainHust). It claims inspiration from Claude Design's brand asset protocol philosophy but is independently authored — not a direct mirror or clone. The repo ships a substantial toolchain: HTML prototype generation, PowerPoint export via `html2pptx.js`, Node.js MP4 video pipeline (HTML → MP4 → GIF + audio mixing), and a 5-dimension design critique radar system. 24 pre-built component showcases across 8 scenarios × 3 styles are included.

**Provenance assessment:** The creator explicitly states the project was "inspired by and extracted from" Claude Design principles but is not a fork or unauthorized copy of Anthropic code. The architecture is meaningfully different (terminal-based agent vs. GUI canvas, HTML/PPTX/video outputs vs. Figma export). However, the phrase "inspired by and extracted from" is ambiguous enough to warrant caution — it is unclear whether any proprietary Claude Design system prompts were incorporated verbatim. This is the key provenance risk.

**License concern (hard blocker for commercial use):** Commercial use is explicitly prohibited without written authorization from the creator. The restriction covers "product integration, client delivery, and derivative commercialization" — all three of which describe exactly what iago-os does. Authorization requires contacting the creator via X/Twitter or WeChat. No public commercial tier exists. Using this skill in any client project (MUNET, iago-workspaces, or future clients) without authorization would be a license violation.

**Technical fit assessment:** The skill's output stack (Node.js video pipeline, HTML2PPTX, audio mixing) significantly overlaps with what the prior council decided to gate behind trigger conditions for Remotion. The MP4/GIF pipeline would require Node.js tooling not currently in the iago-os stack. The PPTX export overlaps with `frontend-slides`. The animation engine (Stage + Sprite + Easing APIs) is a custom abstraction that conflicts with the stack's Framer Motion + GSAP mandate. Even if the license were resolved, the technical debt of onboarding a parallel animation abstraction is high.

---

## Comparison Table

| Skill | Produces | Key deps | Conflict risk | License | Verdict |
|---|---|---|---|---|---|
| **Remotion** | MP4/video via React compositions, embeddable Player | `remotion`, `@remotion/player`, Node ≥16 | Low (frontend-slides = HTML decks, no overlap) | Free ≤3 employees; Company ($100/mo min) at 4+ | Conditional adopt — keep animation-studio gate |
| **taste-skill** | Premium React/Vue/Svelte frontend code via SKILL.md instructions | None (prompt-only) | None — stacks on top of existing skills | MIT (unrestricted commercial) | Adopt now |
| **huashu-design** | HTML prototypes, PPTX, MP4/GIF, design critique | Node.js video pipeline, html2pptx.js, custom animation APIs | High (parallel animation abstraction, PPTX overlap with frontend-slides) | Commercial use prohibited without authorization | Skip |

---

## Per-skill recommendation

**Remotion:** Maintain the prior council ruling — animation-studio only, trigger-gated. The technology has matured (v4.0.454, Claude Code plugin, HTML-in-Canvas) and the free-tier threshold (≤3 employees) covers iaGO today, but the 4-person tripwire is a live compliance risk as iaGO grows. The skill should exist at `.claude/skills/remotion-video/` but only activate when a client project explicitly requires programmatic video output. Do not add `remotion` to the base scaffold. Confidence: high — this is consistent with the prior decision and nothing material has changed the scope argument.

**taste-skill:** Adopt immediately. Zero license friction (MIT), zero new deps (SKILL.md only), high design quality signal, and direct alignment with iago-os's Framer Motion mandate and Tailwind 4 stack. The three tunable parameters (`DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`) map cleanly onto the kinds of client UI decisions iago-os already makes. The `redesign-skill` variant is particularly useful alongside `/frontend-bug-bounty`. Recommended integration: create `.claude/skills/taste-design/SKILL.md` wrapping the taste-skill content, with iago-os-specific overrides (enforce GSAP/ScrollTrigger for scroll animations, Lenis for smooth scroll, ShadCN/UI as component base). Confidence: high.

**huashu-design:** Skip. Two independent blockers, either of which alone would disqualify: (1) commercial use requires authorization that does not exist in a public tier, making any client delivery a license violation; (2) the custom animation abstraction (Stage + Sprite + Easing) is architecturally incompatible with the Framer Motion + GSAP mandate, and the Node.js video pipeline duplicates what the animation-studio gate already scopes for Remotion. The design critique radar feature is interesting but not sufficient to justify the overhead. If the creator ever publishes a commercial license, re-evaluate only the critique capability in isolation. Confidence: high.

---

## Synthesis

**Adopt now:** taste-skill. One-day effort to wrap as a iago-os skill. Immediate value on every client UI task, especially iago-workspaces content-pipeline and MUNET redesign work. No risk.

**Maintain gating:** Remotion. Do not expand the animation-studio scope yet. Track the employee-count threshold — if iaGO crosses 3 people before the next Remotion project, budget $100/month minimum or negotiate a Creator-tier seat arrangement. The Claude Code integration (Codex plugin, v4.0.448) is worth a follow-up investigation since it could integrate directly with the iago-os pipeline.

**Skip entirely:** huashu-design. Do not revisit until the creator publishes a clear commercial license tier.

**Order of adoption:**
1. taste-skill — this week, zero cost, zero risk
2. Remotion skill definition — create the `.claude/skills/remotion-video/` scaffold so it's ready when a project needs it, without activating the dependency globally
3. huashu-design — deferred indefinitely pending license change

---

## Sources

- Remotion docs: https://www.remotion.dev/docs
- Remotion license (GitHub): https://github.com/remotion-dev/remotion/blob/main/LICENSE.md
- Remotion pricing: https://remotion.pro/license
- Remotion releases: https://github.com/remotion-dev/remotion/releases
- taste-skill repository: https://github.com/leonxlnx/taste-skill
- taste-skill SKILL.md (raw): https://raw.githubusercontent.com/leonxlnx/taste-skill/main/skills/taste-skill/SKILL.md
- huashu-design repository: https://github.com/alchaincyf/huashu-design
- huashu-design README (master): https://raw.githubusercontent.com/alchaincyf/huashu-design/master/README.md
