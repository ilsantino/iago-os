from __future__ import annotations

import sys
import types

import pytest

from mcp_youtube_transcript.transcript import (
    InvalidURLError,
    LanguageNotFoundError,
    TranscriptBackendError,
    TranscriptsDisabledError,
    VideoUnavailableError,
    cues_to_markdown,
    extract_video_id,
    fetch_transcript,
)


class _FakeTranscriptsDisabled(Exception):
    pass


class _FakeVideoUnavailable(Exception):
    pass


class _FakeNoTranscriptFound(Exception):
    pass


class TestExtractVideoId:
    def test_watch_url(self) -> None:
        assert (
            extract_video_id("https://www.youtube.com/watch?v=vyN7ITKcGXU")
            == "vyN7ITKcGXU"
        )

    def test_youtu_be_short_url(self) -> None:
        assert extract_video_id("https://youtu.be/vyN7ITKcGXU") == "vyN7ITKcGXU"

    def test_youtu_be_with_query(self) -> None:
        assert (
            extract_video_id("https://youtu.be/vyN7ITKcGXU?si=abc123")
            == "vyN7ITKcGXU"
        )

    def test_shorts_url(self) -> None:
        assert (
            extract_video_id("https://www.youtube.com/shorts/vyN7ITKcGXU")
            == "vyN7ITKcGXU"
        )

    def test_embed_url(self) -> None:
        assert (
            extract_video_id("https://www.youtube.com/embed/vyN7ITKcGXU")
            == "vyN7ITKcGXU"
        )

    def test_watch_url_with_extra_params(self) -> None:
        assert (
            extract_video_id(
                "https://www.youtube.com/watch?v=vyN7ITKcGXU&t=30s&feature=share"
            )
            == "vyN7ITKcGXU"
        )

    def test_invalid_string_raises(self) -> None:
        with pytest.raises(InvalidURLError):
            extract_video_id("not a url")

    def test_empty_string_raises(self) -> None:
        with pytest.raises(InvalidURLError):
            extract_video_id("")

    def test_non_youtube_host_raises(self) -> None:
        with pytest.raises(InvalidURLError):
            extract_video_id("https://vimeo.com/12345")

    @pytest.mark.parametrize(
        "url",
        [
            "https://notyoutube.com/watch?v=vyN7ITKcGXU",
            "https://evil-youtu.be/vyN7ITKcGXU",
            "https://youtube.com.attacker.example/watch?v=vyN7ITKcGXU",
            "https://fakeyoutube.com/watch?v=vyN7ITKcGXU",
            "https://youtube-nocookie.com.evil.test/embed/vyN7ITKcGXU",
            "https://myyoutu.be/vyN7ITKcGXU",
        ],
    )
    def test_lookalike_host_rejected(self, url: str) -> None:
        with pytest.raises(InvalidURLError):
            extract_video_id(url)

    def test_m_subdomain_accepted(self) -> None:
        assert (
            extract_video_id("https://m.youtube.com/watch?v=vyN7ITKcGXU")
            == "vyN7ITKcGXU"
        )

    def test_music_subdomain_accepted(self) -> None:
        assert (
            extract_video_id("https://music.youtube.com/watch?v=vyN7ITKcGXU")
            == "vyN7ITKcGXU"
        )

    def test_nocookie_embed_accepted(self) -> None:
        assert (
            extract_video_id("https://www.youtube-nocookie.com/embed/vyN7ITKcGXU")
            == "vyN7ITKcGXU"
        )


class TestCuesToMarkdown:
    def test_with_timestamps(self) -> None:
        cues = [
            {"text": "hello", "start": 1.0, "duration": 2.0},
            {"text": "world", "start": 3.5, "duration": 2.0},
        ]
        result = cues_to_markdown(cues, include_timestamps=True)
        assert result == "[00:00:01] hello\n[00:00:03] world"

    def test_without_timestamps_merges(self) -> None:
        cues = [
            {"text": "hello", "start": 1.0, "duration": 2.0},
            {"text": "world", "start": 3.5, "duration": 2.0},
        ]
        result = cues_to_markdown(cues, include_timestamps=False)
        assert result == "hello world"

    def test_empty_cues_returns_empty_string(self) -> None:
        assert cues_to_markdown([], include_timestamps=True) == ""
        assert cues_to_markdown([], include_timestamps=False) == ""

    def test_html_entity_stripping(self) -> None:
        cues = [{"text": "Tom &amp; Jerry", "start": 0.0, "duration": 1.0}]
        assert cues_to_markdown(cues, include_timestamps=True) == "[00:00:00] Tom & Jerry"

    def test_xml_tag_stripping(self) -> None:
        cues = [{"text": "<c>hello</c> <b>world</b>", "start": 0.0, "duration": 1.0}]
        assert cues_to_markdown(cues, include_timestamps=True) == "[00:00:00] hello world"

    def test_hour_timestamp_format(self) -> None:
        cues = [{"text": "much later", "start": 3725.0, "duration": 1.0}]
        assert cues_to_markdown(cues, include_timestamps=True) == "[01:02:05] much later"

    def test_paragraph_break_at_500_chars(self) -> None:
        long_text = "a" * 400
        cues = [
            {"text": long_text, "start": 0.0, "duration": 1.0},
            {"text": long_text, "start": 1.0, "duration": 1.0},
            {"text": "end", "start": 2.0, "duration": 1.0},
        ]
        result = cues_to_markdown(cues, include_timestamps=False)
        assert "\n\n" in result

    def test_skips_empty_cues(self) -> None:
        cues = [
            {"text": "hello", "start": 0.0, "duration": 1.0},
            {"text": "", "start": 1.0, "duration": 1.0},
            {"text": "world", "start": 2.0, "duration": 1.0},
        ]
        result = cues_to_markdown(cues, include_timestamps=True)
        assert result == "[00:00:00] hello\n[00:00:02] world"


def _install_fake_youtube_transcript_api(
    monkeypatch: pytest.MonkeyPatch,
    *,
    list_raises: BaseException | None = None,
    fetch_raises: BaseException | None = None,
    find_transcript_raises: BaseException | None = None,
) -> None:
    """Stub the youtube_transcript_api package so fetch_transcript can be unit-tested
    without any network access.
    """

    class _FakeTranscript:
        language_code = "en"

        def fetch(self):
            if fetch_raises is not None:
                raise fetch_raises
            return [{"text": "hi", "start": 0.0, "duration": 1.0}]

    class _FakeTranscriptList:
        def __iter__(self):
            return iter([_FakeTranscript()])

        def find_transcript(self, _languages):
            if find_transcript_raises is not None:
                raise find_transcript_raises
            return _FakeTranscript()

    class _FakeApi:
        def list(self, _video_id):
            if list_raises is not None:
                raise list_raises
            return _FakeTranscriptList()

    pkg = types.ModuleType("youtube_transcript_api")
    pkg.YouTubeTranscriptApi = _FakeApi
    errors = types.ModuleType("youtube_transcript_api._errors")
    errors.TranscriptsDisabled = _FakeTranscriptsDisabled
    errors.VideoUnavailable = _FakeVideoUnavailable
    errors.NoTranscriptFound = _FakeNoTranscriptFound

    monkeypatch.setitem(sys.modules, "youtube_transcript_api", pkg)
    monkeypatch.setitem(sys.modules, "youtube_transcript_api._errors", errors)


class TestFetchTranscriptErrorMapping:
    """Verify unexpected backend exceptions map to TranscriptBackendError."""

    def test_list_transport_error_maps_to_backend_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_youtube_transcript_api(
            monkeypatch, list_raises=ConnectionError("socket timeout")
        )
        with pytest.raises(TranscriptBackendError) as excinfo:
            fetch_transcript("aaaaaaaaaaa", "en")
        assert "ConnectionError" in str(excinfo.value)

    def test_list_generic_error_maps_to_backend_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_youtube_transcript_api(
            monkeypatch, list_raises=RuntimeError("rate limited")
        )
        with pytest.raises(TranscriptBackendError):
            fetch_transcript("aaaaaaaaaaa", "en")

    def test_fetch_transport_error_maps_to_backend_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_youtube_transcript_api(
            monkeypatch, fetch_raises=ConnectionError("broken pipe")
        )
        with pytest.raises(TranscriptBackendError) as excinfo:
            fetch_transcript("aaaaaaaaaaa", "en")
        assert "ConnectionError" in str(excinfo.value)

    def test_happy_path_with_stub(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _install_fake_youtube_transcript_api(monkeypatch)
        cues = fetch_transcript("aaaaaaaaaaa", "en")
        assert cues == [{"text": "hi", "start": 0.0, "duration": 1.0}]

    def test_transcripts_disabled_maps_to_domain_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_youtube_transcript_api(
            monkeypatch, list_raises=_FakeTranscriptsDisabled("captions off")
        )
        with pytest.raises(TranscriptsDisabledError):
            fetch_transcript("aaaaaaaaaaa", "en")

    def test_video_unavailable_maps_to_domain_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_youtube_transcript_api(
            monkeypatch, list_raises=_FakeVideoUnavailable("video gone")
        )
        with pytest.raises(VideoUnavailableError):
            fetch_transcript("aaaaaaaaaaa", "en")

    def test_no_transcript_found_maps_to_language_not_found(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_youtube_transcript_api(
            monkeypatch, find_transcript_raises=_FakeNoTranscriptFound("no lang")
        )
        with pytest.raises(LanguageNotFoundError):
            fetch_transcript("aaaaaaaaaaa", "en")
