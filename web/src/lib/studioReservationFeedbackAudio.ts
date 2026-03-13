type FeedbackTone = "success" | "error" | "cancel";

type AudioContextLike = AudioContext;

type AudioContextCtor =
  | (new () => AudioContextLike)
  | undefined;

function resolveAudioContextCtor(): AudioContextCtor {
  if (typeof window === "undefined") return undefined;
  const globalWindow = window as Window & typeof globalThis & { webkitAudioContext?: new () => AudioContextLike };
  return globalWindow.AudioContext ?? globalWindow.webkitAudioContext;
}

function envelopeTone(
  context: AudioContextLike,
  options: {
    frequency: number;
    startAt: number;
    duration: number;
    gain: number;
    type?: OscillatorType;
  }
) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  oscillator.type = options.type ?? "triangle";
  oscillator.frequency.setValueAtTime(options.frequency, options.startAt);
  gainNode.gain.setValueAtTime(0.0001, options.startAt);
  gainNode.gain.linearRampToValueAtTime(options.gain, options.startAt + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, options.startAt + options.duration);
  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(options.startAt);
  oscillator.stop(options.startAt + options.duration + 0.02);
}

export function createStudioReservationFeedbackAudio() {
  let context: AudioContextLike | null = null;

  function ensureContext(): AudioContextLike | null {
    if (context) return context;
    const AudioContextRef = resolveAudioContextCtor();
    if (!AudioContextRef) return null;
    try {
      context = new AudioContextRef();
      return context;
    } catch {
      return null;
    }
  }

  function prime() {
    const nextContext = ensureContext();
    if (!nextContext || nextContext.state === "running") return;
    void nextContext.resume().catch(() => undefined);
  }

  function play(tone: FeedbackTone) {
    const nextContext = ensureContext();
    if (!nextContext) return;
    void nextContext.resume().catch(() => undefined);
    const startAt = nextContext.currentTime + 0.02;
    if (tone === "success") {
      envelopeTone(nextContext, {
        frequency: 587.33,
        startAt,
        duration: 0.12,
        gain: 0.035,
      });
      envelopeTone(nextContext, {
        frequency: 783.99,
        startAt: startAt + 0.14,
        duration: 0.16,
        gain: 0.03,
      });
      return;
    }
    if (tone === "cancel") {
      envelopeTone(nextContext, {
        frequency: 523.25,
        startAt,
        duration: 0.1,
        gain: 0.024,
      });
      envelopeTone(nextContext, {
        frequency: 440,
        startAt: startAt + 0.11,
        duration: 0.14,
        gain: 0.02,
      });
      return;
    }
    envelopeTone(nextContext, {
      frequency: 246.94,
      startAt,
      duration: 0.11,
      gain: 0.032,
      type: "sawtooth",
    });
    envelopeTone(nextContext, {
      frequency: 196,
      startAt: startAt + 0.13,
      duration: 0.14,
      gain: 0.028,
      type: "triangle",
    });
  }

  function dispose() {
    if (!context) return;
    const activeContext = context;
    context = null;
    void activeContext.close().catch(() => undefined);
  }

  return {
    prime,
    play,
    dispose,
  };
}
