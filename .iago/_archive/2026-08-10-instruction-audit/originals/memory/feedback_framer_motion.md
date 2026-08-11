---
name: Framer Motion on all UI changes
description: Every UI/UX addition or change must include Framer Motion animations — no static panel pages or form sections
type: feedback
---

All UI/UX additions and changes must include Framer Motion animations. No new panel pages, forms, or public sections should ship without motion.

**Why:** PR #44 (Sebas) established a polished animation baseline across the admin panel. New pages without animations feel inconsistent and unfinished. Santiago explicitly flagged this as a requirement.

**How to apply:** When writing or reviewing plans that touch UI:
- Panel pages: stagger card/row entry, dialog slide-up, button tap feedback, status badge transitions
- Public pages: scroll-triggered reveals (GSAP), form field stagger, conditional field AnimatePresence
- Reference patterns: `src/components/ui/motion.tsx` (FadeIn, ScaleIn, SlideIn), `src/components/panel/PanelMotion.tsx` (easeOutQuad)
- Always respect `prefers-reduced-motion` (Framer Motion handles this automatically with `useReducedMotion`)
