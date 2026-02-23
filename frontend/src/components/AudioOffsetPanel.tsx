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

  const thumbColor = offset === 0 ? '#00ffff' : offset > 0 ? '#ff8800' : '#ff00ff';

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(8,8,16,0.88)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="relative w-full max-w-sm mx-4 p-6"
        style={{
          background: 'rgba(8,8,24,0.97)',
          border: '1px solid rgba(0,255,255,0.25)',
          boxShadow: '0 0 48px rgba(0,255,255,0.1), inset 0 0 32px rgba(0,255,255,0.03)',
        }}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-4 text-lg leading-none"
          style={{ color: 'rgba(255,255,255,0.35)', cursor: 'pointer' }}
          onClick={onClose}
          aria-label="Close settings"
        >
          ✕
        </button>

        {/* Header */}
        <h2
          className="text-sm font-black tracking-[0.3em] mb-1"
          style={{ color: '#00ffff', textShadow: '0 0 12px rgba(0,255,255,0.7)' }}
        >
          SETTINGS
        </h2>
        <p className="text-xs tracking-widest mb-6" style={{ color: 'rgba(255,255,255,0.28)' }}>
          AUDIO SYNC CALIBRATION
        </p>

        {/* Offset display */}
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            AUDIO OFFSET
          </span>
          <span
            className="text-2xl font-black tabular-nums"
            style={{
              color: thumbColor,
              textShadow: `0 0 12px ${thumbColor}`,
              minWidth: '6rem',
              textAlign: 'right',
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
          className="w-full audio-offset-slider"
          style={{ accentColor: thumbColor }}
          aria-label={`Audio offset: ${formatOffset(offset)}`}
        />

        {/* Range labels */}
        <div className="flex justify-between mt-1 mb-5">
          <span className="text-xs" style={{ color: 'rgba(255,0,255,0.5)' }}>−200 ms</span>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>0</span>
          <span className="text-xs" style={{ color: 'rgba(255,136,0,0.5)' }}>+200 ms</span>
        </div>

        {/* Help text */}
        <p className="text-xs leading-relaxed mb-5" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Increase if arrows feel early (hit too late). Decrease if arrows feel late (hit too early).
          Bluetooth headphones typically need +50–150 ms.
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            className="flex-1 py-2 text-xs font-bold tracking-widest transition-all duration-150"
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
            }}
            onClick={handleReset}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'; }}
          >
            RESET
          </button>
          <button
            className="flex-1 py-2 text-xs font-bold tracking-widest transition-all duration-150"
            style={{
              background: 'rgba(0,255,255,0.1)',
              border: '1px solid rgba(0,255,255,0.35)',
              color: '#00ffff',
              textShadow: '0 0 8px rgba(0,255,255,0.7)',
              cursor: 'pointer',
            }}
            onClick={onClose}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,255,0.18)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,255,0.1)'; }}
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}
