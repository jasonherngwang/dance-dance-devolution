FROM python:3.11-slim

# System deps:
#   ffmpeg  — audio extraction / WAV conversion
#   deno    — JS runtime for yt-dlp's EJS "n"/signature challenge solver.
#             YouTube requires solving this challenge to expose audio formats;
#             Debian's nodejs (v20) is too old and yt-dlp rejects it as
#             unsupported, so we install Deno (yt-dlp's recommended runtime).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    unzip \
    ca-certificates \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y \
    && deno --version \
    && apt-get purge -y --auto-remove curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

# Copy source
COPY . .

# Create data directory for SQLite cache
RUN mkdir -p data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
