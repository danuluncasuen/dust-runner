import { SCENE, SPAWN } from './config';

// Things on the plain. One pool, allocated once; spawning reuses dead slots.
export const Kind = { Rock: 0, Crater: 1, Sample: 2, Cell: 3 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface Entity {
  alive: boolean;
  kind: Kind;
  variant: number;
  x: number; // screen units, left edge
  depth: number; // 0 far .. 1 near
  w: number; // drawn width, units at depth 1
  hitX: number; // footprint half-width, units at depth 1
  hitDepth: number; // footprint half-depth
  bob: number; // phase, for pickups
  passed: boolean; // has crossed the rover (hazards: near-miss check done)
  struck: boolean; // has already hit the rover
}

export const isPickup = (k: Kind) => k === Kind.Sample || k === Kind.Cell;

// Depth to screen: y of the ground contact point, and the size of things there.
export function plainY(depth: number): number {
  return SCENE.plainFar + (SCENE.plainNear - SCENE.plainFar) * depth;
}

export function depthScale(depth: number): number {
  return SCENE.scaleFar + (1 - SCENE.scaleFar) * depth;
}

export function makePool(): Entity[] {
  const pool: Entity[] = [];
  for (let i = 0; i < SPAWN.maxEntities; i++) {
    pool.push({ alive: false, kind: Kind.Rock, variant: 0, x: 0, depth: 0, w: 0, hitX: 0, hitDepth: 0, bob: 0, passed: false, struck: false });
  }
  return pool;
}
