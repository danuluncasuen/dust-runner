import { RENDER, TEXT } from '../config';

// One coverage texture holds every shape and glyph, so a whole frame is one draw call.
// Each texel is coverage only (0..255); the color comes from the draw call, so a shape can be
// drawn in any palette color, and multi-color art is a stack of single-color layers.
// Shapes are baked once at startup with canvas 2D, at `density` texels per logical unit, and
// sampled with linear filtering, so their edges stay smooth at any screen scale.

export interface Region {
  // Texel rect in the atlas.
  readonly x: number;
  readonly y: number;
  readonly tw: number;
  readonly th: number;
  // Natural size in logical units.
  readonly w: number;
  readonly h: number;
}

export interface Glyph extends Region {
  readonly advance: number; // units at TEXT.bakeSize, before tracking
}

const PAD = 2; // texels between regions, so linear filtering never reaches a neighbor

export class Atlas {
  readonly size = RENDER.atlasSize;
  readonly pixels = new Uint8Array(this.size * this.size);
  readonly glyphs: (Glyph | null)[] = new Array(128).fill(null);
  // A fully covered block for rects and gradients.
  readonly solid: Region;
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  private readonly scratch = document.createElement('canvas');
  private readonly sctx = this.scratch.getContext('2d', { willReadFrequently: true })!;

  constructor() {
    this.solid = this.bake(1, 1, 4, (c) => c.fillRect(0, 0, 1, 1));
  }

  // Bakes a w x h (units) shape. `draw` paints in white on a context scaled to units.
  bake(w: number, h: number, density: number, draw: (ctx: CanvasRenderingContext2D) => void): Region {
    const tw = Math.ceil(w * density);
    const th = Math.ceil(h * density);
    const r = this.alloc(tw, th);
    const c = this.scratch;
    c.width = tw;
    c.height = th;
    const ctx = this.sctx;
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    draw(ctx);
    const data = ctx.getImageData(0, 0, tw, th).data;
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) this.pixels[(r.y + y) * this.size + r.x + x] = data[(y * tw + x) * 4 + 3];
    return { x: r.x, y: r.y, tw, th, w, h };
  }

  // Rasterizes the text font into glyph masks. Call after the font has loaded.
  bakeGlyphs(): void {
    const s = TEXT.bakeSize;
    // Measured on a canvas of its own: resizing the bake canvas resets its font.
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${TEXT.weight} ${s}px ${TEXT.family}`;
    for (let code = 33; code < 127; code++) {
      const ch = String.fromCharCode(code);
      const advance = ctx.measureText(ch).width;
      const w = Math.ceil(advance) + 2;
      const region = this.bake(w, s * 1.25, 1, (c) => {
        c.font = `${TEXT.weight} ${s}px ${TEXT.family}`;
        c.textBaseline = 'alphabetic';
        c.fillText(ch, 1, s);
      });
      this.glyphs[code] = { ...region, advance };
    }
    // Space: no texels, just an advance.
    this.glyphs[32] = { x: 0, y: 0, tw: 0, th: 0, w: 0, h: 0, advance: ctx.measureText(' ').width };
  }

  private alloc(w: number, h: number): { x: number; y: number } {
    if (w + PAD > this.size) throw new Error(`atlas: region ${w}x${h} is wider than the atlas`);
    if (this.shelfX + w + PAD > this.size) {
      this.shelfY += this.shelfH;
      this.shelfX = 0;
      this.shelfH = 0;
    }
    if (this.shelfY + h + PAD > this.size) throw new Error('atlas: out of space; raise RENDER.atlasSize');
    const r = { x: this.shelfX, y: this.shelfY };
    this.shelfX += w + PAD;
    this.shelfH = Math.max(this.shelfH, h + PAD);
    return r;
  }
}
