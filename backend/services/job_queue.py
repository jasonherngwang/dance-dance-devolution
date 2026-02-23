"""
Async job queue with a Semaphore(2) concurrency limit.
Jobs are kept in memory; chart results are persisted in the SQLite cache.

Pipeline:
  extract audio (yt-dlp) [Issue 25]
  → analyze audio (librosa) [Issue 26]
  → select segment [Issue 27]
  → generate chart [Issue 28]
  → cache & mark complete [Issue 29]
"""

import asyncio
from typing import Dict

from models.job import JobStatus, JobState
from services import ytdlp_service
from services.ytdlp_service import ExtractionError
from services import librosa_service
from services.librosa_service import AnalysisError

# In-memory job store (job_id → JobStatus)
job_store: Dict[str, JobStatus] = {}

# Limit concurrent analysis jobs to 2
_semaphore = asyncio.Semaphore(2)


async def _run_pipeline(job_id: str, url: str) -> None:
    """Full processing pipeline — extraction implemented; remaining steps pending."""
    async with _semaphore:
        job = job_store.get(job_id)
        if job is None:
            return

        temp_dir = None
        try:
            # ── Stage 1: Extract audio via yt-dlp ─────────────────────────────
            job.state = JobState.extracting
            job.progress = 5
            job.message = "Downloading audio from YouTube…"

            result = await ytdlp_service.extract_audio(url)
            temp_dir = result.temp_dir

            # Persist metadata so the frontend can show title/artist early
            job.video_id = result.video_id
            job.title = result.title
            job.artist = result.artist
            job.progress = 30
            job.message = f"Extracted audio: {result.title}"

            # ── Stage 2: Analyze audio via librosa ────────────────────────────
            job.state = JobState.analyzing
            job.progress = 35
            job.message = "Analysing audio with librosa…"

            analysis = await librosa_service.analyze(result.audio_path)
            job.bpm = round(analysis.bpm)
            job.progress = 60
            job.message = f"Analysed audio — {analysis.bpm:.0f} BPM detected"

            # ── Stage 3: Select best segment ──────────────────────────────────
            # TODO (Issue 27): segment = segment_service.select(analysis)
            # job.progress = 75

            # ── Stage 4: Generate chart ───────────────────────────────────────
            # TODO (Issue 28): chart_data = chart_service.generate(analysis, segment)
            # from services.cache import chart_cache
            # chart_cache.save(result.video_id, chart_data)
            # job.state = JobState.complete
            # job.progress = 100
            # job.message = "Chart ready!"

            # Stages 3-4 not yet implemented — mark as error until Issues 27-28 land
            job.state = JobState.error
            job.progress = 60
            job.message = "Audio analysed; chart generation pending (Issues 27-28)"
            job.error = "chart_generation_not_implemented"

        except ExtractionError as exc:
            job.state = JobState.error
            job.progress = 0
            job.message = str(exc)
            job.error = "extraction_failed"

        except AnalysisError as exc:
            job.state = JobState.error
            job.progress = 30
            job.message = str(exc)
            job.error = "analysis_failed"

        except Exception as exc:
            job.state = JobState.error
            job.progress = 0
            job.message = "An unexpected error occurred"
            job.error = str(exc)

        finally:
            # Always clean up the temp audio directory when the pipeline finishes
            if temp_dir is not None:
                ytdlp_service.cleanup_temp_dir(temp_dir)


async def enqueue_job(job_id: str, url: str) -> None:
    """Fire-and-forget: schedule the pipeline as a background task."""
    asyncio.create_task(_run_pipeline(job_id, url))
