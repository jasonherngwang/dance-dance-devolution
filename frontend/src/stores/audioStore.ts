import { create } from 'zustand';

export type AudioSourceType = 'local' | 'youtube';

interface AudioStore {
  currentTime: number;        // Current playback position in seconds
  isPlaying: boolean;
  sourceType: AudioSourceType;

  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSourceType: (type: AudioSourceType) => void;

  reset: () => void;
}

export const useAudioStore = create<AudioStore>((set) => ({
  currentTime: 0,
  isPlaying: false,
  sourceType: 'local',

  setCurrentTime: (time) => set({ currentTime: time }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSourceType: (type) => set({ sourceType: type }),

  reset: () => set({ currentTime: 0, isPlaying: false, sourceType: 'local' }),
}));
