import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useJobStore } from "@/stores/jobStore";
import { useGameStore } from "@/stores";
import type { JobStatus, JobStatusType } from "@/types";
import type { ChartData } from "@/types";
import { saveRecentlyPlayed } from "@/utils/recentlyPlayed";

// -- Pipeline step definitions ------------------------------------------------

type StepKey = "extract" | "analyze" | "generate" | "complete";

interface PipelineStep {
  key: StepKey;
  label: string;
  description: string;
  activeStatuses: JobStatusType[];
  doneStatuses: JobStatusType[];
}

const STEPS: PipelineStep[] = [
  {
    key: "extract",
    label: "Extract Audio",
    description:
      "yt-dlp downloads the video and extracts audio as a WAV file at 22 kHz mono.",
    activeStatuses: ["queued", "extracting"],
    doneStatuses: ["analyzing", "generating", "complete"],
  },
  {
    key: "analyze",
    label: "Analyze Audio",
    description:
      "librosa detects BPM via autocorrelation, locates beat frames, and measures onset energy.",
    activeStatuses: ["analyzing"],
    doneStatuses: ["generating", "complete"],
  },
  {
    key: "generate",
    label: "Generate Chart",
    description:
      "A sliding-window algorithm picks the best 90-second segment, then places notes on a 16th-note grid.",
    activeStatuses: ["generating"],
    doneStatuses: ["complete"],
  },
  {
    key: "complete",
    label: "Ready",
    description: "Chart is cached in SQLite and delivered to the frontend.",
    activeStatuses: [],
    doneStatuses: ["complete"],
  },
];

function getStepState(
  step: PipelineStep,
  status: JobStatusType,
): "pending" | "active" | "done" {
  if (step.doneStatuses.includes(status)) return "done";
  if (step.activeStatuses.includes(status)) return "active";
  return "pending";
}

// -- Background ---------------------------------------------------------------

function NeonBg() {
  return (
    <>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            repeating-linear-gradient(45deg, rgba(68,0,170,0.06) 0px, rgba(68,0,170,0.06) 1px, transparent 1px, transparent 24px),
            repeating-linear-gradient(-45deg, rgba(68,0,170,0.06) 0px, rgba(68,0,170,0.06) 1px, transparent 1px, transparent 24px)
          `,
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 0%, rgba(10,0,20,0.92) 100%)",
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 3px)",
          backgroundSize: "100% 3px",
        }}
      />
    </>
  );
}

// -- Main component -----------------------------------------------------------

export default function LoadingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const startPolling = useJobStore((s) => s.startPolling);
  const stopPolling = useJobStore((s) => s.stopPolling);
  const setActiveSong = useGameStore((s) => s.setActiveSong);
  const resetGame = useGameStore((s) => s.resetGame);

  const ytUrl: string =
    (location.state as { ytUrl?: string } | null)?.ytUrl ?? "";

  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkUnreachable, setNetworkUnreachable] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [showBehind, setShowBehind] = useState(false);

  const navigatedRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const lastProgressRef = useRef<{ value: number; time: number }>({
    value: 0,
    time: Date.now(),
  });

  useEffect(() => {
    if (!ytUrl) {
      setError("No YouTube URL provided. Please go back and enter a URL.");
      return;
    }

    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const ANALYSIS_TIMEOUT_MS = 3 * 60 * 1000;
    timeoutHandle = setTimeout(() => {
      if (!cancelled && !navigatedRef.current) {
        setTimedOut(true);
      }
    }, ANALYSIS_TIMEOUT_MS);

    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ytUrl }),
    })
      .then(async (res) => {
        if (res.status === 429) {
          const body = await res
            .json()
            .catch(() => ({ detail: "Rate limit exceeded" }));
          throw new Error(
            body.detail ??
              "Too many requests. Please wait a moment before trying again.",
          );
        }
        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ detail: "Server error" }));
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ job_id: string }>;
      })
      .then(({ job_id }) => {
        if (cancelled) return;
        jobIdRef.current = job_id;

        startPolling(
          job_id,
          (status) => {
            if (!cancelled) {
              setJobStatus(status);
              setNetworkUnreachable(false);
              const p = status.progress ?? 0;
              if (p !== lastProgressRef.current.value) {
                lastProgressRef.current = { value: p, time: Date.now() };
              }
            }
          },
          (status) => {
            if (cancelled || navigatedRef.current) return;
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }
            setTimedOut(false);
            const finalState = status.state ?? status.status;
            if (finalState === "error") {
              setError(
                status.message ??
                  "Analysis failed. Please try a different URL.",
              );
              return;
            }
            if (!status.video_id) {
              setError("Video ID missing from job status. Please try again.");
              return;
            }
            fetchChartAndNavigate(status.video_id);
          },
          () => {
            if (!cancelled) setNetworkUnreachable(true);
          },
        );
      })
      .catch((err) => {
        if (!cancelled) {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          const message = String(err.message ?? err);
          if (
            message === "Failed to fetch" ||
            message.includes("NetworkError")
          ) {
            setNetworkUnreachable(true);
          } else {
            setError(message);
          }
        }
      });

    return () => {
      cancelled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (jobIdRef.current) stopPolling(jobIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytUrl]);

  const fetchChartAndNavigate = useCallback(
    async (videoId: string) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;

      try {
        const res = await fetch(`/api/chart/${videoId}`);
        if (!res.ok) throw new Error(`Chart not found (${res.status})`);
        const chart: ChartData = await res.json();
        saveRecentlyPlayed({
          video_id: videoId,
          title: chart.title ?? "Unknown",
          artist: chart.artist ?? undefined,
          bpm: chart.bpm ?? undefined,
        });
        resetGame();
        setActiveSong(chart, "easy");
        navigate("/play");
      } catch (err) {
        navigatedRef.current = false;
        setError(`Failed to load chart: ${String((err as Error).message)}`);
      }
    },
    [navigate, setActiveSong, resetGame],
  );

  const status = jobStatus?.state ?? (error ? "error" : "queued");
  const progress = jobStatus?.progress ?? 0;
  const detectedTitle = jobStatus?.title;
  const detectedBpm = jobStatus?.bpm;

  const statusLabel: Record<string, string> = {
    queued: "Waiting in queue...",
    extracting: "Extracting audio...",
    analyzing: "Analyzing audio...",
    generating: "Generating chart...",
    complete: "Chart ready! Loading...",
    error: "Analysis failed",
  };

  return (
    <div
      className="relative h-full w-full"
      style={
        { overflowY: "auto", scrollbarWidth: "none" } as React.CSSProperties
      }
    >
      <NeonBg />

      <div className="relative z-10 flex flex-col items-center px-4 pt-12 pb-24 min-h-full max-w-lg mx-auto">
        {/* Header */}
        <button
          className="self-start mb-8 arcade-btn"
          style={{
            padding: "4px 12px",
            fontSize: "0.6rem",
            color: "rgba(240,232,255,0.4)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "#00eeff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color =
              "rgba(240,232,255,0.4)";
          }}
          onClick={() => navigate("/")}
        >
          BACK
        </button>

        <h1
          className="text-center"
          style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: "clamp(0.9rem, 3vw, 1.5rem)",
            letterSpacing: "0.1em",
            color: "var(--color-ddr-cyan)",
            textShadow: "0 0 18px rgba(0,255,255,0.7)",
          }}
        >
          ANALYZING
        </h1>

        {/* Sleek scanner rule */}
        <div className="rainbow-rule w-3/5 max-w-xs mt-3 opacity-70" />

        {/* URL display */}
        {ytUrl && (
          <p
            className="mt-3 text-center max-w-full truncate px-4"
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: "0.95rem",
              color: "rgba(240,232,255,0.3)",
            }}
            title={ytUrl}
          >
            {ytUrl}
          </p>
        )}

        {/* Error state */}
        {error && (
          <div
            className="mt-8 w-full p-5 text-center chrome-frame"
            style={{ background: "rgba(255,0,51,0.06)" }}
          >
            <p
              style={{
                fontFamily: "'Bungee', sans-serif",
                fontSize: "0.8rem",
                color: "#ff0033",
                marginBottom: 4,
              }}
            >
              Analysis Failed
            </p>
            <p
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: "1rem",
                color: "rgba(240,232,255,0.5)",
              }}
            >
              {error}
            </p>
            <button
              className="mt-4 arcade-btn"
              style={{
                padding: "8px 20px",
                fontSize: "0.6rem",
                color: "rgba(240,232,255,0.5)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "#00eeff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color =
                  "rgba(240,232,255,0.5)";
              }}
              onClick={() => navigate("/")}
            >
              TRY ANOTHER URL
            </button>
          </div>
        )}

        {/* Network unreachable banner */}
        {!error && networkUnreachable && (
          <div
            className="mt-8 w-full p-5 text-center chrome-frame"
            style={{ background: "rgba(255,102,0,0.06)" }}
          >
            <p
              style={{
                fontFamily: "'Bungee', sans-serif",
                fontSize: "0.8rem",
                color: "#ff6600",
                marginBottom: 4,
              }}
            >
              Server Unavailable
            </p>
            <p
              className="mb-4"
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: "1rem",
                color: "rgba(240,232,255,0.5)",
              }}
            >
              Cannot reach the server. Retrying automatically.
            </p>
            <div className="flex justify-center gap-3">
              <button
                className="arcade-btn"
                style={{
                  padding: "8px 20px",
                  fontSize: "0.6rem",
                  color: "#ff6600",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(255,102,0,0.1)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
                }}
                onClick={() => {
                  setNetworkUnreachable(false);
                  navigate("/loading", { state: { ytUrl } });
                }}
              >
                RETRY
              </button>
              <button
                className="arcade-btn"
                style={{
                  padding: "8px 20px",
                  fontSize: "0.6rem",
                  color: "rgba(240,232,255,0.45)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "#00eeff";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(240,232,255,0.45)";
                }}
                onClick={() => navigate("/")}
              >
                GO BACK
              </button>
            </div>
          </div>
        )}

        {/* Timeout warning */}
        {!error && !networkUnreachable && timedOut && (
          <div
            className="mt-4 w-full px-4 py-3 chrome-frame"
            style={{ background: "rgba(255,102,0,0.05)" }}
          >
            <p
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: "1rem",
                color: "#ff6600",
              }}
            >
              Taking longer than expected. The server may be under load.
            </p>
            <button
              className="mt-2 underline"
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: "1rem",
                color: "rgba(240,232,255,0.4)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "#00eeff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color =
                  "rgba(240,232,255,0.4)";
              }}
              onClick={() => {
                setTimedOut(false);
                navigate("/loading", { state: { ytUrl } });
              }}
            >
              Retry with a fresh request
            </button>
          </div>
        )}

        {!error && !networkUnreachable && (
          <>
            {/* Progress bar */}
            <div className="mt-10 w-full">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  {status !== "complete" && status !== "error" && (
                    <div
                      className="neon-spinner"
                      style={{
                        width: 12,
                        height: 12,
                        borderWidth: 2,
                        borderColor: "var(--color-chrome-dark)",
                        borderTopColor: "var(--color-ddr-cyan)",
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontFamily: "'Bungee', sans-serif",
                      fontSize: "0.65rem",
                      letterSpacing: "0.1em",
                      color: "var(--color-ddr-cyan)",
                      textShadow: "0 0 8px rgba(0,255,255,0.5)",
                    }}
                  >
                    {statusLabel[status] ?? "Processing..."}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "'VT323', monospace",
                    fontSize: "1.3rem",
                    color: "rgba(240,232,255,0.45)",
                  }}
                >
                  {progress}%
                </span>
              </div>
              <div
                className="w-full h-2 relative overflow-hidden chrome-frame"
                style={{
                  background: "rgba(10,0,20,0.9)",
                  padding: 0,
                  borderWidth: 2,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${progress}%`,
                    background:
                      progress === 100
                        ? "linear-gradient(90deg, var(--color-ddr-cyan), var(--color-ddr-blue))"
                        : "linear-gradient(90deg, var(--color-chrome-mid), var(--color-chrome-light))",
                    boxShadow:
                      progress === 100
                        ? "0 0 12px rgba(0,255,255,0.6)"
                        : "0 0 12px rgba(255,255,255,0.3)",
                    transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
                {progress > 0 && progress < 100 && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${progress - 8}%`,
                      top: 0,
                      bottom: 0,
                      width: "8%",
                      background:
                        "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                      animation: "loading-shimmer 1.2s ease-in-out infinite",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Detected metadata */}
            {(detectedTitle || detectedBpm) && (
              <div
                className="mt-4 w-full px-4 py-3 flex items-center gap-4 chrome-frame"
                style={{ background: "rgba(0,255,255,0.04)" }}
              >
                <div
                  style={{ fontSize: "1.2rem", color: "var(--color-ddr-cyan)" }}
                >
                  &#9835;
                </div>
                <div className="flex-1 min-w-0">
                  {detectedTitle && (
                    <div
                      className="truncate"
                      style={{
                        fontFamily: "'Bungee', sans-serif",
                        fontSize: "0.75rem",
                        color: "rgba(240,232,255,0.88)",
                        textShadow: "0 0 8px rgba(102,255,0,0.3)",
                      }}
                    >
                      {detectedTitle}
                    </div>
                  )}
                  {detectedBpm && (
                    <div
                      style={{
                        fontFamily: "'VT323', monospace",
                        fontSize: "1.1rem",
                        color: "rgba(0,255,255,0.75)",
                        marginTop: 2,
                      }}
                    >
                      {Math.round(detectedBpm)} BPM detected
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pipeline step indicators */}
            <div className="mt-8 w-full space-y-2">
              {STEPS.map((step) => {
                const state = getStepState(step, status as JobStatusType);
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontFamily: "'Press Start 2P', monospace",
                        background:
                          state === "done"
                            ? "rgba(0,255,255,0.18)"
                            : state === "active"
                              ? "rgba(255,255,255,0.18)"
                              : "rgba(255,255,255,0.04)",
                        border:
                          state === "done"
                            ? "1px solid rgba(0,255,255,0.5)"
                            : state === "active"
                              ? "1px solid rgba(255,255,255,0.5)"
                              : "1px solid rgba(240,232,255,0.1)",
                        color:
                          state === "done"
                            ? "var(--color-ddr-cyan)"
                            : state === "active"
                              ? "var(--color-ddr-white)"
                              : "rgba(240,232,255,0.2)",
                        boxShadow:
                          state === "active"
                            ? "0 0 8px rgba(255,255,255,0.35)"
                            : "none",
                      }}
                    >
                      {state === "done"
                        ? "\u2605"
                        : state === "active"
                          ? "\u25CF"
                          : "\u25CB"}
                    </div>

                    <span
                      style={{
                        fontFamily: "'Bungee', sans-serif",
                        fontSize: "0.7rem",
                        letterSpacing: "0.05em",
                        color:
                          state === "done"
                            ? "rgba(0,255,255,0.8)"
                            : state === "active"
                              ? "var(--color-ddr-white)"
                              : "rgba(240,232,255,0.22)",
                        textShadow:
                          state === "active"
                            ? "0 0 8px rgba(255,255,255,0.5)"
                            : "none",
                      }}
                    >
                      {step.label}
                      {state === "active" && (
                        <span style={{ opacity: 0.6 }}> — in progress</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Behind the scenes */}
            <div className="mt-6 w-full">
              <button
                className="w-full flex items-center justify-between px-4 py-3 arcade-btn"
                style={{
                  fontSize: "0.6rem",
                  color: "rgba(240,232,255,0.35)",
                  background: "rgba(255,255,255,0.03)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(240,232,255,0.6)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(240,232,255,0.35)";
                }}
                onClick={() => setShowBehind((prev) => !prev)}
              >
                <span>BEHIND THE SCENES</span>
                <span style={{ fontSize: 10 }}>
                  {showBehind ? "\u25B2" : "\u25BC"}
                </span>
              </button>
              {showBehind && (
                <div
                  className="px-4 py-4 space-y-4 inner-bezel"
                  style={{ borderTop: "none" }}
                >
                  {STEPS.map((step) => (
                    <div key={step.key}>
                      <div
                        style={{
                          fontFamily: "'Bungee', sans-serif",
                          fontSize: "0.6rem",
                          letterSpacing: "0.08em",
                          color: "rgba(0,255,255,0.8)",
                          marginBottom: 4,
                        }}
                      >
                        {step.label}
                      </div>
                      <div
                        style={{
                          fontFamily: "'VT323', monospace",
                          fontSize: "1rem",
                          lineHeight: 1.4,
                          color: "rgba(240,232,255,0.42)",
                        }}
                      >
                        {step.description}
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: "1rem",
                      lineHeight: 1.4,
                      color: "rgba(240,232,255,0.28)",
                      paddingTop: 8,
                      borderTop: "1px solid rgba(68,0,170,0.2)",
                    }}
                  >
                    Results are cached in SQLite — re-analyzing the same video
                    is instant. WebGPU renders the game at up to 120 fps using
                    instanced meshes for zero-allocation arrow rendering.
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
