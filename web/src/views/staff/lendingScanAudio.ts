export type LendingScanAudioCue = "success" | "manual-pass" | "error" | "timeout";

type ToneSpec = {
  frequency: number;
  durationMs: number;
  gain: number;
  pauseAfterMs?: number;
  sweepTo?: number;
};

type CueSpec = {
  audioVolume: number;
  fallbackWaveform: OscillatorType;
  fallbackPeakGain: number;
  tones: ToneSpec[];
};

type ScanAudioController = {
  prime: () => void;
  play: (cue: LendingScanAudioCue, enabled: boolean) => void;
  dispose: () => void;
};

const SAMPLE_RATE = 24_000;

const cueSpecs: Record<LendingScanAudioCue, CueSpec> = {
  success: {
    audioVolume: 0.92,
    fallbackWaveform: "sine",
    fallbackPeakGain: 0.11,
    tones: [
      { frequency: 659.25, durationMs: 150, gain: 0.54, pauseAfterMs: 26 },
      { frequency: 783.99, durationMs: 155, gain: 0.58, pauseAfterMs: 28 },
      { frequency: 987.77, durationMs: 180, gain: 0.62, sweepTo: 1046.5 },
    ],
  },
  "manual-pass": {
    audioVolume: 1,
    fallbackWaveform: "square",
    fallbackPeakGain: 0.18,
    tones: [
      { frequency: 932.33, durationMs: 150, gain: 0.92, pauseAfterMs: 55, sweepTo: 880.0 },
      { frequency: 659.25, durationMs: 150, gain: 0.84, pauseAfterMs: 42 },
      { frequency: 932.33, durationMs: 150, gain: 0.92, pauseAfterMs: 55, sweepTo: 880.0 },
      { frequency: 659.25, durationMs: 150, gain: 0.84, pauseAfterMs: 42 },
      { frequency: 523.25, durationMs: 240, gain: 0.9 },
    ],
  },
  error: {
    audioVolume: 0.96,
    fallbackWaveform: "triangle",
    fallbackPeakGain: 0.12,
    tones: [
      { frequency: 392.0, durationMs: 190, gain: 0.66, pauseAfterMs: 28, sweepTo: 349.23 },
      { frequency: 311.13, durationMs: 240, gain: 0.7, sweepTo: 261.63 },
    ],
  },
  timeout: {
    audioVolume: 0.96,
    fallbackWaveform: "triangle",
    fallbackPeakGain: 0.13,
    tones: [
      { frequency: 523.25, durationMs: 165, gain: 0.64, pauseAfterMs: 30 },
      { frequency: 392.0, durationMs: 180, gain: 0.7, pauseAfterMs: 34 },
      { frequency: 293.66, durationMs: 240, gain: 0.76, sweepTo: 261.63 },
    ],
  },
};

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null)
  );
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") return "";
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1_024) {
    const chunk = bytes.subarray(index, index + 1_024);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildCueSamples(cue: LendingScanAudioCue): Float32Array {
  const spec = cueSpecs[cue];
  let sampleCount = Math.round(SAMPLE_RATE * 0.05);
  spec.tones.forEach((tone) => {
    sampleCount += Math.round((tone.durationMs + (tone.pauseAfterMs ?? 0)) * SAMPLE_RATE / 1_000);
  });

  const samples = new Float32Array(sampleCount);
  let cursor = Math.round(SAMPLE_RATE * 0.02);

  spec.tones.forEach((tone, toneIndex) => {
    const toneSamples = Math.max(1, Math.round(tone.durationMs * SAMPLE_RATE / 1_000));
    for (let index = 0; index < toneSamples; index += 1) {
      const progress = index / toneSamples;
      const attack = Math.min(1, progress / 0.08);
      const release = Math.min(1, (1 - progress) / 0.18);
      const envelope = Math.min(attack, release);
      const frequency = tone.sweepTo
        ? tone.frequency + (tone.sweepTo - tone.frequency) * progress
        : tone.frequency;
      const phase = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
      const shimmer = cue === "success" ? 0.24 : cue === "manual-pass" ? 0.46 : 0.18;
      const upper = Math.sin(phase * 2) * shimmer;
      const bright = Math.sin(phase * 3) * (cue === "manual-pass" ? 0.12 : 0.06);
      const body = Math.sin(phase);
      samples[cursor + index] = (body + upper + bright) * tone.gain * envelope;
    }

    if (cue === "manual-pass" && toneIndex < spec.tones.length - 1) {
      const clickLength = Math.round(SAMPLE_RATE * 0.01);
      for (let index = 0; index < clickLength; index += 1) {
        const clickProgress = 1 - index / clickLength;
        samples[cursor + toneSamples + index] += ((index % 2 === 0 ? 1 : -1) * 0.08 * clickProgress);
      }
    }

    cursor += toneSamples + Math.round((tone.pauseAfterMs ?? 0) * SAMPLE_RATE / 1_000);
  });

  return samples;
}

function buildCueDataUrl(cue: LendingScanAudioCue): string {
  const samples = buildCueSamples(cue);
  const byteLength = samples.length * 2;
  const bytes = new Uint8Array(44 + byteLength);
  const view = new DataView(bytes.buffer);

  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + byteLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, byteLength, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  const base64 = encodeBase64(bytes);
  return base64 ? `data:audio/wav;base64,${base64}` : "";
}

function playFallbackCue(
  cue: LendingScanAudioCue,
  contextRef: { current: AudioContext | null }
): void {
  const context = contextRef.current;
  if (!context) return;

  const spec = cueSpecs[cue];
  const now = context.currentTime;
  let cursor = now;

  try {
    spec.tones.forEach((tone) => {
      const duration = tone.durationMs / 1_000;
      const oscillator = context.createOscillator();
      oscillator.type = spec.fallbackWaveform;
      oscillator.frequency.setValueAtTime(tone.frequency, cursor);
      if (tone.sweepTo) {
        oscillator.frequency.linearRampToValueAtTime(tone.sweepTo, cursor + duration);
      }

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(spec.fallbackPeakGain, cursor + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, cursor + Math.max(duration - 0.02, 0.04));

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(cursor);
      oscillator.stop(cursor + duration);
      cursor += duration + ((tone.pauseAfterMs ?? 0) / 1_000);
    });
  } catch {
    // Audio should never block scanner flow.
  }
}

export function createLendingScanAudioController(): ScanAudioController {
  const audioCache = new Map<LendingScanAudioCue, HTMLAudioElement>();
  const audioContextRef: { current: AudioContext | null } = { current: null };
  let activeAudio: HTMLAudioElement | null = null;

  function ensureAudioContextReady(): AudioContext | null {
    const AudioContextCtor = resolveAudioContextCtor();
    if (!AudioContextCtor) return null;

    try {
      let context = audioContextRef.current;
      if (!context || context.state === "closed") {
        context = new AudioContextCtor();
        audioContextRef.current = context;
      }
      if (context.state === "suspended") {
        void context.resume().catch(() => {});
      }
      return context;
    } catch {
      return null;
    }
  }

  function ensureAudioElement(cue: LendingScanAudioCue): HTMLAudioElement | null {
    if (typeof Audio === "undefined") return null;
    const existing = audioCache.get(cue);
    if (existing) return existing;

    const src = buildCueDataUrl(cue);
    if (!src) return null;

    try {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.volume = cueSpecs[cue].audioVolume;
      audioCache.set(cue, audio);
      return audio;
    } catch {
      return null;
    }
  }

  function pauseActiveAudio() {
    if (!activeAudio) return;
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {
      // Ignore browser media quirks.
    }
    activeAudio = null;
  }

  return {
    prime() {
      ensureAudioContextReady();
      (Object.keys(cueSpecs) as LendingScanAudioCue[]).forEach((cue) => {
        void ensureAudioElement(cue);
      });
    },
    play(cue, enabled) {
      if (!enabled) return;

      const audio = ensureAudioElement(cue);
      if (audio) {
        pauseActiveAudio();
        audio.currentTime = 0;
        activeAudio = audio;
        const playResult = audio.play();
        if (typeof playResult?.catch === "function") {
          void playResult.catch(() => {
            activeAudio = null;
            playFallbackCue(cue, audioContextRef);
          });
          return;
        }
        return;
      }

      if (ensureAudioContextReady()) {
        playFallbackCue(cue, audioContextRef);
      }
    },
    dispose() {
      pauseActiveAudio();
      audioCache.forEach((audio) => {
        try {
          audio.pause();
          audio.src = "";
        } catch {
          // Ignore browser media quirks.
        }
      });
      audioCache.clear();

      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => {});
      }
    },
  };
}
