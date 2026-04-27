# Using Claude Design to Build the Full iaGO Brand Package

## Access (3 steps)

1. Open **claude.ai** → sign in with your Pro/Max/Team account (not free tier).
2. In the left sidebar, look for **Claude Design** under Tools / Anthropic Labs. If Team/Enterprise, an admin may need to enable it in **Organization → Features**.
3. Click **Create new design** → select **Brand system** (or blank canvas if that preset isn't there — it's a research preview, UI may change).

> Claude Design uses your subscription's usage limits. It has separate weekly caps that don't count against your Claude Code or chat quotas.

## Onboarding: build the design system FIRST

Before any prompt, Claude Design wants a **design system** it will apply to everything you make. This is the biggest lever — skip it and you get generic output.

Three ways to seed the system (use all three):

1. **Link your codebase** — connect `iago-os` GitHub repo. Claude Design reads React components, Tailwind config, CSS vars, and infers existing conventions.
2. **Upload reference docs** — drag any `.docx`, `.pdf`, or image you have with brand cues. If you don't have one, skip.
3. **Capture website elements** — paste `https://iago.live/`. Claude Design renders the page and extracts the wordmark + layout DNA, even if minimal.

Then tell it verbally during onboarding:

> "This is iaGO, a 3-person AI consultancy based in Mexico City. We build agent infrastructure and web apps for clients. Current brand is minimal lowercase wordmark 'iaGO' on white. Stack we use: React 19 + Vite + Tailwind 4 + ShadCN + Framer Motion + GSAP. I want to expand this into a full brand system — not just a logo."

## The master prompt

Paste this into Claude Design after onboarding is done. It's written for one generation pass followed by iteration.

```
Create a complete brand system for iaGO — a 3-person AI consultancy in Mexico City that ships agent infrastructure and modern web apps for clients. We sell to mid-market SaaS and funded startups who want AI capabilities shipped fast without hiring a whole team.

POSITIONING
- We're the anti-agency: operator-speed, no account managers, no deck theater.
- We live inside the code. Every deliverable is agent-native, versioned in git.
- Aesthetic reference: Linear, Vercel, Anthropic — technical, confident, quiet.
- Not: consulting-beige, stock-photo-corporate, flashy-startup-gradient.

AUDIENCE
- Primary: technical founders and CTOs, series-A to series-B.
- Secondary: ops/automation leads at LatAm enterprises.

VOICE
- Direct. No hedging. No "it depends." Fragments OK when sharp.
- Bilingual when useful (EN primary, ES secondary).
- Never corporate-speak. Never emoji. Never em dashes in copy.

GENERATE THE FULL BRAND PACKAGE

1. LOGO SYSTEM
   - Primary wordmark: lowercase "iaGO" (keep the case contrast between "ia" and "GO").
   - Mark-only icon for favicon / app icons (small, works at 16px).
   - Lockup variations: horizontal, stacked, mark-only.
   - Light and dark variants.
   - Show on black, white, and a warm off-white surface.

2. COLOR SYSTEM
   - Primary brand color (something specific to us, not "another blue").
   - Full palette: 3 neutrals (warm off-white, mid, deep), 1 primary, 1 accent, 1 signal (for CTAs / live status).
   - No pure white (#FFFFFF) — use warm off-white like #FAF7F2.
   - Dark mode palette aligned to the same semantic roles.
   - Output: hex values, OKLCH values, Tailwind 4 @theme block, and CSS custom properties.

3. TYPOGRAPHY
   - Display font: something editorial and slightly unusual, but readable (not Inter).
   - Body font: highly legible, modern sans-serif.
   - Mono font: for UI labels, code, timestamps.
   - Full type scale: display-xl → caption, with line-heights and tracking.
   - Show specimens: headline, subhead, body paragraph, caption, code block, button label.

4. SPACING + RADIUS
   - 4-point base scale.
   - Radius tokens: sharp (2-4px) — we don't do oversized pill shapes.
   - Container widths (mobile, tablet, desktop).

5. MOTION LANGUAGE
   - Durations: instant (80ms), quick (160ms), standard (240ms), deliberate (400ms).
   - Easings: give specific cubic-beziers, not "ease-out."
   - Named Framer Motion variants: fadeIn, slideUp, staggerChildren, pressScale.
   - Scroll behavior philosophy (short, opinionated).

6. COMPONENTS
   Render these as live HTML so I can see them:
   - Primary button (default, hover, active, disabled)
   - Secondary button
   - Text input + textarea
   - Card (default + elevated)
   - Badge / tag
   - Nav bar (site)
   - Footer
   - Section header pattern
   - Pricing card
   - Testimonial block

7. APPLIED SURFACES
   Produce first-draft designs for:
   - Landing page for iago.live — hero, services grid, case studies teaser, CTA.
   - Email signature (HTML, inline-styled — must render in Gmail/Outlook).
   - Transactional email template (welcome / proposal delivery).
   - One-pager (investor / sales, A4 PDF-ready).
   - Pitch deck template — title slide, section divider, content slide, quote slide, closing slide.
   - Proposal cover page.
   - Social: LinkedIn banner, X header, OG image template.
   - Favicon set (16, 32, 96, 180, 512).

8. VOICE + COPY GUIDE
   - 10 non-negotiables (what we always do).
   - 10 prohibitions (what we never do).
   - 5 headline examples in brand voice.
   - 5 product-description examples.
   - Error-message tone example.
   - Empty-state copy example.

9. AGENT BRIEF
   Produce a single AGENT_BRIEF.md that an AI coding agent (Claude Code, Copilot) can read to apply this brand correctly. Include precedence rules: tokens > brief > voice > rationale.

DELIVERABLES FORMAT
- Each section exportable as standalone HTML.
- Tokens exportable as JSON (colors.json, typography.json, spacing.json, motion.json) AND as a single tokens.css with @theme block for Tailwind 4.
- Handoff bundle for Claude Code when done.

ITERATION MODE
Don't give me one "safe" option per section. For logo, color, and typography give me 3 distinct directions to pick from, then I'll narrow. For everything else, your best single answer.
```

## Feeding it iago.live

Claude Design accepts URLs natively via its "capture website elements" feature. Easiest path:

1. In Claude Design, use **Add reference → From URL** and paste `https://iago.live/`.
2. It renders the page (even though it's mostly empty) and extracts: wordmark styling, current color (white bg), meta description ("AI agent management and generation").

If URL capture fails (research preview, may glitch), paste this snippet inline as fallback:

```html
<!-- iago.live — current state as of 2026-04-20 -->
<!-- Lowercase wordmark "iaGO" on pure white background, no other content. -->
<!-- Meta: "iaGO Web App for ai agent management and generation" -->
<!-- Positioning signals: AI agent management, web dev + design agency, Mexico City -->
<!-- Tech: React 19 + Vite PWA -->
<!-- theme-color: #ffffff (we will change this — no pure white per brand rules) -->
<main style="display:grid;place-items:center;min-height:100vh;background:#fff;">
  <span style="font-family:system-ui;font-weight:500;font-size:4rem;letter-spacing:-0.02em;">iaGO</span>
</main>
```

Tell Claude Design: *"This is where we are today. Expand it into the full brand system above. Keep the lowercase wordmark — it's the one fixed element."*

## Iteration tactics (after first generation)

Claude Design is conversational. Don't accept the first pass. After it generates:

1. **Narrow logo/color/typography** — pick one of the 3 directions for each, ask for refinements on that one.
2. **Stress-test accessibility** — *"Show WCAG AA contrast ratios for every foreground/background pair in the palette. Fix anything under 4.5:1 for body text, 3:1 for large."*
3. **Stress-test at edges** — *"Render the landing page at 320px wide and at 1920px wide. Show me both."*
4. **Inject constraints from CLAUDE.md** — *"Every interactive element must have a Framer Motion variant. No static hovers. Show me motion specs for every component."*
5. **Motion-language sanity check** — *"Apply the staggerChildren variant to the services grid and slideUp to the hero. Show the animation in the preview."*
6. **Email rendering reality check** — *"Render the transactional email template in Gmail, Outlook 2019, and Apple Mail viewport styles. Flag anything that breaks."*

## Export → git handoff

When satisfied, use:

- **Export → HTML bundle** → unzip into `brand/iago/preview/` (matches the iago-brand spec structure).
- **Export → Tokens (JSON)** → drop into `brand/iago/tokens/*.json`.
- **Export → tokens.css** → `brand/iago/tokens/tokens.css`.
- **Export → PDF** → brand book PDF for clients / investors.
- **Export → PPTX** → pitch deck template.
- **Handoff bundle → Claude Code** → single instruction hands off to Claude Code in this repo. Use this to scaffold the actual React components in `brand/iago/components/` and wire Tailwind 4 `@theme`.

Then in Claude Code:
```
Read brand/iago/ handoff bundle. Apply tokens.css to src/index.css. Scaffold brand/iago/components/ from the HTML previews. Generate brand/iago/animations/variants.ts from the motion specs. Generate brand/iago/AGENT_BRIEF.md from the voice guide.
```

## What Claude Design won't do well

Know the edges before you hit them:

- **Vector logo files (SVG)** — it'll render logo concepts in HTML/CSS, but won't always produce clean SVG. Export screenshots, rebuild final marks in Figma / Illustrator if needed.
- **Production email HTML** — HTML email is 1998-web-hell (inline styles, table layouts, Outlook quirks). Claude Design gives you a visual template; convert to email-safe HTML via a tool like MJML or hand-rewrite.
- **Brand book PDF with legal boilerplate** — it'll generate layout; fill in trademark / usage terms yourself.
- **Animated videos / Lottie** — not its scope.

## Fallback: if Claude Design doesn't work for you

Research preview = rough edges. If onboarding is broken or quotas are too tight:

Run the same master prompt above in Claude.ai (regular chat) with a project connected to this repo. You get 90% of the output (HTML, tokens, voice, components) as conversational artifacts, minus the visual canvas iteration. Paste results into `brand/iago/`.
