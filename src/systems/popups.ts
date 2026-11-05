import { POPUPS } from '../config';
import type { Renderer } from '../gfx/renderer';

interface Popup {
  text: string;
  x: number;
  y: number;
  age: number;
  color: number;
}

// Floating text from a fixed pool: rises and fades. Callers pass constant strings.
export class Popups {
  private readonly list: Popup[] = [];
  private next = 0;

  constructor() {
    for (let i = 0; i < POPUPS.max; i++) this.list.push({ text: '', x: 0, y: 0, age: POPUPS.life, color: 0 });
  }

  add(text: string, x: number, y: number, color: number): void {
    const p = this.list[this.next];
    this.next = (this.next + 1) % POPUPS.max;
    p.text = text;
    p.x = x;
    p.y = y;
    p.age = 0;
    p.color = color;
  }

  clear(): void {
    for (const p of this.list) p.age = POPUPS.life;
  }

  update(dt: number): void {
    for (const p of this.list) if (p.age < POPUPS.life) p.age += dt;
  }

  render(r: Renderer): void {
    for (const p of this.list) {
      if (p.age >= POPUPS.life) continue;
      const k = p.age / POPUPS.life;
      r.text(p.text, p.x, p.y - POPUPS.rise * k, POPUPS.size, p.color, k < 0.6 ? 1 : (1 - k) / 0.4, 0.5, 0.15);
    }
  }
}
