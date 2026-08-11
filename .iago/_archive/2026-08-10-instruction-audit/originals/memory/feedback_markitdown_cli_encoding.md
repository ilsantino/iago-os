---
name: markitdown CLI on Windows — use -o flag, never stdout redirect
description: Non-obvious gotcha: Windows console stdout redirect breaks UTF-8 encoding; always use markitdown -o out.md instead of > out.md
type: feedback
originSessionId: c9c1ed54-50dc-467f-9354-120f477454c5
---
On Windows, `markitdown file.docx > out.md` silently produces CP1252-encoded output — every non-ASCII character (ñ, á, é, emoji) becomes `?` or mojibake. Always use `markitdown -o out.md file.docx` instead; the `-o` flag writes the file in UTF-8 directly.

**Why:** Discovered 2026-04-19 during smoke-test of Spanish-content DOCX/XLSX/PDF files. First run used stdout redirect and produced `Reuni�n` instead of `Reunión`. Second run with `-o` produced perfect UTF-8. Not a markitdown bug — it's Windows console's default CP1252 redirect encoding.

**How to apply:**
- CLI usage on Windows: `markitdown -o <out>.md <in>.{docx,pdf,xlsx,pptx}`. Never `markitdown file > out.md`.
- MCP server (`mcp__markitdown__convert_to_markdown`) is unaffected — uses Python API directly, returns clean UTF-8. Gotcha only hits shell/Bash usage.
- If forced to use stdout redirect: set `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1` before the command.
- Doesn't apply on Mac/Linux — only Windows cmd/PowerShell/git-bash redirect.
