"""
Async job queue with a Semaphore(2) concurrency limit.
Jobs are kept in memory; chart results are persisted in the SQLite cache.

Full pipeline (implemented in Issues 25-28):
  extract audio (yt-dlp) → analyze audio (librosa) → select segment → generate chart → cache

For Issue 24 this file only sets up the scaffolding. The actual pipeline
steps will be added in Issues 25-28.
"""

import asyncio
from typing import Dict

from models.job import JobStatus, JobState

# In-memory job store (job_id → JobStatus)
job_store: Dict[str, JobStatus] = {}

# Limit concurrent analysis jobs to 2
_semaphore = asyncio.Semaphore(2)


async def _run_pipeline(job_id: str, url: str) -> None:
    """Full processing pipeline placeholder — extended in Issues 25-28."""
    async with _semaphore:
        job = job_store.get(job_id)
        if job is None:
            return

        try:
            # Stub: mark as extracting then immediately error until Issue 25 fills this in
            job.state = JobState.extracting
            job.progress = 10
            job.message = "Starting extraction…"

            # TODO (Issue 25): yt_dlp_service.extract(url) → audio_path, metadata
            # TODO (Issue 26): librosa_service.analyze(audio_path) → analysis
            # TODO (Issue 27): segment_service.select(analysis) → segment
            # TODO (Issue 28): chart_service.generate(analysis, segment) → chart_data
            # TODO: cache.save(video_id, chart_data)
            # TODO: job.state = JobState.complete; job.progress = 100

            job.state = JobState.error
            job.progress = 0
            job.message = "Pipeline not yet implemented (Issues 25-28 pending)"
            job.error = "not_implemented"
        except Exception as exc:
            job.state = JobState.error
            job.progress = 0
            job.message = "An unexpected error occurred"
            job.error = str(exc)


async def enqueue_job(job_id: str, url: str) -> None:
    """Fire-and-forget: schedule the pipeline as a background task."""
    asyncio.create_task(_run_pipeline(job_id, url))
