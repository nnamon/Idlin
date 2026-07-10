// The sound engine (#148 A8): a tiny WebAudio SYNTH — every cue is
// procedural (oscillators + envelopes + filtered noise), so the repo
// ships zero audio assets and the broadcast still talks.
//
// Determinism discipline: sound is PRESENTATION ONLY. The engine never
// touches sim or store state; `log` records the last cues for the
// capture harness (headless Chromium has no audible output — the probe
// asserts the MAPPING, ears verify the rest). The AudioContext is
// created lazily on the first user gesture (autoplay policy), and the
// broadcast starts MUTED — a viewer opts into sound.

export type CueName =
  | "kill"
  | "boss-fall"
  | "act-complete"
  | "death"
  | "level-up"
  | "map_open"
  | "tally"
  | "rare-drop"
  | "recall";

const VOLUME_KEY = "idlin.volume";

export class SoundEngine {
  /** The last cues played (or suppressed by mute) — the harness probe. */
  log: string[] = [];
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 0 = muted (the default; a viewer opts in). */
  volume = 0;

  constructor() {
    const saved = Number(localStorage.getItem(VOLUME_KEY) ?? 0);
    // Muted until the unlock GESTURE regardless of the saved dial —
    // the context can't start without one anyway.
    this.volume = Number.isFinite(saved) ? Math.min(Math.max(saved, 0), 1) : 0;
  }

  get muted(): boolean {
    return this.volume === 0 || this.ctx === null;
  }

  /** The speaker button's click IS the unlock gesture. */
  toggle(): void {
    if (this.ctx === null) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      if (this.volume === 0) this.volume = 0.5;
    } else if (this.volume === 0) {
      this.volume = 0.5;
    } else {
      this.volume = 0;
    }
    if (this.master) this.master.gain.value = this.volume;
    localStorage.setItem(VOLUME_KEY, String(this.volume));
  }

  play(cue: CueName): void {
    this.log.push(cue);
    if (this.log.length > 32) this.log.splice(0, this.log.length - 32);
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    switch (cue) {
      case "kill":
        this.blip(t, 220, 160, 0.05, "square", 0.15);
        break;
      case "boss-fall":
        this.sweep(t, 160, 40, 0.9, "sawtooth", 0.5);
        this.noise(t + 0.05, 0.4, 0.35);
        break;
      case "act-complete":
        // A little fanfare: I - V - I, up an octave.
        this.blip(t, 262, 262, 0.18, "triangle", 0.4);
        this.blip(t + 0.18, 392, 392, 0.18, "triangle", 0.4);
        this.blip(t + 0.36, 523, 523, 0.36, "triangle", 0.45);
        break;
      case "death":
        this.sweep(t, 300, 90, 0.5, "triangle", 0.35);
        break;
      case "level-up":
        this.blip(t, 330, 660, 0.22, "sine", 0.3);
        break;
      case "map_open":
        this.noise(t, 0.9, 0.2, 400);
        break;
      case "tally":
        // A coin cascade: three quick rising ticks.
        this.blip(t, 660, 660, 0.05, "square", 0.2);
        this.blip(t + 0.08, 880, 880, 0.05, "square", 0.2);
        this.blip(t + 0.16, 1100, 1100, 0.08, "square", 0.22);
        break;
      case "rare-drop":
        this.blip(t, 523, 1046, 0.3, "sine", 0.3);
        break;
      case "recall":
        this.sweep(t, 440, 110, 0.35, "square", 0.25);
        break;
    }
  }

  private blip(
    at: number,
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(g).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private sweep(
    at: number,
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    this.blip(at, f0, f1, dur, type, gain);
  }

  private noise(at: number, dur: number, gain: number, highpassHz = 0): void {
    if (!this.ctx || !this.master) return;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Presentation-only noise: Math.random is FINE here (never sim state).
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let head: AudioNode = src;
    if (highpassHz > 0) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = highpassHz;
      src.connect(hp);
      head = hp;
    }
    head.connect(g).connect(this.master);
    src.start(at);
  }
}
