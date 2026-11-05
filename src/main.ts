import '@fontsource/jost/500.css';
import { HITCH, MAX_FRAME, STEP, TESTING, TEXT } from './config';
import { buildArt } from './art';
import { Sound } from './audio';
import { Game } from './game';
import { Input } from './input';
import { Renderer } from './gfx/renderer';

const DEBUG = new URLSearchParams(location.search).has('debug');

// iOS reports frame times rounded to 1 ms, so 60 Hz frames arrive as 16 or 17 ms, never 16.67.
// Fed straight into the fixed step, a 16 ms frame falls just short of a step: the game freezes
// for a frame, then jumps two steps on the next, a judder across the whole screen. Gaps within a
// few ms of a whole number of steps count as exactly that many (a dropped frame still counts as 2).
const STEP_MS = STEP * 1000;
function steadyGap(gap: number): number {
  const steps = Math.round(gap / STEP_MS);
  return steps >= 1 && Math.abs(gap - steps * STEP_MS) < 4 ? steps * STEP_MS : gap;
}

// Glyphs are baked into the atlas, so the font has to be there first. It ships with the app;
// the timeout only guards against a broken load (the text would be missing, nothing else).
async function fontReady(): Promise<void> {
  const font = `${TEXT.weight} ${TEXT.bakeSize}px ${TEXT.family}`;
  await Promise.race([document.fonts.load(font), new Promise((r) => setTimeout(r, 2000))]).catch(() => {});
}

async function start(): Promise<void> {
  await fontReady();
  const art = buildArt();
  art.atlas.bakeGlyphs();

  const screen = document.getElementById('screen') as HTMLCanvasElement;
  const renderer = new Renderer(screen, art.atlas);
  const input = new Input(screen, renderer);
  const sound = new Sound();
  const game = new Game(art, input, sound);
  game.debugHits = new URLSearchParams(location.search).has('hits');
  // Handy for poking at state from the browser console.
  if (DEBUG) Object.assign(window, { game, renderer, input, art, sound });

  // Audio may only start inside a user gesture; every tap or key press makes sure it's running.
  screen.addEventListener('pointerdown', () => sound.unlock());
  window.addEventListener('keydown', () => sound.unlock());

  // Fixed-timestep loop: simulate in 1/60 s steps, render once per animation frame.
  let last = performance.now();
  let acc = 0;
  let running = true;

  function loop(now: number): void {
    if (!running) return;
    const gap = now - last;
    last = now;
    acc += Math.min(MAX_FRAME, steadyGap(gap) / 1000);
    const t0 = performance.now();
    let steps = 0;
    while (acc >= STEP) {
      game.update(STEP, renderer.viewW);
      acc -= STEP;
      steps++;
    }
    const t1 = performance.now();
    game.render(renderer);
    const t2 = performance.now();
    if (TESTING.lagLog && gap > HITCH.logMs && game.inRun) {
      console.log(`[lag] gap ${gap.toFixed(1)} | update ${(t1 - t0).toFixed(1)} (${steps} steps) render ${(t2 - t1).toFixed(1)} | ${renderer.lastCount} quads | ${game.lagContext()}`);
    }
    requestAnimationFrame(loop);
  }

  // Leaving the app (or the window, on desktop) pauses the run so nothing is lost meanwhile.
  window.addEventListener('blur', () => game.pause());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
    running = !document.hidden;
    if (running) {
      last = performance.now();
      acc = 0;
      requestAnimationFrame(loop);
    }
  });

  // Test builds report the screen they got, for checking the layout on the phone.
  if (TESTING.lagLog) {
    setTimeout(() => {
      console.log(`[screen] css ${innerWidth}x${innerHeight} canvas ${screen.width}x${screen.height} scale ${renderer.scale.toFixed(2)} view ${renderer.viewW.toFixed(0)} origin ${renderer.originX},${renderer.originY} insets L${renderer.insetL.toFixed(1)} R${renderer.insetR.toFixed(1)} B${renderer.insetB.toFixed(1)}`);
    }, 1500);
  }

  // Draw one frame before the loop starts, so shader compile and texture upload happen now and
  // not on the first frame of play (iOS stalls a frame on the first use of each).
  game.render(renderer);
  requestAnimationFrame(loop);
}

start();
