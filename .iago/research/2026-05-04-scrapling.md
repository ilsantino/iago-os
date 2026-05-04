# Research: D4Vinci/Scrapling

**Date:** 2026-05-04
**Repo:** https://github.com/D4Vinci/Scrapling

## What it is

Scrapling is a Python adaptive web scraping framework (44K stars, BSD-3-Clause) that
layers three progressively heavier fetching strategies — plain HTTP with TLS
fingerprint impersonation, headless Chromium via Playwright, and a stealth variant
(Camoufox-based) that bypasses Cloudflare Turnstile — on top of a unified lxml/CSS/XPath
parsing API. It ships a built-in MCP server exposing 10 tools (get, bulk_get, fetch,
bulk_fetch, stealthy_fetch, bulk_stealthy_fetch, open_session, close_session,
list_sessions, screenshot) consumable directly by Claude Desktop, Cursor, or any
MCP-compatible agent. The parser additionally uses similarity algorithms to relocate
elements after page structure changes, reducing breakage on site redesigns.

## Stack & runtime

- **Language:** Python 3.10+
- **Runtime:** CPython; Playwright for browser tiers; Camoufox (modified Firefox) for stealth
- **License:** BSD-3-Clause (permissive; no GPL contamination, commercial use OK)
- **Last commit / release:** v0.4.7 — April 17, 2026 (confirmed recent activity)
- **Stars:** ~44K (as of research date)
- **Maintainership signal:** Highly active — 5 releases in ~3 weeks (March 30–April 17
  2026), 92% test coverage, full type hints, PyRight + MyPy scanning. Open issues: 4.
  Industry-sponsored (proxy vendors, VPS) indicating real production usage.

## Overlap with iago-os

| iago-os capability | Scrapling overlap | Verdict |
|--------------------|-------------------|---------|
| **WebFetch** (Claude built-in) | Scrapling's `Fetcher` / `get` tool does the same basic HTTP fetch; Scrapling adds TLS impersonation and anti-bot headers that WebFetch cannot do | Partial overlap — Scrapling wins on hardened targets |
| **markitdown** (DOCX/PDF/YouTube→markdown) | Scrapling does not touch local documents; it converts live web page HTML to markdown via `extraction_type=Markdown` — scope is web-only | No meaningful overlap |
| **youtube-transcript MCP** | Scrapling has no YouTube-specific handling | No overlap |
| **WebSearch** (Claude built-in) | Scrapling is not a search engine; it scrapes known URLs | No overlap |
| **Agent HTTP calls (Lambda, n8n)** | Scrapling covers the client-side fetch layer; Lambda outbound calls are a different concern | No overlap |

Primary overlap is narrow: both WebFetch and Scrapling can retrieve a URL and return
markdown. Scrapling is strictly more capable for web scraping; it does not compete with
markitdown, youtube-transcript, or WebSearch.

## Patterns worth absorbing

1. **Progressive fetcher tiering (static → browser → stealth)**: Scrapling's
   "try the cheapest option first, upgrade only when needed" pattern is sound and maps
   directly to how iago-os agents should reason about fetch strategy — don't launch a
   Playwright session when plain HTTP suffices. Codify this as a decision heuristic in
   the operator base prompt or as a skill flag (`--stealth`, `--dynamic`).

2. **MCP tool granularity for bulk + session operations**: Scrapling separates
   single-URL (`get`) from multi-URL (`bulk_get`) and single-use from
   persistent-session (`open_session` / `close_session`) at the tool level, not in
   code. This pattern lets agents pick the right tool by name rather than parameterize
   around complexity. Worth mirroring if we ever expose a scraping MCP from iago-os.

3. **Extraction-type parameter on all fetch tools** (`Markdown` / `HTML` / `text` /
   `main_content_only`): Scrapling filters noise (ads, nav, boilerplate) before the
   response leaves the tool, reducing token cost to the AI. Our WebFetch+markitdown
   chain does this post-hoc and inconsistently. Any iago-os scraping primitive should
   accept an extraction_type upfront.

## Integration cost

**Estimate:** medium

**What it would take:**

1. **Python process management** — Scrapling is Python 3.10+; iago-os is Node 20.
   Either (a) spawn a Python subprocess from a Lambda or script, or (b) wrap it as an
   MCP server and register it in `~/.claude.json` alongside existing MCPs. Option (b)
   is the lower-friction path: run `scrapling mcp` as a stdio process, add the config
   block to Claude Code's MCP config, done. No Node code changes.

2. **MCP registration** (option b, ~1 hour):
   ```json
   {
     "mcpServers": {
       "scrapling": {
         "command": "/path/to/scrapling",
         "args": ["mcp"]
       }
     }
   }
   ```
   Requires Python 3.10+ and `pip install "scrapling[fetchers,ai]"` + `scrapling install`
   (installs Playwright browsers and Camoufox). On Windows this is viable but adds
   ~1–2 GB of browser binaries.

3. **Subprocess path** (for Lambda use, ~2–3 hours): Thin Node wrapper that shells out
   to a Python script calling Scrapling. Adds cold-start latency (~2–4s for browser
   tiers), complicates Lambda packaging (Python + Node in one function), and is harder
   to maintain. Not recommended unless the use case is Lambda-specific scraping.

4. **No iago-os pipeline changes needed** — integration is additive (new MCP tools
   available to agents), not a replacement for anything in the pipeline.

## Use case differentiation

**When Scrapling beats WebFetch + markitdown:**

- **Anti-bot targets**: Sites behind Cloudflare Turnstile, JS challenges, or aggressive
  fingerprinting (DataDome, PerimeterX). WebFetch sends raw requests; Scrapling's
  `StealthyFetcher` uses Camoufox with patched browser fingerprints. This is the
  primary moat. WebFetch will 403/block; Scrapling often succeeds.

- **JavaScript-rendered content**: SPAs and React/Next.js pages that return empty HTML
  on first load. `DynamicFetcher` / `fetch` MCP tool runs full Playwright, waits for
  network idle, and returns the hydrated DOM. markitdown's web handling cannot do this
  (it fetches raw HTTP only).

- **Multi-URL batch jobs**: Scrapling's `bulk_*` tools run concurrent async fetches
  with proxy rotation and retry. WebFetch is serial and single-URL per call. For
  research tasks scraping 50+ pages, Scrapling is significantly faster.

- **Persistent session scraping**: Login-gated content, cookie-dependent flows, or
  scraping sequences that require session state across multiple page loads. Scrapling's
  `open_session` / `close_session` pattern handles this; WebFetch is stateless.

- **Screenshot capture**: `screenshot` MCP tool delivers page images to vision-capable
  agents. No equivalent in current iago-os MCP stack.

**When WebFetch + markitdown is still correct:**

- Scraping open, bot-permissive sites (docs, GitHub, public APIs) — WebFetch is
  lower-latency and zero-dependency.
- Local document ingestion (DOCX, PDF, PPTX) — markitdown's domain entirely.
- YouTube transcripts — youtube-transcript MCP covers it.
- Any Lambda-internal use where spawning a Python browser process is prohibitive.

## Verdict

**Recommendation:** clear-yes — register as MCP server, additive integration only

**Reasoning:** The non-overlap with existing capabilities is nearly total. Scrapling
fills a real gap: anti-bot web fetching and JS-rendered content are both currently
out of reach for iago-os agents. The MCP server path (option b above) is low-cost —
one JSON config block, one pip install, no pipeline changes, no Node code. BSD-3
license is clean. Maintainer cadence (weekly releases, 4 open issues, 44K stars) is
strong. The Python runtime is the only friction, and Scrapling's own MCP server
abstracts that entirely — agents call `stealthy_fetch` over stdio, never knowing
it's Python.

**If clear-yes — how to integrate:**

1. Install: `pip install "scrapling[fetchers,ai]"` then `scrapling install` (downloads
   Playwright + Camoufox browsers, ~1.5 GB).
2. Register in Claude Code MCP config (`~/.claude.json` or project `.claude/settings.json`):
   ```json
   {
     "mcpServers": {
       "scrapling": {
         "command": "scrapling",
         "args": ["mcp"]
       }
     }
   }
   ```
3. Update `.claude/agents/bases/operator.md` to document the 10 new MCP tools and
   their decision heuristics (static → dynamic → stealth escalation ladder).
4. Add a short entry to `available-skills.md` noting when agents should prefer
   `scrapling:stealthy_fetch` over `WebFetch` (anti-bot, JS-rendered, session-gated).
5. Optional: add `scrapling mcp --http` as a sidecar service in Lambda for
   server-side scraping tasks, if a use case emerges.

**Risk note:** Browser binary footprint (~1.5 GB) makes this unsuitable for Lambda
packaging. Confine to MCP/desktop use; any Lambda scraping requirement should stay
on plain HTTP or a dedicated scraping service.
