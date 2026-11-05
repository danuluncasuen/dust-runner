import { BATTERY, HULL, ROVER, SCENE, SCORE, SPAWN, VIEW, WORLD } from './config';
import { HILL_W, ROVER_GROUND, ROVER_W, WHEEL_R, WHEEL_X, WHEEL_Y, type Art } from './art';
import { DayClock } from './day';
import { Kind, depthScale, isPickup, makePool, plainY, type Entity } from './entities';
import type { Input } from './input';
import { C } from './gfx/palette';
import type { Renderer } from './gfx/renderer';
import { loadBest, saveBest } from './storage';

type State = 'title' | 'play' | 'over';
type SpawnKind = 'rock' | 'crater' | 'sample' | 'cell';
const SPAWN_KINDS: SpawnKind[] = ['rock', 'crater', 'sample', 'cell'];
const KIND_OF: Record<SpawnKind, Kind> = { rock: Kind.Rock, crater: Kind.Crater, sample: Kind.Sample, cell: Kind.Cell };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Mesas drift by on their own slow layer; a fixed set of slots is recycled off the left edge.
interface Mesa {
  x: number;
  variant: number;
}

export class Game {
  readonly day = new DayClock();
  state: State = 'title';
  paused = false;
  private readonly pool: Entity[] = makePool();
  private readonly order = new Int16Array(SPAWN.maxEntities);
  private readonly mesas: Mesa[] = [];
  private readonly starX = new Float32Array(SCENE.stars);
  private readonly starY = new Float32Array(SCENE.stars);
  private readonly timers: Record<SpawnKind, number> = { rock: 0, crater: 0, sample: 0, cell: 0 };
  private viewW: number = VIEW.minW;
  private cam = 0; // world units driven (at depth 1)
  private runTime = 0;
  private stateTime = 0;
  private frame = 0;
  private speed: number = WORLD.speedStart;
  private depth: number = ROVER.startDepth;
  private moveRamp = 1;
  private wasTouching = false;
  private battery: number = BATTERY.start;
  private hull: number = HULL.max;
  private invuln = 0;
  private samples = 0;
  private lastHazardDepth = 0.5;
  private best = loadBest();
  private newBest = false;
  private endReason = '';
  // Readout strings, rebuilt only when their number changes.
  private scoreShown = -1;
  private scoreText = '0';
  private bestText = '';

  constructor(private readonly art: Art, private readonly input: Input) {
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
    return Math.floor(this.cam * WORLD.metersPerUnit) + this.samples * SCORE.sample;
  }

  pause(): void {
    if (this.state === 'play') this.paused = true;
  }

  update(dt: number, viewW: number): void {
    this.viewW = viewW;
    const tap = this.input.consumeTap();
    if (this.input.consumePauseKey() && this.state === 'play') this.paused = !this.paused;
    if (this.paused) {
      if (tap) this.paused = false;
      return;
    }
    this.frame++;
    this.stateTime += dt;
    this.day.update(dt);

    if (this.state === 'title' && tap) this.start();
    else if (this.state === 'over' && tap && this.stateTime > 1) this.start();

    const playing = this.state === 'play';
    if (playing) {
      this.runTime += dt;
      this.speed = Math.min(WORLD.speedMax, WORLD.speedStart + WORLD.speedRamp * this.runTime);
    } else if (this.state === 'over') {
      this.speed = Math.max(0, this.speed - 60 * dt); // the rover rolls to a stop
    }
    this.cam += this.speed * dt;

    this.steer(dt);
    if (playing) {
      this.drainBattery(dt);
      this.spawn(dt);
    }
    this.moveEntities(dt);
    if (playing) this.collide();
    this.invuln = Math.max(0, this.invuln - dt);
  }

  private start(): void {
    for (const e of this.pool) e.alive = false;
    for (const k of SPAWN_KINDS) this.timers[k] = SPAWN[k].start * 0.5;
    this.state = 'play';
    this.stateTime = 0;
    this.runTime = 0;
    this.cam = 0;
    this.speed = WORLD.speedStart;
    this.battery = BATTERY.start;
    this.hull = HULL.max;
    this.invuln = 0;
    this.samples = 0;
    this.newBest = false;
    this.day.reset();
  }

  private end(reason: string): void {
    this.state = 'over';
    this.stateTime = 0;
    this.endReason = reason;
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      saveBest(this.best);
      this.bestText = `BEST ${this.best}`;
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
    if (touching) target = (inp.pointerY! - SCENE.plainFar) / (SCENE.plainNear - SCENE.plainFar);
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
      this.end('BATTERY DEAD');
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
    if (hazard && Math.abs(depth - this.lastHazardDepth) < SPAWN.clearDepth) depth = (depth + 0.5) % 1;
    if (hazard) this.lastHazardDepth = depth;
    e.alive = true;
    e.kind = kind;
    e.depth = depth;
    e.x = this.viewW + 10;
    e.bob = Math.random() * 6;
    switch (kind) {
      case Kind.Rock:
        e.variant = Math.floor(Math.random() * this.art.rocks.length);
        e.hitW = this.art.rocks[e.variant].body.w * 0.7;
        e.hitDepth = 0.045;
        break;
      case Kind.Crater:
        e.variant = 0;
        e.hitW = 26;
        e.hitDepth = 0.05;
        break;
      case Kind.Sample:
        e.hitW = 12;
        e.hitDepth = 0.07;
        break;
      case Kind.Cell:
        e.hitW = 12;
        e.hitDepth = 0.07;
        break;
    }
  }

  private moveEntities(dt: number): void {
    for (const e of this.pool) {
      if (!e.alive) continue;
      e.x -= this.speed * depthScale(e.depth) * dt;
      e.bob += dt * 4;
      if (e.x < -40) e.alive = false;
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

  private collide(): void {
    const k = depthScale(this.depth);
    const rcx = this.roverX() + ROVER_W * k * 0.5;
    for (const e of this.pool) {
      if (!e.alive) continue;
      const ek = depthScale(e.depth);
      if (Math.abs(e.depth - this.depth) > e.hitDepth + ROVER.hitDepth) continue;
      const ecx = e.x + e.hitW * ek * 0.5;
      if (Math.abs(ecx - rcx) > (e.hitW * ek + ROVER.hitW * k) * 0.5) continue;
      if (e.kind === Kind.Sample) {
        e.alive = false;
        this.samples++;
      } else if (e.kind === Kind.Cell) {
        e.alive = false;
        this.battery = Math.min(BATTERY.max, this.battery + SCORE.cell);
      } else if (this.invuln === 0) {
        this.hull--;
        this.invuln = HULL.invuln;
        if (this.hull <= 0) this.end('ROVER WRECKED');
      }
    }
  }

  private roverX(): number {
    return this.viewW * ROVER.x;
  }

  // ---- Rendering ----------------------------------------------------------------------------

  render(r: Renderer): void {
    const day = this.day;
    const W = r.viewW;
    this.viewW = W;
    r.setDay(day.rowA, day.rowB, day.mix);
    r.begin();
    this.drawBackground(r, W);
    this.drawPlain(r, W);
    this.drawThings(r);
    this.drawHud(r, W);
    r.end();
  }

  private drawBackground(r: Renderer, W: number): void {
    const art = this.art;
    const day = this.day;
    const hz = SCENE.horizon;
    r.gradient(0, 0, W, hz * 0.5, C.skyTop, C.skyMid);
    r.gradient(0, hz * 0.5, W, hz * 0.42, C.skyMid, C.skyHz);
    r.rect(0, hz * 0.92 - 0.1, W, hz * 0.08 + 1, C.skyHz);

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
    const first = Math.min(W, HILL_W - off);
    r.slice(art.hills, off, first, 0, hy, C.hill);
    if (first < W) r.slice(art.hills, 0, W - first, first, hy, C.hill);
    r.gradient(0, hz - 16, W, 17, C.skyHz, C.skyHz, 0, 0.8);

    for (const m of this.mesas) {
      const p = art.mesas[m.variant];
      const x = m.x - this.cam * SCENE.mesaParallax;
      if (x > W || x + p.body.w < 0) continue;
      const y = hz - p.body.h + 1;
      r.shape(p.body, x, y, C.mesa);
      r.shape(p.shade, x, y, C.mesaSh);
    }
    r.gradient(0, hz - 6, W, 7, C.skyHz, C.skyHz, 0, 0.55);
  }

  private drawPlain(r: Renderer, W: number): void {
    const art = this.art;
    const hz = SCENE.horizon;
    r.rect(0, hz, W, VIEW.h - hz, C.plain);
    // Big flat panels, as in the poster, sliding at mid-plain speed.
    const panelSpan = 300;
    const po = (this.cam * 0.75) % panelSpan;
    for (let x = -po - 60; x < W; x += panelSpan) r.shape(art.panel, x, hz + 12, C.plain2, 0.45);
    const bandSpan = 340;
    const bo = this.cam % bandSpan;
    for (let x = -bo - 40; x < W; x += bandSpan) r.shape(art.band, x, VIEW.h - 9, C.plain3, 0.6);
    // Haze lying on the far plain.
    r.gradient(0, hz, W, 26, C.skyHz, C.skyHz, 0.6, 0);
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

  private drawEntity(r: Renderer, e: Entity): void {
    const art = this.art;
    const k = depthScale(e.depth);
    const gy = plainY(e.depth);
    const fog = e.depth < SCENE.hazeDepth ? SCENE.hazeMax * (1 - e.depth / SCENE.hazeDepth) : 0;
    switch (e.kind) {
      case Kind.Rock: {
        const p = art.rocks[e.variant];
        const y = gy - p.body.h * k + 1 * k;
        r.stretch(art.shadow, e.x - 1 * k, gy - 2 * k, (p.body.w + 4) * k, 3.5 * k, C.shadow, 0.55);
        r.shape(p.body, e.x, y, C.rock, 1, k);
        r.shape(p.shade, e.x, y, C.rockSh, 1, k);
        if (fog > 0) r.shape(p.body, e.x, y, C.skyHz, fog, k);
        break;
      }
      case Kind.Crater: {
        const y = gy - 6 * k;
        r.shape(art.craterRim, e.x, y, C.craterRim, 1, k);
        r.shape(art.craterIn, e.x, y, C.craterIn, 1, k);
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

  private drawRover(r: Renderer): void {
    const art = this.art;
    const day = this.day;
    const k = depthScale(this.depth);
    const x = this.roverX();
    const gy = plainY(this.depth);
    const moving = this.speed > 1;
    const bob = moving && Math.sin(this.cam * 0.35) > 0.55 ? ROVER.bob * k : 0;
    const y = gy - ROVER_GROUND * k - bob;

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

  private drawHud(r: Renderer, W: number): void {
    const blink = Math.floor(this.frame / 20) % 2 === 0;
    if (this.state === 'title') {
      r.text('DUST RUNNER', W / 2, 30, 11, C.hud, 1, 0.5);
      r.text('STEER ACROSS MARS. SURVIVE THE NIGHT.', W / 2, 50, 3.6, C.hud, 0.85, 0.5, 0.25);
      if (blink) r.text('TOUCH TO DRIVE', W / 2, 62, 4.2, C.hud, 1, 0.5);
      if (this.best > 0) r.text(this.bestText, W / 2, 172, 3.6, C.hud, 0.7, 0.5);
      return;
    }

    // Battery gauge, hull pips and score.
    const gx = 12;
    const gy = 12;
    const gw = 56;
    const low = this.battery < BATTERY.low;
    r.rect(gx, gy, gw, 3, C.hud, 0.25);
    if (!low || blink) r.rect(gx, gy, (gw * this.battery) / BATTERY.max, 3, low ? C.danger : C.hud, 0.95);
    for (let i = 0; i < HULL.max; i++) {
      r.shape(this.art.gaugeCap, gx + gw + 8 + i * 6, gy - 0.5, C.hud, i < this.hull ? 0.95 : 0.25);
    }
    const s = this.score;
    if (s !== this.scoreShown) {
      this.scoreShown = s;
      this.scoreText = String(s);
    }
    r.text(this.scoreText, W - 12, 11, 6, C.hud, 1, 1, 0.15);

    if (this.state === 'over') {
      r.text(this.endReason, W / 2, 36, 8, C.hud, 1, 0.5);
      r.text(this.scoreText, W / 2, 54, 6, C.hud, 1, 0.5, 0.15);
      r.text(this.newBest ? 'NEW BEST' : this.bestText, W / 2, 66, 3.6, C.hud, 0.85, 0.5);
      if (this.stateTime > 1 && blink) r.text('TOUCH TO RETRY', W / 2, 76, 4, C.hud, 1, 0.5);
    }
    if (this.paused) {
      r.rect(0, 0, W, VIEW.h, C.void, 0.45);
      r.text('PAUSED', W / 2, 70, 8, C.hud, 1, 0.5);
      r.text('TOUCH TO RESUME', W / 2, 86, 4, C.hud, 1, 0.5);
    }
  }

  // For the lag log.
  lagContext(): string {
    let n = 0;
    for (const e of this.pool) if (e.alive) n++;
    return `${this.state} ${this.day.name} entities ${n} speed ${this.speed.toFixed(0)}`;
  }
}
