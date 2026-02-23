export type Direction = 'left' | 'down' | 'up' | 'right';
export type Difficulty = 'easy' | 'hard';

export interface Note {
  time: number;           // Seconds from segment start
  type: 'tap';            // Only taps for MVP
  direction: Direction | Direction[];  // Single direction or array for jumps
}

export interface Chart {
  difficulty: Difficulty;
  noteCount: number;
  notes: Note[];
}

export interface ChartData {
  video_id: string;       // YouTube video ID (11 chars) or local song identifier
  title: string;          // Song title
  artist: string;         // Artist name
  bpm: number;            // Detected BPM (rounded)
  duration: number;       // Playable segment duration in seconds (60-90s)
  segment_start: number;  // Where in the audio to begin (seconds)
  offset: number;         // Fine-tune sync offset (seconds)
  source: 'local' | 'youtube';  // Audio source type
  /** Path to local audio file (e.g. "/audio/sandstorm.mp3"). Required when source === 'local'. */
  audio_url?: string;
  charts: {
    easy: Chart;
    hard: Chart;
  };
}
