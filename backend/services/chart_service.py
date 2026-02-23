"""
Chart generation service.

Converts AudioAnalysis + Segment into ChartData containing Easy and Hard charts.

Easy chart:
  - Note placement: beat positions (quarter notes)
  - Density: 40–80 notes/min cap; floor filled from onsets if too sparse
  - Min gap: 100 ms between notes

Hard chart:
  - Note placement: beats + onsets snapped to nearest 16th-note grid
  - Density: 120–250 notes/min; floor filled from beats if too sparse
  - Min gap: 80 ms between notes
  - Jumps (two-arrow chords) on strong downbeats every ~4 bars

Arrow assignment:
  - Alternates left foot (down/left) and right foot (up/right)
  - On-beat notes prefer center columns (down, up)
  - Off-beat notes prefer side columns (left, right)
  - Avoids consecutive identical directions where possible
"""

from __future__ import annotations

import asyncio
from functools import partial
from typing import Optional

import numpy as np

from models.chart import ChartData, Chart, Note
from services.librosa_service import AudioAnalysis
from services.segment_service import Segment


# ── Density targets ────────────────────────────────────────────────────────────

EASY_MIN_NPM = 40     # notes per minute floor
EASY_MAX_NPM = 80     # notes per minute cap

HARD_MIN_NPM = 120    # notes per minute floor
HARD_MAX_NPM = 250    # notes per minute cap

# ── Timing ─────────────────────────────────────────────────────────────────────

MIN_GAP_EASY = 0.10   # 100 ms — minimum gap between consecutive easy notes
MIN_GAP_HARD = 0.08   # 80 ms  — minimum gap between consecutive hard notes

# Fraction of beat interval within which a note is considered "on-beat"
ON_BEAT_TOLERANCE = 0.15

# ── Arrow patterns ─────────────────────────────────────────────────────────────

# FOOT_DIRS[foot] = (on-beat direction, off-beat direction)
# foot 0 = left foot  → plays Down (on beat) and Left (off beat)
# foot 1 = right foot → plays Up (on beat) and Right (off beat)
FOOT_DIRS = [
    ("down", "left"),
    ("up",   "right"),
]

# Two-arrow jump pairs (Hard only).
JUMP_PAIRS = [
    ["left",  "down"],
    ["up",    "right"],
    ["down",  "up"],
]

# Jumps every N beats (4 bars × 4 beats/bar = every 16 beats).
BEATS_PER_JUMP = 16


# ── Helpers ────────────────────────────────────────────────────────────────────

def _filter_min_gap(times: list[float], min_gap: float) -> list[float]:
    """
    Remove notes that are closer than min_gap seconds to the previous note.
    Preserves the first note of each cluster.
    """
    if not times:
        return []
    out = [times[0]]
    for t in times[1:]:
        if t - out[-1] >= min_gap - 1e-9:
            out.append(t)
    return out


def _apply_density_cap(
    times: list[float], max_npm: float, duration: float
) -> list[float]:
    """
    Uniformly downsample note times so density does not exceed max_npm notes/min.
    Uses linspace-based sampling to preserve rhythmic spread.
    """
    if not times or duration <= 0:
        return times
    current_npm = len(times) / duration * 60.0
    if current_npm <= max_npm:
        return times
    target = max(1, int(max_npm * duration / 60.0))
    indices = np.linspace(0, len(times) - 1, target).round().astype(int)
    seen: set[int] = set()
    out: list[float] = []
    for i in indices:
        if i not in seen:
            seen.add(i)
            out.append(times[i])
    return out


def _apply_density_floor(
    times: list[float],
    min_npm: float,
    fill_candidates: list[float],
    duration: float,
) -> list[float]:
    """
    If density is below min_npm, merge in fill_candidates (which are not already
    present) to bring density up.
    """
    if duration <= 0:
        return times
    current_npm = len(times) / duration * 60.0 if times else 0.0
    if current_npm >= min_npm:
        return times
    existing = {round(t, 3) for t in times}
    extras = [t for t in fill_candidates if round(t, 3) not in existing]
    return sorted(times + extras)


def _snap_to_16th_grid(
    onset_times: list[float],
    beat_times: list[float],
    bpm: float,
) -> list[float]:
    """
    Quantise onset times to the nearest 16th-note grid position anchored at
    beat boundaries.  Returns a deduplicated sorted list.
    """
    if not beat_times or not onset_times:
        return list(onset_times)
    beat_arr = np.array(beat_times, dtype=float)
    sixteenth = 60.0 / bpm / 4.0  # seconds per 16th note
    snapped: list[float] = []
    for t in onset_times:
        nearest_idx = int(np.argmin(np.abs(beat_arr - t)))
        nearest_beat = beat_times[nearest_idx]
        steps = round((t - nearest_beat) / sixteenth)
        snapped.append(round(nearest_beat + steps * sixteenth, 4))
    return sorted(set(snapped))


def _find_jump_times(rel_beats: list[float], bpm: float) -> set[float]:
    """
    Return segment-relative beat times that should host jump notes.
    Jumps land every BEATS_PER_JUMP beats, skipping the very first beat so
    the song has time to establish itself.
    """
    jumps: set[float] = set()
    for i, beat in enumerate(rel_beats):
        if i > 0 and i % BEATS_PER_JUMP == 0:
            jumps.add(round(beat, 3))
    return jumps


def _pick_jump_pair(jump_index: int, last_dir: Optional[str]) -> list[str]:
    """
    Rotate through JUMP_PAIRS avoiding the pair that shares a direction with
    the most recent single note.
    """
    for offset in range(len(JUMP_PAIRS)):
        pair = JUMP_PAIRS[(jump_index + offset) % len(JUMP_PAIRS)]
        if last_dir not in pair:
            return list(pair)
    # Fallback: return without conflict avoidance
    return list(JUMP_PAIRS[jump_index % len(JUMP_PAIRS)])


def _assign_directions(
    times: list[float],
    rel_beats: list[float],
    bpm: float,
    jump_times: Optional[set[float]] = None,
) -> list[Note]:
    """
    Assign a direction (or direction list for jumps) to each note time.

    Rules:
    - Alternate left foot / right foot on single-arrow notes.
    - On-beat notes get the preferred center column for that foot (down/up).
    - Off-beat notes get the side column (left/right).
    - If the preferred direction equals the last direction, swap to the alternate.
    - Jump notes (two-arrow chords) don't advance the foot counter.
    """
    if not times:
        return []

    beat_interval = 60.0 / bpm
    threshold = beat_interval * ON_BEAT_TOLERANCE

    def is_on_beat(t: float) -> bool:
        return any(abs(t - b) <= threshold for b in rel_beats)

    notes: list[Note] = []
    foot = 0
    last_dir: Optional[str] = None
    jump_count = 0

    for t in times:
        t_key = round(t, 3)

        # ── Jump note ──────────────────────────────────────────────────────────
        if jump_times and t_key in jump_times:
            pair = _pick_jump_pair(jump_count, last_dir)
            notes.append(Note(time=t, direction=pair))  # type: ignore[arg-type]
            last_dir = pair[-1]
            jump_count += 1
            # Jumps are two-footed; foot counter does not advance.
            continue

        # ── Single-arrow note ──────────────────────────────────────────────────
        on_beat_dir, off_beat_dir = FOOT_DIRS[foot]
        direction = on_beat_dir if is_on_beat(t) else off_beat_dir

        # Avoid repeating the same direction twice in a row.
        if direction == last_dir:
            direction = off_beat_dir if direction == on_beat_dir else on_beat_dir

        notes.append(Note(time=t, direction=direction))
        last_dir = direction
        foot = 1 - foot  # alternate

    return notes


# ── Core generation ────────────────────────────────────────────────────────────

def _generate_sync(
    analysis: AudioAnalysis,
    segment: Segment,
    title: str,
    artist: str,
    audio_url: str,
    video_id: str = "",
) -> ChartData:
    """
    Synchronous chart generation — intended to run in a thread pool.

    1. Normalise all times to segment-relative (0 = segment start).
    2. Build Easy chart from beat positions.
    3. Build Hard chart from beats + 16th-snapped onsets + jumps.
    4. Apply density caps/floors and min-gap filtering to both.
    5. Assign arrow directions.
    """
    bpm = analysis.bpm
    seg_start = segment.start
    seg_end = segment.end
    seg_duration = segment.duration

    # Segment-relative beat and onset times (sort, deduplicate).
    rel_beats = sorted({
        round(b - seg_start, 4)
        for b in analysis.beat_times
        if seg_start <= b <= seg_end
    })
    rel_onsets = sorted({
        round(o - seg_start, 4)
        for o in analysis.onset_times
        if seg_start <= o <= seg_end
    })

    # ── Easy chart ─────────────────────────────────────────────────────────────
    easy_times = list(rel_beats)
    easy_times = _filter_min_gap(easy_times, MIN_GAP_EASY)
    easy_times = _apply_density_cap(easy_times, EASY_MAX_NPM, seg_duration)
    easy_times = _apply_density_floor(easy_times, EASY_MIN_NPM, rel_beats, seg_duration)
    easy_times = _filter_min_gap(easy_times, MIN_GAP_EASY)  # re-filter after additions

    easy_notes = _assign_directions(easy_times, rel_beats, bpm)

    # ── Hard chart ─────────────────────────────────────────────────────────────
    # Merge beats with 16th-quantised onsets, then shape density.
    snapped_onsets = _snap_to_16th_grid(rel_onsets, rel_beats, bpm)
    hard_candidates = sorted(set(rel_beats + snapped_onsets))
    hard_times = _filter_min_gap(hard_candidates, MIN_GAP_HARD)
    hard_times = _apply_density_cap(hard_times, HARD_MAX_NPM, seg_duration)
    hard_times = _apply_density_floor(hard_times, HARD_MIN_NPM, rel_beats, seg_duration)
    hard_times = _filter_min_gap(hard_times, MIN_GAP_HARD)  # re-filter after additions

    # Jumps only at beat positions that survived into hard_times.
    jump_times = _find_jump_times(rel_beats, bpm)
    hard_time_keys = {round(t, 3) for t in hard_times}
    active_jumps = jump_times & hard_time_keys

    hard_notes = _assign_directions(hard_times, rel_beats, bpm, jump_times=active_jumps)

    # ── Assemble ChartData ─────────────────────────────────────────────────────
    easy_chart = Chart(
        difficulty="easy",
        notes=easy_notes,
        note_count=len(easy_notes),
    )
    hard_chart = Chart(
        difficulty="hard",
        notes=hard_notes,
        note_count=len(hard_notes),
    )

    return ChartData(
        title=title,
        artist=artist,
        bpm=round(bpm, 2),
        duration=round(seg_duration, 2),
        segment_start=round(seg_start, 2),
        audio_url=audio_url,
        source="youtube" if video_id else "local",
        video_id=video_id,
        charts={"easy": easy_chart, "hard": hard_chart},
    )


# ── Public async API ───────────────────────────────────────────────────────────

async def generate(
    analysis: AudioAnalysis,
    segment: Segment,
    title: str = "",
    artist: str = "",
    audio_url: str = "",
    video_id: str = "",
) -> ChartData:
    """
    Async entry point: generates Easy + Hard charts from audio analysis.

    Runs the CPU-bound work in the default thread pool so the FastAPI event
    loop is not blocked.

    Args:
        analysis:  AudioAnalysis returned by librosa_service.analyze().
        segment:   Segment returned by segment_service.select_best_segment().
        title:     Song title (propagated from yt-dlp metadata).
        artist:    Artist name (propagated from yt-dlp metadata).
        audio_url: Audio URL for the frontend (empty string for custom songs).
        video_id:  YouTube video ID; sets source='youtube' in ChartData.

    Returns:
        ChartData with both "easy" and "hard" Chart entries.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        partial(_generate_sync, analysis, segment, title, artist, audio_url, video_id),
    )


# ── Error type ─────────────────────────────────────────────────────────────────

class ChartGenerationError(Exception):
    """Raised when chart generation fails unexpectedly."""
