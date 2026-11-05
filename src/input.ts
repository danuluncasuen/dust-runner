import type { Renderer } from './gfx/renderer';

// One-thumb input: where the finger is (or the up/down arrows), plus single taps for menus.
export class Input {
  held = false;
  // Logical position of the finger while it's down, otherwise null.
  pointerX: number | null = null;
  pointerY: number | null = null;
  private tap: { x: number; y: number } | null = null;
  private pointers = 0;
  private keyHeld = false;
  // -1, 0 or 1 from the up/down arrows.
  keyDirY = 0;
  private readonly keys = new Set<string>();
  private pauseKey = false;

  constructor(target: HTMLCanvasElement, renderer: Renderer) {
    const toLogical = (e: PointerEvent) => {
      // Goes through the canvas's actual on-screen size, so taps stay on target even if a
      // resize hasn't been handled yet.
      const rect = target.getBoundingClientRect();
      const kx = target.width / (rect.width || 1);
      const ky = target.height / (rect.height || 1);
      return {
        x: ((e.clientX - rect.left) * kx - renderer.originX) / renderer.scale,
        y: ((e.clientY - rect.top) * ky - renderer.originY) / renderer.scale,
      };
    };
    target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture(e.pointerId);
      const p = toLogical(e);
      this.tap = p;
      this.pointerX = p.x;
      this.pointerY = p.y;
      this.pointers++;
      this.updateHeld();
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.pointers) return;
      const p = toLogical(e);
      this.pointerX = p.x;
      this.pointerY = p.y;
    });
    const release = () => {
      this.pointers = Math.max(0, this.pointers - 1);
      if (!this.pointers) {
        this.pointerX = null;
        this.pointerY = null;
      }
      this.updateHeld();
    };
    target.addEventListener('pointerup', release);
    target.addEventListener('pointercancel', release);
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Enter') {
        this.keyHeld = true;
        this.tap = { x: -1, y: -1 };
        e.preventDefault();
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        this.keys.add(e.key);
        this.tap ??= { x: -1, y: -1 };
        e.preventDefault();
      }
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') this.pauseKey = true;
      this.updateHeld();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') this.keyHeld = false;
      this.keys.delete(e.key);
      this.updateHeld();
    });
    window.addEventListener('blur', () => {
      this.keyHeld = false;
      this.keys.clear();
      this.pointers = 0;
      this.pointerX = null;
      this.pointerY = null;
      this.updateHeld();
    });
  }

  // The latest tap, once; used by screens to advance.
  consumeTap(): { x: number; y: number } | null {
    const t = this.tap;
    this.tap = null;
    return t;
  }

  // True once after P or Esc is pressed.
  consumePauseKey(): boolean {
    const p = this.pauseKey;
    this.pauseKey = false;
    return p;
  }

  private updateHeld(): void {
    this.held = this.keyHeld || this.pointers > 0;
    this.keyDirY = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
  }
}
