---
name: stack
description: Fixed iaGO tech stack. Always active.
---

# Tech Stack

Stack fixed — no alternatives unless explicitly asked.

- **Frontend:** React 19 + Vite + TypeScript (strict) + TailwindCSS 4 + ShadCN/UI + Framer Motion + GSAP/ScrollTrigger + Lenis
- **Backend/Infra:** AWS Amplify Gen 2 (manages all AWS resources) + Lambda (Node.js 20) + API Gateway + DynamoDB + Cognito + SES
- **Agents:** Claude SDK (Anthropic) + LangGraph + n8n
- **Testing:** Vitest (unit/integration), Playwright (E2E)
- **Tooling:** Biome (formatter + linter) — never Prettier or ESLint
- **CI/CD:** GitHub Actions
