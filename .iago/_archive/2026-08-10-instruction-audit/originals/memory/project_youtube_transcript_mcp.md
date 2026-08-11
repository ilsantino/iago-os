---
name: YouTube transcript MCP
description: Global MCP tool transcribe_video(url, language, include_timestamps) — replaces broken markitdown YouTube handler; registered in ~/.claude.json
type: reference
originSessionId: 20a576d4-ee42-4df6-aa9a-9b6a419738b8
---
Global MCP server `youtube-transcript` registered in `~/.claude.json`. Source lives in the iago-os repo at `mcp-servers/youtube-transcript/` and is versioned with the iaGO-OS toolchain.

## Tool signature

```
transcribe_video(url: str, language: str = "en", include_timestamps: bool = True) -> str
```

Returns markdown. With timestamps, one line per cue as `[HH:MM:SS] text`. Without, cues merged into paragraphs of ≤500 chars.

## URL forms supported
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`

## Error taxonomy
All inherit from `TranscriptError`:
- `InvalidURLError` — not a recognized YouTube video URL
- `TranscriptsDisabledError` — creator disabled captions
- `VideoUnavailableError` — private, removed, region-locked
- `LanguageNotFoundError` — no transcript in requested language (message lists available codes)

## Language fallback
Requested language resolves through `[lang, lang-US, lang-GB, a.lang]` (auto-generated) before raising `LanguageNotFoundError`.

## When to prefer
- **YouTube URLs** → `youtube-transcript` MCP (`transcribe_video`)
- **DOCX / PDF / XLSX / PPTX / EPub** → `markitdown` MCP (`convert_to_markdown`)

## Install path
`pip install -e C:/Users/sanal/dev/iago-os/mcp-servers/youtube-transcript`

## v0.1.0 limitations
- No Whisper fallback — caption-disabled videos raise `TranscriptsDisabledError` immediately.
- No private, members-only, or age-gated videos (requires cookies).
- No translation. Transcription only.

## v0.2 roadmap
Add Whisper fallback with a pre-warmed model so caption-disabled videos don't block. Guard timeout on first-run model download.
