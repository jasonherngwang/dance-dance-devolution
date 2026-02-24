const KEY = 'ddd_recently_played';
const MAX_ENTRIES = 100;

export interface RecentlyPlayedEntry {
  video_id: string;
  title: string;
  artist?: string;
  bpm?: number;
  played_at: number;
}

export function getRecentlyPlayed(): RecentlyPlayedEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentlyPlayedEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveRecentlyPlayed(entry: Omit<RecentlyPlayedEntry, 'played_at'>): void {
  try {
    const existing = getRecentlyPlayed().filter(e => e.video_id !== entry.video_id);
    const updated = [{ ...entry, played_at: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // localStorage unavailable — non-fatal
  }
}
