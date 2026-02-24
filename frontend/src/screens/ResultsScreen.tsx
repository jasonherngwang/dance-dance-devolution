import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "@/stores";
import { useJobStore } from "@/stores/jobStore";
import type { ChartData } from "@/types";
import { triggerResultsConfetti } from "../components/ResultsConfetti";
import { HomeBackground } from "../components/HomeBackground";

const GRADE_COLORS: Record<string, string> = {
  S: "var(--color-ddr-cyan)",
  A: "var(--color-chrome-light)",
  B: "var(--color-chrome-mid)",
  C: "var(--color-chrome-dark)",
  D: "var(--color-ddr-magenta)",
};

export default function ResultsScreen() {
  const navigate = useNavigate();
  const gameResult = useGameStore((state) => state.gameResult);
  const activeSong = useGameStore((state) => state.activeSong);
  const activeDifficulty = useGameStore((state) => state.activeDifficulty);
  const setActiveSong = useGameStore((state) => state.setActiveSong);
  const resetGame = useGameStore((state) => state.resetGame);
  const completedJobs = useJobStore((s) => s.completedJobs);
  const clearCompletedJob = useJobStore((s) => s.clearCompletedJob);

  useEffect(() => {
    if (!gameResult || !activeSong) {
      navigate("/", { replace: true });
    }
  }, [gameResult, activeSong, navigate]);

  useEffect(() => {
    if (gameResult) {
      triggerResultsConfetti();
      const audio = new Audio("/audio/cheering.mp3"); // Ensure this file exists or will be added
      audio.volume = 0.6;
      audio
        .play()
        .catch((e) =>
          console.log("Audio play failed (maybe autoplay blocked)", e),
        );
    }
  }, [gameResult]);

  if (!gameResult || !activeSong) return null;

  const gradeColor = GRADE_COLORS[gameResult.grade] ?? "#ffffff";

  function handleRetry() {
    resetGame();
    setActiveSong(activeSong!, activeDifficulty);
    navigate("/play");
  }

  function handleNewSong() {
    navigate("/");
  }

  const handlePlayReadySong = useCallback(
    async (jobId: string, videoId: string) => {
      clearCompletedJob(jobId);
      try {
        const res = await fetch(`/api/chart/${videoId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const chart: ChartData = await res.json();
        resetGame();
        setActiveSong(chart, "easy");
        navigate("/play");
      } catch (err) {
        console.error("[ResultsScreen] Failed to load ready song:", err);
      }
    },
    [clearCompletedJob, resetGame, setActiveSong, navigate],
  );

  const firstReadyEntry =
    completedJobs.size > 0 ? [...completedJobs.entries()][0] : null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Background Particles */}
      <HomeBackground />

      {/* Scrolling starfield background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.15) 1px, transparent 0), radial-gradient(1px 1px at 60% 70%, rgba(255,255,255,0.1) 1px, transparent 0), radial-gradient(1px 1px at 80% 20%, rgba(255,255,255,0.12) 1px, transparent 0), radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,0.08) 1px, transparent 0)",
          backgroundSize: "200px 200px, 300px 300px, 250px 250px, 180px 180px",
          animation: "starfield-scroll 30s linear infinite",
        }}
      />
      {/* CRT scanlines */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 3px)",
          backgroundSize: "100% 3px",
        }}
      />

      {/* Page content — single viewport, no scroll */}
      <div className="relative z-10 flex flex-col items-center justify-center px-4 py-4 h-full">
        {/* "STAGE CLEAR" header */}
        <div
          style={{
            animation: "results-header-in 0.55s ease-out forwards",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "'Press Start 2P', 'Courier New', monospace",
              fontSize: "clamp(0.9rem, 2.5vw, 1.5rem)",
              fontWeight: 400,
              letterSpacing: "0.12em",
              color: "#ffd700",
            }}
          >
            <span
              style={{
                color: "var(--color-chrome-light)",
                textShadow: "0 0 8px var(--color-chrome-light)",
              }}
            >
              MISSION
            </span>{" "}
            ACCOMPLISHED
          </div>
        </div>

        {/* Sleek scanner rule */}
        <div className="rainbow-rule w-3/5 max-w-xs mt-2 mb-2 opacity-70" />

        {/* Song info — thumbnail + title */}
        <div
          className="mt-1 flex items-center gap-4 select-none"
          style={{
            animation: "results-fade-up 0.5s 0.15s ease-out both",
            maxWidth: 420,
            width: "100%",
          }}
        >
          {activeSong.video_id && (
            <img
              src={`https://img.youtube.com/vi/${activeSong.video_id}/mqdefault.jpg`}
              alt=""
              style={{
                width: 96,
                height: 72,
                objectFit: "cover",
                borderRadius: 4,
                flexShrink: 0,
                border: "2px solid rgba(255,255,255,0.15)",
                boxShadow: "0 0 16px rgba(0,238,255,0.2)",
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div
              style={
                {
                  fontFamily: "'Bungee', 'Impact', sans-serif",
                  fontSize: "clamp(1.1rem, 3.2vw, 1.6rem)",
                  color: "#f0e8ff",
                  textShadow: "1px 1px 0 rgba(0,0,0,0.8)",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                } as React.CSSProperties
              }
            >
              {activeSong.title.toUpperCase()}
            </div>
            <div
              style={{
                marginTop: 5,
                fontFamily: "'Press Start 2P', monospace",
                fontSize: "0.55rem",
                letterSpacing: "0.15em",
                color: "rgba(0,238,255,0.6)",
              }}
            >
              {activeSong.artist.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Grade letter */}
        <div
          className="mt-3 flex items-center justify-center select-none"
          style={{
            animation:
              "grade-stamp 0.7s 0.28s cubic-bezier(0.34,1.56,0.64,1) both",
          }}
        >
          <div
            style={{
              fontFamily: "'Press Start 2P', 'Courier New', monospace",
              fontSize: "clamp(4rem, 12vw, 6.5rem)",
              fontWeight: 400,
              lineHeight: 1,
              /* Brighter base color plus horizontal gradient for the shimmer */
              background: `linear-gradient(90deg, ${gradeColor} 0%, #ffffff 50%, ${gradeColor} 100%)`,
              backgroundSize: "200% 100%",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              /* Using text-shadow for browsers that don't support drop-shadow with text clip,
                 but keeping the heavy glow */
              filter: `drop-shadow(0 0 30px ${gradeColor}) drop-shadow(0 0 70px ${gradeColor}88)`,
              WebkitTextStroke: `2px ${gradeColor}`,
              /* Slower shimmer, starts slightly after the stamp animation */
              animation: "chrome-shimmer 3s 1s ease-in-out infinite alternate",
            }}
          >
            {gameResult.grade}
          </div>
        </div>

        {/* Stats panel — chrome framed */}
        <div
          className="mt-4 w-full max-w-sm chrome-frame"
          style={{
            animation: "results-fade-up 0.5s 0.55s ease-out both",
            background: "#0a0014",
          }}
        >
          {/* Panel header */}
          <div
            style={{
              textAlign: "center",
              padding: "6px 0",
              background: "#1a0033",
              borderBottom: "2px solid #443366",
            }}
          >
            <span
              style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: "0.6rem",
                letterSpacing: "0.2em",
                color: "#00eeff",
                textShadow: "0 0 8px rgba(0,238,255,0.5)",
              }}
            >
              RESULTS
            </span>
          </div>

          <div className="inner-bezel">
            <StatRow
              label="SCORE"
              value={String(Math.floor(gameResult.score)).padStart(9, "0")}
              color="var(--color-ddr-cyan)"
              isBig
              last={false}
            />
            <StatRow
              label="PERFECT"
              value={String(gameResult.perfect)}
              color="var(--color-chrome-light)"
              last={false}
            />
            <StatRow
              label="GREAT"
              value={String(gameResult.great)}
              color="var(--color-chrome-mid)"
              last={false}
            />
            <StatRow
              label="MISS"
              value={String(gameResult.miss)}
              color="var(--color-ddr-magenta)"
              last={false}
            />
            <StatRow
              label="MAX COMBO"
              value={String(gameResult.maxCombo)}
              color="var(--color-ddr-blue)"
              last={false}
            />
            <StatRow
              label="ACCURACY"
              value={`${gameResult.accuracy.toFixed(1)}%`}
              color="#00eeff"
              last={true}
            />
          </div>
        </div>

        {/* Song-ready notification banner */}
        {firstReadyEntry &&
          (() => {
            const [jobId, info] = firstReadyEntry;
            return (
              <div
                className="mt-3 w-full max-w-sm chrome-frame"
                style={{
                  animation: "results-fade-up 0.5s 0.65s ease-out both",
                  background: "#02040c",
                  borderColor: "var(--color-ddr-cyan)",
                }}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div
                    style={{
                      fontSize: 20,
                      color: "#66ff00",
                      textShadow: "0 0 10px rgba(102,255,0,0.7)",
                      flexShrink: 0,
                    }}
                  >
                    &#9835;
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "'Press Start 2P', monospace",
                        fontSize: "0.35rem",
                        letterSpacing: "0.15em",
                        color: "var(--color-ddr-cyan)",
                        marginBottom: 2,
                      }}
                    >
                      YOUR SONG IS READY
                    </div>
                    {info.title && (
                      <div
                        style={{
                          fontFamily: "'Bungee', sans-serif",
                          fontSize: "0.7rem",
                          color: "#f0e8ff",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {info.title}
                      </div>
                    )}
                  </div>
                  <button
                    className="arcade-btn shrink-0"
                    style={{
                      padding: "6px 14px",
                      background: "rgba(0,255,255,0.14)",
                      color: "var(--color-ddr-cyan)",
                      fontSize: "0.6rem",
                      textShadow: "0 0 8px rgba(0,255,255,0.6)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "rgba(0,255,255,0.26)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "rgba(0,255,255,0.14)";
                    }}
                    onClick={() => handlePlayReadySong(jobId, info.videoId)}
                  >
                    PLAY NOW
                  </button>
                </div>
              </div>
            );
          })()}

        {/* Action buttons */}
        <div
          className="flex gap-4 mt-4"
          style={{ animation: "results-fade-up 0.5s 0.72s ease-out both" }}
        >
          <ArcadeButton
            label="RETRY"
            color="var(--color-chrome-light)"
            onClick={handleRetry}
          />
          <ArcadeButton
            label="NEW SONG"
            color="var(--color-ddr-cyan)"
            onClick={handleNewSong}
          />
        </div>
      </div>
    </div>
  );
}

// -- Sub-components -----------------------------------------------------------

function StatRow({
  label,
  value,
  color,
  isBig,
  last,
}: {
  label: string;
  value: string;
  color: string;
  isBig?: boolean;
  last: boolean;
}) {
  return (
    <div
      className="flex justify-between items-center px-5 py-1.5"
      style={
        last ? undefined : { borderBottom: "1px solid rgba(68,0,170,0.3)" }
      }
    >
      <span
        style={{
          fontFamily: "'Bungee', 'Impact', sans-serif",
          fontSize: "0.75rem",
          letterSpacing: "0.15em",
          color: "rgba(0,238,255,0.55)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "'VT323', 'Courier New', monospace",
          fontWeight: 400,
          fontSize: isBig ? "2rem" : "1.65rem",
          color,
          textShadow: `0 0 10px ${color}66`,
          letterSpacing: "0.04em",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ArcadeButton({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      className="arcade-btn"
      style={{
        padding: "12px 32px",
        fontSize: "1rem",
        color,
        background: `${color}12`,
        textShadow: `0 0 12px ${color}66`,
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = `${color}25`;
        el.style.boxShadow = `0 0 28px ${color}44`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = `${color}12`;
        el.style.boxShadow = "";
      }}
    >
      {label}
    </button>
  );
}
