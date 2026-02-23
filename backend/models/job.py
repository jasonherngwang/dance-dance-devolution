from enum import Enum
from typing import Optional
from pydantic import BaseModel


class JobState(str, Enum):
    pending = "pending"
    extracting = "extracting"
    analyzing = "analyzing"
    generating = "generating"
    complete = "complete"
    error = "error"


class JobStatus(BaseModel):
    job_id: str
    state: JobState
    progress: int  # 0-100
    message: str = ""
    # Available once extraction/analysis completes
    title: Optional[str] = None
    artist: Optional[str] = None
    bpm: Optional[float] = None
    video_id: Optional[str] = None
    error: Optional[str] = None
