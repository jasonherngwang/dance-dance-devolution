from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import analyze, chart, songs, status

app = FastAPI(
    title="Dance Dance Devolution API",
    description="Backend API for the Dance Dance Devolution rhythm game",
    version="0.1.0",
)

# CORS configuration — allow frontend origins
origins = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:4173",  # Vite preview
    "https://ddd.jasonherngwang.com",  # Production
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(analyze.router, prefix="/api")
app.include_router(status.router, prefix="/api")
app.include_router(chart.router, prefix="/api")
app.include_router(songs.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "dance-dance-devolution-api"}
