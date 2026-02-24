"""
yt-dlp audio extraction service.

Extracts audio from a YouTube URL as a 22050 Hz mono WAV file, along with
video metadata (title, artist, duration, thumbnail).

Temp directories are the caller's responsibility to clean up on success;
the service cleans up on any error internally.
"""

import asyncio
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yt_dlp


class ExtractionError(Exception):
    """Raised when audio extraction or metadata fetch fails."""

    pass


# Maximum video duration accepted for chart generation.
# Long videos (podcasts, DJ sets) would consume excessive memory and CPU
# without providing any gameplay benefit — the game only plays a 60–90s segment.
MAX_SONG_DURATION_S = 600  # 10 minutes


@dataclass
class ExtractionResult:
    audio_path: Path  # WAV file at 22050 Hz mono
    video_id: str
    title: str
    artist: str
    duration: float  # total video duration in seconds
    thumbnail_url: Optional[str]
    temp_dir: Path  # caller must call cleanup_temp_dir() when done


def get_video_id(url: str) -> Optional[str]:
    """Extract the 11-character YouTube video ID from a URL, or None if not found."""
    patterns = [
        r"(?:v=)([a-zA-Z0-9_-]{11})",
        r"(?:youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"(?:embed/)([a-zA-Z0-9_-]{11})",
        r"(?:shorts/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


async def extract_audio(url: str) -> ExtractionResult:
    """
    Download audio from a YouTube URL and convert to 22050 Hz mono WAV.

    Runs the blocking yt-dlp download in a thread executor so the event loop
    stays responsive.  Raises ExtractionError on any failure.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _extract_audio_sync, url)


def _extract_audio_sync(url: str) -> ExtractionResult:
    """Synchronous core — called from a thread pool by extract_audio()."""
    temp_dir = Path(tempfile.mkdtemp(prefix="ddd_"))

    try:
        output_template = str(temp_dir / "%(id)s.%(ext)s")

        # ── Pre-flight: check duration before downloading anything ────────────
        _QUIET_OPTS = {"quiet": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(_QUIET_OPTS) as ydl_meta:
            meta = ydl_meta.extract_info(url, download=False)
        raw_duration = float(meta.get("duration") or 0)
        if raw_duration > MAX_SONG_DURATION_S:
            mins = int(raw_duration // 60)
            raise ExtractionError(
                f"Video is too long ({mins} min). Please submit a song under 10 minutes."
            )

        ydl_opts = {
            # Prefer audio-only streams; fall back to best if unavailable
            "format": "bestaudio/best",
            "outtmpl": output_template,
            "quiet": True,
            "no_warnings": True,
            # Convert to WAV after download
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "wav",
                }
            ],
            # Resample to 22050 Hz mono via the FFmpegExtractAudio postprocessor
            "postprocessor_args": {
                "extractaudio": ["-ar", "22050", "-ac", "1"],
            },
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        video_id: str = info.get("id", "")
        title: str = info.get("title") or "Unknown Title"
        # Prefer 'artist' tag (music videos), fall back to uploader / channel
        artist: str = (
            info.get("artist")
            or info.get("uploader")
            or info.get("channel")
            or "Unknown Artist"
        )
        duration: float = float(info.get("duration") or 0)
        thumbnail_url: Optional[str] = info.get("thumbnail")

        # yt-dlp renames the file to <id>.wav after postprocessing
        wav_files = list(temp_dir.glob("*.wav"))
        if not wav_files:
            raise ExtractionError(
                "WAV file not found in temp directory after extraction"
            )

        return ExtractionResult(
            audio_path=wav_files[0],
            video_id=video_id,
            title=title,
            artist=artist,
            duration=duration,
            thumbnail_url=thumbnail_url,
            temp_dir=temp_dir,
        )

    except yt_dlp.utils.DownloadError as exc:
        cleanup_temp_dir(temp_dir)
        msg = str(exc)
        if "Video unavailable" in msg or "is not available" in msg:
            raise ExtractionError(f"Video unavailable: {msg}") from exc
        if "Private video" in msg:
            raise ExtractionError("Video is private and cannot be downloaded") from exc
        if "Sign in" in msg or "age" in msg.lower():
            raise ExtractionError("Video requires sign-in or age verification") from exc
        raise ExtractionError(f"Download failed: {msg}") from exc

    except ExtractionError:
        cleanup_temp_dir(temp_dir)
        raise

    except Exception as exc:
        cleanup_temp_dir(temp_dir)
        raise ExtractionError(f"Unexpected extraction error: {exc}") from exc


def cleanup_temp_dir(temp_dir: Path) -> None:
    """Remove the temporary directory created during extraction."""
    shutil.rmtree(temp_dir, ignore_errors=True)
