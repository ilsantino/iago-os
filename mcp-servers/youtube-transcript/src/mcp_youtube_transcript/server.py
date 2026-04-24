from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .transcript import (
    InvalidURLError,
    LanguageNotFoundError,
    TranscriptBackendError,
    TranscriptsDisabledError,
    VideoUnavailableError,
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
    try:
        video_id = extract_video_id(url)
    except InvalidURLError as exc:
        raise InvalidURLError(f"InvalidURLError: {exc}") from exc

    try:
        cues = fetch_transcript(video_id, language)
    except TranscriptsDisabledError as exc:
        raise TranscriptsDisabledError(
            f"TranscriptsDisabledError: Video {video_id} has captions disabled by the creator"
        ) from exc
    except VideoUnavailableError as exc:
        raise VideoUnavailableError(
            f"VideoUnavailableError: Video {video_id} is unavailable (private, removed, or region-locked)"
        ) from exc
    except LanguageNotFoundError as exc:
        raise LanguageNotFoundError(f"LanguageNotFoundError: {exc}") from exc
    except TranscriptBackendError as exc:
        raise TranscriptBackendError(f"TranscriptBackendError: {exc}") from exc

    return cues_to_markdown(cues, include_timestamps)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
