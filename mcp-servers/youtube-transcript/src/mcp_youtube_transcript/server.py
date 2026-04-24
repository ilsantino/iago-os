from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .transcript import (
    cues_to_markdown,
    extract_video_id,
    fetch_transcript,
)

mcp = FastMCP("youtube-transcript")


@mcp.tool()
def transcribe_video(
    url: str,
    language: str = "en",
    include_timestamps: bool = True,
) -> str:
    """Fetch the transcript for a YouTube video as markdown.

    Args:
        url: YouTube video URL (watch, youtu.be, shorts, or embed form).
        language: ISO language code (default "en"). Falls back through
            lang -> lang-US -> lang-GB -> a.lang (auto-generated).
        include_timestamps: When True, one cue per line as `[HH:MM:SS] text`.
            When False, cues merged into paragraphs of <=500 chars.

    Returns:
        Markdown transcript string.

    Raises:
        InvalidURLError: URL is not a recognized YouTube video form.
        TranscriptsDisabledError: Captions disabled by creator.
        VideoUnavailableError: Video is private, removed, or region-locked.
        LanguageNotFoundError: No transcript in requested language.
        TranscriptBackendError: Upstream service failure (rate-limit, transport,
            library skew). Retryable in general — distinct from user-input errors.
    """
    video_id = extract_video_id(url)
    cues = fetch_transcript(video_id, language)
    return cues_to_markdown(cues, include_timestamps)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
