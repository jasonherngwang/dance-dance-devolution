"""
POST /api/analyze — submit a YouTube URL for processing.
Returns a job_id that can be polled via GET /api/status/:job_id.
"""

import time
import uuid
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from models.job import JobState, JobStatus
from services.job_queue import job_store, enqueue_job
from services.ytdlp_service import get_video_id
from services.cache import chart_cache

router = APIRouter()

# Simple in-memory rate limiter: IP → list of request timestamps
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT = 50      # max requests (raised for batch preprocessing; lower for production)
RATE_WINDOW = 60.0   # per this many seconds


def _check_rate_limit(ip: str) -> bool:
    """Returns True if the request is allowed, False if rate limited."""
    now = time.time()
    timestamps = _rate_limit_store[ip]
    # Evict timestamps outside the window
    _rate_limit_store[ip] = [t for t in timestamps if now - t < RATE_WINDOW]
    if len(_rate_limit_store[ip]) >= RATE_LIMIT:
        return False
    _rate_limit_store[ip].append(now)
    return True


class AnalyzeRequest(BaseModel):
    url: str
    bpm_override: float | None = None


@router.post("/analyze")
async def analyze(http_request: Request, request: AnalyzeRequest) -> dict:
    url = request.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    # Basic YouTube URL validation
    if "youtube.com" not in url and "youtu.be" not in url:
        raise HTTPException(status_code=400, detail="Only YouTube URLs are supported")

    job_id = str(uuid.uuid4())

    # Check SQLite cache first — cached videos skip rate limiting entirely
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

    # Rate limiting: 5 new analyses per minute per IP (cached hits are exempt)
    client_ip = http_request.client.host if http_request.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Too many requests. You can analyze up to 5 songs per minute. Please wait a moment before trying again.",
        )

    job = JobStatus(
        job_id=job_id,
        state=JobState.pending,
        progress=0,
        message="Queued for processing",
    )
    job_store[job_id] = job

    await enqueue_job(job_id, url, bpm_override=request.bpm_override)

    return {"job_id": job_id}
