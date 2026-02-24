import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GameCanvas } from "@/components/GameCanvas";
import { useGameStore } from "@/stores";

export default function GameplayScreen() {
  const navigate = useNavigate();
  const activeSong = useGameStore((state) => state.activeSong);
  const activeDifficulty = useGameStore((state) => state.activeDifficulty);
  const gameState = useGameStore((state) => state.gameState);
  const giveUp = useGameStore((state) => state.giveUp);

  // Redirect to home if no song is loaded (e.g. direct URL navigation or page refresh).
  useEffect(() => {
    if (activeSong === null) {
      navigate("/", { replace: true });
    }
  }, [activeSong, navigate]);

  // Navigate to results when the game ends.
  useEffect(() => {
    if (gameState === "ended" && activeSong !== null) {
      navigate("/results");
    }
  }, [gameState, activeSong, navigate]);

  return (
    <div className="h-full w-full bg-game-bg relative select-none">
      <GameCanvas chartData={activeSong} difficulty={activeDifficulty} />

      {/* In-game controls — bottom-right, unobtrusive */}
      <div className="absolute bottom-4 right-4 flex gap-2 z-10">
        <button
          className="arcade-btn"
          onClick={() => navigate("/")}
          style={{
            padding: "6px 14px",
            fontSize: "0.7rem",
            background: "rgba(0,0,0,0.65)",
            color: "rgba(200,160,255,0.7)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color =
              "var(--color-chrome-light)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color =
              "rgba(200,160,255,0.7)";
          }}
        >
          BACK
        </button>
        {activeSong !== null && (
          <button
            className="arcade-btn"
            onClick={giveUp}
            style={{
              padding: "6px 14px",
              fontSize: "0.7rem",
              background: "rgba(0,0,0,0.65)",
              color: "rgba(255,120,120,0.7)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "var(--color-ddr-magenta)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "rgba(255,120,120,0.7)";
            }}
          >
            GIVE UP
          </button>
        )}
      </div>
    </div>
  );
}
