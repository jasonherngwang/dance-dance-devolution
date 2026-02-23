from typing import Literal, Union
from pydantic import BaseModel

Direction = Literal["left", "down", "up", "right"]
Difficulty = Literal["easy", "hard"]


class Note(BaseModel):
    time: float  # seconds from chart start
    direction: Union[Direction, list[Direction]]  # list for jumps


class Chart(BaseModel):
    difficulty: Difficulty
    notes: list[Note]
    note_count: int


class ChartData(BaseModel):
    title: str
    artist: str
    bpm: float
    duration: float  # seconds
    segment_start: float = 0.0  # seconds
    audio_url: str = ""
    # Source type: 'local' for pre-loaded songs, 'youtube' for custom URLs.
    # Frontend uses this to decide whether to use AudioPlayer or YouTubePlayer.
    source: str = "youtube"
    # YouTube video ID (11 chars) — set for custom YouTube songs.
    # Empty string for pre-loaded local songs.
    video_id: str = ""
    charts: dict[Difficulty, Chart]
