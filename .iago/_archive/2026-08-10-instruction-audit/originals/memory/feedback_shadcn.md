---
name: ShadCN docs verification
description: Always verify ShadCN/Tailwind setup against official docs — Vite setup differs from Next.js
type: feedback
---

Always verify ShadCN/UI and TailwindCSS 4 setup against the official ShadCN documentation. The Vite setup process differs significantly from Next.js, and the docs are the source of truth.

**Why:** User explicitly requested this as a standard. ShadCN defaults to Next.js examples, which don't apply to their Vite + React 19 stack.

**How to apply:** When setting up ShadCN in any client project or when writing react-vite patterns, use context7 MCP to fetch current ShadCN docs rather than relying on training data.
