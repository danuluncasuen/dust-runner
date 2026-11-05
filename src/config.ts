// Every tunable number lives here. SPEC.md has the reasoning behind each value.

// Logical units: the height is fixed, the width follows the screen within these bounds.
export const VIEW = { h: 180, minW: 280, maxW: 460 } as const;

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
  maxSpeed: 2.0, // depth per second
  ramp: 0.15, // s to reach full speed after a new touch
  ease: 11, // how quickly it closes on the target (1/s)
  hitX: 10, // footprint half-width, units at depth 1
  hitDepth: 0.028, // footprint half-depth: about the wheels' contact patch
  nearFactor: 1.9, // a hazard passing within this many footprints is a near miss
  bob: 0.6, // units of suspension bounce
  knock: 4, // units the rover is thrown back by a hit
} as const;

export const WORLD = {
  speedTitle: 40, // units/s at depth 1, behind the title screen
  speedStart: 85,
  speedMax: 190,
  speedTau: 40, // s; the speed closes on speedMax fast at first, then levels off
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
  rock: { start: 0.9, min: 0.36, ramp: 90, unlock: 0 },
  crater: { start: 3, min: 1.4, ramp: 90, unlock: 12 },
  sample: { start: 1.8, min: 1.2, ramp: 90, unlock: 0 },
  cell: { start: 16, min: 16, ramp: 1, unlock: 0, nightFactor: 0.4 }, // night: every 6.4 s
  firstDelay: 0.25, // share of the interval before the first of each kind
  clearDepth: 0.2, // a new hazard avoids depths within this of the last one
  maxEntities: 48,
} as const;

export const SCORE = {
  sample: 50,
  nearMiss: 10,
  cell: 20, // battery added
  milestone: 1000, // a callout every this many metres
  bestKey: 'dust-runner.best',
} as const;

// Hits and pickups, felt.
export const JUICE = {
  shakeHit: { size: 2, time: 0.28 }, // units, s
  shakeWreck: { size: 4, time: 0.55 },
  flash: 0.4, // s of the red screen-edge flash
  pipBlink: 1.2, // s the lost hull pip blinks
  gaugePulse: 0.35, // s the gauge swells after a cell
  chainGap: 2.5, // s between samples that keeps their chime climbing
  warnEvery: 1.3, // s between low-battery beeps
  callout: 2.2, // s a phase or milestone callout stays up
  countdown: 3, // s of 3-2-1 on resume
  wheelDust: 34, // puffs per second at top speed
  streaks: 16, // speed streaks per second at top speed
  streakFrom: 0.3, // share of the speed range where streaks begin
} as const;

export const PARTICLES = { max: 192, gravity: 40 } as const;
export const POPUPS = { max: 10, life: 0.9, rise: 12, size: 4.6 } as const;

export const AUDIO = {
  volume: 0.5,
  musicVolume: 0.55,
  mutedKey: 'dust-runner.muted',
  bpm: 126,
  musicFade: 1.2, // s
  engine: 0.05, // peak gain of the motor hum
  echoTime: 0.24,
  echoFeedback: 0.3,
  echoCutoff: 1400,
} as const;

// Slow frames get logged to the console (the iOS app forwards it to devicectl --console).
export const HITCH = { logMs: 25 } as const;

// Must all be off for a release build.
export const TESTING = {
  lagLog: true,
} as const;
