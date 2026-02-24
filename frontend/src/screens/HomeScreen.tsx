import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "@/stores";
import { AudioOffsetPanel } from "@/components/AudioOffsetPanel";
import { getRecentlyPlayed } from "@/utils/recentlyPlayed";
import { PREMADE_VIDEO_IDS } from "@/data/premadeSongs";

const HomeBackground = lazy(() =>
  import("@/components/HomeBackground").then((m) => ({
    default: m.HomeBackground,
  })),
);
import type { ChartData } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SongEntry {
  video_id: string;
  title: string;
  artist?: string;
  bpm?: number;
  difficulty_tier?: number; // 1–10 DDR-style foot rating
  playedAt: number | null; // null = never played
  isPremade: boolean;
}

// ---------------------------------------------------------------------------
// HomeScreen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const navigate = useNavigate();
  const setActiveSong = useGameStore((state) => state.setActiveSong);
  const resetGame = useGameStore((state) => state.resetGame);

  const [songs, setSongs] = useState<SongEntry[]>([]);
  const [ytUrl, setYtUrl] = useState("");
  const [ytUrlError, setYtUrlError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingSong, setLoadingSong] = useState<string | null>(null);

  // Fetch all songs from API + merge with localStorage play history
  useEffect(() => {
    const playHistory = getRecentlyPlayed();
    const playMap = new Map(playHistory.map((e) => [e.video_id, e]));

    fetch("/api/songs")
      .then(
        (r) =>
          r.json() as Promise<
            Array<{
              video_id: string;
              title?: string;
              artist?: string;
              bpm?: number;
              difficulty_tier?: number;
            }>
          >,
      )
      .then((apiSongs) => {
        const apiIds = new Set<string>();
        const merged: SongEntry[] = [];

        // Add all API songs (premade + user-analyzed that are cached)
        for (const s of apiSongs) {
          if (!s.video_id || !s.title) continue;
          apiIds.add(s.video_id);
          const played = playMap.get(s.video_id);
          merged.push({
            video_id: s.video_id,
            title: s.title,
            artist: played?.artist ?? s.artist,
            bpm: played?.bpm ?? s.bpm,
            difficulty_tier: s.difficulty_tier,
            playedAt: played?.played_at ?? null,
            isPremade: PREMADE_VIDEO_IDS.has(s.video_id),
          });
        }

        // Add localStorage entries not in API (user songs that might not have loaded yet)
        for (const p of playHistory) {
          if (!apiIds.has(p.video_id)) {
            merged.push({
              video_id: p.video_id,
              title: p.title,
              artist: p.artist,
              bpm: p.bpm,
              playedAt: p.played_at,
              isPremade: false,
            });
          }
        }

        // Split into groups for sorting
        const played: SongEntry[] = [];
        const unplayedPremade: SongEntry[] = [];
        const unplayedUser: SongEntry[] = [];

        for (const s of merged) {
          if (s.playedAt) played.push(s);
          else if (s.isPremade) unplayedPremade.push(s);
          else unplayedUser.push(s);
        }

        // Played: most recently played first
        played.sort((a, b) => b.playedAt! - a.playedAt!);

        // Unplayed premade: Fisher-Yates shuffle (no song bias)
        for (let i = unplayedPremade.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [unplayedPremade[i], unplayedPremade[j]] = [
            unplayedPremade[j],
            unplayedPremade[i],
          ];
        }

        // Unplayed user-added: keep API order (newest first)

        setSongs([...played, ...unplayedUser, ...unplayedPremade]);
      })
      .catch(() => {
        // API unreachable — show localStorage entries only
        const fallback = playHistory.map((p) => ({
          video_id: p.video_id,
          title: p.title,
          artist: p.artist,
          bpm: p.bpm,
          playedAt: p.played_at,
          isPremade: PREMADE_VIDEO_IDS.has(p.video_id),
        }));
        setSongs(fallback);
      });
  }, []);

  // On-demand chart fetch + play
  const handlePlay = useCallback(
    async (entry: SongEntry) => {
      setLoadingSong(entry.video_id);
      try {
        const res = await fetch(`/api/chart/${entry.video_id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const chart: ChartData = await res.json();
        resetGame();
        setActiveSong(chart, "easy");
        navigate("/play");
      } catch (err) {
        console.error("[HomeScreen] Failed to load chart:", err);
        setLoadingSong(null);
      }
    },
    [resetGame, setActiveSong, navigate],
  );

  const handleAnalyze = useCallback(() => {
    const url = ytUrl.trim();
    if (!url) {
      setYtUrlError("Please enter a YouTube URL.");
      return;
    }
    if (!isValidYouTubeUrl(url)) {
      setYtUrlError(
        "Please enter a valid YouTube URL (e.g. youtube.com/watch?v=... or youtu.be/...)",
      );
      return;
    }
    setYtUrlError("");
    navigate("/loading", { state: { ytUrl: url } });
  }, [ytUrl, navigate]);

  return (
    <div
      className="relative h-full w-full"
      style={
        { overflowY: "auto", scrollbarWidth: "none" } as React.CSSProperties
      }
    >
      {/* WebGPU animated background */}
      <Suspense fallback={null}>
        <HomeBackground />
      </Suspense>

      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: "rgba(10,0,20,0.82)" }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 3px)",
          backgroundSize: "100% 3px",
          zIndex: 1,
        }}
      />
      <div
        className="fixed bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: 80,
          background: "linear-gradient(transparent, rgba(10,0,20,0.98))",
          zIndex: 1,
        }}
      />

      {/* Settings */}
      {settingsOpen && (
        <AudioOffsetPanel onClose={() => setSettingsOpen(false)} />
      )}
      <button
        className="fixed top-4 right-4 z-30 w-9 h-9 flex items-center justify-center text-lg chrome-frame"
        style={{ color: "#00eeff", background: "#120024", cursor: "pointer" }}
        onClick={() => setSettingsOpen(true)}
        aria-label="Open settings"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = "#fff";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 0 20px rgba(0,238,255,0.4), inset 0 0 20px rgba(68,0,170,0.1)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = "#00eeff";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 0 20px rgba(68,0,170,0.3), inset 0 0 20px rgba(68,0,170,0.1)";
        }}
      >
        &#9881;
      </button>

      {/* Page content */}
      <div className="relative z-10 flex flex-col items-center px-4 pt-10 pb-24 min-h-full">
        {/* Sleek scanner rule above title */}
        <div className="rainbow-rule w-3/5 max-w-sm mt-8 mb-4 opacity-70" />

        {/* Title */}
        <div className="text-center select-none">
          <h1
            style={
              {
                fontFamily: "'Press Start 2P', 'Courier New', monospace",
                fontSize: "clamp(1.3rem, 4.5vw, 2.6rem)",
                fontWeight: 400,
                lineHeight: 1.4,
                letterSpacing: "0.06em",
                background:
                  "linear-gradient(90deg, #ffffff 0%, #00eeff 30%, #4400ff 50%, #ff00cc 70%, #ffffff 100%)",
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter:
                  "drop-shadow(0 0 16px rgba(0,238,255,0.6)) drop-shadow(0 4px 6px rgba(0,0,0,0.9))",
                animation: "chrome-shimmer 2.5s ease-in-out infinite alternate",
              } as React.CSSProperties
            }
          >
            DANCE DANCE
            <br />
            DEVOLUTION
          </h1>
          <p
            className="mt-3 select-none"
            style={{
              fontFamily: "'Bungee', 'Impact', 'Arial Black', sans-serif",
              fontSize: "0.6rem",
              letterSpacing: "0.18em",
              color: "rgba(0,238,255,0.45)",
            }}
          >
            USE ARROW KEYS or TAP ZONES
          </p>
        </div>

        {/* Sleek scanner rule below title */}
        <div className="rainbow-rule w-3/5 max-w-sm mt-4 mb-8 opacity-70" />

        {/* Custom Song (YouTube) */}
        <div className="mt-8 w-full max-w-md">
          <SectionLabel text="> CUSTOM SONG" color="#00eeff" />
          <div className="flex gap-2">
            <input
              type="url"
              value={ytUrl}
              onChange={(e) => {
                setYtUrl(e.target.value);
                if (ytUrlError) setYtUrlError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAnalyze();
              }}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 px-4 py-3 outline-none chrome-frame"
              style={{
                background: "#000008",
                color: "#f0e8ff",
                fontFamily: "'VT323', 'Courier New', monospace",
                fontSize: "1.1rem",
                transition: "border-color 0.15s",
                borderColor: ytUrlError ? "rgba(255,0,102,0.6)" : undefined,
              }}
              onFocus={(e) => {
                (e.target as HTMLInputElement).style.boxShadow =
                  "0 0 20px rgba(0,238,255,0.3), inset 0 0 20px rgba(68,0,170,0.1)";
              }}
              onBlur={(e) => {
                (e.target as HTMLInputElement).style.boxShadow =
                  "0 0 20px rgba(68,0,170,0.3), inset 0 0 20px rgba(68,0,170,0.1)";
              }}
            />
            <button
              className="arcade-btn px-5 py-3 whitespace-nowrap"
              style={{
                background: ytUrl.trim()
                  ? "rgba(255,0,102,0.15)"
                  : "rgba(255,255,255,0.04)",
                color: ytUrl.trim() ? "#ff0066" : "rgba(240,232,255,0.25)",
                fontSize: "0.8rem",
                cursor: ytUrl.trim() ? "pointer" : "default",
              }}
              onClick={handleAnalyze}
            >
              ANALYZE
            </button>
          </div>
          {ytUrlError && (
            <p
              className="mt-2"
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: "0.95rem",
                color: "#ff0066",
              }}
            >
              {ytUrlError}
            </p>
          )}
        </div>

        {/* Song Library */}
        {songs.length > 0 && (
          <div className="mt-8 w-full max-w-3xl">
            <SectionLabel text="> SONG LIBRARY" color="#ff00cc" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {songs.map((entry) => (
                <SongCard
                  key={entry.video_id}
                  entry={entry}
                  isLoading={loadingSong === entry.video_id}
                  onPlay={() => handlePlay(entry)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Utilities ----------------------------------------------------------------

/** Difficulty tier bar color: green → yellow → red as tier increases. */
function tierColor(tier: number): string {
  if (tier <= 3) return "#66ff00"; // green — easy
  if (tier <= 6) return "#ffd700"; // gold — medium
  if (tier <= 8) return "#ff6600"; // orange — hard
  return "#ff0033"; // red — extreme
}

function isValidYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com") {
      return (
        (u.pathname === "/watch" && !!u.searchParams.get("v")) ||
        u.pathname.startsWith("/shorts/") ||
        u.pathname.startsWith("/embed/")
      );
    }
    if (host === "youtu.be") {
      return u.pathname.length > 1;
    }
    return false;
  } catch {
    return false;
  }
}

// -- Sub-components -----------------------------------------------------------

function SectionLabel({ text, color }: { text: string; color: string }) {
  return (
    <p
      className="mb-3 select-none"
      style={{
        fontFamily: "'Press Start 2P', 'Courier New', monospace",
        fontSize: "0.5rem",
        letterSpacing: "0.15em",
        color,
        textShadow: `0 0 10px ${color}55`,
      }}
    >
      {text}
    </p>
  );
}

function SongCard({
  entry,
  isLoading,
  onPlay,
}: {
  entry: SongEntry;
  isLoading: boolean;
  onPlay: () => void;
}) {
  // Color scheme: premade = magenta, user-added = cyan
  const accent = entry.isPremade ? "#ff00cc" : "#00eeff";
  const accentDim = entry.isPremade
    ? "rgba(255,0,204,0.3)"
    : "rgba(0,238,255,0.3)";
  const accentBg = entry.isPremade
    ? "rgba(255,0,204,0.06)"
    : "rgba(0,238,255,0.06)";
  const accentBtn = entry.isPremade
    ? "rgba(255,0,204,0.12)"
    : "rgba(0,238,255,0.12)";
  const accentBtnHover = entry.isPremade
    ? "rgba(255,0,204,0.25)"
    : "rgba(0,238,255,0.25)";
  const accentBtnGlow = entry.isPremade
    ? "rgba(255,0,204,0.5)"
    : "rgba(0,238,255,0.5)";

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 chrome-frame"
      style={{ background: "rgba(18,0,36,0.9)" }}
    >
      {/* YouTube thumbnail */}
      <div
        className="shrink-0 overflow-hidden"
        style={{
          width: 40,
          height: 40,
          border: `2px solid ${accentDim}`,
          background: accentBg,
        }}
      >
        <img
          src={`https://img.youtube.com/vi/${entry.video_id}/mqdefault.jpg`}
          alt={entry.title}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>

      {/* Metadata */}
      <div className="flex-1 min-w-0">
        <div
          style={{
            fontFamily: "'VT323', 'Courier New', monospace",
            fontSize: "1rem",
            lineHeight: 1.2,
            color: "#f0e8ff",
          }}
        >
          {entry.title}
        </div>
        <div
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: "0.85rem",
            lineHeight: 1.2,
            color: accent,
          }}
        >
          {entry.artist ?? "YouTube"}
          {entry.bpm != null && (
            <span style={{ color: "rgba(240,232,255,0.4)" }}>
              {" "}
              / {Math.round(entry.bpm)} BPM
            </span>
          )}
          {entry.difficulty_tier != null && (
            <span
              style={{ color: tierColor(entry.difficulty_tier), marginLeft: 6 }}
            >
              {"▮".repeat(entry.difficulty_tier)}
              <span style={{ opacity: 0.2 }}>
                {"▮".repeat(10 - entry.difficulty_tier)}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Play button */}
      <button
        className="shrink-0 arcade-btn"
        style={{
          padding: "4px 10px",
          fontSize: "0.55rem",
          background: isLoading ? "rgba(255,255,255,0.03)" : accentBtn,
          color: isLoading ? "rgba(240,232,255,0.2)" : accent,
          cursor: isLoading ? "wait" : "pointer",
          textShadow: isLoading ? "none" : `0 0 8px ${accentBtnGlow}`,
        }}
        disabled={isLoading}
        onClick={onPlay}
        onMouseEnter={(e) => {
          if (!isLoading)
            (e.currentTarget as HTMLElement).style.background = accentBtnHover;
        }}
        onMouseLeave={(e) => {
          if (!isLoading)
            (e.currentTarget as HTMLElement).style.background = accentBtn;
        }}
      >
        {isLoading ? "..." : "PLAY"}
      </button>
    </div>
  );
}
