/**
 * Generates synthetic placeholder audio (WAV) and chart JSON files
 * for the 3 pre-loaded catalog songs.
 *
 * Usage: node scripts/generate-catalog-assets.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'frontend/public/audio');
const DATA_DIR = path.join(ROOT, 'frontend/public/data');

// ─────────────────────────────────────────────
// WAV generation helpers
// ─────────────────────────────────────────────

const SAMPLE_RATE = 44100;

function writeWavHeader(buf, offset, numSamples, numChannels = 1, sampleRate = SAMPLE_RATE) {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = numSamples * numChannels * 2;

  buf.write('RIFF', offset); offset += 4;
  buf.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buf.write('WAVE', offset); offset += 4;
  buf.write('fmt ', offset); offset += 4;
  buf.writeUInt32LE(16, offset); offset += 4;       // PCM
  buf.writeUInt16LE(1, offset); offset += 2;        // audio format
  buf.writeUInt16LE(numChannels, offset); offset += 2;
  buf.writeUInt32LE(sampleRate, offset); offset += 4;
  buf.writeUInt32LE(byteRate, offset); offset += 4;
  buf.writeUInt16LE(blockAlign, offset); offset += 2;
  buf.writeUInt16LE(16, offset); offset += 2;       // bits per sample
  buf.write('data', offset); offset += 4;
  buf.writeUInt32LE(dataSize, offset);
}

/**
 * Generate a click-track WAV for a given BPM and duration.
 * Each song gets a distinct base frequency so they sound different.
 */
function generateClickTrack({ bpm, duration, baseFreq, accentFreq, offbeatFreq }) {
  const numSamples = Math.ceil(SAMPLE_RATE * duration);
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + numSamples * 2);
  writeWavHeader(buf, 0, numSamples);

  const beatInterval = 60 / bpm;  // seconds per beat

  // Generate samples
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;  // time in seconds
    let sample = 0;

    // Beat phase within the current bar (4/4 time)
    const beatPos = (t / beatInterval) % 4;
    const beatFrac = t % beatInterval;

    // Click envelope: very short decay (20ms)
    const clickEnv = Math.max(0, 1 - beatFrac / 0.020);

    if (beatPos < 0.05) {
      // Downbeat (beat 1): accent frequency, louder
      sample += Math.sin(2 * Math.PI * accentFreq * beatFrac) * clickEnv * 28000;
    } else if (beatFrac < 0.020) {
      // Other beats: base frequency
      sample += Math.sin(2 * Math.PI * baseFreq * beatFrac) * clickEnv * 20000;
    }

    // Offbeat (8th notes) — subtle
    if (offbeatFreq) {
      const halfBeat = beatInterval / 2;
      const offFrac = t % halfBeat;
      if (offFrac < 0.012 && Math.abs(offFrac - (t % beatInterval)) > 0.05) {
        const offEnv = Math.max(0, 1 - offFrac / 0.012);
        sample += Math.sin(2 * Math.PI * offbeatFreq * offFrac) * offEnv * 8000;
      }
    }

    // Clamp and write
    const clamped = Math.max(-32768, Math.min(32767, Math.round(sample)));
    buf.writeInt16LE(clamped, headerSize + i * 2);
  }

  return buf;
}

// ─────────────────────────────────────────────
// Chart generation
// ─────────────────────────────────────────────

const DIRECTIONS = ['left', 'down', 'up', 'right'];

/**
 * Simple DDR-style arrow assignment: alternates columns with some variety.
 * Returns a Direction string.
 */
function pickDirection(noteIndex, isDownbeat, col) {
  // Use a deterministic but varied pattern
  const patterns = [
    ['left', 'down', 'up', 'right'],
    ['right', 'up', 'down', 'left'],
    ['down', 'left', 'right', 'up'],
    ['up', 'right', 'left', 'down'],
  ];
  const patternRow = Math.floor(noteIndex / 4) % 4;
  const patternCol = noteIndex % 4;
  return patterns[patternRow][patternCol];
}

/**
 * Generate a chart object for a given difficulty.
 */
function generateChart({ bpm, duration, difficulty }) {
  const beatInterval = 60 / bpm;
  const notes = [];

  if (difficulty === 'easy') {
    // Every 2 beats (half notes) → ~bpm/2 notes per minute
    const noteInterval = beatInterval * 2;
    let t = beatInterval; // start 1 beat in
    let noteIndex = 0;
    while (t < duration - 0.5) {
      notes.push({
        time: parseFloat(t.toFixed(4)),
        type: 'tap',
        direction: pickDirection(noteIndex, true, noteIndex % 4),
      });
      t += noteInterval;
      noteIndex++;
    }
  } else {
    // Every beat (quarter notes) + jumps every 8 beats → ~bpm notes per minute
    const noteInterval = beatInterval;
    let t = beatInterval;
    let noteIndex = 0;
    let barBeat = 0; // beat within bar (0-3)
    while (t < duration - 0.5) {
      const isStrongDownbeat = barBeat === 0 && noteIndex > 0 && noteIndex % 8 === 0;

      if (isStrongDownbeat) {
        // Jump: two simultaneous arrows
        const dir1 = pickDirection(noteIndex, true, 0);
        let dir2 = pickDirection(noteIndex + 1, false, 1);
        if (dir2 === dir1) dir2 = DIRECTIONS[(DIRECTIONS.indexOf(dir1) + 2) % 4];
        notes.push({
          time: parseFloat(t.toFixed(4)),
          type: 'tap',
          direction: [dir1, dir2],
        });
      } else {
        notes.push({
          time: parseFloat(t.toFixed(4)),
          type: 'tap',
          direction: pickDirection(noteIndex, barBeat === 0, noteIndex % 4),
        });
      }

      t += noteInterval;
      noteIndex++;
      barBeat = (barBeat + 1) % 4;
    }
  }

  return {
    difficulty,
    noteCount: notes.length,
    notes,
  };
}

// ─────────────────────────────────────────────
// Song definitions
// ─────────────────────────────────────────────

const SONGS = [
  {
    id: 'sandstorm',
    title: 'Sandstorm',
    artist: 'Darude',
    bpm: 136,
    duration: 90,
    segment_start: 0,
    offset: 0,
    featured: true,
    // Distinct click timbre: high piercing synth
    audio: { baseFreq: 880, accentFreq: 1760, offbeatFreq: 440 },
  },
  {
    id: 'butterfly',
    title: 'Butterfly',
    artist: 'Smile.dk',
    bpm: 154,
    duration: 90,
    segment_start: 0,
    offset: 0,
    featured: false,
    // Bright, bouncy timbre
    audio: { baseFreq: 660, accentFreq: 1320, offbeatFreq: 330 },
  },
  {
    id: 'blinding-lights',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    bpm: 171,
    duration: 90,
    segment_start: 0,
    offset: 0,
    featured: false,
    // Driving, punchy timbre
    audio: { baseFreq: 440, accentFreq: 880, offbeatFreq: 220 },
  },
];

// ─────────────────────────────────────────────
// Generate all assets
// ─────────────────────────────────────────────

console.log('Generating catalog assets...\n');

for (const song of SONGS) {
  console.log(`Processing: ${song.title} (${song.bpm} BPM)`);

  // 1. Generate audio
  const audioFilename = `${song.id}-segment.wav`;
  const audioPath = path.join(AUDIO_DIR, audioFilename);
  const audioBuf = generateClickTrack({
    bpm: song.bpm,
    duration: song.duration,
    ...song.audio,
  });
  fs.writeFileSync(audioPath, audioBuf);
  console.log(`  ✓ Audio: public/audio/${audioFilename} (${(audioBuf.length / 1024 / 1024).toFixed(1)} MB)`);

  // 2. Generate chart JSON
  const audioUrl = `/audio/${audioFilename}`;
  const chartData = {
    video_id: song.id,
    title: song.title,
    artist: song.artist,
    bpm: song.bpm,
    duration: song.duration,
    segment_start: song.segment_start,
    offset: song.offset,
    source: 'local',
    audio_url: audioUrl,
    charts: {
      easy: generateChart({ bpm: song.bpm, duration: song.duration, difficulty: 'easy' }),
      hard: generateChart({ bpm: song.bpm, duration: song.duration, difficulty: 'hard' }),
    },
  };

  const chartFilename = `${song.id}.json`;
  const chartPath = path.join(DATA_DIR, chartFilename);
  fs.writeFileSync(chartPath, JSON.stringify(chartData, null, 2));
  const easyCount = chartData.charts.easy.noteCount;
  const hardCount = chartData.charts.hard.noteCount;
  const easyRate = ((easyCount / song.duration) * 60).toFixed(0);
  const hardRate = ((hardCount / song.duration) * 60).toFixed(0);
  console.log(`  ✓ Chart: public/data/${chartFilename}`);
  console.log(`    Easy: ${easyCount} notes (${easyRate}/min), Hard: ${hardCount} notes (${hardRate}/min)`);
}

// 3. Generate catalog.json
const catalog = SONGS.map((song) => ({
  id: song.id,
  title: song.title,
  artist: song.artist,
  bpm: song.bpm,
  duration: song.duration,
  segment_start: song.segment_start,
  audio_url: `/audio/${song.id}-segment.wav`,
  thumbnail_url: `/images/thumbnails/${song.id}.svg`,
  featured: song.featured,
  chart_url: `/data/${song.id}.json`,
}));

const catalogPath = path.join(DATA_DIR, 'catalog.json');
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log(`\n✓ Catalog: public/data/catalog.json (${catalog.length} songs)`);
console.log('  Featured:', catalog.filter((s) => s.featured).map((s) => s.title).join(', '));

console.log('\nDone!');
