---
name: liquid-glass-design
experimental: true
description: >-
  Use when implementing glassmorphism or liquid glass UI effects for client
  projects. Not when building standard UI components (use ShadCN/UI defaults)
  or when the design doesn't call for glass effects.
---


> **Experimental:** This skill describes behavior that may exceed current Claude Code capabilities. Cost ceilings, context introspection, and persistent daemon loops are not enforced by the platform. Use with awareness of these limitations.

## Purpose

Implement glassmorphism and liquid glass UI effects using TailwindCSS 4 +
ShadCN/UI — translucent layers, blur effects, subtle borders, and depth —
compatible with our design system.

## Arguments

`/liquid-glass-design {component or page}` — what to apply glass effects to.

Optional flags:
- `--intensity {subtle|medium|bold}` — glass effect intensity (default: medium)
- `--dark-mode` — include dark mode variants

## Steps

### 1. Define the glass palette

Establish CSS custom properties in `src/index.css`:

```css
:root {
  --glass-bg: rgba(255, 255, 255, 0.1);
  --glass-border: rgba(255, 255, 255, 0.2);
  --glass-blur: 12px;
  --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.dark {
  --glass-bg: rgba(0, 0, 0, 0.2);
  --glass-border: rgba(255, 255, 255, 0.1);
}
```

Adjust values per intensity flag.

### 2. Create Tailwind utilities

Using TailwindCSS 4's CSS-based configuration:

```css
@utility glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
}

@utility glass-subtle {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

@utility glass-bold {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}
```

### 3. Apply to components

Compose glass effects with ShadCN/UI components:

```tsx
<Card className="glass rounded-2xl">
  <CardHeader>
    <CardTitle className="text-white/90">{title}</CardTitle>
  </CardHeader>
  <CardContent>{children}</CardContent>
</Card>
```

Rules:
- Never modify ShadCN/UI source files — compose via className
- Use CSS custom properties for theming, not hardcoded values
- Ensure text contrast meets WCAG AA (4.5:1 ratio minimum)
- Test on both light and dark backgrounds

### 4. Performance considerations

- `backdrop-filter` is GPU-accelerated but can cause jank on low-end devices
- Limit glass layers to 3 max per viewport
- Use `will-change: backdrop-filter` sparingly
- Provide a reduced-motion fallback: `@media (prefers-reduced-motion: reduce)`

### 5. Save design tokens

Document the glass design tokens in `docs/design/{slug}-glass.md`.

## Output

1. CSS custom properties added
2. Tailwind utilities created
3. Components modified
4. Accessibility check (contrast ratios)
5. Performance notes

## Examples

**Glass navigation bar:**
```
/liquid-glass-design navigation bar with frosted glass effect --intensity subtle
```

**Glass card grid:**
```
/liquid-glass-design dashboard cards with layered glass depth --dark-mode
```

## Boundaries

- TailwindCSS 4 + ShadCN/UI only — no external CSS libraries
- Does not modify ShadCN/UI component source — composing via className only
- Must meet WCAG AA contrast requirements — glass effects often fail this
- Performance: max 3 glass layers per viewport
- Does not dispatch agents — orchestrator implements inline
