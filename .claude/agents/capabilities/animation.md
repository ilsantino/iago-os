# Animation & Motion Patterns

## Stack

- **Framer Motion** — React-native animations, layout transitions, gesture handling
- **GSAP + ScrollTrigger** — Timeline-based animations, scroll-driven sequences, pinning
- **Lenis** — Smooth scroll with momentum, integrates with ScrollTrigger

## Framer Motion

- Use `motion.*` components for all animated elements — never raw CSS transitions on interactive elements
- `AnimatePresence` wraps conditional renders for exit animations — place it OUTSIDE the conditional
- Layout animations: add `layout` prop for automatic position/size transitions between renders
- `useInView` for scroll-triggered entrance animations — prefer over IntersectionObserver
- Variants pattern for orchestrated children: define `container` and `item` variants, use `staggerChildren`
- `useMotionValue` + `useTransform` for scroll-linked parallax — no `useEffect` + scroll listeners
- Spring physics: prefer `type: "spring"` with `stiffness`/`damping` over `type: "tween"` for organic feel
- Shared layout: `layoutId` for seamless transitions between routes (e.g., card → detail page)

## GSAP + ScrollTrigger

- Register plugins once at app entry: `gsap.registerPlugin(ScrollTrigger)`
- Use `useGSAP` hook (from `@gsap/react`) — NOT `useEffect` + manual cleanup
- `useGSAP` automatically handles cleanup on unmount — never call `gsap.killTweensOf` manually
- ScrollTrigger scrub: `scrub: true` for 1:1 scroll-to-progress, `scrub: 1` for smooth catch-up
- Pinning: `pin: true` on ScrollTrigger — ensure the pinned element is NOT inside a `transform` parent
- Timelines: `gsap.timeline({ scrollTrigger: {...} })` for multi-step scroll sequences
- `gsap.context()` scopes animations to a component — use with `useGSAP`'s `scope` parameter
- Performance: use `will-change: transform` on animated elements, avoid animating `width`/`height` (use `scale`)
- `gsap.matchMedia()` for responsive breakpoints — define different animations per screen size

## Lenis Smooth Scroll

- Initialize once at app root: `new Lenis()` with `requestAnimationFrame` loop
- Connect to ScrollTrigger: `lenis.on('scroll', ScrollTrigger.update)` in the RAF loop
- Wrapper component pattern: create `<SmoothScroll>` provider that initializes Lenis and exposes `lenis` instance via context
- `lenis.scrollTo(target, { offset, duration })` for programmatic scroll — never `window.scrollTo`
- Disable on mobile if native scroll is preferred: check `window.innerWidth` before init
- Stop/start Lenis when modals or drawers open — prevents background scroll

## Integration Rules

- **Framer Motion + GSAP coexistence:** Use Framer Motion for component-level animations (enter/exit, layout, gestures). Use GSAP for scroll-driven sequences and complex timelines. Never animate the same property with both simultaneously.
- **Lenis + ScrollTrigger:** Lenis handles the scroll engine, ScrollTrigger reacts to it. Always connect them via the RAF loop — do not use ScrollTrigger's native scroll listener when Lenis is active.
- **React 19 compatibility:** All animation setup goes in `useGSAP` or `useEffect` (for Lenis init), never in the render body. Cleanup is mandatory — Strict Mode double-mounts will create duplicate animations without it.
- **Performance budget:** Max 3 simultaneous GSAP timelines per viewport. Use `will-change` sparingly (only on actively animating elements). Prefer `transform` and `opacity` — these are compositor-only properties.

## Accessibility

- Respect `prefers-reduced-motion`: wrap all animations in a media query check or use Framer Motion's `useReducedMotion` hook
- Lenis smooth scroll: disable when `prefers-reduced-motion` is set — instant jumps instead
- GSAP: `gsap.matchMedia()` can target `(prefers-reduced-motion: reduce)` to skip animations
- Never rely on animation to convey essential information — animations enhance, not communicate
