---
name: memory
description: iaGO memory layers + frozen-snapshot rule for MEMORY.md.
---

# Memory

Retrieval routing lives in global CLAUDE.md. iaGO-specific layers: SQLite ledger `/var/lib/iago-os/state/ledger.sqlite` (agent state + costs + event dedupe; daemon writes, schema ships Phase 3); MarkItDown MCP (`convert_to_markdown`) for DOCX/PPTX/XLSX/EPub/YouTube/large-PDF ingestion — producer, not storage. MemPalace wings: `iago_os`, `munet`, `din`, `sentria`, `installflow`, `santiago`, `business`.

## Frozen-snapshot rule

MEMORY.md is injected at session start (incl. `claude -p`; only `--bare` skips). Never grep/Read it mid-session — the content is already in context; writes persist for the NEXT session only. Exceptions: read-after-Write to verify persistence; skills designed to read cross-session prefs (e.g. `/council`) with an inline comment noting the exception.
