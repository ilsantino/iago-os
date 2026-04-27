from __future__ import annotations

import html
import re
from urllib.parse import parse_qs, urlparse


class TranscriptError(Exception):
    """Base class for all transcript module errors."""


class InvalidURLError(TranscriptError):
    """URL does not match a recognized YouTube video form."""


class TranscriptsDisabledError(TranscriptError):
    """Creator has disabled captions for the video."""


class VideoUnavailableError(TranscriptError):
    """Video is private, removed, age-gated, or region-locked."""


class LanguageNotFoundError(TranscriptError):
    """Requested language is not available for the video."""


class TranscriptBackendError(TranscriptError):
    """Upstream transcript service failed (transport, rate-limit, library skew)."""


_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_XML_TAG_RE = re.compile(r"<[^>]+>")

_YOUTUBE_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    }
)


def extract_video_id(url: str) -> str:
    """Extract the 11-char YouTube video id from a URL.

    Supports watch?v=, youtu.be/, shorts/, embed/ forms.
    """
    if not isinstance(url, str) or not url.strip():
        raise InvalidURLError(f"not a YouTube URL: {url!r}")

    try:
        parsed = urlparse(url.strip())
    except ValueError as exc:
        raise InvalidURLError(f"cannot parse URL {url!r}: {exc}") from exc

    host = (parsed.hostname or "").lower()
    path = parsed.path or ""

    candidate: str | None = None

    is_youtu_be = host == "youtu.be"
    is_youtube_host = host in _YOUTUBE_HOSTS or host.endswith(
        (".youtube.com", ".youtube-nocookie.com")
    )

    if is_youtu_be:
        candidate = path.lstrip("/").split("/", 1)[0]
    elif is_youtube_host:
        if path == "/watch" or path.startswith("/watch/"):
            qs = parse_qs(parsed.query)
            values = qs.get("v")
            if values:
                candidate = values[0]
        else:
            for prefix in ("/shorts/", "/embed/", "/v/", "/live/"):
                if path.startswith(prefix):
                    candidate = path[len(prefix):].split("/", 1)[0]
                    break

    if not candidate or not _VIDEO_ID_RE.match(candidate):
        raise InvalidURLError(f"not a YouTube URL: {url!r}")

    return candidate


def fetch_transcript(video_id: str, language: str) -> list[dict]:
    """Fetch transcript cues for a video in the requested language.

    Tries the requested language, then region variants, then auto-generated.
    Maps youtube-transcript-api exceptions to this module's taxonomy.
    """
    from youtube_transcript_api import (  # type: ignore[import-not-found]
        YouTubeTranscriptApi,
    )
    from youtube_transcript_api._errors import (  # type: ignore[import-not-found]
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
    )

    language = language.strip().lower()
    language_chain = [
        language,
        f"{language}-US",
        f"{language}-GB",
        f"a.{language}",
    ]

    api = YouTubeTranscriptApi()

    try:
        transcript_list = api.list(video_id)
    except TranscriptsDisabled as exc:
        raise TranscriptsDisabledError(
            f"Video {video_id} has captions disabled by the creator"
        ) from exc
    except VideoUnavailable as exc:
        raise VideoUnavailableError(
            f"Video {video_id} is unavailable (private, removed, or region-locked)"
        ) from exc
    except TranscriptError:
        raise
    except Exception as exc:  # rate-limit, transport, library skew, etc.
        raise TranscriptBackendError(
            f"Upstream transcript service failed for {video_id} "
            f"({type(exc).__name__}): {exc}"
        ) from exc

    try:
        transcript = transcript_list.find_transcript(language_chain)
    except NoTranscriptFound as exc:
        available = []
        try:
            for t in transcript_list:
                code = getattr(t, "language_code", None)
                if code:
                    available.append(code)
        except Exception:
            pass
        raise LanguageNotFoundError(
            f"No transcript for language {language!r} (tried {language_chain}). "
            f"Available: {sorted(set(available))}"
        ) from exc
    except TranscriptError:
        raise
    except Exception as exc:
        raise TranscriptBackendError(
            f"Failed to resolve transcript language for {video_id} "
            f"({type(exc).__name__}): {exc}"
        ) from exc

    try:
        fetched = transcript.fetch()
    except TranscriptsDisabled as exc:
        raise TranscriptsDisabledError(
            f"Video {video_id} has captions disabled by the creator"
        ) from exc
    except VideoUnavailable as exc:
        raise VideoUnavailableError(
            f"Video {video_id} is unavailable (private, removed, or region-locked)"
        ) from exc
    except TranscriptError:
        raise
    except Exception as exc:  # transport failure mid-fetch, XML parse, etc.
        raise TranscriptBackendError(
            f"Upstream transcript fetch failed for {video_id} "
            f"({type(exc).__name__}): {exc}"
        ) from exc

    # v1.2+: iterating FetchedTranscript yields FetchedTranscriptSnippet with
    # attributes (text, start, duration). Older versions return list[dict].
    normalized: list[dict] = []
    for cue in fetched:
        if isinstance(cue, dict):
            normalized.append(
                {
                    "text": cue.get("text", ""),
                    "start": float(cue.get("start", 0.0)),
                    "duration": float(cue.get("duration", 0.0)),
                }
            )
        else:
            normalized.append(
                {
                    "text": getattr(cue, "text", ""),
                    "start": float(getattr(cue, "start", 0.0)),
                    "duration": float(getattr(cue, "duration", 0.0)),
                }
            )
    return normalized


def _format_timestamp(seconds: float) -> str:
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _clean_text(text: str) -> str:
    return html.unescape(_XML_TAG_RE.sub("", text or "")).strip()


def cues_to_markdown(cues: list[dict], include_timestamps: bool) -> str:
    """Convert cues to markdown.

    With timestamps: one line per cue as `[HH:MM:SS] text`.
    Without: merged into paragraphs of <=500 chars separated by blank lines.
    """
    if not cues:
        return ""

    if include_timestamps:
        lines = []
        for cue in cues:
            text = _clean_text(cue.get("text", ""))
            if not text:
                continue
            lines.append(f"[{_format_timestamp(float(cue.get('start', 0.0)))}] {text}")
        return "\n".join(lines)

    paragraphs: list[str] = []
    current = ""
    for cue in cues:
        text = _clean_text(cue.get("text", ""))
        if not text:
            continue
        candidate = f"{current} {text}".strip() if current else text
        if len(candidate) > 500 and current:
            paragraphs.append(current)
            current = text
        else:
            current = candidate
    if current:
        paragraphs.append(current)
    return "\n\n".join(paragraphs)
