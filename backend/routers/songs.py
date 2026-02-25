"""
GET /api/songs — return premade songs from the SQLite cache, newest first.
User-analyzed custom songs are cached server-side for performance but are not
returned here; they surface via localStorage on the submitting user's device.
"""

from fastapi import APIRouter
from services.cache import chart_cache

router = APIRouter()


@router.get("/songs")
async def get_songs() -> list[dict]:
    return chart_cache.list_all(limit=200, premade_only=True)
