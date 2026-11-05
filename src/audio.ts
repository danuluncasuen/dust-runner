import { AUDIO } from './config';
import { loadMuted, saveMuted } from './storage';

export type Sfx =
  | 'start'
  | 'sample'
  | 'cell'
  | 'nearMiss'
  | 'hit'
  | 'wreck'
  | 'dead'
  | 'warn'
  | 'gameOver'
  | 'newBest'
  | 'callout'
  | 'night'
  | 'milestone'
  | 'tick'
  | 'blip';

// Sample chimes climb this scale (semitones above C6) as you chain them.
const CHAIN_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

// Note number to Hz (69 = A4).
const hz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

// Music: a bouncy little rolling tune in C major, written for this game. Eighth notes, eight per
// bar: an oom-pah bass, a soft shaker on the off-beats, and a plucked melody. Each row of MELODY
// is one bar (-1 = rest), and each bar has a root, a fifth and a chord for the "pah".
const BARS = [
  { root: 48, fifth: 43, chord: [64, 67] }, // C
  { root: 53, fifth: 48, chord: [65, 69] }, // F
  { root: 43, fifth: 50, chord: [62, 67] }, // G
  { root: 48, fifth: 43, chord: [64, 67] }, // C
  { root: 45, fifth: 52, chord: [64, 69] }, // Am
  { root: 53, fifth: 48, chord: [65, 69] }, // F
  { root: 43, fifth: 50, chord: [62, 65] }, // G7
  { root: 48, fifth: 43, chord: [64, 67] }, // C
];
const MELODY = [
  [72, -1, 76, 79, 76, -1, 72, -1],
  [77, -1, 81, 84, 81, -1, 77, -1],
  [79, -1, 83, -1, 81, 79, -1, 74],
  [76, -1, 72, -1, 72, 74, 76, -1],
  [84, -1, 81, -1, 76, -1, 81, -1],
  [81, 79, 77, -1, 72, -1, 77, -1],
  [79, -1, 74, -1, 79, 81, 83, -1],
  [84, -1, 79, -1, 72, -1, -1, -1],
];

// Every sound is synthesized: square and triangle waves plus filtered noise. No audio files.
export class Sound {
  muted = loadMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private echo: GainNode | null = null; // send: whatever goes in here repeats and fades
  private noiseBuffer: AudioBuffer | null = null;
  private playing = false;
  private paused = false;
  private engine: { gain: GainNode; osc: OscillatorNode; low: BiquadFilterNode } | null = null;
  private nextStep = 0; // audio clock time of the next music step
  private step = 0;

  // Browsers (iOS especially) only start audio inside a user gesture, so call this from one.
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : AUDIO.volume;
      this.master.connect(ctx.destination);
      this.music = ctx.createGain();
      this.music.gain.value = AUDIO.musicVolume;
      this.music.connect(this.master);
      // Echo: delay -> darker filter -> feedback back into the delay, all into the music bus.
      this.echo = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = AUDIO.echoTime;
      const dark = ctx.createBiquadFilter();
      dark.type = 'lowpass';
      dark.frequency.value = AUDIO.echoCutoff;
      const feedback = ctx.createGain();
      feedback.gain.value = AUDIO.echoFeedback;
      this.echo.connect(delay);
      delay.connect(dark);
      dark.connect(feedback);
      feedback.connect(delay);
      dark.connect(this.music);
      // One second of white noise, reused by every noisy effect.
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running' && !this.paused) this.ctx.resume().catch(() => {});
  }

  // Suspending freezes the audio clock, so the music picks up mid-bar on resume.
  pause(): void {
    this.paused = true;
    this.ctx?.suspend().catch(() => {});
  }

  resume(): void {
    this.paused = false;
    this.ctx?.resume().catch(() => {});
  }

  toggleMute(): void {
    this.muted = !this.muted;
    saveMuted(this.muted);
    if (this.master && this.ctx) {
      // Set the value directly too: a scheduled change can get lost while the context is suspended.
      const g = this.master.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.value = this.muted ? 0 : AUDIO.volume;
    }
    if (this.muted) return;
    // While paused the audio is frozen, so wake it just long enough for the blip to confirm.
    if (this.paused && this.ctx) {
      const ctx = this.ctx;
      ctx.resume().then(() => {
        this.play('blip');
        setTimeout(() => {
          if (this.paused) ctx.suspend().catch(() => {});
        }, 150);
      }).catch(() => {});
      return;
    }
    this.play('blip');
  }

  // n: for 'sample', how many came just before it in a chain (raises the pitch).
  play(name: Sfx, n = 0): void {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'start':
        [72, 76, 79, 84].forEach((n, i) => this.tone('triangle', hz(n), hz(n), 0.09, 0.14, i * 0.06));
        break;
      case 'sample': {
        const note = hz(84 + CHAIN_STEPS[Math.min(n, CHAIN_STEPS.length - 1)]);
        this.tone('triangle', note, note, 0.1, 0.25);
        this.tone('triangle', note * 2, note * 2, 0.06, 0.08, 0.03);
        break;
      }
      case 'cell':
        [76, 81, 88].forEach((n, i) => this.tone('triangle', hz(n), hz(n), 0.09, 0.3, i * 0.05));
        break;
      case 'nearMiss':
        this.noise(0.14, 0.14, 4500, 1200);
        this.tone('triangle', 900, 1500, 0.08, 0.08);
        break;
      case 'hit':
        this.noise(0.3, 0.45, 2200, 200);
        this.tone('square', 170, 60, 0.22, 0.2);
        break;
      case 'wreck':
        this.noise(0.8, 0.5, 2500, 120);
        this.tone('square', 140, 32, 0.5, 0.2);
        break;
      case 'dead':
        // The motor running out of power.
        this.tone('triangle', 420, 45, 1.1, 0.3);
        this.tone('square', 210, 30, 0.9, 0.05);
        break;
      case 'warn':
        this.tone('square', 660, 660, 0.07, 0.06);
        this.tone('square', 520, 520, 0.09, 0.06, 0.1);
        break;
      case 'gameOver':
        [67, 64, 60, 55].forEach((n, i) => this.tone('triangle', hz(n), hz(n), 0.2, 0.16, 0.3 + i * 0.16));
        break;
      case 'newBest':
        [72, 76, 79, 84, 79, 84].forEach((n, i) => this.tone('triangle', hz(n), hz(n), 0.12, 0.16, 0.3 + i * 0.09));
        break;
      case 'callout':
        this.tone('triangle', hz(76), hz(76), 0.12, 0.14);
        this.tone('triangle', hz(83), hz(83), 0.22, 0.14, 0.1);
        break;
      case 'night':
        this.tone('triangle', hz(52), hz(52), 0.7, 0.25);
        this.tone('triangle', hz(59), hz(59), 0.7, 0.14, 0.12);
        this.tone('triangle', hz(63), hz(63), 0.8, 0.1, 0.24);
        break;
      case 'milestone':
        [72, 76, 79, 84].forEach((n, i) => this.tone('triangle', hz(n), hz(n), 0.1, 0.12, i * 0.07));
        break;
      case 'tick':
        this.tone('triangle', 880, 880, 0.08, 0.14);
        break;
      case 'blip':
        this.tone('triangle', 1200, 1200, 0.05, 0.12);
        break;
    }
  }

  // The motor: a soft low hum plus rumble, kept running and faded by setEngine().
  startEngine(): void {
    if (!this.ctx || this.engine) return;
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 55;
    osc.connect(gain);
    osc.start();
    const rumble = c.createBufferSource();
    rumble.buffer = this.noiseBuffer;
    rumble.loop = true;
    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 240;
    const level = c.createGain();
    level.gain.value = 1.6;
    rumble.connect(low).connect(level).connect(gain);
    rumble.start();
    this.engine = { gain, osc, low };
  }

  // on: 0..1 how hard it runs (0 is silent), speed: 0..1 of the speed range.
  setEngine(on: number, speed: number): void {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(on * AUDIO.engine, t, 0.08);
    this.engine.osc.frequency.setTargetAtTime(50 + 50 * speed, t, 0.2);
    this.engine.low.frequency.setTargetAtTime(220 + 500 * speed, t, 0.2);
  }

  startMusic(): void {
    if (!this.ctx || !this.music) return;
    this.playing = true;
    this.step = 0;
    this.nextStep = this.ctx.currentTime + 0.1;
    const g = this.music.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(AUDIO.musicVolume, this.ctx.currentTime);
  }

  // Pads ring for a whole bar, so fade the music out instead of cutting it.
  stopMusic(): void {
    if (!this.ctx || !this.music || !this.playing) return;
    this.playing = false;
    const t = this.ctx.currentTime;
    const g = this.music.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + AUDIO.musicFade);
  }

  // Call every frame; schedules music a little ahead. tempo: 1 = normal speed.
  update(tempo: number): void {
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime;
    if (this.nextStep < now) this.nextStep = now + 0.02; // fell behind (tab was hidden)
    const stepTime = 30 / AUDIO.bpm / tempo; // eighth notes
    while (this.nextStep < now + 0.15) {
      this.scheduleStep(this.nextStep, stepTime);
      this.nextStep += stepTime;
      this.step++;
    }
  }

  private scheduleStep(at: number, len: number): void {
    const bar = Math.floor(this.step / 8) % BARS.length;
    const loop = Math.floor(this.step / (8 * BARS.length));
    const i = this.step % 8;
    const delay = at - this.ctx!.currentTime;
    const music = this.music!;
    const b = BARS[bar];
    // Oom-pah: bass on the beats, a light chord between them.
    if (i === 0) this.tone('triangle', hz(b.root), 0, len * 1.6, 0.34, delay, music);
    else if (i === 4) this.tone('triangle', hz(b.fifth), 0, len * 1.6, 0.28, delay, music);
    else if (i === 2 || i === 6) for (const note of b.chord) this.tone('sine', hz(note), 0, len * 0.9, 0.05, delay, music);
    // A shaker on the off-beats keeps it rolling.
    if (i % 2 === 1) this.noise(0.03, 0.025, 7000, 5000, delay, music);
    // The melody: a sine pluck with a short echo. The first loop plays it alone, then a music-box
    // octave joins every other loop, so it doesn't wear out.
    const note = MELODY[bar][i];
    if (note < 0) return;
    this.tone('sine', hz(note), 0, len * 1.5, 0.17, delay, music);
    this.tone('triangle', hz(note), 0, len * 0.5, 0.05, delay, music);
    this.tone('sine', hz(note), 0, len, 0.05, delay, this.echo!);
    if (loop % 2 === 1) this.tone('sine', hz(note + 12), 0, len * 0.8, 0.045, delay, music);
  }

  // to: end frequency for a slide, or 0 to hold the pitch.
  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0, out?: AudioNode): void {
    const c = this.ctx!;
    const t = c.currentTime + Math.max(0, delay);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(out ?? this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Low-passed noise; the cutoff slides from `from` to `to` Hz.
  private noise(dur: number, vol: number, from: number, to: number, delay = 0, out?: AudioNode): void {
    const c = this.ctx!;
    const t = c.currentTime + Math.max(0, delay);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(out ?? this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
