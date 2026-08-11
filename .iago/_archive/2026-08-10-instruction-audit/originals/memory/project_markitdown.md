---
name: MarkItDown MCP shipped
description: Global MCP server for DOCX/PPTX/XLSX/EPub/YouTube/large-PDF → markdown, shipped 2026-04-19 via brainstorm + council workflow
type: project
originSessionId: c9c1ed54-50dc-467f-9354-120f477454c5
---
Shipped 2026-04-19: `markitdown-mcp` registered globally in `C:/Users/sanal/.claude.json` as `python -m markitdown_mcp`. Versions: `markitdown 0.1.5`, `markitdown-mcp 0.0.1a4` (alpha — monitor for breaking changes between core and wrapper).

**Why:** Council modified original spec — killed project-scoped `iago-os/.mcp.json` (symbolic without binary install), collapsed 1-week timeline to ~1 hour, verified MCP tool surface from source before writing docs.

**How to apply:**
- Tool available in every project: `mcp__markitdown__convert_to_markdown(uri)` — accepts `file://`, `http(s)://`, `data:` URIs.
- Use for: client DOCX briefs, RFPs >20 pages, XLSX financial models, Gemini meeting transcripts (Obsidian `meetings/_inbox/`), EPub research, YouTube transcripts.
- Quality verified on 3 real files: DOCX is production-grade, XLSX has `NaN` noise + `Unnamed:` columns but parseable, PDF has duplicated-headings quirk from pdfminer but content preserved.
- Sebas (Mac) install when needed: `brew install pipx && pipx install markitdown-mcp`, same `python -m markitdown_mcp` in his `.claude.json`.
- Spec + outcomes: `iago-os/docs/specs/markitdown-integration.md`.
