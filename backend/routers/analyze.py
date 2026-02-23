"""
POST /api/analyze — submit a YouTube URL for processing.
Returns a job_id that can be polled via GET /api/status/:job_id.
"""

import asyncio
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl

from models.job import JobState, JobStatus
from services.job_queue import job_store, enqueue_job

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
    job = JobStatus(
        job_id=job_id,
        state=JobState.pending,
        progress=0,
        message="Queued for processing",
    )
    job_store[job_id] = job

    await enqueue_job(job_id, url)

    return {"job_id": job_id}
