# Component Library

<!--
TEACHING NOTE: Loaded by BUILD agents, not spec agents.
This is your "what's available" reference — reusable components,
packages, templates. The agent checks here before building from scratch.

A good component library doc has:
  1. What's available (table format for scanning)
  2. When to use each thing
  3. When to build custom instead
  4. How to promote custom → shared (component lifecycle)
-->

## Available Components

| Component | Purpose | Use When |
|-----------|---------|----------|
| `AuthFlow` | Login/signup demo with OAuth | Any demo requiring user auth |
| `APIExplorer` | Interactive API endpoint tester | API-focused tutorials |
| `CodePlayground` | Embedded code editor with output | Interactive coding tutorials |
| `DataViz` | Charts and data visualization | Demos involving data display |

## Available Packages

| Package | Purpose |
|---------|---------|
| React + Vite | Default stack for web demos |
| Tailwind CSS | Styling (unless design system specifies otherwise) |
| Playwright | E2E testing (`/webapp-testing` skill wraps this) |
| Shiki | Code syntax highlighting |

## When to Build Custom

The library is a starting point, not a ceiling. Build custom when:
- No existing component fits the demo's core concept
- Modifying an existing component would be more work than building fresh
- The demo's visual identity needs to be unique

## Component Promotion

When a demo-specific component proves reusable across 2+ projects:
1. Generalize it (remove demo-specific coupling)
2. Move to `../src/components/shared/`
3. Add it to this registry
