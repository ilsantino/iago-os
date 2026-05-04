# Research: vercel-labs/agent-browser

**Date:** 2026-05-04
**Repo:** https://github.com/vercel-labs/agent-browser

## What it is

agent-browser is a native Rust CLI that drives Chrome/Chromium via CDP (Chrome DevTools Protocol) and surfaces page state as an accessibility-tree "snapshot" — a compact, numbered element-reference list (`@e1`, `@e2`, ...) — so an LLM can interact with a browser using 200–400 tokens instead of 3,000–5,000 tokens of raw HTML. The primary use case is autonomous web agents that need to click, fill forms, extract data, and navigate without a human in the loop. It ships as an npm package (pre-compiled Rust binary) installable globally, and integrates with Vercel Sandboxes (Linux microVM) for serverless browser execution.

## Stack & runtime

- **Language:** Rust (CLI + daemon, ~320 unit tests + 18 e2e); TypeScript for docs, dashboard, evals, and examples
- **Runtime:** Rust binary communicating with Chrome via CDP; no Node.js in the hot path. Dashboard and docs are Next.js.
- **License:** Apache-2.0
- **Last commit:** 2026-04-29
- **Stars:** 31,671
- **Maintainership signal:** Active — Vercel-owned, pushed within the past week, 440 open issues (expected for a high-traffic OSS tool), CI/CD workflows present, CHANGELOG and docs systematically maintained, AGENTS.md provides contributor guidance for both humans and AI

## Overlap with iago-os

| agent-browser capability | iago-os equivalent | Verdict |
|---|---|---|
| Accessibility-tree snapshot + `@ref` interaction | None. Playwright is our E2E tool but it operates at the test layer, not the agent-automation layer. WebFetch/WebSearch give agents read-only HTTP access. No iago-os component does interactive browser automation. | **No overlap — gap** |
| Session isolation, cookie/auth persistence | None at agent layer | **No overlap — gap** |
| Skills system (`skill-data/`, `skill get core`) | `.claude/skills/` skill files — conceptually similar (markdown context loaded per task) but executed very differently (ours are Claude Code slash commands, theirs are CLI-fetched markdown docs for a browser automation agent) | **Superficial naming overlap only** |
| Live dashboard (port 4848, Next.js) | None | **No overlap** |
| Claude Code plugin marketplace entry (`.claude-plugin/`) | N/A — iago-os IS a Claude Code config layer, not a consumer of the marketplace | **Not applicable** |
| Eval framework (rubric-based skill-selection scoring) | None — iago-os has no formal agent behavior eval harness | **No overlap — gap** |
| Playwright usage (repo has e2e tests using Chrome) | Playwright in iago-os stack for frontend E2E testing | **Same tool, different layers** — theirs tests the CLI; ours tests the app UI. No conflict. |

## Patterns worth absorbing

1. **Accessibility-tree snapshot as primary agent interface.** Instead of feeding raw HTML or screenshots to an LLM, agent-browser extracts a compact accessibility tree and assigns stable `@eN` refs. Token usage drops ~90% vs DOM injection. The `operator` base in iago-os agents currently uses WebFetch (returns raw HTML markup) for any dynamic-page scraping tasks. Adopting the snapshot-first pattern — either by integrating agent-browser or implementing a lightweight accessibility-tree extractor in Playwright — would make any iago-os agents that browse the web dramatically cheaper and more reliable.

2. **Trust-boundary prompt template for browser-operating agents.** Their `skill-data/core/references/trust-boundaries.md` codifies exactly what an LLM agent must treat as untrusted: snapshot content, console messages, DOM attributes, and error overlays — any of which can carry prompt-injection payloads. iago-os has no equivalent safety layer in agent profiles. The pattern is a small markdown capability module injection: a `browser-trust` capability that any agent doing web automation loads, containing the injection-detection rules, secret-non-echo rules, and domain-constraint rules.

3. **Rubric-based skill-selection eval cases.** Their `evals/cases/skill-selection.ts` defines 8 test cases with a 5-point rubric scoring whether the agent picks the right specialized skill vs. a generic fallback. iago-os has no formal eval harness for agent behavior. Absorbing this pattern means adding a lightweight `evals/` directory (Vitest-runnable) with cases that score whether the orchestrator correctly dispatches to fullstack vs. backend vs. research profiles. This catches skill-routing regressions as the catalog grows past 50+ commands.

## Integration cost

**Estimate:** small (new MCP wrapper) — if integrating the tool directly; or trivial (config-only) — if absorbing patterns only.

**What it would take (tool integration path):**
1. `npm install -g agent-browser && agent-browser install` on each developer machine (Santiago: Windows supported; Sebas: Mac supported via Homebrew)
2. Write a thin MCP server (`mcp/agent-browser/index.ts`) that wraps the CLI: `snapshot`, `click`, `fill`, `navigate`, `screenshot` as MCP tools. The existing `mcp-server-patterns.md` rule applies directly — each tool calls the CLI as a child process and returns structured JSON.
3. Register the MCP server in `.claude.json` alongside the existing MCPs (context7, obsidian, graphify, mempalace, markitdown)
4. Add a new agent capability module `browser` that injects the trust-boundary rules plus the snapshot workflow into any profile that needs web automation
5. Add `browser` capability to the `operator` base profile (currently uses WebFetch only)

**What it would take (patterns-only path):**
1. Add `skill-data/browser-trust.md` as a new capability module — copy and adapt the trust-boundaries content. 30 minutes.
2. Add `evals/` skeleton with 3-5 skill-routing test cases. 2 hours.
3. No binary installation, no new MCP server.

## Verdict

**Recommendation:** clear-yes (MCP integration) — prioritize after current Munet M2 work completes, not immediately.

**Reasoning:** iago-os agents have a real gap at the interactive-web-automation layer. WebFetch gives read access to static HTML; Playwright tests UI but is not an agent tool. Any future iago-os deliverable involving autonomous web agents (form submission, scraping dynamic SPAs, authenticated workflows) currently has no path. agent-browser fills this gap with 31K stars, active Vercel ownership, Apache-2.0 license (compatible with internal use, no copyleft risk), and native Windows support. The integration surface is small — a thin MCP wrapper matches the existing MCP pattern exactly.

**If clear-yes:** Integrate as a new MCP server (`mcp/agent-browser/`). Add a `browser` capability module containing the trust-boundary rules and snapshot workflow. Wire the `browser` capability into the `operator` agent base. Separately absorb the rubric-based eval pattern into an `evals/` directory as a standalone improvement — that has value independent of whether agent-browser is integrated.

**License note:** Apache-2.0. No copyleft. Compatible with iago-os as a private internal tool. No flags.
