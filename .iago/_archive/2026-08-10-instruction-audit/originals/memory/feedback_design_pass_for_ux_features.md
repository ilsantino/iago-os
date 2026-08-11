---
name: Dispatch design-proposal pass before brainstorming for UX/visual features
description: For features primarily about UX, content density, visual hierarchy, or information architecture, run a design-proposal pass FIRST (dedicated Claude session with content corpus + screenshots + brief). Output feeds brainstorming as input, not the other way around.
type: feedback
originSessionId: 1d4602fc-8c9f-4ef3-823e-a6736c9394b4
---
For features whose primary value is UX, content density, visual hierarchy, or information architecture (NOT pure code/data), dispatch a design-proposal pass BEFORE the brainstorming session. Output of the design pass becomes input to brainstorming.

**Why:** Santiago suggested this on 2026-05-16 after sentria PR #133 shipped a complete content overhaul that was "complete but overwhelming." He wanted refinements (sticky sidebar, grouped glossary, per-role workflow clarity, less density) and asked whether a Claude design session with assets + content + brief would propose better structure. Yes — proven valuable pattern.

**How to apply:**
For UX/design/IA-heavy features:
1. **Gather inputs** for the design pass: content corpus (the docs/screens/components being refined), real assets (captured screenshots if any), user feedback (specific gripes), constraints (stack, brand, accessibility), and one-line brief ("propose visual + structural refinements to {surface} that address {gripes}").
2. **Dispatch a dedicated Claude session** (`claude -p`) with a design-focused prompt. The prompt should ask for:
   - Refined sidebar / nav pattern (collapse/expand, grouping, density choices)
   - Information architecture critique (grouping schemes — by role/topic/lifecycle/hybrid)
   - Per-role overview structure (e.g., "Mi día como X" timeline docs vs enhanced flow docs)
   - Visual density critique (whitespace, typography hierarchy, callout patterns)
   - Moodboard or wireframe-level recommendations (not pixel-perfect mockups; structural directives)
3. **Capture output** to `.iago/research/{feature}-design-proposal-{date}.md`. This becomes a reference artifact.
4. **Then run `/brainstorming`** using the design proposal as the primary input — Santiago picks which proposals to ship + which to defer.
5. **Then `/iago-plan --feature` with per-chunk PRs** (per `feedback_pr_split_multichunk`).

For NON-UX features (pure backend, data flows, infra), this is overkill. Skip the design pass and go straight to brainstorming.

**Stack-specific note for sentria/client work:**
- shadcn/ui + Tailwind v4 + Radix primitives are the constraints. Design proposals should compose existing primitives, not invent new components.
- Spanish user-facing copy is mandatory (sentria specifically). No tech vocab leakage rule applies to all design proposals that affect user-facing text.
