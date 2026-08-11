# Animation & Motion Capability

Stack: Framer Motion + GSAP/ScrollTrigger + Lenis. Library APIs are standard — these house rules are not:

- Division of labor: Framer Motion for component-level animation (enter/exit, layout, gestures); GSAP for scroll-driven sequences and complex timelines. Never animate the same property with both simultaneously.
- GSAP in React: `useGSAP` (from `@gsap/react`) with its `scope` param — never `useEffect` + manual cleanup.
- Lenis drives the scroll engine; connect `lenis.on('scroll', ScrollTrigger.update)` in the RAF loop — never ScrollTrigger's native listener while Lenis is active. Stop Lenis when modals/drawers open.
- Performance budget: max 3 simultaneous GSAP timelines per viewport; animate `transform`/`opacity` only; `will-change` only on actively animating elements.
- Respect `prefers-reduced-motion` everywhere (Framer `useReducedMotion`, `gsap.matchMedia()`); disable Lenis smoothing under reduced motion.
