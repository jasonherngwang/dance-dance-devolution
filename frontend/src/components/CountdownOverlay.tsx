import { useCallback, useEffect, useRef } from "react";

/**
 * Countdown phase values:
 *   3 / 2 / 1  → show the corresponding number
 *   0          → show "GO!"
 *  -1          → hide overlay
 */
export type CountdownPhase = -1 | 0 | 1 | 2 | 3;

interface CountdownOverlayProps {
  onRegisterUpdate: (fn: (phase: CountdownPhase) => void) => void;
  isActive: boolean;
}

// Per-phase colors (retro DDR palette)
const PHASE_COLOR: Record<number, string> = {
  3: "#00eeff", // cyan
  2: "#00eeff", // cyan
  1: "#ff6600", // orange
  0: "#66ff00", // lime green (GO!)
};

let sharedAudioCtx: AudioContext | null = null;

function playBeep(phase: number) {
  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume();
    }

    const osc = sharedAudioCtx.createOscillator();
    const gainNode = sharedAudioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(sharedAudioCtx.destination);

    osc.type = "square";

    if (phase === 0) {
      // GO! - Higher pitch, longer sustain
      osc.frequency.setValueAtTime(880, sharedAudioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.07, sharedAudioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        sharedAudioCtx.currentTime + 0.4,
      );
      osc.start();
      osc.stop(sharedAudioCtx.currentTime + 0.4);
    } else if (phase > 0) {
      // 3, 2, 1 - Mid pitch, short blip
      osc.frequency.setValueAtTime(440, sharedAudioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.05, sharedAudioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        sharedAudioCtx.currentTime + 0.15,
      );
      osc.start();
      osc.stop(sharedAudioCtx.currentTime + 0.15);
    }
  } catch (e) {
    console.warn("Countdown beep failed (possibly autoplay restricted)", e);
  }
}

export function CountdownOverlay({
  onRegisterUpdate,
  isActive,
}: CountdownOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const lastPhaseRef = useRef<CountdownPhase>(-1);

  const updatePhase = useCallback((phase: CountdownPhase) => {
    if (phase === lastPhaseRef.current) return;
    lastPhaseRef.current = phase;

    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    if (phase === -1) {
      container.style.opacity = "0";
      return;
    }

    container.style.opacity = "1";

    // Play arcade audio!
    playBeep(phase);

    const label = phase === 0 ? "GO!" : String(phase);
    const color = PHASE_COLOR[phase] ?? "#ffffff";

    text.textContent = label;
    text.style.color = color;
    text.style.textShadow = [
      `0 0 20px ${color}`,
      `0 0 50px ${color}`,
      `0 0 100px ${color}`,
      "0 2px 6px rgba(0,0,0,0.9)",
    ].join(", ");

    for (const anim of text.getAnimations()) anim.cancel();

    if (phase === 0) {
      text.animate(
        [
          { transform: "scale(0.5)", opacity: "0", offset: 0 },
          { transform: "scale(1.18)", opacity: "1", offset: 0.28 },
          { transform: "scale(1.0)", opacity: "1", offset: 0.6 },
          { transform: "scale(1.35)", opacity: "0", offset: 1 },
        ],
        { duration: 600, easing: "ease-out", fill: "forwards" },
      );
    } else {
      text.animate(
        [
          {
            transform: "scale(2.5)",
            opacity: "0",
            filter: "blur(16px)",
            offset: 0,
          },
          {
            transform: "scale(1.0)",
            opacity: "1",
            filter: "blur(0px)",
            offset: 0.2,
          },
          {
            transform: "scale(1.0)",
            opacity: "1",
            filter: "blur(0px)",
            offset: 0.75,
          },
          {
            transform: "scale(0.82)",
            opacity: "0",
            filter: "blur(6px)",
            offset: 1,
          },
        ],
        { duration: 1000, easing: "ease-out", fill: "forwards" },
      );
    }
  }, []);

  useEffect(() => {
    onRegisterUpdate(updatePhase);
  }, [onRegisterUpdate, updatePhase]);

  if (!isActive) return null;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
      style={{ opacity: 0 }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 40% 30% at 50% 50%, rgba(0,0,0,0.45) 0%, transparent 100%)",
        }}
      />
      <span
        ref={textRef}
        style={{
          display: "inline-block",
          position: "relative",
          fontFamily: "'Press Start 2P', 'Courier New', monospace",
          fontSize: "clamp(3rem, 12vw, 7rem)",
          fontWeight: 400,
          letterSpacing: "0.02em",
          lineHeight: 1,
          willChange: "transform, opacity",
        }}
      />
    </div>
  );
}
