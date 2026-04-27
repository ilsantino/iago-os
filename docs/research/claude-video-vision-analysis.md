# Research: Claude Video Vision — Robust Video Transcription

**Date:** 2026-04-27
**Question:** How should iaGO-OS extend video transcription beyond YouTube captions?

---

## Findings

### 1. Technique stack

**Current state (confirmed from source):**
`mcp-servers/youtube-transcript/` is a Python MCP (`youtube-transcript-api>=1.2.0`) that calls the YouTube InnerTube captions API. It parses SRT-format cue objects and formats them as timestamped markdown. Zero vision, zero audio. Fails hard on `TranscriptsDisabledError` or `VideoUnavailableError` — no fallback path exists.

**Reference repo technique (`jordanrendric/claude-video-vision`):**
A Node.js MCP server that wraps `ffmpeg` to extract frames at a configurable fps, converts them to base64, and sends multi-image content blocks to Claude via `@anthropic-ai/sdk`. Audio is handled by a parallel multi-backend ASR pipeline: Gemini native speech > local `whisper.cpp` > OpenAI Whisper API. Claude adapts sampling parameters per question ("first second" triggers high fps; "summarize 1h lecture" triggers low fps across full duration). Max 100 frames per extraction (configurable). The Claude model receives a mixed content message: N image blocks + the ASR transcript as a text block, then produces a unified analysis.

**Technique classification:** Frame sampling + vision messages (primary) + hybrid ASR (audio). No Files API used — frames go as inline base64. No Batch API. Prompt caching not applied.

**Assessment:** The frame-sampling + vision hybrid is the correct approach for caption-free video. The reference repo validates the architecture but has Windows-hostile assumptions (Apple Silicon tested only, `ffmpeg` assumed in PATH).

---

### 2. Supported inputs

| Input type | Reference repo | Notes |
|---|---|---|
| Local video files | Yes — any ffmpeg-supported format (mp4, mov, mkv, webm, avi) | ffmpeg handles container diversity |
| YouTube URLs | Not directly | Would need `yt-dlp` to download first |
| Max duration practical limit | Soft: ~100 frames budget at 1fps = ~100s at default; adjustable | Token budget, not time, is the real ceiling |
| Max file size | Bounded by ffmpeg memory; no explicit limit stated | Disk I/O, not API limit |
| Streams / live video | Not supported | Point-in-time frame extraction only |

For our use case, the highest-value extension path is: **local mp4/webm files + YouTube-as-fallback** (when captions fail, `yt-dlp` download + frame extraction).

---

### 3. Anthropic SDK patterns

All numbers confirmed from `platform.claude.com/docs/en/docs/build-with-claude/vision` (fetched 2026-04-27).

**Image content blocks — three source types:**
```typescript
// base64 (inline)
{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "<b64>" } }

// URL (public URL, Claude fetches)
{ type: "image", source: { type: "url", url: "https://..." } }

// Files API (upload once, reference by ID)
{ type: "image", source: { type: "file", file_id: "file_abc123" } }
```

**Files API (`files-api-2025-04-14` beta):**
- Supported types for `image` blocks: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Supported types for `document` blocks: `application/pdf`, `text/plain`
- Video files: NOT natively supported — no `video` content block type exists. Video must be decomposed into frames (images) before sending.
- Max file size: 500 MB per file; 500 GB org-wide total
- File operations (upload, list, delete) are free; content used in Messages costs as input tokens
- Files persist until explicitly deleted (not ephemeral like base64 in-request images)
- Rate limit (beta): ~100 file API calls/minute

**Prompt caching with images:** Supported — images in the `system` prompt or at the start of a conversation can be cached with `cache_control: { type: "ephemeral" }`. Repeated frame sets (e.g., same video analyzed multiple times) would benefit, but the 5-minute TTL makes caching valuable only for tight retry loops, not across sessions.

**Batch API:** Supported for Messages with image content. Viable for offline batch transcription of large video libraries. Not useful for interactive MCP tool calls.

---

### 4. Failure modes and rate limits

Confirmed hard limits from Anthropic vision docs:

| Limit | Value | Source |
|---|---|---|
| Max images per request (200k-context models) | 100 | vision docs |
| Max images per request (other models) | 600 | vision docs |
| Max image dimension | 8000×8000 px (reduced to 2000×2000 if >20 images in request) | vision docs |
| Max image file size (API) | 5 MB per image | vision docs |
| Request size limit (standard endpoints) | 32 MB total | vision docs note |
| Token formula | `width × height / 750` tokens | vision docs |
| Max tokens per image — Sonnet 4.6 / non-Opus-4.7 | 1568 tokens (capped at 1568px long edge) | vision docs |
| Max tokens per image — Opus 4.7 | 4784 tokens (capped at 2576px long edge) | vision docs |

**Practical failure modes for video:**
- **100-frame wall at 200k context:** Sonnet 4.6 hits the 100-image cap. At 1fps, that's 100 seconds of video. A 10-minute video at 1fps needs 600 frames — requires chunked multi-request processing.
- **32 MB request ceiling:** 100 frames × 5 MB max = 500 MB theoretical; real limit is 32 MB total request. At ~100 KB/frame (768×768 JPEG), 100 frames ≈ 10 MB — within budget. At 1920×1080, frames must be downsampled before send.
- **ffmpeg dependency on Windows:** `ffmpeg` is not in PATH by default on Windows 11. Must be installed separately or bundled. The reference repo does not handle this. This is a real friction point for iaGO-OS Windows-first deployment.
- **ASR cold start:** Local Whisper model download (~150 MB for `base.en`) on first run adds latency without user feedback.
- **Caption fallback race condition:** If `yt-dlp` download + frame extraction runs as the fallback for a YouTube video, latency jumps from ~1s (caption API) to 30–120s (download + ffmpeg + API calls).

---

### 5. Cost model

**Vision approach — Sonnet 4.6 ($3.00/M input tokens):**

At 768×768 px per frame:
- Tokens per frame: `768 × 768 / 750 = 786 tokens` (below 1568 cap, so exact)
- Cost per frame: `786 / 1,000,000 × $3.00 = $0.00236`
- At 1 fps: 60 frames/minute → `60 × $0.00236 = $0.142/minute`
- Plus output tokens (~500 tokens summary per chunk): `500 / 1,000,000 × $15.00 = $0.0075`
- **Total vision cost: ~$0.15/minute at 1fps, 768×768**

Reduce to 0.5fps: $0.075/minute. At 320×240 (≈102 tokens/frame): $0.018/minute.

**ASR alternative — OpenAI Whisper API ($0.006/minute):**
- 25× cheaper than vision at 1fps/768px
- No visual content understanding — text only
- For transcription-only use cases, Whisper is clearly better on cost

**Hybrid approach (recommended):**
- Use Whisper/caption API for the transcript (cheap)
- Use vision only when explicitly needed (scene analysis, slide reading, code in video)
- Vision as optional enrichment, not default pipeline

**Files API amortization:** Upload a frame once (`file_id`), reference in multiple calls — eliminates repeated base64 encoding cost. Meaningful for multi-question analysis of the same video.

---

### 6. Integration fit for our MCP

**Option (a): Extend existing `mcp-servers/youtube-transcript` with vision fallback**
- Existing server: Python, `youtube-transcript-api`, captions path is solid
- Vision fallback would require adding `ffmpeg` subprocess + `yt-dlp` download + `@anthropic-ai/sdk` (or Python `anthropic`) for vision calls — bloating a focused tool
- Mixed-language complexity: Python MCP calling JS-style async vision pipeline is awkward
- Captions and vision serve different user intents (transcript vs. visual analysis) — conflating them into one tool obscures the tool contract

**Option (b): Build sibling MCP `mcp/video-vision` for arbitrary video files**
- Clean separation of concerns: `youtube-transcript` stays fast/cheap for captioned YouTube; `video-vision` handles arbitrary local files + caption-disabled videos
- Aligns with MCP design principle: one tool, one clear purpose
- Uses our stack (Node.js 20 ESM, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`)
- ffmpeg handled explicitly with Windows PATH check and clear error message
- Can accept both local file paths and YouTube URLs (with `yt-dlp` download step)
- Tool contract: `analyze_video(path_or_url, question, fps?, max_frames?)` — caller controls cost

**Option (c): Fork the reference repo's code into our tree**
- Reference repo is Python-hostile (macOS-only tested), has no TypeScript, and couples frame extraction + ASR + vision in a single opaque blob
- Configuration via `~/.claude-video-vision/config.json` conflicts with MCP server patterns
- No tests, no typed helpers, no error taxonomy — does not meet iaGO code standards
- Not worth forking; the architecture is correct but the implementation is not adoptable

---

## Sources

- `mcp-servers/youtube-transcript/src/mcp_youtube_transcript/transcript.py` — confirmed existing MCP is captions-only Python using `youtube-transcript-api`
- `mcp-servers/youtube-transcript/pyproject.toml` — confirmed Python 3.10+, no vision dependencies
- `https://github.com/jordanrendric/claude-video-vision` (README via WebFetch) — technique: ffmpeg frame extraction + base64 to Claude vision + multi-backend ASR; Node.js MCP; 100-frame max; macOS-primary
- `https://platform.claude.com/docs/en/docs/build-with-claude/vision` — authoritative limits: 100 images/request (200k models), 5 MB/image, 32 MB total request, token formula `width×height/750`, 1568 token cap per frame on non-Opus-4.7 models, Files API `file_id` source type for images
- `https://platform.claude.com/docs/en/docs/build-with-claude/files` — Files API: supported types (PDF, plain text, JPEG/PNG/GIF/WebP), 500 MB max per file, 500 GB org storage, no native video block type, file operations free, ~100 req/min rate limit in beta

---

## Recommendation

**Decision:** (b) Build a sibling MCP `mcp-servers/video-vision` for arbitrary video files.

**Confidence:** High

**Reasoning:** The existing `youtube-transcript` MCP is correct for its narrow purpose (captioned YouTube, fast, cheap) and should not be mutated. Vision analysis is a fundamentally different tool contract — it applies to local mp4/webm files, caption-disabled YouTube videos, and screen recordings. Building it as a sibling MCP keeps both tools focused, maintains the one-tool-one-purpose MCP pattern, and lets callers compose them (try captions first, fall back to vision). Forking the reference repo is not viable — it is macOS-only, untested, and architecturally incompatible with iaGO standards.

**Next step:** Create `mcp-servers/video-vision/` as a Node.js 20 ESM package with `@modelcontextprotocol/sdk` and `@anthropic-ai/sdk`. Wire one tool: `analyze_video(input, question, options)` that accepts a file path or YouTube URL, runs ffmpeg frame extraction (with explicit Windows PATH check), sends frames as base64 image blocks to Sonnet 4.6, and returns the analysis with a cost estimate. Add `yt-dlp` as an optional download step for YouTube URLs when caption API fails.

**Risk if wrong:** If chosen wrong and (a) was correct — we'd have a bloated `youtube-transcript` MCP with mixed concerns that's harder to test and maintain, and vision calls routed through a Python server would lack the TypeScript type safety the rest of the stack relies on.
