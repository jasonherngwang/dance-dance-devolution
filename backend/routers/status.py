"""
GET /api/status/:job_id — poll processing progress.
"""

from fastapi import APIRouter, HTTPException

from models.job import JobStatus
from services.job_queue import job_store

router = APIRouter()


@router.get("/status/{job_id}")
async def get_status(job_id: str) -> JobStatus:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
