"""
Chart generation service.

Converts AudioAnalysis + Segment into ChartData containing a single unified
chart, stored under both 'easy' and 'hard' keys for frontend compatibility.

Direction assignment uses pattern-rotation: short predefined sequences (4–8
notes) that use all 4 arrows are cycled through, with anti-repeat enforcement.
This ensures all 4 directions appear regardless of song tempo or onset density.

Jump placement uses periodic beats (every 2 bars) plus energy peaks detected
from the song's RMS curve.
"""

from __future__ import annotations

import asyncio
import hashlib
import random
from functools import partial
from typing import Optional

import numpy as np

from models.chart import ChartData, Chart, Note
from services.librosa_service import AudioAnalysis
from services.segment_service import Segment


# ── Direction patterns ─────────────────────────────────────────────────────────
# Each pattern is a list of directions covering all 4 arrows.
# Patterns are designed to be recognisable and hand-natural.

PATTERNS: list[list[str]] = [
    ["left", "down", "up", "right"],                                        # stair up
    ["right", "up", "down", "left"],                                        # stair down
    ["left", "up", "right", "down"],                                        # cross 1
    ["right", "down", "left", "up"],                                        # cross 2
    ["down", "left", "up", "right"],                                        # cycle A
    ["up", "right", "down", "left"],                                        # cycle B
    ["left", "right", "down", "up"],                                        # side sweep
    ["right", "left", "up", "down"],                                        # side sweep reversed
    ["left", "down", "right", "up", "right", "down", "left", "up"],        # Z-shape
    ["down", "up", "left", "right", "up", "down", "right", "left"],        # W-shape
]

# Two-arrow jump pairs — comfortable on a laptop keyboard.
# Excluded: ["down", "up"] (↑ sits directly above ↓ — awkward to press together)
JUMP_PAIRS: list[list[str]] = [
    ["left",  "down"],
    ["up",    "right"],
    ["left",  "right"],
    ["left",  "up"],
    ["down",  "right"],
]

# ── Difficulty scoring ─────────────────────────────────────────────────────────
# Chart parameters are no longer fixed — they scale with each song's auto-
# computed difficulty score (0.0–1.0), derived from BPM and onset density.

def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation: a at t=0, b at t=1."""
    return a + (b - a) * t


def compute_difficulty_score(bpm: float, onset_density: float) -> float:
    """
    Compute a 0.0–1.0 difficulty score from song characteristics.

    bpm:            Beats per minute (typically 80–200).
    onset_density:  Onsets per second within the segment (typically 1–8).

    Weights: BPM 55%, onset density 45%.
    Ranges calibrated for pop/dance music (80–180 BPM, 1.5–7 onsets/s).
    """
    bpm_score = _clamp((bpm - 90) / 110.0, 0.0, 1.0)         # 90→0, 200→1
    onset_score = _clamp((onset_density - 1.5) / 6.5, 0.0, 1.0)  # 1.5→0, 8.0→1
    return 0.70 * bpm_score + 0.30 * onset_score


def difficulty_tier(score: float) -> int:
    """Map 0.0–1.0 score to a 1–10 DDR-style foot rating."""
    return int(_clamp(round(score * 9) + 1, 1, 10))


def _chart_params(score: float) -> dict:
    """
    Interpolate chart generation parameters from difficulty score.

    Easy (score≈0) → sparse notes, wide gaps, rare jumps.
    Hard (score≈1) → dense notes, tight gaps, frequent jumps.
    """
    return {
        "min_npm":       _lerp(60,  140, score),
        "max_npm":       _lerp(100, 280, score),
        "min_gap":       _lerp(0.25, 0.12, score),
        "beats_per_jump": max(4, round(_lerp(16, 4, score))),
        "rms_jump_threshold": _lerp(0.90, 0.50, score),
    }


# Hard spacing floor between any two jumps (unchanged across difficulties)
MIN_BEATS_BETWEEN_JUMPS = 4


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _filter_min_gap(times: list[float], min_gap: float) -> list[float]:
    """
    Remove notes closer than min_gap seconds to the previous note.
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
    If density is below min_npm, merge in fill_candidates (not already present)
    to bring density up.
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


# ── Jump helpers ───────────────────────────────────────────────────────────────

def _find_jump_times(
    rel_beats: list[float],
    rms_times: list[float],
    rms_values: list[float],
    bpm: float,
    seg_start: float,
    beats_per_jump: int = 8,
    rms_jump_threshold: float = 0.75,
) -> set[float]:
    """
    Return segment-relative beat times that should host jump notes.

    Two sources:
    1. Periodic: every beats_per_jump beats, skipping the first 4 beats.
    2. Energy: any beat where the nearest RMS frame exceeds rms_jump_threshold.

    Both sources are gated by MIN_BEATS_BETWEEN_JUMPS spacing.
    """
    beat_interval = 60.0 / bpm
    min_gap_sec = beat_interval * MIN_BEATS_BETWEEN_JUMPS

    rms_arr = np.array(rms_times, dtype=float) if rms_times else np.array([])
    rms_val_arr = np.array(rms_values, dtype=float) if rms_values else np.array([])

    def rms_at(abs_beat: float) -> float:
        if len(rms_arr) == 0:
            return 0.0
        idx = int(np.argmin(np.abs(rms_arr - abs_beat)))
        return float(rms_val_arr[idx])

    jumps: set[float] = set()
    last_jump_time: float = -999.0

    for i, beat in enumerate(rel_beats):
        if (beat - last_jump_time) < min_gap_sec:
            continue

        abs_beat = beat + seg_start
        is_periodic = (i >= 4) and (i % beats_per_jump == 0)
        is_energy = rms_at(abs_beat) >= rms_jump_threshold

        if is_periodic or is_energy:
            jumps.add(round(beat, 3))
            last_jump_time = beat

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


# ── Direction assignment ───────────────────────────────────────────────────────

def _assign_directions(
    times: list[float],
    rel_beats: list[float],
    bpm: float,
    jump_times: Optional[set[float]] = None,
    seed: int = 0,
) -> list[Note]:
    """
    Assign a direction (or direction list for jumps) to each note time.

    Uses pattern-rotation: predefined short sequences (4–8 notes each) are
    shuffled once using the seed and then cycled. Each note consumes the next
    direction in the flattened sequence. If it would repeat the last direction,
    we scan forward up to 16 steps to find a non-repeating one.

    Jump notes (two-arrow chords) do not advance the direction cursor —
    they interrupt the pattern rhythmically but let it resume at the same
    position. They do update last_dir to the final arrow of the jump pair.
    """
    if not times:
        return []

    # ── Build shuffled pattern order (deterministic for this seed) ────────
    rng = random.Random(seed)
    pattern_order = list(range(len(PATTERNS)))
    rng.shuffle(pattern_order)

    # ── Flatten patterns into a long direction sequence ────────────────────
    # Pre-generate enough directions to cover all notes with room to spare.
    flat_dirs: list[str] = []
    pat_idx = 0
    needed = len(times) * 2 + 32
    while len(flat_dirs) < needed:
        pattern = PATTERNS[pattern_order[pat_idx % len(pattern_order)]]
        flat_dirs.extend(pattern)
        pat_idx += 1

    # ── Walk notes and assign directions ──────────────────────────────────
    all_dirs = ["left", "down", "up", "right"]
    notes: list[Note] = []
    last_dir: Optional[str] = None
    dir_cursor = 0
    jump_count = 0

    for t in times:
        t_key = round(t, 3)

        # ── Jump note ──────────────────────────────────────────────────────
        if jump_times and t_key in jump_times:
            pair = _pick_jump_pair(jump_count, last_dir)
            notes.append(Note(time=t, direction=pair))  # type: ignore[arg-type]
            last_dir = pair[-1]
            jump_count += 1
            # Jumps don't advance dir_cursor — the pattern resumes at the
            # same position for the next single-arrow note.
            continue

        # ── Single-arrow note ──────────────────────────────────────────────
        direction = flat_dirs[dir_cursor % len(flat_dirs)]

        # If this direction would repeat last_dir, scan forward for a
        # non-repeating one (bounded to 16 steps to prevent infinite loops).
        if direction == last_dir:
            for lookahead in range(1, 17):
                candidate = flat_dirs[(dir_cursor + lookahead) % len(flat_dirs)]
                if candidate != last_dir:
                    direction = candidate
                    dir_cursor += lookahead  # skip past the collision
                    break
            else:
                # All lookahead directions identical — fall back to any
                # direction that differs from last_dir.
                direction = next(d for d in all_dirs if d != last_dir)

        notes.append(Note(time=t, direction=direction))
        last_dir = direction
        dir_cursor += 1

    return notes


# ── Core generation ────────────────────────────────────────────────────────────

def _note_seed(video_id: str, title: str) -> int:
    """
    Stable cross-process seed derived from video_id (preferred) or title.
    Uses hashlib.md5 so the result is the same regardless of PYTHONHASHSEED.
    """
    key = video_id if video_id else title
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16)


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

    Produces a single chart with auto-scaled difficulty. Chart parameters
    (note density, min gap, jump frequency) are derived from the song's BPM
    and onset density — faster/busier songs are automatically harder.

    Pipeline:
    1. Compute difficulty score from BPM + onset density.
    2. Segment-relative beat and onset times.
    3. Merge beats + 16th-snapped onsets as note candidates.
    4. Min-gap filter (scaled by difficulty).
    5. Density cap and floor (scaled by difficulty).
    6. Jump times from periodic beats + RMS energy peaks (scaled by difficulty).
    7. Direction assignment via pattern rotation (seeded per song).
    """
    bpm = analysis.bpm
    seg_start = segment.start
    seg_end = segment.end
    seg_duration = segment.duration

    # ── 1. Auto-difficulty ─────────────────────────────────────────────────
    seg_onsets = [o for o in analysis.onset_times if seg_start <= o <= seg_end]
    onset_density = len(seg_onsets) / seg_duration if seg_duration > 0 else 0.0
    diff_score = compute_difficulty_score(bpm, onset_density)
    tier = difficulty_tier(diff_score)
    params = _chart_params(diff_score)

    # ── 2. Segment-relative times ──────────────────────────────────────────
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

    # ── 3. Merge beats + 16th-snapped onsets ──────────────────────────────
    snapped_onsets = _snap_to_16th_grid(rel_onsets, rel_beats, bpm)
    candidates = sorted(set(rel_beats + snapped_onsets))

    # ── 4. Min-gap filter (scaled) ─────────────────────────────────────────
    note_times = _filter_min_gap(candidates, params["min_gap"])

    # ── 5. Density shaping (scaled) ────────────────────────────────────────
    note_times = _apply_density_cap(note_times, params["max_npm"], seg_duration)
    note_times = _apply_density_floor(note_times, params["min_npm"], rel_beats, seg_duration)
    note_times = _filter_min_gap(note_times, params["min_gap"])

    # ── 6. Jump times (periodic + energy-aware, scaled) ────────────────────
    jump_times = _find_jump_times(
        rel_beats,
        analysis.rms_times,
        analysis.rms_values,
        bpm,
        seg_start,
        beats_per_jump=int(params["beats_per_jump"]),
        rms_jump_threshold=params["rms_jump_threshold"],
    )
    note_time_keys = {round(t, 3) for t in note_times}
    active_jumps = jump_times & note_time_keys

    # ── 7. Direction assignment ────────────────────────────────────────────
    seed = _note_seed(video_id, title)
    notes = _assign_directions(note_times, rel_beats, bpm, jump_times=active_jumps, seed=seed)

    # ── Assemble — same chart stored under both keys ───────────────────────
    chart = Chart(
        difficulty="easy",
        notes=notes,
        note_count=len(notes),
    )
    hard_chart = Chart(
        difficulty="hard",
        notes=notes,
        note_count=len(notes),
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
        difficulty_tier=tier,
        charts={"easy": chart, "hard": hard_chart},
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
    Async entry point: generates a chart from audio analysis.

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
        ChartData with identical charts stored under both "easy" and "hard" keys.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        partial(_generate_sync, analysis, segment, title, artist, audio_url, video_id),
    )


# ── Error type ─────────────────────────────────────────────────────────────────

class ChartGenerationError(Exception):
    """Raised when chart generation fails unexpectedly."""
