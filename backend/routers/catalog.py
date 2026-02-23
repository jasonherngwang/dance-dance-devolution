"""
GET /api/catalog — return the pre-loaded song catalog.
"""

from fastapi import APIRouter

router = APIRouter()

# Pre-loaded song catalog (mirrors frontend /public/data/catalog.json)
CATALOG = [
    {
        "id": "sandstorm",
        "title": "Sandstorm",
        "artist": "Darude",
        "bpm": 136,
        "duration": 90,
        "segment_start": 0,
        "audio_url": "/audio/sandstorm-segment.wav",
        "chart_url": "/data/sandstorm.json",
        "thumbnail_url": "/images/sandstorm.svg",
        "featured": True,
    },
    {
        "id": "butterfly",
        "title": "Butterfly",
        "artist": "Smile.dk",
        "bpm": 154,
        "duration": 90,
        "segment_start": 0,
        "audio_url": "/audio/butterfly-segment.wav",
        "chart_url": "/data/butterfly.json",
        "thumbnail_url": "/images/butterfly.svg",
        "featured": False,
    },
    {
        "id": "blinding-lights",
        "title": "Blinding Lights",
        "artist": "The Weeknd",
        "bpm": 171,
        "duration": 90,
        "segment_start": 0,
        "audio_url": "/audio/blinding-lights-segment.wav",
        "chart_url": "/data/blinding-lights.json",
        "thumbnail_url": "/images/blinding-lights.svg",
        "featured": False,
    },
]


@router.get("/catalog")
async def get_catalog() -> list[dict]:
    return CATALOG
