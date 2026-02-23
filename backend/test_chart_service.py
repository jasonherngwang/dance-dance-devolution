#!/usr/bin/env python3
"""
Verification script for Issue 28: Chart generation algorithm.
Uses synthetic AudioAnalysis data (no audio files required).

Run from backend/:  python test_chart_service.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from services.librosa_service import AudioAnalysis
from services.segment_service import Segment
from services.chart_service import (
    _generate_sync,
    _filter_min_gap,
    MIN_GAP_EASY,
    MIN_GAP_HARD,
)


def make_analysis(bpm: float, duration: float) -> AudioAnalysis:
    """Create synthetic AudioAnalysis with evenly spaced beats and onsets."""
    beat_interval = 60.0 / bpm
    eighth_interval = beat_interval / 2.0

    # Beat times (quarter notes)
    beat_times = []
    t = 0.0
    while t <= duration:
        beat_times.append(round(t, 4))
        t += beat_interval

    # Onset times (eighth notes — includes beats + off-beats)
    onset_times = []
    t = 0.0
    while t <= duration:
        onset_times.append(round(t, 4))
        t += eighth_interval

    # RMS energy: fake constant mid-level energy
    hop = 512
    sr = 22050
    n_frames = int(duration * sr / hop) + 1
    rms_times = [round(i * hop / sr, 4) for i in range(n_frames)]
    rms_values = [0.5] * n_frames

    return AudioAnalysis(
        bpm=bpm,
        beat_times=beat_times,
        onset_times=onset_times,
        rms_times=rms_times,
        rms_values=rms_values,
        duration=duration,
        sample_rate=sr,
    )


def check(condition: bool, label: str) -> bool:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}")
    return condition


def run_scenario(name: str, bpm: float, seg_duration: float) -> int:
    """Run a single test scenario; return number of failures."""
    print(f"\n{'─'*60}")
    print(f"  Scenario: {name}  (BPM={bpm}, duration={seg_duration}s)")
    print(f"{'─'*60}")

    analysis = make_analysis(bpm, seg_duration)
    segment = Segment(start=0.0, end=seg_duration, duration=seg_duration)

    chart_data = _generate_sync(analysis, segment, "Test Song", "Artist", "")

    easy = chart_data.charts["easy"]
    hard = chart_data.charts["hard"]

    easy_npm = easy.note_count / (seg_duration / 60.0)
    hard_npm = hard.note_count / (seg_duration / 60.0)

    failures = 0

    # ── Acceptance criteria ────────────────────────────────────────────────────

    # 1. Easy chart: 40–80 notes/min
    c = check(40 <= easy_npm <= 80, f"Easy density: {easy_npm:.1f} notes/min (target 40–80)")
    if not c:
        failures += 1

    # 2. Hard chart: 120–250 notes/min
    c = check(120 <= hard_npm <= 250, f"Hard density: {hard_npm:.1f} notes/min (target 120–250)")
    if not c:
        failures += 1

    # 3. No two easy notes closer than MIN_GAP_EASY
    easy_times = [n.time for n in easy.notes]
    gaps_easy = [easy_times[i+1] - easy_times[i] for i in range(len(easy_times)-1)]
    min_gap_easy_actual = min(gaps_easy) if gaps_easy else float("inf")
    c = check(
        min_gap_easy_actual >= MIN_GAP_EASY - 1e-6,
        f"Easy min gap: {min_gap_easy_actual*1000:.1f}ms (min {MIN_GAP_EASY*1000:.0f}ms)",
    )
    if not c:
        failures += 1

    # 4. No two hard notes closer than MIN_GAP_HARD
    hard_times = [n.time for n in hard.notes]
    gaps_hard = [hard_times[i+1] - hard_times[i] for i in range(len(hard_times)-1)]
    min_gap_hard_actual = min(gaps_hard) if gaps_hard else float("inf")
    c = check(
        min_gap_hard_actual >= MIN_GAP_HARD - 1e-6,
        f"Hard min gap: {min_gap_hard_actual*1000:.1f}ms (min {MIN_GAP_HARD*1000:.0f}ms)",
    )
    if not c:
        failures += 1

    # 5. Arrow patterns: no three identical consecutive single-arrow directions in easy
    easy_single = [n for n in easy.notes if isinstance(n.direction, str)]
    consec_repeats = 0
    for i in range(len(easy_single) - 1):
        if easy_single[i].direction == easy_single[i+1].direction:
            consec_repeats += 1
    repeat_pct = consec_repeats / max(len(easy_single)-1, 1) * 100
    c = check(repeat_pct < 5, f"Easy consecutive repeats: {repeat_pct:.1f}% (target <5%)")
    if not c:
        failures += 1

    # 6. Jumps appear ONLY in hard chart
    easy_jumps = [n for n in easy.notes if isinstance(n.direction, list)]
    hard_jumps = [n for n in hard.notes if isinstance(n.direction, list)]
    c = check(len(easy_jumps) == 0, f"No jumps in easy chart (found {len(easy_jumps)})")
    if not c:
        failures += 1

    # 7. Hard chart has some jumps (at least 1 if segment is long enough)
    expected_jumps = max(0, (len([b for b in analysis.beat_times if b <= seg_duration]) // 16) - 1)
    c = check(
        len(hard_jumps) >= min(1, expected_jumps),
        f"Hard chart jumps: {len(hard_jumps)} (expected ≥{min(1, expected_jumps)})",
    )
    if not c:
        failures += 1

    # 8. Note counts match note_count field
    c = check(easy.note_count == len(easy.notes), "Easy note_count matches len(notes)")
    if not c:
        failures += 1
    c = check(hard.note_count == len(hard.notes), "Hard note_count matches len(notes)")
    if not c:
        failures += 1

    # 9. All note times are within [0, seg_duration]
    all_times = easy_times + hard_times
    c = check(
        all(0.0 <= t <= seg_duration + 0.01 for t in all_times),
        "All note times within segment bounds",
    )
    if not c:
        failures += 1

    # 10. Metadata preserved
    c = check(chart_data.title == "Test Song", "Title preserved")
    if not c:
        failures += 1
    c = check(abs(chart_data.bpm - bpm) < 0.01, f"BPM preserved: {chart_data.bpm}")
    if not c:
        failures += 1

    print(f"\n  Easy notes: {easy.note_count}  ({easy_npm:.1f}/min)")
    print(f"  Hard notes: {hard.note_count}  ({hard_npm:.1f}/min)  [{len(hard_jumps)} jumps]")
    return failures


def main() -> None:
    print("=" * 60)
    print("  Issue 28 — Chart Generation Algorithm Verification")
    print("=" * 60)

    total_failures = 0

    # Typical EDM / dance music BPMs matching the catalog
    total_failures += run_scenario("Sandstorm-like (136 BPM, 90s)",  bpm=136.0, seg_duration=90.0)
    total_failures += run_scenario("Butterfly-like (154 BPM, 90s)",   bpm=154.0, seg_duration=90.0)
    total_failures += run_scenario("Blinding Lights (171 BPM, 90s)", bpm=171.0, seg_duration=90.0)

    # Edge cases
    total_failures += run_scenario("Slow song (60 BPM, 90s)",         bpm=60.0,  seg_duration=90.0)
    total_failures += run_scenario("Fast song (200 BPM, 90s)",         bpm=200.0, seg_duration=90.0)
    total_failures += run_scenario("Short segment (136 BPM, 45s)",    bpm=136.0, seg_duration=45.0)

    print("\n" + "=" * 60)
    if total_failures == 0:
        print("  ALL TESTS PASSED ✓")
    else:
        print(f"  {total_failures} TEST(S) FAILED ✗")
    print("=" * 60)
    sys.exit(0 if total_failures == 0 else 1)


if __name__ == "__main__":
    main()
