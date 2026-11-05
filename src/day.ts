import { DAY } from './config';
import { KEYFRAMES } from './gfx/palette';

const PHASE = DAY.hold + DAY.blend;
const CYCLE = PHASE * KEYFRAMES.length;

// Per keyframe (NOON, SUNSET, DUSK, NIGHT, DAWN), blended the same way as the colors.
const NIGHTNESS = [0, 0.1, 0.5, 1, 0.25]; // star, headlight alpha
const SUN = [1, 0.5, 0.15, 0, 0.5]; // solar charge
// Where the sun is: x as a share of the view width, y from top of sky (0) to horizon (1);
// past 1 it's below the horizon. Long shadows come from these.
const SUN_X = [0.62, 0.86, 0.92, 0.5, 0.08];
const SUN_Y = [0.15, 0.68, 0.9, 1.4, 0.68];

const smooth = (t: number) => t * t * (3 - 2 * t);

// The time of day as palette rows to blend, plus everything that follows from it. Mutated
// in place, so reading it every frame allocates nothing.
export class DayClock {
  time = 0;
  rowA = 0;
  rowB = 0;
  mix = 0;
  night = 0;
  sun = 0;
  sunX = 0;
  sunY = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.time = DAY.startPhase * PHASE;
    this.update(0);
  }

  update(dt: number): void {
    this.time = (this.time + dt) % CYCLE;
    const i = Math.floor(this.time / PHASE);
    const local = this.time - i * PHASE;
    this.rowA = i;
    this.rowB = (i + 1) % KEYFRAMES.length;
    this.mix = local < DAY.hold ? 0 : smooth((local - DAY.hold) / DAY.blend);
    const m = this.mix;
    const a = this.rowA;
    const b = this.rowB;
    this.night = NIGHTNESS[a] + (NIGHTNESS[b] - NIGHTNESS[a]) * m;
    this.sun = SUN[a] + (SUN[b] - SUN[a]) * m;
    this.sunY = SUN_Y[a] + (SUN_Y[b] - SUN_Y[a]) * m;
    // Night to dawn: the sun comes back up on the other side rather than sweeping across.
    this.sunX = a === 3 ? SUN_X[4] : SUN_X[a] + (SUN_X[b] - SUN_X[a]) * m;
  }

  get name(): string {
    return KEYFRAMES[this.mix < 0.5 ? this.rowA : this.rowB];
  }
}
