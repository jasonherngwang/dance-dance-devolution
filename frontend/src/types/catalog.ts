export interface CatalogEntry {
  id: string;               // Unique identifier for this song
  title: string;
  artist: string;
  bpm: number;
  duration: number;         // Segment duration (not full song)
  segment_start: number;    // Where to start in the audio file
  audio_url: string;        // Path to local audio file (e.g., "/audio/sandstorm.mp3")
  thumbnail_url: string;    // Album art or custom thumbnail
  featured: boolean;        // Show on home screen?
}
