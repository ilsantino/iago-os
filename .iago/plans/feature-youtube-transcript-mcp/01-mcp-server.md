---
phase: feature-youtube-transcript-mcp
plan: 01
wave: 1
depends_on: []
context: inline
created: 2026-04-23
updated: 2026-04-23
source: feature
---

# Plan: feature-youtube-transcript-mcp/01-mcp-server

> **Revision note (2026-04-23):** rewritten from 7 tasks → 4 after stress test. Primary engine switched from yt-dlp to `youtube-transcript-api` (InnerTube API, no ffmpeg, no subprocess). Whisper fallback dropped from v0.1.0 — caption-disabled videos return a clear error; if demand proves real, add Whisper in v0.2 with a pre-warmed model.
>
> **Path revision (2026-04-23):** target path moved from sibling `~/dev/mcp-youtube-transcript/` to `iago-os/mcp-servers/youtube-transcript/` so the MCP is versioned with the iaGO-OS toolchain and the execute-pipeline handles it natively (git + PR + review).

## Goal

Ship a Python MCP server inside iago-os at `mcp-servers/youtube-transcript/` that extracts YouTube transcripts via `youtube-transcript-api` with a clear error taxonomy on failure modes (captions disabled, private video, geo-block, language mismatch). Single tool: `transcribe_video(url, language, include_timestamps) -> markdown`. Registered globally in `~/.claude.json`. End-to-end verified on both the video that failed MarkItDown this session AND a second stable reference URL.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `mcp-servers/youtube-transcript/pyproject.toml` | Package metadata, deps (`mcp[cli]>=1.0.0`, `youtube-transcript-api>=0.6.2`), hatchling src-layout |
| create | `mcp-servers/youtube-transcript/README.md` | Install + usage + tool signature + error taxonomy |
| create | `mcp-servers/youtube-transcript/.gitignore` | `__pycache__/`, `.venv/`, `dist/`, `*.egg-info/` |
| create | `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/__init__.py` | Package marker, version string |
| create | `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/transcript.py` | URL parsing, `youtube-transcript-api` call, cues → markdown, error mapping |
| create | `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/server.py` | FastMCP server with `transcribe_video` tool + error taxonomy |
| create | `mcp-servers/youtube-transcript/tests/test_transcript.py` | Unit tests for URL parsing + cue formatting (no network) |
| modify | `~/.claude.json` | Register MCP server (using `python -m` pattern matching markitdown entry) |
| modify | `C:/Users/sanal/.claude/CLAUDE.md` | Add row to Retrieval Routing table so tool is discoverable from any project |
| create | `C:/Users/sanal/.claude/projects/C--Users-sanal-dev-iago-os/memory/project_youtube_transcript_mcp.md` | Project-scoped memory entry |
| modify | `C:/Users/sanal/.claude/projects/C--Users-sanal-dev-iago-os/memory/MEMORY.md` | Append pointer |

## Tasks

### Task 1: Scaffold repo

- **files:** `mcp-servers/youtube-transcript/pyproject.toml`, `mcp-servers/youtube-transcript/README.md`, `mcp-servers/youtube-transcript/.gitignore`, `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/__init__.py`
- **action:** Create directory tree `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/` and `mcp-servers/youtube-transcript/tests/`. Write `pyproject.toml` with: `[project] name="mcp-youtube-transcript"`, `version="0.1.0"`, `requires-python=">=3.10"`, `dependencies=["mcp[cli]>=1.0.0", "youtube-transcript-api>=0.6.2"]`. Add `[build-system] requires=["hatchling"]`, `build-backend="hatchling.build"`. Add `[tool.hatch.build.targets.wheel] packages=["src/mcp_youtube_transcript"]` (required for src-layout — `pip install -e` fails without this). No `[project.scripts]` entry — we invoke via `python -m` instead of a pipx shim to match the existing markitdown registration pattern and avoid Windows PATH issues. Write `__init__.py` with `__version__ = "0.1.0"` and `from .server import main` so `python -m mcp_youtube_transcript` resolves. Also create `src/mcp_youtube_transcript/__main__.py` with a single line `from .server import main; main()`. Write `.gitignore` with `__pycache__/`, `.venv/`, `dist/`, `*.egg-info/`, `.pytest_cache/`. Write `README.md` stating: purpose (drop-in replacement for MarkItDown's broken YouTube handler), install (`pip install -e ~/dev/iago-os/mcp-servers/youtube-transcript`), tool signature (`transcribe_video(url: str, language: str = "en", include_timestamps: bool = True) -> str`), error taxonomy (TranscriptsDisabledError, VideoUnavailableError, LanguageNotFoundError, InvalidURLError), and v0.2 roadmap note about Whisper fallback.
- **verify:** `python -c "import tomllib; d=tomllib.load(open('C:/Users/sanal/dev/iago-os/mcp-servers/youtube-transcript/pyproject.toml','rb')); assert d['project']['name']=='mcp-youtube-transcript'; assert 'youtube-transcript-api' in ''.join(d['project']['dependencies']); assert d['tool']['hatch']['build']['targets']['wheel']['packages']==['src/mcp_youtube_transcript']; print('scaffold ok')"`
- **expected:** `scaffold ok`

### Task 2: Transcript module

- **files:** `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/transcript.py`
- **action:** Implement three functions. (a) `extract_video_id(url: str) -> str`: handles `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/embed/ID`, with query-string stripping; raise `InvalidURLError` on anything else. (b) `fetch_transcript(video_id: str, language: str) -> list[dict]`: use `YouTubeTranscriptApi.list_transcripts(video_id)` then `.find_transcript([language, f"{language}-US", f"{language}-GB", "a." + language])` for near-match resolution (exact → region variant → auto-generated). If none found, raise `LanguageNotFoundError` with list of available languages in the message. Catch `TranscriptsDisabled` → raise domain `TranscriptsDisabledError`. Catch `VideoUnavailable` → raise `VideoUnavailableError`. Return `.fetch()` output (list of `{"text": str, "start": float, "duration": float}`). (c) `cues_to_markdown(cues: list[dict], include_timestamps: bool) -> str`: if timestamps, one line per cue as `[HH:MM:SS] text` (format `start` via `divmod`); if not, merge cues into paragraphs of ≤500 chars separated by blank lines. Strip HTML entities (`html.unescape`) and XML tags (simple regex `<[^>]+>`). Handle empty cues list by returning empty string. Define all four custom exceptions at module top inheriting from a common `TranscriptError(Exception)` base.
- **verify:** `cd ~/dev/iago-os/mcp-servers/youtube-transcript && PYTHONPATH=src python -c "from mcp_youtube_transcript.transcript import extract_video_id, cues_to_markdown, InvalidURLError; assert extract_video_id('https://www.youtube.com/watch?v=vyN7ITKcGXU')=='vyN7ITKcGXU'; assert extract_video_id('https://youtu.be/vyN7ITKcGXU?si=abc')=='vyN7ITKcGXU'; assert cues_to_markdown([{'text':'hello','start':1.0,'duration':2.0},{'text':'world','start':3.5,'duration':2.0}], True)=='[00:00:01] hello\n[00:00:03] world'; try: extract_video_id('not a url'); assert False, 'should have raised'\nexcept InvalidURLError: pass\nprint('transcript module ok')"`
- **expected:** `transcript module ok`

### Task 3: MCP server + tests

- **files:** `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/server.py`, `mcp-servers/youtube-transcript/tests/test_transcript.py`
- **action:** In `server.py`: `from mcp.server.fastmcp import FastMCP`. Create `mcp = FastMCP("youtube-transcript")`. Implement `@mcp.tool() def transcribe_video(url: str, language: str = "en", include_timestamps: bool = True) -> str:` that: (1) calls `extract_video_id(url)`, (2) calls `fetch_transcript(video_id, language)`, (3) calls `cues_to_markdown(cues, include_timestamps)`, (4) returns the markdown. Wrap in try/except for each custom exception and re-raise with a human-readable message prefixed by error class name (e.g. `TranscriptsDisabledError: Video vyN7ITKcGXU has captions disabled by the creator`). Add `def main(): mcp.run()` and `if __name__ == "__main__": main()` guard. In `tests/test_transcript.py`: pytest tests for (a) `extract_video_id` across 5 URL forms + 2 invalid inputs, (b) `cues_to_markdown` with timestamps=True and =False, (c) HTML entity stripping (`&amp;` → `&`), (d) XML tag stripping (`<c>text</c>` → `text`). Tests must be pure unit (no network) — do NOT call `fetch_transcript` in tests. Use `pytest` as the runner.
- **verify:** `cd ~/dev/iago-os/mcp-servers/youtube-transcript && pip install -e . --quiet && pytest tests/ -q && python -c "from mcp_youtube_transcript.server import mcp, transcribe_video; assert mcp.name=='youtube-transcript'; print('server ok')"`
- **expected:** pytest reports all tests passing (≥8 tests), then `server ok`

### Task 4: Register + end-to-end + memory

- **files:** `~/.claude.json`, `C:/Users/sanal/.claude/CLAUDE.md`, `C:/Users/sanal/.claude/projects/C--Users-sanal-dev-iago-os/memory/project_youtube_transcript_mcp.md`, `C:/Users/sanal/.claude/projects/C--Users-sanal-dev-iago-os/memory/MEMORY.md`
- **action:** (1) Back up `~/.claude.json` to `~/.claude.json.bak.$(date +%Y%m%d)`. Using Python (not `jq`, not raw sed), read `~/.claude.json`, add under top-level `mcpServers` the entry `"youtube-transcript": {"type": "stdio", "command": "python", "args": ["-m", "mcp_youtube_transcript"], "env": {}}`. Preserve all other keys. Write back with 2-space indent. (2) End-to-end test BEFORE restarting Claude Code: run `python -c "from mcp_youtube_transcript.server import transcribe_video; out = transcribe_video('https://www.youtube.com/watch?v=vyN7ITKcGXU', 'en', True); assert '[00:' in out; assert 'YouTube' not in out[:200] or 'transcript' in out.lower(); print(out[:300])"`. If the first video fails for any reason, fall back to the stable reference `https://www.youtube.com/watch?v=dQw4w9WgXcQ` (Rick Astley — effectively immortal) and record the failure reason in `test-output.md` (gitignored). (3) Add row to `C:/Users/sanal/.claude/CLAUDE.md` under the "Retrieval Routing" table: `| YouTube transcript | youtube-transcript MCP (\`transcribe_video\`) |`. This makes the tool discoverable from every project, not just iago-os. (4) Write `project_youtube_transcript_mcp.md` with `type: reference` frontmatter (not `project` — it's a global tool, not an iago-os project) and body covering: tool signature, error taxonomy, when to prefer vs markitdown (`markitdown for DOCX/PDF/XLSX; youtube-transcript for YT URLs`), install path, v0.1.0 limitation (no Whisper, caption-disabled videos error out), v0.2 roadmap note. Append to `MEMORY.md`: `- [YouTube transcript MCP](project_youtube_transcript_mcp.md) — transcribe_video via youtube-transcript-api, replaces broken markitdown YT handler; global tool registered in ~/.claude.json`. (5) Restart Claude Code and verify the MCP appears in `/mcp` list with one tool `transcribe_video`.
- **verify:** `python -c "import json; d=json.load(open('C:/Users/sanal/.claude.json')); s=d['mcpServers']['youtube-transcript']; assert s['command']=='python' and s['args']==['-m', 'mcp_youtube_transcript']; print('registered')" && grep -q "YouTube transcript" C:/Users/sanal/.claude/CLAUDE.md && grep -q "YouTube transcript MCP" C:/Users/sanal/.claude/projects/C--Users-sanal-dev-iago-os/memory/MEMORY.md && echo "memory+routing ok"`
- **expected:** `registered` on line 1, `memory+routing ok` on line 2

## Verification

```bash
# Files exist
ls mcp-servers/youtube-transcript/pyproject.toml \
   mcp-servers/youtube-transcript/src/mcp_youtube_transcript/server.py \
   mcp-servers/youtube-transcript/src/mcp_youtube_transcript/transcript.py \
   mcp-servers/youtube-transcript/src/mcp_youtube_transcript/__main__.py \
   mcp-servers/youtube-transcript/tests/test_transcript.py

# Installed
pip show mcp-youtube-transcript | head -2

# Tests pass, no network
cd ~/dev/iago-os/mcp-servers/youtube-transcript && pytest tests/ -q

# Server class resolves
python -c "from mcp_youtube_transcript.server import mcp; assert mcp.name=='youtube-transcript'"

# Registered
python -c "import json; d=json.load(open('C:/Users/sanal/.claude.json')); assert 'youtube-transcript' in d['mcpServers']; print('ok')"

# Live test
python -c "from mcp_youtube_transcript.server import transcribe_video; print(transcribe_video('https://www.youtube.com/watch?v=vyN7ITKcGXU', 'en', True)[:200])"
```

## Acceptance Criteria

1. **Latency:** p50 <3s for captioned videos (no ffmpeg, no subprocess, no tempfile — just HTTP to InnerTube). p95 <10s.
2. **Quality:** output contains no YouTube footer HTML; timestamps are monotonically increasing; at least 20 cues returned for a 5+ minute video; HTML entities decoded.
3. **Error taxonomy:** each failure mode raises a distinct exception (`TranscriptsDisabledError`, `VideoUnavailableError`, `LanguageNotFoundError`, `InvalidURLError`) with a human-readable message — not a generic `ValueError`.
4. **Language fallback:** requested `"en"` resolves via fallback chain (`en` → `en-US` → `en-GB` → `a.en`) before raising `LanguageNotFoundError`.
5. **Windows compatibility:** all paths use forward slashes or are OS-agnostic; no hardcoded `C:\` in source; MCP launches via `python -m` (not pipx shim) to avoid PATH issues.
6. **Test coverage:** all pure logic (URL parsing, cue formatting, entity stripping) covered by unit tests that do not hit the network.
7. **Discoverability:** tool listed in `~/.claude/CLAUDE.md` Retrieval Routing table so it's auto-loaded in every project, not just iago-os.
8. **End-to-end:** target URL `vyN7ITKcGXU` returns actual transcript markdown; if that video is unreachable, `dQw4w9WgXcQ` is the stable fallback reference.

## Non-Goals (v0.1.0)

- Whisper audio transcription for caption-disabled videos → v0.2 with pre-warmed model
- yt-dlp as fallback → not useful; if `youtube-transcript-api` can't find a transcript, yt-dlp can't either (same InnerTube source)
- Private / members-only / age-gated videos → require cookies, out of scope
- Translation (input is Spanish, output requested as English) → transcription only, no translation
- Batch / channel-wide fetching
- Caching

## Stress Test

**Verdict:** PROCEED (revision addresses all prior PROCEED_WITH_NOTES findings)
**Date:** 2026-04-23
**Revision basis:** resolves the three blocking issues from the 2026-04-23 analyst review of the prior 7-task version:

| Prior Finding | Resolution |
|---|---|
| Whisper first-run model download times out MCP call | Whisper dropped from v0.1.0 |
| `youtube-transcript-api` is a materially simpler primary engine | Now the only engine |
| `python -m` vs pipx shim on Windows PATH | Registration uses `python -m mcp_youtube_transcript` (matches markitdown pattern) |
| hatchling src-layout not declared | Task 1 includes `[tool.hatch.build.targets.wheel] packages=["src/mcp_youtube_transcript"]` |
| `src.` prefix in verify commands breaks post-install | All post-install verifies use `from mcp_youtube_transcript...`; pre-install verify uses `PYTHONPATH=src` |
| yt-dlp default subtitle format is VTT not SRT | Moot — no yt-dlp in v0.1.0 |
| Language fallback unspecified | Task 2 specifies `[lang, lang-US, lang-GB, a.lang]` chain |
| Error taxonomy: all failures collapse to `ValueError` | Task 2 defines `TranscriptsDisabledError`, `VideoUnavailableError`, `LanguageNotFoundError`, `InvalidURLError` inheriting `TranscriptError` |
| Memory scope mismatch (user-global tool in project-scoped memory) | Task 4 writes to both iago-os memory AND global `~/.claude/CLAUDE.md` Retrieval Routing table |
| No latency / quality acceptance criteria | Added `## Acceptance Criteria` section |
| Brittle single-video acceptance test | Task 4 adds `dQw4w9WgXcQ` as stable fallback reference |
| `/mcp` list check after restart missing | Task 4 step (5) includes it explicitly |

### Remaining minor risks (non-blocking)
- **YouTube bot detection / rate limits:** `youtube-transcript-api` uses InnerTube, generally more resilient than yt-dlp but not immune. If rate-limited, raises `YouTubeRequestFailed` — currently propagates as unmapped exception. Acceptable for v0.1.0; add mapping in v0.2 if it surfaces.
- **Concurrent invocations:** FastMCP stdio is single-process. `youtube-transcript-api` is stateless and network-bound, so concurrency is fine in practice. No queueing needed.
- **Private / age-gated:** `youtube-transcript-api` raises `VideoUnavailable` — mapped. Does not attempt cookie-based auth. Documented as non-goal.
