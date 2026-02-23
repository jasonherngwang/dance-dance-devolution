"""
GET /api/chart/:video_id — retrieve a cached chart (404 if not found).
"""

from fastapi import APIRouter, HTTPException

from models.chart import ChartData
from services.cache import chart_cache

router = APIRouter()


@router.get("/chart/{video_id}")
async def get_chart(video_id: str) -> ChartData:
    chart = chart_cache.get(video_id)
    if chart is None:
        raise HTTPException(status_code=404, detail="Chart not found or not yet generated")
    return chart
