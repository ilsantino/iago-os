# Spec: video-vision MCP

**Date:** 2026-04-27
**Status:** Draft (post-brainstorm, pre-council)
**Predecessor research:** `docs/research/claude-video-vision-analysis.md`

## Problem

Current `mcp-servers/youtube-transcript/` only handles YouTube videos with official captions. It fails hard on `TranscriptsDisabledError` and has zero coverage for local video files (mp4, mov, webm, mkv) — a common consulting deliverable input (client recordings, meeting captures, screen captures). We need one robust video → text/analysis tool that handles any video Santiago or Sebas throws at it.

## Solution

Build a sibling MCP server `mcp-servers/video-vision` (Node.js 20 ESM, TypeScript strict). One primary tool `analyze_video(input, question, options)` with internal routing:

1. If `input` is a YouTube URL → try YouTube captions API first (cheap, fast)
2. If captions unavailable OR `input` is a local file path → ffmpeg frame extraction + Claude vision multimodal analysis
3. For YouTube without captions, download via `yt-dlp` first, then extract

Companion tool `estimate_video_cost(input, options)` for dry-run pricing without burning API tokens.

**Why this beats the alternatives:** Builds on the validated technique from `jordanrendric/claude-video-vision` (frame sampling + vision messages) but adopts iaGO's stack (Node.js 20, TypeScript strict, `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`) and Windows-first reality (`ffmpeg-static` bundled binary, no PATH dependency). Keeps `youtube-transcript` MCP intact as a low-level captions utility — composability through internal routing, not tool sprawl.

## Scope

### In Scope

- New package `mcp-servers/video-vision/` — Node 20 ESM, TS strict, `@modelcontextprotocol/sdk` + `@anthropic-ai/sdk`
- Tool `analyze_video(input, question, options)`:
  - `input`: local file path OR YouTube URL (string)
  - `question`: what the user wants to know (string)
  - `options`: `{ fps?, max_frames?, format?, model?, allow_youtube_download? }`
- Tool `estimate_video_cost(input, options)` — returns `{ frames, estimated_input_tokens, estimated_cost_usd, duration_seconds }` without calling the LLM
- ffmpeg via `ffmpeg-static` npm package (bundled binaries, no PATH dependency)
- yt-dlp via spawned binary — bundle path-resolution helper checking common install locations + fallback to `npx yt-dlp-exec`
- Frame extraction at configurable fps with hard cap at 100 frames (Sonnet 4.6 vision limit)
- Smart routing for YouTube URLs: captions API → vision fallback
- Cost guardrails: hard cap at 100 frames, pre-flight warning when frames > 30, cost estimate returned in every response
- Output: `format: "markdown" | "json"`, default markdown
- Global registration via `~/.claude.json` mcp servers section
- Cross-platform: Windows 11 (Santiago) + macOS (Sebas) tested
- Vitest unit tests for: input parsing, frame budget calculator, cost estimator, error taxonomy
- Error taxonomy: `VideoNotFound`, `FfmpegFailure`, `YtDlpFailure`, `FrameBudgetExceeded`, `AnthropicApiError`, `CaptionsUnavailable`

### Out of Scope (defer to v0.2 or later)

- Audio transcription / ASR (whisper.cpp shell-out, OpenAI Whisper). Vision-only MVP. If audio matters, captions cover the common case.
- Files API (`file_id` source type) for cross-session frame caching. 5-minute cache TTL gives minimal benefit; revisit if usage shows repeated analyses of same video.
- Live streams / RTMP. Point-in-time only.
- Question-adaptive sampling (LLM picks fps based on question). Adds round-trip cost.
- Scene-change detection via ffmpeg `select='gt(scene,0.4)'`. Quality gain doesn't justify processing time.
- Batch API integration for multi-video pipelines. Build interactive first, batch later if demand.
- Prompt caching across conversations. 5-minute TTL not worth complexity.
- Video format conversion / re-encoding beyond ffmpeg's native frame extraction.

## Technical Approach

### Stack

- Node.js 20 ESM, TypeScript 5 strict
- `@modelcontextprotocol/sdk` — server framework
- `@anthropic-ai/sdk` — vision API client
- `ffmpeg-static` — bundled ffmpeg binary (Win/Mac/Linux)
- `youtube-transcript-api` (Python) — NOT used directly. We re-implement YouTube caption fetch in Node via a small InnerTube call (or shell out to existing `youtube-transcript` MCP if internal routing proves cleaner — TBD in Phase 2)
- `yt-dlp` — system binary or `yt-dlp-exec` npm wrapper. Resolved at startup, fail fast with clear message if missing
- `zod` — input schema validation per `mcp-server-patterns.md`
- `vitest` — unit tests
- `biome` — formatter/linter (per stack rule)

### File Layout

```
mcp-servers/video-vision/
  package.json
  tsconfig.json
  biome.json (extends root if root exists)
  src/
    index.ts                    # MCP server entry, stdio transport
    tools/
      analyze-video.ts          # primary tool, internal routing
      estimate-video-cost.ts    # dry-run pricing
    lib/
      ffmpeg.ts                 # ffmpeg-static wrapper, frame extraction
      yt-dlp.ts                 # yt-dlp wrapper, download YouTube
      youtube-captions.ts       # InnerTube caption fetch (or shell-out)
      vision.ts                 # Anthropic vision API call
      cost.ts                   # token + dollar math
      errors.ts                 # error taxonomy
      paths.ts                  # tmpdir handling, cleanup
    types.ts                    # shared types, zod schemas
  test/
    cost.test.ts
    errors.test.ts
    ffmpeg.test.ts (mocked subprocess)
    integration.test.ts (skipped in CI without API key)
  README.md
```

### Tool Contracts

**`analyze_video`:**

```ts
const inputSchema = z.object({
  input: z.string().describe("Local file path OR YouTube URL"),
  question: z.string().describe("What to analyze about the video"),
  options: z.object({
    fps: z.number().min(0.1).max(30).default(1),
    max_frames: z.number().min(1).max(100).default(60),
    format: z.enum(["markdown", "json"]).default("markdown"),
    model: z.enum(["claude-sonnet-4-6", "claude-opus-4-7"]).default("claude-sonnet-4-6"),
    allow_youtube_download: z.boolean().default(true),
  }).default({}),
});
```

Response (markdown default):

```markdown
# Video Analysis

**Input:** {input}
**Frames analyzed:** {n} ({fps} fps from {duration}s)
**Model:** {model}
**Cost:** ${estimated_cost} (input: {input_tokens}, output: {output_tokens})

## Analysis
{Claude's response}
```

JSON format returns the same data as a structured object.

**`estimate_video_cost`:**

```ts
const inputSchema = z.object({
  input: z.string(),
  options: z.object({
    fps: z.number().default(1),
    max_frames: z.number().default(60),
    model: z.enum(["claude-sonnet-4-6", "claude-opus-4-7"]).default("claude-sonnet-4-6"),
  }).default({}),
});
```

Returns:

```json
{
  "duration_seconds": 180,
  "frames_to_extract": 60,
  "estimated_input_tokens": 47160,
  "estimated_output_tokens": 1000,
  "estimated_cost_usd": 0.156,
  "warnings": ["Frames capped at 60; full video would need 180 frames at 1fps"]
}
```

### Internal Routing Logic

```
analyze_video(input, question, options)
  │
  ▼
isYouTubeUrl(input)?
  │
  ├── YES ──► fetchYouTubeCaptions(videoId)
  │            │
  │            ├── SUCCESS ──► return formatted captions + Claude text-only summary
  │            │                                            (uses question for context)
  │            │
  │            └── FAILURE ──► options.allow_youtube_download?
  │                              │
  │                              ├── YES ──► ytDlp.download() to tmpdir
  │                              │           ffmpeg.extractFrames()
  │                              │           vision.analyze(frames, question)
  │                              │           cleanup tmpdir
  │                              │
  │                              └── NO ──► return CaptionsUnavailable error
  │
  └── NO ──► assertFileExists(input)
              ffmpeg.extractFrames(input, fps, max_frames)
              vision.analyze(frames, question)
              return result
```

### Frame Extraction (ffmpeg)

- Probe duration first via `ffprobe` (bundled with ffmpeg-static): `ffprobe -v error -show_entries format=duration -of csv=p=0 {input}`
- Calculate frames-to-extract: `min(duration * fps, max_frames)` (hard cap 100)
- Extract to tmpdir as JPEG (~80% quality, max 768px long edge to stay under per-image token cap):
  `ffmpeg -i {input} -vf "fps={fps},scale='min(768,iw)':-1" -q:v 5 {tmpdir}/frame_%04d.jpg`
- Read frames into base64 in parallel (Promise.all)
- Cleanup tmpdir in `finally` block (always)

### Vision API Call

- One request, all frames as image content blocks + text block with the question
- Model: Sonnet 4.6 default (cheap), Opus 4.7 opt-in for complex analysis
- Source type: `base64` (Files API skipped for MVP per Q7)
- Set `max_tokens: 4096` for response, override via options later if needed
- Retry on `429` / `529` with exponential backoff (3 attempts max), surface `AnthropicApiError` after

### Cost Math (cost.ts)

- Token formula: `tokens_per_frame ≈ (width × height) / 750`
- At 768×768: ≈786 tokens/frame
- Sonnet 4.6 input: $3.00 / 1M tokens; output: $15.00 / 1M tokens
- Opus 4.7 input: $15.00 / 1M; output: $75.00 / 1M
- Question token estimate: `len(question) / 4` (rough chars-per-token)
- Output estimate: 1000 tokens default (configurable)
- Returned in every response — no surprises

### Cross-Platform

- `ffmpeg-static` resolves to platform-specific binary at install time (Windows: `ffmpeg.exe`)
- `tmpdir` via Node `os.tmpdir()` — works on both
- `yt-dlp`: prefer `yt-dlp-exec` npm package (bundles binary). Fallback: probe `where yt-dlp` (Windows) / `which yt-dlp` (Unix) and surface install instructions if missing
- Tested on Windows 11 (primary) and macOS via Sebas before global registration

### Global Registration

- Add to Santiago's `~/.claude.json` and Sebas's equivalent under `mcpServers`:
  ```json
  "video-vision": {
    "command": "node",
    "args": ["C:\\Users\\sanal\\dev\\iago-os\\mcp-servers\\video-vision\\dist\\index.js"]
  }
  ```
- Build step: `tsc --outDir dist`. No bundler needed (server runs in Node, deps are CommonJS-compatible via Node's ESM/CJS interop).

## Delivery Path

**4 weeks max, 4 phases.** Each phase ends with a working artifact and unit tests passing.

### Phase 1 — Core MCP for local files (Week 1)

- Scaffold `mcp-servers/video-vision/` with package.json, tsconfig, biome
- Implement `lib/ffmpeg.ts` using `ffmpeg-static` (probe + extract frames)
- Implement `lib/vision.ts` (Anthropic vision call with base64 frames)
- Implement `lib/cost.ts` (token + dollar math)
- Implement `lib/errors.ts` (error taxonomy)
- Wire `tools/analyze-video.ts` for **local file paths only** (no YouTube yet)
- Vitest unit tests for cost.ts and errors.ts
- Manual smoke test: analyze a local mp4 from Santiago's machine

**Deliverable:** Working MCP that analyzes local video files, registered in Santiago's `~/.claude.json`.

### Phase 2 — YouTube routing (Week 2)

- Implement `lib/youtube-captions.ts` — InnerTube caption fetch (port from existing `mcp-servers/youtube-transcript` if Python, or shell-out via subprocess)
- Implement `lib/yt-dlp.ts` — wrap `yt-dlp-exec` for download, with PATH fallback
- Wire internal routing in `tools/analyze-video.ts` — captions-first → vision-fallback
- Add `allow_youtube_download` option (default true)
- Integration tests (skipped in CI without API key + network): real YouTube URL with captions, real YouTube URL without captions, local file

**Deliverable:** End-to-end YouTube + local file support. Smoke test against 3 real videos (one with captions, one without, one local).

### Phase 3 — Cost guardrails + JSON output (Week 3)

- Implement `tools/estimate-video-cost.ts` (dry-run, no LLM call)
- Add pre-flight warning when frames > 30 (returned in result, not blocking)
- Hard cap at 100 frames enforced in zod schema + frame extractor
- Add `format: "json"` output path
- Update README with cost examples and usage patterns
- Cross-platform test on Sebas's Mac

**Deliverable:** Cost transparency end-to-end. Sebas can run the tool on macOS without changes.

### Phase 4 — Polish + global rollout (Week 4)

- Tighten error messages with install instructions for missing yt-dlp
- Add tmpdir cleanup verification (test crash mid-extraction, ensure cleanup)
- Retry logic for `429` / `529` with backoff
- Coverage report: target 80% on lib/, 60% on tools/ (skip transports)
- Document tool contract in README with worked examples
- Register globally in both Santiago's and Sebas's `~/.claude.json`
- Add to MEMORY.md as a project memory entry under `project_youtube_transcript_mcp.md` companion

**Deliverable:** Production-ready, tested, documented, globally available.

## Open Questions

1. **YouTube captions implementation choice (Phase 2):** Port the InnerTube call to Node natively, or shell out to the existing Python `youtube-transcript` MCP via subprocess? Port is cleaner; shell-out reuses tested code. **Lean: native Node port** (~50 LOC, removes Python runtime dependency for video-vision).

2. **yt-dlp packaging:** `yt-dlp-exec` npm package bundles the binary (~6MB) — is that acceptable footprint? Alternative is `npx yt-dlp-exec` on first run (slower first call, no permanent disk cost). **Lean: bundle.**

3. **Should v0.1 expose `model` selection at all, or hardcode Sonnet 4.6?** Exposing it now means we need a price table to maintain. Hiding it simplifies the contract. **Lean: hardcode Sonnet 4.6 in v0.1, expose in v0.2 if needed.**

4. **Token estimate accuracy:** The `width × height / 750` formula is the documented Anthropic ratio but actual tokens vary. Should we calibrate against real responses post-Phase 1? **Lean: yes, log actual vs estimated for first week of usage and adjust constant.**

These are pre-planning gray areas — none block the spec from going to /iago-plan, but flag them for council review.

---

**Next:** Run `/council` on this spec to stress-test the architecture choices, then `/iago-plan --feature docs/specs/video-vision-mcp.md` to break into implementation tasks.
