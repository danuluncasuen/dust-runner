import { Atlas, type Region } from './gfx/atlas';
import { C } from './gfx/palette';

// Every shape, baked into the atlas once at startup as a soft-edged mask (see atlas.ts).
// Flat poster style after art-brainstorm/concept.jpg. Sizes are logical units at depth 1.

export const HILL_W = 640; // the hill strip wraps every HILL_W units
export const ROVER_W = 32;
export const ROVER_H = 27;
export const ROVER_GROUND = 25; // y in the rover box where the wheels touch the ground
export const WHEEL_X = [7, 16, 25];
export const WHEEL_Y = 21;
export const WHEEL_R = 4;

type Ctx = CanvasRenderingContext2D;

// One layer of the rover: a mask and the palette color it's drawn in.
export interface Layer {
  region: Region;
  color: number;
}

// A two-tone shape: body plus a shade layer drawn over it.
export interface Pair {
  body: Region;
  shade: Region;
}

export interface Art {
  atlas: Atlas;
  hills: Region;
  mesas: Pair[];
  panel: Region; // big diagonal plain panel
  band: Region; // long thin plain stripe
  sun: Region;
  glow: Region;
  star: Region;
  shadow: Region; // soft ellipse, stretched for long shadows
  beam: Region;
  rocks: Pair[];
  craterRim: Region;
  craterIn: Region;
  sample: Pair;
  cell: Pair;
  rover: Layer[];
  hubDot: Region;
  gaugeCap: Region; // hull pip
  edge: Region; // soft horizontal fade for the damage flash at the screen's sides
  pauseIcon: Region;
  soundIcon: Region;
  soundWaves: Region;
  soundOff: Region;
}

export function buildArt(): Art {
  const a = new Atlas();
  return {
    atlas: a,
    hills: a.bake(HILL_W, 24, 3, hills),
    mesas: [
      mesa(a, 120, 18, false),
      mesa(a, 80, 13, true),
      mesa(a, 150, 22, true),
      mesa(a, 60, 10, false),
    ],
    panel: a.bake(260, 64, 2, (c) => poly(c, [[0, 0], [190, 10], [120, 64], [-0, 64]])),
    band: a.bake(300, 8, 2, (c) => poly(c, [[0, 3], [300, 0], [300, 8], [0, 8]])),
    sun: a.bake(8, 8, 8, (c) => disc(c, 4, 4, 3.6)),
    glow: a.bake(80, 80, 1, (c) => {
      const g = c.createRadialGradient(40, 40, 0, 40, 40, 40);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 80, 80);
    }),
    star: a.bake(2, 2, 8, (c) => disc(c, 1, 1, 0.55)),
    shadow: a.bake(32, 6, 4, (c) => ellipse(c, 16, 3, 15.5, 2.6)),
    beam: a.bake(80, 30, 2, (c) => {
      const g = c.createLinearGradient(0, 0, 80, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      poly(c, [[0, 13], [80, 0], [80, 30], [0, 17]]);
    }),
    rocks: [rock(a, 34, 23, 1), rock(a, 46, 31, 2), rock(a, 58, 38, 3), rock(a, 28, 19, 4)],
    craterRim: a.bake(34, 9, 4, (c) => ellipse(c, 17, 4.5, 16.5, 4.2)),
    craterIn: a.bake(34, 9, 4, (c) => ellipse(c, 17, 5.4, 14, 3)),
    sample: {
      body: a.bake(10, 11, 8, (c) => {
        poly(c, [[5, 0], [8, 5], [5, 11], [2, 5]]);
        poly(c, [[1.5, 4], [3.2, 7], [1.5, 11], [0, 7]]);
        poly(c, [[8.5, 5], [10, 8], [8.5, 11], [7, 8]]);
      }),
      shade: a.bake(10, 11, 8, (c) => {
        poly(c, [[5, 0], [5, 11], [2, 5]]);
        poly(c, [[1.5, 4], [1.5, 11], [0, 7]]);
      }),
    },
    cell: {
      body: a.bake(9, 13, 8, (c) => {
        rrect(c, 0.5, 2, 8, 11, 1.6);
        c.fillRect(3, 0.5, 3, 2);
      }),
      shade: a.bake(9, 13, 8, (c) => poly(c, [[5, 3.5], [2.5, 8], [4.3, 8], [3.6, 11.5], [6.5, 6.8], [4.6, 6.8], [5.6, 3.5]])),
    },
    rover: rover(a),
    hubDot: a.bake(2, 2, 8, (c) => disc(c, 1, 1, 0.8)),
    gaugeCap: a.bake(4, 4, 8, (c) => disc(c, 2, 2, 2)),
    edge: a.bake(16, 4, 4, (c) => {
      const g = c.createLinearGradient(0, 0, 16, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 16, 4);
    }),
    pauseIcon: a.bake(8, 8, 8, (c) => {
      rrect(c, 1.2, 0.8, 2.2, 6.4, 0.5);
      rrect(c, 4.6, 0.8, 2.2, 6.4, 0.5);
    }),
    soundIcon: a.bake(10, 8, 8, (c) => poly(c, [[0.5, 2.8], [2.4, 2.8], [5, 0.6], [5, 7.4], [2.4, 5.2], [0.5, 5.2]])),
    soundWaves: a.bake(10, 8, 8, (c) => {
      c.lineWidth = 0.8;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(5, 4, 2.2, -0.8, 0.8);
      c.stroke();
      c.beginPath();
      c.arc(5, 4, 3.8, -0.8, 0.8);
      c.stroke();
    }),
    soundOff: a.bake(10, 8, 8, (c) => {
      c.lineWidth = 0.9;
      c.lineCap = 'round';
      line(c, 6.4, 2.6, 9, 5.4);
      line(c, 9, 2.6, 6.4, 5.4);
    }),
  };
}

// Rolling far mountains: whole waves over HILL_W, so the strip wraps without a seam.
function hills(c: Ctx): void {
  c.beginPath();
  c.moveTo(0, 24);
  for (let x = 0; x <= HILL_W; x += 1) {
    const t = (x / HILL_W) * Math.PI * 2;
    const v = 0.55 * Math.sin(t * 3 + 1) + 0.3 * Math.sin(t * 7 + 2) + 0.15 * Math.sin(t * 17 + 0.5);
    const peak = Math.max(0, Math.sin(t * 2 + 4)) * 0.35;
    c.lineTo(x, 24 - 6 - 9 * (v * 0.5 + 0.5) - 8 * peak);
  }
  c.lineTo(HILL_W, 24);
  c.closePath();
  c.fill();
}

// A flat-topped mesa with steep sides, optionally with a lower step; the shade is its base.
function mesa(a: Atlas, w: number, h: number, step: boolean): Pair {
  const pts: [number, number][] = [[0, h], [4, 3], [8, 0]];
  if (step) pts.push([w * 0.5, 0], [w * 0.55, h * 0.35], [w - 10, h * 0.35]);
  else pts.push([w - 10, 0]);
  pts.push([w - 4, h * 0.5], [w, h]);
  return {
    body: a.bake(w, h, 4, (c) => poly(c, pts)),
    shade: a.bake(w, h, 4, (c) => {
      c.beginPath();
      c.rect(0, h * 0.68, w, h);
      c.clip();
      poly(c, pts);
    }),
  };
}

// A lumpy boulder lit from the upper left.
function rock(a: Atlas, w: number, h: number, seed: number): Pair {
  const pts: [number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const t = Math.PI + (i / 8) * Math.PI;
    const wob = 1 + 0.12 * Math.sin(i * 2.3 + seed);
    pts.push([w / 2 + Math.cos(t) * (w / 2) * wob, h + Math.sin(t) * h * wob]);
  }
  return {
    body: a.bake(w, h + 1, 6, (c) => poly(c, pts.map(([x, y]) => [Math.max(0, Math.min(w, x)), Math.max(0, y)]))),
    shade: a.bake(w, h + 1, 6, (c) => {
      c.beginPath();
      c.moveTo(w * 0.55, 0);
      c.lineTo(w, 0);
      c.lineTo(w, h + 1);
      c.lineTo(0, h + 1);
      c.lineTo(0, h * 0.75);
      c.closePath();
      c.clip();
      poly(c, pts.map(([x, y]) => [Math.max(0, Math.min(w, x)), Math.max(0, y)]));
    }),
  };
}

// The chibi rover from the brainstorm, as flat layers, facing right: big head, big lens eye,
// chunky wheels, a short mast and the power unit at the back.
function rover(a: Atlas): Layer[] {
  const W = ROVER_W;
  const H = ROVER_H;
  const L = (color: number, draw: (c: Ctx) => void): Layer => ({ region: a.bake(W, H, 6, draw), color });
  return [
    L(C.roverSh, (c) => {
      // Rocker-bogie legs and the power unit.
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      line(c, WHEEL_X[0], WHEEL_Y, 11.5, 16.5);
      line(c, WHEEL_X[1], WHEEL_Y, 11.5, 16.5);
      line(c, WHEEL_X[2], WHEEL_Y, 23, 16.5);
      rrect(c, 0, 10.5, 5, 5, 1);
    }),
    L(C.rover, (c) => {
      rrect(c, 3, 10.5, 25, 6.5, 1.5); // body
      c.fillRect(19.5, 6, 2.2, 5); // mast
      rrect(c, 13.5, 0, 16, 10, 2.4); // head
      rrect(c, 6, 8.6, 8, 2.4, 0.8); // deck box
    }),
    L(C.roverSh, (c) => {
      c.fillRect(3.6, 15, 23.8, 2); // underside
      c.fillRect(14, 8.4, 15, 1.6); // head underside
    }),
    L(C.roverDk, (c) => {
      disc(c, 24.2, 4.6, 3.1); // lens
      c.fillRect(15.6, 2.4, 2, 2); // side camera
      rrect(c, 28, 11.5, 3.2, 4.5, 0.8); // arm turret
      for (const x of WHEEL_X) disc(c, x, WHEEL_Y, WHEEL_R);
    }),
    L(C.roverSh, (c) => {
      for (const x of WHEEL_X) disc(c, x, WHEEL_Y, 1.6);
    }),
    L(C.roverHi, (c) => {
      disc(c, 23.1, 3.5, 1); // glint
      c.fillRect(13.5 + 2.4, 0, 16 - 4.8, 0.8); // head top light
    }),
  ];
}

// Canvas helpers.
function disc(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function poly(c: Ctx, pts: [number, number][]): void {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  c.fill();
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

function line(c: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}
