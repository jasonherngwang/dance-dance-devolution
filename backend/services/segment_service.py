"""
Song segment selection service.

Selects the most engaging 60-90 second portion of a song for gameplay.

- Songs ≤ 90s: use full duration (start=0)
- Longer songs: sliding window scored by onset_density × avg_energy × beat_alignment;
  segment start is then snapped to the nearest beat boundary.

All computation is CPU-bound but fast (<1s), so it runs synchronously.
No thread pool wrapper needed here (unlike librosa analysis).
"""

from dataclasses import dataclass

import numpy as np

from services.librosa_service import AudioAnalysis


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class Segment:
    """Describes a playable time window within an audio file."""
    start: float    # seconds — where playback begins
    end: float      # seconds — where playback ends
    duration: float # seconds — (end - start), always ≤ max_duration


# ── Core implementation ───────────────────────────────────────────────────────

MAX_DURATION = 90.0   # target segment length in seconds
WINDOW_STEP  = 5.0    # sliding window step in seconds


def select_best_segment(analysis: AudioAnalysis, max_duration: float = MAX_DURATION) -> Segment:
    """
    Choose the most engaging segment of a song given its audio analysis.

    Algorithm (mirrors PRD Section 6.5):
      1. Short songs (≤ max_duration): return full duration.
      2. Sliding window: for each candidate start time (step=5s) compute
             score = onset_count × avg_energy × alignment_bonus
         where alignment_bonus penalises windows that begin mid-phrase.
      3. Snap best_start to the nearest beat boundary.
      4. Return Segment(nearest_beat, nearest_beat + max_duration, max_duration).

    Args:
        analysis:     AudioAnalysis from librosa_service.analyze()
        max_duration: Maximum segment length (default 90 s).

    Returns:
        Segment with start/end/duration fields.
    """
    total_duration = analysis.duration
    beat_times = np.array(analysis.beat_times, dtype=float)
    onset_times = np.array(analysis.onset_times, dtype=float)
    rms_times = np.array(analysis.rms_times, dtype=float)
    rms_values = np.array(analysis.rms_values, dtype=float)

    # 1. Short song — use entire file ─────────────────────────────────────────
    if total_duration <= max_duration:
        return Segment(start=0.0, end=total_duration, duration=total_duration)

    # 2. Sliding window scoring ────────────────────────────────────────────────
    best_score: float = -1.0
    best_start: float = 0.0

    candidate_starts = np.arange(0.0, total_duration - max_duration + 1e-9, WINDOW_STEP)

    for start in candidate_starts:
        end = start + max_duration

        # Onset density: count onsets inside this window
        onset_count = int(np.sum((onset_times >= start) & (onset_times <= end)))

        # Average energy across window frames
        energy_mask = (rms_times >= start) & (rms_times <= end)
        avg_energy = float(np.mean(rms_values[energy_mask])) if energy_mask.any() else 0.0

        # Beat alignment bonus: prefer starts near a beat (inverse of distance)
        if len(beat_times) > 0:
            beat_dist = float(np.min(np.abs(beat_times - start)))
        else:
            beat_dist = 1.0
        alignment_bonus = 1.0 / (1.0 + beat_dist * 5.0)

        score = onset_count * avg_energy * alignment_bonus
        if score > best_score:
            best_score = score
            best_start = float(start)

    # 3. Snap best_start to nearest beat ──────────────────────────────────────
    if len(beat_times) > 0:
        nearest_idx = int(np.argmin(np.abs(beat_times - best_start)))
        snapped_start = float(beat_times[nearest_idx])
        # Guard: if snapping would push the segment past the end, stay at best_start
        if snapped_start + max_duration > total_duration:
            snapped_start = best_start
    else:
        snapped_start = best_start

    end_time = snapped_start + max_duration
    return Segment(
        start=round(snapped_start, 4),
        end=round(end_time, 4),
        duration=round(max_duration, 4),
    )
