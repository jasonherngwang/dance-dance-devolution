"""
SQLite-backed chart cache.
Stores generated ChartData keyed by YouTube video_id so the same video
is never processed twice.

Schema:
  charts(video_id TEXT PRIMARY KEY, chart_json TEXT, created_at INTEGER)
"""

import json
import sqlite3
import time
from pathlib import Path
from typing import Optional

from models.chart import ChartData

DB_PATH = Path(__file__).parent.parent / "data" / "chart_cache.db"


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS charts (
            video_id   TEXT PRIMARY KEY,
            chart_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    conn.commit()
    return conn


class ChartCache:
    def get(self, video_id: str) -> Optional[ChartData]:
        conn = _get_conn()
        try:
            row = conn.execute(
                "SELECT chart_json FROM charts WHERE video_id = ?", (video_id,)
            ).fetchone()
            if row is None:
                return None
            return ChartData.model_validate_json(row[0])
        finally:
            conn.close()

    def save(self, video_id: str, chart: ChartData) -> None:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO charts (video_id, chart_json, created_at) VALUES (?, ?, ?)",
                (video_id, chart.model_dump_json(), int(time.time())),
            )
            conn.commit()
        finally:
            conn.close()

    def exists(self, video_id: str) -> bool:
        conn = _get_conn()
        try:
            row = conn.execute(
                "SELECT 1 FROM charts WHERE video_id = ?", (video_id,)
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def list_all(self, limit: int = 50) -> list[dict]:
        """Return lightweight metadata for all cached charts, newest first."""
        conn = _get_conn()
        try:
            rows = conn.execute(
                "SELECT video_id, chart_json, created_at FROM charts ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            result = []
            for video_id, chart_json, created_at in rows:
                try:
                    data = json.loads(chart_json)
                    result.append({
                        "video_id": video_id,
                        "title": data.get("title"),
                        "artist": data.get("artist"),
                        "bpm": data.get("bpm"),
                        "difficulty_tier": data.get("difficulty_tier", 5),
                        "created_at": created_at,
                    })
                except Exception:
                    pass
            return result
        finally:
            conn.close()


# Module-level singleton
chart_cache = ChartCache()
