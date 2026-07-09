# Dance Dance Devolution

DDR-style rhythm game with Three.js + WebGPU

Pick pre-loaded songs or paste a YouTube URL (<10 min). For YouTube, extracts audio with `yt-dlp`, analyzes beats with `librosa`, and generates a step chart.

![Home screen with song library](screenshots/home.png)

![Gameplay with arrows scrolling](screenshots/gameplay.png)

![Gameplay with podcast](screenshots/podcast.png)

![Score result](screenshots/result.png)

The backend detects the tempo and individual hits in the audio, picks the highest-energy 90s segment from the music, then places arrows on the beats. Faster songs with more hits get harder charts. Arrow directions follow shuffled patterns so the same song always produces the same chart.

Generated charts are cached in SQLite keyed by video ID, so repeat plays skip processing entirely. Pre-loaded songs have pre-generated charts in the cache — audio is always streamed from YouTube via the IFrame player.
