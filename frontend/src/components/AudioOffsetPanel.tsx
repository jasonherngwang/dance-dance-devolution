import { useState, useEffect, useCallback } from 'react';

export const AUDIO_OFFSET_KEY = 'ddd:audioOffset';
export const AUDIO_OFFSET_MIN = -200;
export const AUDIO_OFFSET_MAX = 200;
export const AUDIO_OFFSET_DEFAULT = 0;

/** Read the persisted audio offset from localStorage (ms, integer). */
export function getStoredAudioOffset(): number {
  try {
    const raw = localStorage.getItem(AUDIO_OFFSET_KEY);
    if (raw === null) return AUDIO_OFFSET_DEFAULT;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) return AUDIO_OFFSET_DEFAULT;
    return Math.max(AUDIO_OFFSET_MIN, Math.min(AUDIO_OFFSET_MAX, parsed));
  } catch {
    return AUDIO_OFFSET_DEFAULT;
  }
}

/** Persist the audio offset to localStorage. */
function storeAudioOffset(ms: number): void {
  try {
    localStorage.setItem(AUDIO_OFFSET_KEY, String(ms));
  } catch {
    // localStorage may be unavailable in some environments
  }
}

function formatOffset(ms: number): string {
  if (ms === 0) return '0 ms';
  return ms > 0 ? `+${ms} ms` : `${ms} ms`;
}

interface AudioOffsetPanelProps {
  onClose: () => void;
}

export function AudioOffsetPanel({ onClose }: AudioOffsetPanelProps) {
  const [offset, setOffset] = useState<number>(getStoredAudioOffset);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setOffset(value);
    storeAudioOffset(value);
  }, []);

  const handleReset = useCallback(() => {
    setOffset(AUDIO_OFFSET_DEFAULT);
    storeAudioOffset(AUDIO_OFFSET_DEFAULT);
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const thumbColor = offset === 0 ? '#00eeff' : offset > 0 ? '#ff6600' : '#ff00cc';

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(10,0,20,0.88)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="relative w-full max-w-sm mx-4 p-6 chrome-frame"
        style={{
          background: 'rgba(10,0,20,0.97)',
        }}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-4 text-lg leading-none"
          style={{ color: 'rgba(240,232,255,0.35)', cursor: 'pointer' }}
          onClick={onClose}
          aria-label="Close settings"
        >
          &#10005;
        </button>

        {/* Header */}
        <h2
          className="mb-1"
          style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '0.6rem',
            letterSpacing: '0.2em',
            color: '#00eeff',
            textShadow: '0 0 12px rgba(0,238,255,0.7)',
          }}
        >
          SETTINGS
        </h2>
        <p className="mb-6" style={{
          fontFamily: "'Bungee', sans-serif",
          fontSize: '0.5rem',
          letterSpacing: '0.15em',
          color: 'rgba(240,232,255,0.28)',
        }}>
          AUDIO SYNC CALIBRATION
        </p>

        {/* Offset display */}
        <div className="flex items-baseline justify-between mb-2">
          <span style={{
            fontFamily: "'Bungee', sans-serif",
            fontSize: '0.55rem',
            letterSpacing: '0.15em',
            color: 'rgba(240,232,255,0.45)',
          }}>
            AUDIO OFFSET
          </span>
          <span
            className="led-display"
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '2.2rem',
              color: thumbColor,
              textShadow: `0 0 12px ${thumbColor}`,
              minWidth: '7rem',
              textAlign: 'right',
              padding: '2px 8px',
            }}
          >
            {formatOffset(offset)}
          </span>
        </div>

        {/* Slider */}
        <input
          type="range"
          min={AUDIO_OFFSET_MIN}
          max={AUDIO_OFFSET_MAX}
          step={1}
          value={offset}
          onChange={handleChange}
          className="w-full"
          style={{ accentColor: thumbColor }}
          aria-label={`Audio offset: ${formatOffset(offset)}`}
        />

        {/* Range labels */}
        <div className="flex justify-between mt-1 mb-5">
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'rgba(255,0,204,0.5)' }}>-200 ms</span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'rgba(240,232,255,0.2)' }}>0</span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'rgba(255,102,0,0.5)' }}>+200 ms</span>
        </div>

        {/* Help text */}
        <p className="leading-relaxed mb-5" style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1rem',
          color: 'rgba(240,232,255,0.35)',
        }}>
          Increase if arrows feel early (hit too late). Decrease if arrows feel late (hit too early).
          Bluetooth headphones typically need +50-150 ms.
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            className="flex-1 arcade-btn"
            style={{
              padding: '8px 0',
              fontSize: '0.6rem',
              color: 'rgba(240,232,255,0.4)',
            }}
            onClick={handleReset}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f0e8ff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(240,232,255,0.4)'; }}
          >
            RESET
          </button>
          <button
            className="flex-1 arcade-btn"
            style={{
              padding: '8px 0',
              fontSize: '0.6rem',
              background: 'rgba(0,238,255,0.1)',
              color: '#00eeff',
              textShadow: '0 0 8px rgba(0,238,255,0.7)',
            }}
            onClick={onClose}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,238,255,0.18)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,238,255,0.1)'; }}
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}
