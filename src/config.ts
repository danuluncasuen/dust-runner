// Every tunable number lives here. SPEC.md has the reasoning behind each value.

// Logical units: the height is fixed, the width follows the screen within these bounds.
export const VIEW = { h: 180, minW: 280, maxW: 420 } as const;

// Fixed-timestep loop.
export const STEP = 1 / 60;
export const MAX_FRAME = 0.25; // s; longer gaps (a stall, a breakpoint) are clamped to this

export const RENDER = {
  maxInstances: 8192, // quads per frame; the batch flushes early if a frame needs more
  atlasSize: 2048, // texels, square, one byte each
} as const;

export const TEXT = {
  family: "'Jost'",
  weight: 500,
  bakeSize: 48, // px the glyphs are baked at
  capHeight: 0.7, // share of bakeSize a capital letter fills
  tracking: 0.35, // extra space between letters, in multiples of the size (the poster's wide "M A R S")
} as const;

// Time of day: NOON -> SUNSET -> DUSK -> NIGHT -> DAWN -> NOON. Each phase holds its colors for
// `hold` seconds, then blends into the next over `blend` seconds.
export const DAY = {
  hold: 20,
  blend: 10,
  startPhase: 0, // index into KEYFRAMES in palette.ts
} as const;

// Scene layout. The plain runs from depth 0 (far) to 1 (near).
export const SCENE = {
  horizon: 80, // y where sky meets ground
  plainFar: 104, // y of depth 0
  plainNear: 166, // y of depth 1
  scaleFar: 0.5, // size of things at depth 0 (1 at depth 1)
  hazeDepth: 0.35, // things farther than this fade into the horizon haze
  hazeMax: 0.75, // haze alpha at depth 0
  hillParallax: 0.06, // share of world speed
  mesaParallax: 0.22,
  stars: 90,
} as const;

export const ROVER = {
  x: 0.28, // share of the view width
  startDepth: 0.6,
  maxSpeed: 1.6, // depth per second
  ramp: 0.15, // s to reach full speed after a new touch
  ease: 9, // how quickly it closes on the target (1/s)
  hitW: 20, // units, at depth 1
  hitDepth: 0.06, // depth half-width of the hit box
  bob: 0.6, // units of suspension bounce
} as const;

export const WORLD = {
  speedStart: 55, // units/s at depth 1
  speedMax: 120,
  speedRamp: 0.45, // units/s gained per second of run
  metersPerUnit: 0.05,
} as const;

export const BATTERY = {
  start: 60,
  max: 100,
  drain: 2.6, // per second, always
  charge: 4.0, // per second at full sun
  low: 25, // the gauge turns to danger below this
} as const;

export const HULL = {
  max: 3,
  invuln: 1.2, // s after a hit
} as const;

// Spawn intervals in seconds: `start` at the beginning, shrinking to `min` over `ramp` seconds.
export const SPAWN = {
  rock: { start: 1.3, min: 0.5, ramp: 180, unlock: 0 },
  crater: { start: 4.5, min: 2.2, ramp: 180, unlock: 25 },
  sample: { start: 2.2, min: 1.8, ramp: 180, unlock: 0 },
  cell: { start: 16, min: 16, ramp: 1, unlock: 0, nightFactor: 0.4 }, // night: every 6.4 s
  clearDepth: 0.12, // a new spawn avoids depths within this of the last one
  maxEntities: 48,
} as const;

export const SCORE = {
  sample: 50,
  cell: 20, // battery added
  bestKey: 'dust-runner.best',
} as const;

// Slow frames get logged to the console (the iOS app forwards it to devicectl --console).
export const HITCH = { logMs: 25 } as const;

// Must all be off for a release build.
export const TESTING = {
  lagLog: true,
} as const;
