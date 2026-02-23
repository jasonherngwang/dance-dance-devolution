"""
librosa audio analysis service.

Loads a WAV file (22050 Hz mono) and extracts:
  - BPM (tempo estimation)
  - Beat frame positions → times in seconds
  - Onset times in seconds
  - RMS energy curve (times + values)
  - Audio duration

All CPU-intensive calls run in a thread pool to avoid blocking the async event loop.
"""

import asyncio
from dataclasses import dataclass, field
from functools import partial

import librosa
import numpy as np


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class AudioAnalysis:
    """Structured result returned by analyze()."""
    bpm: float
    beat_times: list[float]    # seconds — beat positions
    onset_times: list[float]   # seconds — note onset candidates
    rms_times: list[float]     # seconds — RMS frame centres
    rms_values: list[float]    # normalised RMS energy [0, 1]
    duration: float            # total audio length in seconds
    sample_rate: int           # Hz (should always be 22050)


# ── Core (synchronous) implementation ────────────────────────────────────────

def _analyze_sync(audio_path: str) -> AudioAnalysis:
    """
    Blocking analysis — intended to be run in a thread executor.

    Steps:
      1. Load WAV at 22050 Hz mono (librosa resamples if needed)
      2. Detect BPM + beat frames via librosa.beat.beat_track
      3. Detect onsets via librosa.onset.onset_detect
      4. Compute frame-level RMS energy and normalise
    """
    # 1. Load audio ──────────────────────────────────────────────────────────
    sr = 22050
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    # 2. Tempo + beats ───────────────────────────────────────────────────────
    # beat_track returns (tempo_scalar, beat_frame_indices)
    # Use a smaller hop_length for tighter beat alignment.
    hop_length = 512
    tempo_arr, beat_frames = librosa.beat.beat_track(
        y=y, sr=sr, hop_length=hop_length, units="frames"
    )
    # librosa ≥0.10 may return a 1-element array for tempo
    bpm = float(np.atleast_1d(tempo_arr)[0])
    beat_times = librosa.frames_to_time(
        beat_frames, sr=sr, hop_length=hop_length
    ).tolist()

    # 3. Onsets ──────────────────────────────────────────────────────────────
    onset_frames = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=hop_length, units="frames"
    )
    onset_times = librosa.frames_to_time(
        onset_frames, sr=sr, hop_length=hop_length
    ).tolist()

    # 4. RMS energy curve ────────────────────────────────────────────────────
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]  # shape (n_frames,)
    rms_frame_indices = np.arange(len(rms))
    rms_times_arr = librosa.frames_to_time(
        rms_frame_indices, sr=sr, hop_length=hop_length
    )

    # Normalise to [0, 1] to make downstream comparisons scale-independent.
    rms_max = float(rms.max()) or 1.0  # guard against silent audio
    rms_normalised = (rms / rms_max).tolist()

    return AudioAnalysis(
        bpm=bpm,
        beat_times=[round(t, 4) for t in beat_times],
        onset_times=[round(t, 4) for t in onset_times],
        rms_times=[round(t, 4) for t in rms_times_arr.tolist()],
        rms_values=[round(v, 6) for v in rms_normalised],
        duration=round(duration, 4),
        sample_rate=sr,
    )


# ── Async wrapper ─────────────────────────────────────────────────────────────

async def analyze(audio_path: str) -> AudioAnalysis:
    """
    Async entry point: runs librosa analysis in the default thread pool
    so the FastAPI event loop remains unblocked.

    Raises:
        AnalysisError: if librosa fails to load or process the file.
    """
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            None, partial(_analyze_sync, audio_path)
        )
    except Exception as exc:
        raise AnalysisError(f"Audio analysis failed: {exc}") from exc
    return result


# ── Error type ────────────────────────────────────────────────────────────────

class AnalysisError(Exception):
    """Raised when librosa fails to analyse the audio file."""
