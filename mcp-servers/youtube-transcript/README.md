# mcp-youtube-transcript

MCP server that extracts YouTube transcripts via `youtube-transcript-api`. Drop-in replacement for MarkItDown's broken YouTube handler.

## Install

```bash
pip install -e ~/dev/iago-os/mcp-servers/youtube-transcript
```

## Tool

```
transcribe_video(url: str, language: str = "en", include_timestamps: bool = True) -> str
```

Returns a markdown transcript. When `include_timestamps=True`, each cue is emitted as `[HH:MM:SS] text`; when `False`, cues are merged into paragraphs of ≤500 characters separated by blank lines.

### URL forms supported

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`

### Language fallback

Requested language resolves through `[lang, lang-US, lang-GB, a.lang]` (auto-generated) before raising `LanguageNotFoundError`.

## Error taxonomy

All errors inherit from `TranscriptError`.

| Exception | Meaning |
|---|---|
| `InvalidURLError` | URL does not match a recognized YouTube video form |
| `TranscriptsDisabledError` | Creator has disabled captions for the video |
| `VideoUnavailableError` | Private, removed, or region-locked video |
| `LanguageNotFoundError` | No transcript available in the requested language (includes list of available langs in message) |

## MCP registration

Registered in `~/.claude.json` under `mcpServers` using the `python -m` pattern:

```json
"youtube-transcript": {
  "type": "stdio",
  "command": "python",
  "args": ["-m", "mcp_youtube_transcript"],
  "env": {}
}
```

## v0.1.0 limitations / v0.2 roadmap

- No Whisper fallback — videos with captions disabled raise `TranscriptsDisabledError`. If demand proves real, v0.2 will add Whisper with a pre-warmed model to avoid first-run download timeouts.
- No support for private, members-only, or age-gated videos (requires cookies).
- No translation. Input language = output language.
- No caching or batch/channel-wide fetching.
