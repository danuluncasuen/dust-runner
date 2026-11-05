import { BATTERY, HULL, JUICE, ROVER, SCENE, SCORE, SPAWN, VIEW, WORLD } from './config';
import { HILL_W, ROVER_GROUND, ROVER_W, WHEEL_R, WHEEL_X, WHEEL_Y, type Art } from './art';
import type { Sound } from './audio';
import { DayClock } from './day';
import { Kind, depthScale, isPickup, makePool, plainY, type Entity } from './entities';
import { buzz } from './haptics';
import type { Input } from './input';
import { C } from './gfx/palette';
import type { Renderer } from './gfx/renderer';
import { loadBest, saveBest } from './storage';
import { Particles } from './systems/particles';
import { Popups } from './systems/popups';
import { Shake } from './systems/shake';

type State = 'title' | 'play' | 'over';
type SpawnKind = 'rock' | 'crater' | 'sample' | 'cell';
const SPAWN_KINDS: SpawnKind[] = ['rock', 'crater', 'sample', 'cell'];
const KIND_OF: Record<SpawnKind, Kind> = { rock: Kind.Rock, crater: Kind.Crater, sample: Kind.Sample, cell: Kind.Cell };

// By keyframe: NOON, SUNSET, DUSK, NIGHT, DAWN.
const PHASE_CALLOUTS = ['HIGH NOON', 'SUNSET', 'DUSK', 'NIGHT FALLS', 'DAWN'];
const NIGHT_PHASE = 3;

const PLAIN_H = SCENE.plainNear - SCENE.plainFar;
const BLEED = 6; // units the background overdraws each edge, so a shake never shows the void
const PAUSE_ICON = { x: 100, y: 9.5, w: 8, h: 8, pad: 5 };
const SOUND_ICON = { right: 12, y: 22, w: 10, h: 8, pad: 5 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Mesas drift by on their own slow layer; a fixed set of slots is recycled off the left edge.
interface Mesa {
  x: number;
  variant: number;
}

export class Game {
  readonly day = new DayClock();
  readonly shake = new Shake();
  state: State = 'title';
  paused = false;
  debugHits = false; // draws every footprint (?hits)
  private readonly pool: Entity[] = makePool();
  private readonly order = new Int16Array(SPAWN.maxEntities);
  private readonly mesas: Mesa[] = [];
  private readonly starX = new Float32Array(SCENE.stars);
  private readonly starY = new Float32Array(SCENE.stars);
  private readonly timers: Record<SpawnKind, number> = { rock: 0, crater: 0, sample: 0, cell: 0 };
  private readonly particles: Particles;
  private readonly popups = new Popups();
  private viewW: number = VIEW.minW;
  private insetL = 0; // safe-area insets, units
  private insetR = 0;
  private cam = 0; // world units driven (at depth 1)
  private runTime = 0;
  private stateTime = 0;
  private frame = 0;
  private speed: number = WORLD.speedTitle;
  private depth: number = ROVER.startDepth;
  private moveRamp = 1;
  private wasTouching = false;
  private battery: number = BATTERY.start;
  private hull: number = HULL.max;
  private invuln = 0;
  private samples = 0;
  private bonus = 0;
  private lastHazardDepth = 0.5;
  private best = loadBest();
  private newBest = false;
  private endReason = '';
  // Juice timers.
  private countdown = 0;
  private flash = 0;
  private pipBlink = 0;
  private gaugePulse = 0;
  private knock = 0;
  private chain = 0;
  private chainTime = 0;
  private warnTime = 0;
  private dustAcc = 0;
  private streakAcc = 0;
  private callout = '';
  private calloutTime = 0;
  private phase = 0;
  private milestone = 0;
  // Readout strings, rebuilt only when their number changes.
  private scoreShown = -1;
  private scoreText = '0';
  private bestText = '';

  constructor(private readonly art: Art, private readonly input: Input, private readonly sound: Sound) {
    this.particles = new Particles(art.hubDot);
    for (let i = 0; i < SCENE.stars; i++) {
      this.starX[i] = Math.random();
      this.starY[i] = Math.random() * (SCENE.horizon - 14);
    }
    let x = 30;
    for (let i = 0; i < 4; i++) {
      this.mesas.push({ x, variant: i % art.mesas.length });
      x += 160 + Math.random() * 200;
    }
    this.bestText = `BEST ${this.best}`;
  }

  get inRun(): boolean {
    return this.state === 'play' && !this.paused;
  }

  get score(): number {
    return Math.floor(this.cam * WORLD.metersPerUnit) + this.samples * SCORE.sample + this.bonus;
  }

  // 0 at the starting speed, 1 at top speed.
  private get speedNorm(): number {
    return clamp((this.speed - WORLD.speedStart) / (WORLD.speedMax - WORLD.speedStart), 0, 1);
  }

  pause(): void {
    if (this.state !== 'play') return;
    this.paused = true;
    this.countdown = 0;
    this.sound.setEngine(0, 0);
    this.sound.pause();
  }

  update(dt: number, viewW: number): void {
    this.viewW = viewW;
    const tap = this.input.consumeTap();
    if (this.input.consumeMuteKey()) this.sound.toggleMute();
    const pauseKey = this.input.consumePauseKey();
    const onSound = tap !== null && this.showsSoundIcon() && this.onSoundIcon(tap.x, tap.y);
    if (onSound) this.sound.toggleMute();

    if (this.paused) {
      this.updatePaused(dt, (tap !== null && !onSound) || pauseKey);
      return;
    }
    if (this.state === 'play' && (pauseKey || (tap !== null && this.onPauseIcon(tap.x, tap.y)))) {
      this.pause();
      return;
    }

    this.frame++;
    this.stateTime += dt;
    this.day.update(dt);

    if (tap && !onSound && (this.state === 'title' || (this.state === 'over' && this.stateTime > 1))) this.start();

    const playing = this.state === 'play';
    if (playing) {
      this.runTime += dt;
      this.speed = lerp(WORLD.speedStart, WORLD.speedMax, 1 - Math.exp(-this.runTime / WORLD.speedTau));
    } else if (this.state === 'over') {
      this.speed = Math.max(0, this.speed - 70 * dt); // the rover rolls to a stop
    }
    this.cam += this.speed * dt;

    this.steer(dt);
    if (playing) {
      this.drainBattery(dt);
      this.spawn(dt);
      this.announce();
    }
    this.moveEntities(dt);
    if (playing) this.collide();
    this.updateJuice(dt);
  }

  // Paused: a tap starts the 3-2-1, and play picks up when it runs out.
  private updatePaused(dt: number, resume: boolean): void {
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.paused = false;
      } else if (Math.ceil(this.countdown) !== before) {
        this.sound.play('tick');
      }
    } else if (resume) {
      this.countdown = JUICE.countdown;
      this.sound.resume();
      this.sound.play('tick');
    }
  }

  private start(): void {
    for (const e of this.pool) e.alive = false;
    for (const k of SPAWN_KINDS) this.timers[k] = SPAWN[k].start * SPAWN.firstDelay;
    this.state = 'play';
    this.stateTime = 0;
    this.runTime = 0;
    this.cam = 0;
    this.speed = WORLD.speedStart;
    this.battery = BATTERY.start;
    this.hull = HULL.max;
    this.invuln = 0;
    this.samples = 0;
    this.bonus = 0;
    this.newBest = false;
    this.chain = 0;
    this.chainTime = 0;
    this.flash = 0;
    this.knock = 0;
    this.calloutTime = 0;
    this.milestone = 0;
    this.day.reset();
    this.phase = this.currentPhase();
    this.particles.clear();
    this.popups.clear();
    this.shake.clear();
    this.sound.play('start');
    this.sound.startEngine();
    this.sound.startMusic();
  }

  private end(reason: string): void {
    this.state = 'over';
    this.stateTime = 0;
    this.endReason = reason;
    this.sound.stopMusic();
    this.sound.play('gameOver');
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      saveBest(this.best);
      this.bestText = `BEST ${this.best}`;
      this.sound.play('newBest');
    }
  }

  // The rover's depth eases toward the finger's, capped, ramping up after a new touch.
  private steer(dt: number): void {
    const inp = this.input;
    const touching = inp.pointerY !== null;
    if (touching && !this.wasTouching) this.moveRamp = 0;
    this.wasTouching = touching;
    this.moveRamp = Math.min(1, this.moveRamp + dt / ROVER.ramp);
    let target = this.depth;
    if (touching) target = (inp.pointerY! - SCENE.plainFar) / PLAIN_H;
    else if (inp.keyDirY) target = this.depth + inp.keyDirY;
    target = clamp(target, 0, 1);
    const cap = ROVER.maxSpeed * this.moveRamp;
    const v = clamp((target - this.depth) * ROVER.ease, -cap, cap);
    this.depth = clamp(this.depth + v * dt, 0, 1);
  }

  private drainBattery(dt: number): void {
    this.battery += (this.day.sun * BATTERY.charge - BATTERY.drain) * dt;
    this.battery = Math.min(BATTERY.max, this.battery);
    if (this.battery <= 0) {
      this.battery = 0;
      this.sound.play('dead');
      buzz('wreck');
      this.end('BATTERY DEAD');
      return;
    }
    if (this.battery < BATTERY.low) {
      this.warnTime -= dt;
      if (this.warnTime <= 0) {
        this.warnTime = JUICE.warnEvery;
        this.sound.play('warn');
        buzz('warn');
      }
    } else {
      this.warnTime = 0;
    }
  }

  private spawn(dt: number): void {
    for (const k of SPAWN_KINDS) {
      const s = SPAWN[k];
      if (this.runTime < s.unlock) continue;
      this.timers[k] -= dt;
      if (this.timers[k] > 0) continue;
      let interval = lerp(s.start, s.min, clamp(this.runTime / s.ramp, 0, 1));
      if (k === 'cell' && this.day.night > 0.5) interval *= SPAWN.cell.nightFactor;
      this.timers[k] = interval * (0.75 + Math.random() * 0.5);
      this.add(KIND_OF[k]);
    }
  }

  private add(kind: Kind): void {
    let e: Entity | null = null;
    for (const p of this.pool) if (!p.alive) { e = p; break; }
    if (!e) return;
    let depth = 0.03 + Math.random() * 0.94;
    const hazard = !isPickup(kind);
    // Never stack two hazards on one depth in a row, so there's always a way through.
    if (hazard && Math.abs(depth - this.lastHazardDepth) < SPAWN.clearDepth) depth = 0.03 + ((depth + 0.5) % 1) * 0.94;
    if (hazard) this.lastHazardDepth = depth;
    e.alive = true;
    e.kind = kind;
    e.depth = depth;
    e.x = this.viewW + 10;
    e.bob = Math.random() * 6;
    e.passed = false;
    e.struck = false;
    // Footprints are what the rover's wheels can actually touch, so they follow the drawn base.
    switch (kind) {
      case Kind.Rock: {
        e.variant = Math.floor(Math.random() * this.art.rocks.length);
        const body = this.art.rocks[e.variant].body;
        e.w = body.w;
        e.hitX = body.w * 0.38;
        e.hitDepth = 0.02 + body.h * 0.0008;
        break;
      }
      case Kind.Crater:
        e.variant = 0;
        e.w = this.art.craterRim.w;
        e.hitX = 13;
        e.hitDepth = 0.035;
        break;
      case Kind.Sample:
        e.w = this.art.sample.body.w;
        e.hitX = 9;
        e.hitDepth = 0.075;
        break;
      case Kind.Cell:
        e.w = this.art.cell.body.w;
        e.hitX = 9;
        e.hitDepth = 0.075;
        break;
    }
  }

  private moveEntities(dt: number): void {
    for (const e of this.pool) {
      if (!e.alive) continue;
      e.x -= this.speed * depthScale(e.depth) * dt;
      e.bob += dt * 4;
      if (e.x < -70) e.alive = false;
    }
    // Mesas recycle off the left edge to somewhere past the right one.
    const span = this.viewW + 200;
    for (const m of this.mesas) {
      const sx = m.x - this.cam * SCENE.mesaParallax;
      if (sx + this.art.mesas[m.variant].body.w < -10) {
        m.x += span + Math.random() * 260;
        m.variant = Math.floor(Math.random() * this.art.mesas.length);
      }
    }
  }

  // Two oval footprints on the ground touch, or they don't. Both are centered on what's drawn.
  private collide(): void {
    const k = depthScale(this.depth);
    const rcx = this.roverX() + ROVER_W * k * 0.5;
    for (const e of this.pool) {
      if (!e.alive) continue;
      const ek = depthScale(e.depth);
      const dx = e.x + e.w * ek * 0.5 - rcx;
      const dd = e.depth - this.depth;
      const rx = e.hitX * ek + ROVER.hitX * k;
      const rd = e.hitDepth + ROVER.hitDepth;
      if ((dx / rx) * (dx / rx) + (dd / rd) * (dd / rd) < 1) {
        if (e.kind === Kind.Sample) this.takeSample(e);
        else if (e.kind === Kind.Cell) this.takeCell(e);
        else {
          e.struck = true;
          if (this.invuln === 0) this.hit(e, rcx);
        }
      } else if (!isPickup(e.kind) && !e.passed && dx < 0) {
        e.passed = true;
        if (!e.struck && Math.abs(dd) < rd * ROVER.nearFactor) this.nearMiss(rcx);
      }
    }
  }

  private takeSample(e: Entity): void {
    e.alive = false;
    this.samples++;
    this.chain = this.chainTime > 0 ? this.chain + 1 : 0;
    this.chainTime = JUICE.chainGap;
    const k = depthScale(e.depth);
    const x = e.x + e.w * k * 0.5;
    const y = plainY(e.depth) - 9 * k;
    this.sparkle(x, y, C.sampleHi);
    this.popups.add('+50', x, y - 6 * k, C.hud);
    this.sound.play('sample', this.chain);
    buzz('sample');
  }

  private takeCell(e: Entity): void {
    e.alive = false;
    this.battery = Math.min(BATTERY.max, this.battery + SCORE.cell);
    this.gaugePulse = JUICE.gaugePulse;
    const k = depthScale(e.depth);
    const x = e.x + e.w * k * 0.5;
    const y = plainY(e.depth) - 9 * k;
    this.sparkle(x, y, C.cell);
    this.popups.add('POWER', x, y - 6 * k, C.cell);
    this.sound.play('cell');
    buzz('cell');
  }

  private hit(e: Entity, rcx: number): void {
    this.hull--;
    this.invuln = HULL.invuln;
    this.flash = JUICE.flash;
    this.pipBlink = JUICE.pipBlink;
    this.knock = 1;
    const y = plainY(this.depth) - 10 * depthScale(this.depth);
    const color = e.kind === Kind.Rock ? C.rock : C.craterRim;
    const wrecked = this.hull <= 0;
    for (let i = 0; i < (wrecked ? 28 : 14); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 18 + Math.random() * 55;
      const c = i % 3 === 0 ? C.roverSh : color;
      this.particles.add(rcx + 6, y, Math.cos(a) * v - this.speed * 0.3, Math.sin(a) * v - 22, 0.5 + Math.random() * 0.4, 1 + Math.random() * 1.6, c, 1, 0, 1);
    }
    if (wrecked) {
      this.shake.add(JUICE.shakeWreck.size, JUICE.shakeWreck.time);
      this.sound.play('wreck');
      buzz('wreck');
      this.end('ROVER WRECKED');
    } else {
      this.shake.add(JUICE.shakeHit.size, JUICE.shakeHit.time);
      this.sound.play('hit');
      buzz('hit');
    }
  }

  private nearMiss(rcx: number): void {
    this.bonus += SCORE.nearMiss;
    this.popups.add('CLOSE +10', rcx, plainY(this.depth) - 32 * depthScale(this.depth), C.hud);
    this.sound.play('nearMiss');
    buzz('nearMiss');
  }

  private sparkle(x: number, y: number, color: number): void {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const v = 22 + Math.random() * 16;
      this.particles.add(x, y, Math.cos(a) * v - this.speed * 0.4, Math.sin(a) * v, 0.4, 1.6, color, 1, -2);
    }
  }

  private currentPhase(): number {
    return this.day.mix < 0.5 ? this.day.rowA : this.day.rowB;
  }

  // Calls out each change of the day, and every milestone.
  private announce(): void {
    const phase = this.currentPhase();
    if (phase !== this.phase) {
      this.phase = phase;
      this.callout = PHASE_CALLOUTS[phase];
      this.calloutTime = JUICE.callout;
      this.sound.play(phase === NIGHT_PHASE ? 'night' : 'callout');
    }
    const m = Math.floor((this.cam * WORLD.metersPerUnit) / SCORE.milestone);
    if (m > this.milestone) {
      this.milestone = m;
      this.callout = `${m * SCORE.milestone} M`;
      this.calloutTime = JUICE.callout;
      this.sound.play('milestone');
    }
  }

  private updateJuice(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.pipBlink = Math.max(0, this.pipBlink - dt);
    this.gaugePulse = Math.max(0, this.gaugePulse - dt);
    this.calloutTime = Math.max(0, this.calloutTime - dt);
    this.chainTime = Math.max(0, this.chainTime - dt);
    this.knock = Math.max(0, this.knock - dt * 4);
    this.emitDust(dt);
    this.particles.update(dt);
    this.popups.update(dt);
    this.shake.update(dt);
    // A few times a second: each call schedules audio events, and they pile up on iOS.
    if (this.frame % 12 === 0) this.sound.setEngine(clamp(this.speed / WORLD.speedStart, 0, 1), this.speedNorm);
    this.sound.update(1 + this.speedNorm * 0.25);
  }

  // Dust kicked up by the wheels, and thin streaks over the plain once the speed builds.
  private emitDust(dt: number): void {
    const k = depthScale(this.depth);
    const gy = plainY(this.depth);
    const x = this.roverX();
    const norm = this.speed / WORLD.speedMax;
    this.dustAcc += JUICE.wheelDust * norm * dt;
    while (this.dustAcc >= 1) {
      this.dustAcc -= 1;
      const wheel = WHEEL_X[Math.floor(Math.random() * WHEEL_X.length)];
      const color = Math.random() < 0.5 ? C.craterRim : C.plain;
      this.particles.add(x + (wheel - 3) * k, gy - 1 * k, -this.speed * k * (0.45 + Math.random() * 0.3), -(4 + Math.random() * 12) * k, 0.45 + Math.random() * 0.3, (1.2 + Math.random()) * k, color, 0.75, 7 * k);
    }
    if (this.state !== 'play') return;
    const s = (this.speedNorm - JUICE.streakFrom) / (1 - JUICE.streakFrom);
    if (s <= 0) return;
    this.streakAcc += JUICE.streaks * s * dt;
    while (this.streakAcc >= 1) {
      this.streakAcc -= 1;
      const d = Math.random();
      const v = this.speed * depthScale(d) * 1.5;
      this.particles.add(this.viewW, plainY(d) + 2, -v, 0, 1 + (this.viewW / v) * 0.5, 1, C.craterRim, 0.35 * s, 0, 0, 12 + 22 * d);
    }
  }

  private roverX(): number {
    return this.viewW * ROVER.x;
  }

  private showsSoundIcon(): boolean {
    return this.paused || this.state !== 'play';
  }

  private onSoundIcon(x: number, y: number): boolean {
    const i = SOUND_ICON;
    const left = this.viewW - this.insetR - i.right - i.w;
    return x >= left - i.pad && x <= left + i.w + i.pad && y >= i.y - i.pad && y <= i.y + i.h + i.pad;
  }

  private onPauseIcon(x: number, y: number): boolean {
    const i = PAUSE_ICON;
    const left = i.x + this.insetL;
    return x >= left - i.pad && x <= left + i.w + i.pad && y >= i.y - i.pad && y <= i.y + i.h + i.pad;
  }

  // ---- Rendering ----------------------------------------------------------------------------

  render(r: Renderer): void {
    const day = this.day;
    const W = r.viewW;
    this.viewW = W;
    this.insetL = r.insetL;
    this.insetR = r.insetR;
    r.setDay(day.rowA, day.rowB, day.mix);
    r.setShake(this.shake.offsetX, this.shake.offsetY);
    r.begin();
    this.drawBackground(r, W);
    this.drawPlain(r, W);
    this.drawThings(r);
    this.particles.render(r);
    this.popups.render(r);
    if (this.debugHits) this.drawFootprints(r);
    this.drawFlash(r, W);
    this.drawHud(r, W);
    r.end();
  }

  private drawBackground(r: Renderer, W: number): void {
    const art = this.art;
    const day = this.day;
    const hz = SCENE.horizon;
    const x0 = -BLEED;
    const w = W + BLEED * 2;
    r.rect(x0, -BLEED, w, BLEED, C.skyTop);
    r.gradient(x0, 0, w, hz * 0.5, C.skyTop, C.skyMid);
    r.gradient(x0, hz * 0.5, w, hz * 0.42, C.skyMid, C.skyHz);
    r.rect(x0, hz * 0.92 - 0.1, w, hz * 0.08 + 1, C.skyHz);

    if (day.night > 0.03) {
      for (let i = 0; i < this.starX.length; i++) {
        const tw = 0.55 + 0.45 * Math.sin(this.frame * 0.04 + i * 1.7);
        r.shape(art.star, this.starX[i] * W, this.starY[i], C.star, day.night * tw * (1 - this.starY[i] / hz));
      }
    }

    if (day.sunY < 1.15) {
      const sx = day.sunX * W;
      const sy = 8 + (hz - 8) * day.sunY;
      r.stretch(art.glow, sx - 40, sy - 40, 80, 80, C.sun, 0.35);
      r.shape(art.sun, sx - 4, sy - 4, C.sun);
    }

    // Far mountains, then haze settling on them.
    const off = (this.cam * SCENE.hillParallax) % HILL_W;
    const hy = hz - art.hills.h + 1;
    const first = Math.min(w, HILL_W - off);
    r.slice(art.hills, off, first, x0, hy, C.hill);
    if (first < w) r.slice(art.hills, 0, w - first, x0 + first, hy, C.hill);
    r.gradient(x0, hz - 16, w, 17, C.skyHz, C.skyHz, 0, 0.8);

    for (const m of this.mesas) {
      const p = art.mesas[m.variant];
      const x = m.x - this.cam * SCENE.mesaParallax;
      if (x > W || x + p.body.w < 0) continue;
      const y = hz - p.body.h + 1;
      r.shape(p.body, x, y, C.mesa);
      r.shape(p.shade, x, y, C.mesaSh);
    }
    r.gradient(x0, hz - 6, w, 7, C.skyHz, C.skyHz, 0, 0.55);
  }

  private drawPlain(r: Renderer, W: number): void {
    const art = this.art;
    const hz = SCENE.horizon;
    r.rect(-BLEED, hz, W + BLEED * 2, VIEW.h - hz + BLEED, C.plain);
    // Big flat panels, as in the poster, sliding at mid-plain speed.
    const panelSpan = 300;
    const po = (this.cam * 0.75) % panelSpan;
    for (let x = -po - 60; x < W; x += panelSpan) r.shape(art.panel, x, hz + 12, C.plain2, 0.45);
    const bandSpan = 340;
    const bo = this.cam % bandSpan;
    for (let x = -bo - 40; x < W; x += bandSpan) r.shape(art.band, x, VIEW.h - 9, C.plain3, 0.6);
    // Haze lying on the far plain.
    r.gradient(-BLEED, hz, W + BLEED * 2, 26, C.skyHz, C.skyHz, 0.6, 0);
  }

  // Entities and the rover, far to near, so nearer things overlap farther ones.
  private drawThings(r: Renderer): void {
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i].alive) this.order[n++] = i;
    // Insertion sort by depth: tiny list, no allocation.
    for (let i = 1; i < n; i++) {
      const v = this.order[i];
      const d = this.pool[v].depth;
      let j = i - 1;
      while (j >= 0 && this.pool[this.order[j]].depth > d) {
        this.order[j + 1] = this.order[j];
        j--;
      }
      this.order[j + 1] = v;
    }
    let roverDrawn = false;
    for (let i = 0; i < n; i++) {
      const e = this.pool[this.order[i]];
      if (!roverDrawn && e.depth > this.depth) {
        this.drawRover(r);
        roverDrawn = true;
      }
      this.drawEntity(r, e);
    }
    if (!roverDrawn) this.drawRover(r);
  }

  // How much the headlight catches something: full just ahead, on the rover's line, at night.
  private lampOn(cx: number, depth: number): number {
    const ahead = cx - this.roverX();
    if (ahead < 0 || this.day.night < 0.15) return 0;
    return this.day.night * clamp(1 - ahead / 170, 0, 1) * clamp(1 - Math.abs(depth - this.depth) / 0.35, 0, 1);
  }

  private drawEntity(r: Renderer, e: Entity): void {
    const art = this.art;
    const k = depthScale(e.depth);
    const gy = plainY(e.depth);
    const cx = e.x + e.w * k * 0.5;
    const fog = e.depth < SCENE.hazeDepth ? SCENE.hazeMax * (1 - e.depth / SCENE.hazeDepth) : 0;
    switch (e.kind) {
      case Kind.Rock: {
        const p = art.rocks[e.variant];
        const y = gy - (p.body.h - 1) * k;
        // The ground shadow is the footprint, so it shows exactly where the rover can't go.
        const fw = e.hitX * k * 1.2;
        const fd = e.hitDepth * PLAIN_H;
        r.stretch(art.shadow, cx - fw, gy - fd, fw * 2, fd * 2, C.shadow, 0.6);
        // Thins out when the rover is behind it, so you never lose sight of yourself.
        const a = 1 - 0.5 * this.hiddenBy(e, cx, p.body.h * k);
        r.shape(p.body, e.x, y, C.rock, a, k);
        r.shape(p.shade, e.x, y, C.rockSh, a, k);
        const lamp = this.lampOn(cx, e.depth);
        if (lamp > 0) r.shape(p.body, e.x, y, C.lamp, lamp * 0.45 * a, k);
        if (fog > 0) r.shape(p.body, e.x, y, C.skyHz, fog * a, k);
        break;
      }
      case Kind.Crater: {
        const y = gy - 6 * k;
        r.shape(art.craterRim, e.x, y, C.craterRim, 1, k);
        r.shape(art.craterIn, e.x, y, C.craterIn, 1, k);
        const lamp = this.lampOn(cx, e.depth);
        if (lamp > 0) r.shape(art.craterRim, e.x, y, C.lamp, lamp * 0.3, k);
        if (fog > 0) r.shape(art.craterRim, e.x, y, C.skyHz, fog, k);
        break;
      }
      case Kind.Sample:
      case Kind.Cell: {
        const p = e.kind === Kind.Sample ? art.sample : art.cell;
        const lift = (3 + Math.sin(e.bob) * 1.2) * k;
        const y = gy - p.body.h * k - lift;
        r.stretch(art.shadow, e.x, gy - 1.5 * k, p.body.w * k, 2.5 * k, C.shadow, 0.45);
        r.shape(p.body, e.x, y, e.kind === Kind.Sample ? C.sample : C.cell, 1, k);
        r.shape(p.shade, e.x, y, e.kind === Kind.Sample ? C.sampleHi : C.roverDk, e.kind === Kind.Sample ? 0.8 : 0.55, k);
        if (fog > 0) r.shape(p.body, e.x, y, C.skyHz, fog * 0.7, k);
        break;
      }
    }
  }

  // 0..1: how much a nearer rock covers the rover.
  private hiddenBy(e: Entity, cx: number, height: number): number {
    if (e.depth <= this.depth) return 0;
    if (plainY(e.depth) - plainY(this.depth) > height) return 0;
    const k = depthScale(this.depth);
    const rcx = this.roverX() + ROVER_W * k * 0.5;
    return clamp(2 * (1 - Math.abs(cx - rcx) / (e.w * depthScale(e.depth) * 0.5 + ROVER_W * k * 0.5)), 0, 1);
  }

  private drawRover(r: Renderer): void {
    const art = this.art;
    const day = this.day;
    const k = depthScale(this.depth);
    const x = this.roverX() - this.knock * ROVER.knock * k;
    const gy = plainY(this.depth);
    const bump = this.speed > 1 && Math.sin(this.cam * 0.35) > 0.55 ? ROVER.bob * (1 + this.speedNorm) * k : 0;
    const y = gy - ROVER_GROUND * k - bump;

    // Long shadow pointing away from the sun; gone once the sun is down.
    const shadowA = clamp((1.12 - day.sunY) * 4, 0, 1) * 0.8;
    if (shadowA > 0) {
      const len = (6 + 60 * clamp(day.sunY - 0.12, 0, 1)) * k;
      const w = ROVER_W * k * 0.9 + len;
      const away = day.sunX * this.viewW < x + ROVER_W * k * 0.5;
      r.stretch(art.shadow, away ? x + 1 * k : x + ROVER_W * k * 0.9 - w, gy - 2.2 * k, w, 4 * k, C.shadow, shadowA);
    }
    // Headlight at night.
    if (day.night > 0.15) r.shape(art.beam, x + (ROVER_W - 2) * k, y + 1 * k, C.lamp, day.night * 0.3, k);

    // Blink while invulnerable after a hit.
    if (this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0) return;
    for (const layer of art.rover) r.shape(layer.region, x, y, layer.color, 1, k);
    // A dot on each hub turns with the distance driven.
    const a = this.cam / WHEEL_R;
    const dx = Math.cos(a) * 2.2;
    const dy = Math.sin(a) * 2.2;
    for (const wx of WHEEL_X) r.shape(art.hubDot, x + (wx + dx - 1) * k, y + (WHEEL_Y + dy - 1) * k, C.roverSh, 1, k);
  }

  // ?hits: every footprint, in the danger color.
  private drawFootprints(r: Renderer): void {
    const k = depthScale(this.depth);
    const rcx = this.roverX() + ROVER_W * k * 0.5;
    const rd = ROVER.hitDepth * PLAIN_H;
    r.stretch(this.art.shadow, rcx - ROVER.hitX * k, plainY(this.depth) - rd, ROVER.hitX * k * 2, rd * 2, C.danger, 0.7);
    for (const e of this.pool) {
      if (!e.alive) continue;
      const ek = depthScale(e.depth);
      const fd = e.hitDepth * PLAIN_H;
      r.stretch(this.art.shadow, e.x + e.w * ek * 0.5 - e.hitX * ek, plainY(e.depth) - fd, e.hitX * ek * 2, fd * 2, C.danger, 0.7);
    }
  }

  // The damage flash: a red fade at all four screen edges, for peripheral vision.
  private drawFlash(r: Renderer, W: number): void {
    if (this.flash <= 0) return;
    const a = (this.flash / JUICE.flash) * 0.75;
    r.gradient(-BLEED, -BLEED, W + BLEED * 2, 22, C.danger, C.danger, a, 0);
    r.gradient(-BLEED, VIEW.h - 16, W + BLEED * 2, 22, C.danger, C.danger, 0, a);
    r.stretch(this.art.edge, -BLEED, -BLEED, 28, VIEW.h + BLEED * 2, C.danger, a);
    r.stretch(this.art.edge, W + BLEED - 28, -BLEED, 28, VIEW.h + BLEED * 2, C.danger, a, true);
  }

  private drawSoundIcon(r: Renderer, W: number): void {
    const art = this.art;
    const i = SOUND_ICON;
    const x = W - this.insetR - i.right - i.w;
    r.shape(art.soundIcon, x, i.y, C.hud, 0.9);
    r.shape(this.sound.muted ? art.soundOff : art.soundWaves, x, i.y, C.hud, 0.9);
  }

  private drawHud(r: Renderer, W: number): void {
    const blink = Math.floor(this.frame / 20) % 2 === 0;
    if (this.state === 'title') {
      r.text('DUST RUNNER', W / 2, 30, 11, C.hud, 1, 0.5);
      r.text('STEER ACROSS MARS. SURVIVE THE NIGHT.', W / 2, 50, 3.6, C.hud, 0.85, 0.5, 0.25);
      if (blink) r.text('TOUCH TO DRIVE', W / 2, 62, 4.2, C.hud, 1, 0.5);
      if (this.best > 0) r.text(this.bestText, W / 2, 172 - r.insetB, 3.6, C.hud, 0.7, 0.5);
      this.drawSoundIcon(r, W);
      return;
    }

    // Battery gauge, hull pips and score.
    const gx = 12 + this.insetL;
    const gy = 12;
    const gw = 56;
    const low = this.battery < BATTERY.low;
    const swell = (this.gaugePulse / JUICE.gaugePulse) * 1.6;
    r.rect(gx, gy, gw, 3, C.hud, 0.25);
    if (!low || blink) r.rect(gx, gy - swell / 2, (gw * this.battery) / BATTERY.max, 3 + swell, low ? C.danger : swell > 0 ? C.cell : C.hud, 0.95);
    for (let i = 0; i < HULL.max; i++) {
      const justLost = i === this.hull && this.pipBlink > 0;
      if (justLost && Math.floor(this.pipBlink * 10) % 2 === 0) continue;
      r.shape(this.art.gaugeCap, gx + gw + 8 + i * 6, gy - 0.5, justLost ? C.danger : C.hud, i < this.hull || justLost ? 0.95 : 0.25);
    }
    const s = this.score;
    if (s !== this.scoreShown) {
      this.scoreShown = s;
      this.scoreText = String(s);
    }
    r.text(this.scoreText, W - 12 - this.insetR, 11, 6, C.hud, 1, 1, 0.15);

    if (this.state === 'play' && !this.paused) r.shape(this.art.pauseIcon, PAUSE_ICON.x + this.insetL, PAUSE_ICON.y, C.hud, 0.7);

    if (this.calloutTime > 0 && this.state === 'play') {
      const t = this.calloutTime / JUICE.callout;
      r.text(this.callout, W / 2, 34, 7, C.hud, clamp(Math.min(t, 1 - t) * 6, 0, 1), 0.5);
    }

    if (this.state === 'over') {
      const a = clamp(this.stateTime * 2.5, 0, 1);
      r.text(this.endReason, W / 2, 36, 8, C.hud, a, 0.5);
      r.text(this.scoreText, W / 2, 54, 6, C.hud, a, 0.5, 0.15);
      r.text(this.newBest ? 'NEW BEST' : this.bestText, W / 2, 66, 3.6, this.newBest ? C.cell : C.hud, a * 0.9, 0.5);
      if (this.stateTime > 1 && blink) r.text('TOUCH TO RETRY', W / 2, 76, 4, C.hud, 1, 0.5);
      this.drawSoundIcon(r, W);
    }
    if (this.paused) {
      r.rect(-BLEED, -BLEED, W + BLEED * 2, VIEW.h + BLEED * 2, C.void, 0.45);
      if (this.countdown > 0) {
        r.text(COUNT[Math.ceil(this.countdown)], W / 2, 62, 22, C.hud, 1, 0.5, 0);
      } else {
        r.text('PAUSED', W / 2, 70, 8, C.hud, 1, 0.5);
        r.text('TOUCH TO RESUME', W / 2, 86, 4, C.hud, 1, 0.5);
      }
      this.drawSoundIcon(r, W);
    }
  }

  // For the lag log.
  lagContext(): string {
    let n = 0;
    for (const e of this.pool) if (e.alive) n++;
    return `${this.state} ${this.day.name} entities ${n} speed ${this.speed.toFixed(0)}`;
  }
}

const COUNT = ['', '1', '2', '3'];
