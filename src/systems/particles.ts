import { PARTICLES } from '../config';
import type { Region } from '../gfx/atlas';
import type { Renderer } from '../gfx/renderer';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  total: number;
  size: number; // units across at birth
  grow: number; // units per second
  len: number; // above 0: a horizontal streak this long instead of a puff
  gravity: number; // share of PARTICLES.gravity
  color: number;
  alpha: number;
}

// Pooled puffs and streaks in screen space. `count` live ones sit at the front of the list, and
// a dead one swaps with the last, so nothing is allocated after startup.
export class Particles {
  private readonly list: Particle[] = [];
  private count = 0;

  constructor(private readonly dot: Region) {
    for (let i = 0; i < PARTICLES.max; i++) {
      this.list.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, total: 1, size: 1, grow: 0, len: 0, gravity: 0, color: 0, alpha: 1 });
    }
  }

  add(x: number, y: number, vx: number, vy: number, life: number, size: number, color: number, alpha = 1, grow = 0, gravity = 0, len = 0): void {
    if (this.count === PARTICLES.max) return;
    const p = this.list[this.count++];
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.total = life;
    p.size = size;
    p.grow = grow;
    p.gravity = gravity;
    p.len = len;
    p.color = color;
    p.alpha = alpha;
  }

  clear(): void {
    this.count = 0;
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.count--;
        this.list[i] = this.list[this.count];
        this.list[this.count] = p;
        continue;
      }
      p.vy += PARTICLES.gravity * p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
    }
  }

  render(r: Renderer): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.list[i];
      const a = p.alpha * (p.life / p.total);
      if (p.len > 0) r.rect(p.x, p.y, p.len, 0.5, p.color, a);
      else r.stretch(this.dot, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, p.color, a);
    }
  }
}
