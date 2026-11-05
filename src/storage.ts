import { SCORE } from './config';

// Storage can throw (private mode, blocked site data); the game still works without it.
export function loadBest(): number {
  try {
    const n = Number(localStorage.getItem(SCORE.bestKey));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(SCORE.bestKey, String(Math.floor(score)));
  } catch {
    // Best score just won't survive a reload.
  }
}
