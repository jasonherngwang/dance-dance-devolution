"""
GET /api/songs — return all globally analyzed songs from the SQLite cache,
newest first. Used by the frontend to populate the "Recently Played" section
with songs other users have generated.
"""

from fastapi import APIRouter
from services.cache import chart_cache

router = APIRouter()


@router.get("/songs")
async def get_songs() -> list[dict]:
    return chart_cache.list_all(limit=200)
