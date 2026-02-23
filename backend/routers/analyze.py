"""
POST /api/analyze — submit a YouTube URL for processing.
Returns a job_id that can be polled via GET /api/status/:job_id.
"""

import asyncio
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models.job import JobState, JobStatus
from services.job_queue import job_store, enqueue_job
from services.ytdlp_service import get_video_id
from services.cache import chart_cache

router = APIRouter()


class AnalyzeRequest(BaseModel):
    url: str


@router.post("/analyze")
async def analyze(request: AnalyzeRequest) -> dict:
    url = request.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    # Basic YouTube URL validation
    if "youtube.com" not in url and "youtu.be" not in url:
        raise HTTPException(status_code=400, detail="Only YouTube URLs are supported")

    job_id = str(uuid.uuid4())

    # Check SQLite cache — skip re-processing if we already have this video
    video_id = get_video_id(url)
    if video_id and chart_cache.exists(video_id):
        cached = chart_cache.get(video_id)
        job = JobStatus(
            job_id=job_id,
            state=JobState.complete,
            progress=100,
            message="Chart loaded from cache",
            video_id=video_id,
            title=cached.title if cached else None,
            artist=cached.artist if cached else None,
            bpm=cached.bpm if cached else None,
        )
        job_store[job_id] = job
        return {"job_id": job_id}

    job = JobStatus(
        job_id=job_id,
        state=JobState.pending,
        progress=0,
        message="Queued for processing",
    )
    job_store[job_id] = job

    await enqueue_job(job_id, url)

    return {"job_id": job_id}
