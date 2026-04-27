# Design System

<!--
TEACHING NOTE: Loaded by BUILD agents. Contains the visual quality floor.
This is the "how things should look" reference.

A design system doc should be PRESCRIPTIVE about the minimum bar
but PERMISSIVE about creative execution. "Every page needs a
consistent header" is a requirement. "The header must be exactly
64px tall with #1a1a2e background" is a recipe.
-->

## Visual Philosophy

Clean, developer-focused. Technical content should feel like a well-designed IDE — information-dense but scannable, with clear visual hierarchy.

## Color

| Token | Value | Use |
|-------|-------|-----|
| `--bg-primary` | `#0f0f1a` | Page backgrounds |
| `--bg-surface` | `#1a1a2e` | Cards, panels |
| `--text-primary` | `#e0e0e0` | Body text |
| `--accent` | `#6366f1` | Links, buttons, highlights |
| `--success` | `#22c55e` | Positive states |
| `--warning` | `#f59e0b` | Caution states |
| `--error` | `#ef4444` | Error states |

## Typography

- **Headings:** Inter or system sans-serif, bold
- **Body:** Inter or system sans-serif, regular
- **Code:** JetBrains Mono or system monospace

## Layout Principles

- Max content width: 1200px
- Generous padding (24px minimum on containers)
- Visual hierarchy through size and weight, not just color
- Dark mode is the default. Light mode is optional.

## Quality Floor

Every deliverable must have:
- Consistent color usage (use the tokens above)
- Readable typography (16px minimum body text)
- Clear visual hierarchy (you should be able to scan in 3 seconds)
- Responsive layout (unless explicitly desktop-only)
