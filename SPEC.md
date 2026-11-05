# Dust Runner: spec

**Steer across Mars, grab samples, and make it through the night.**

A landscape, one-thumb endless run in a minimal travel-poster style (see `art-brainstorm/concept.jpg`). The rover drives on its own. You drag your thumb up and down to move it nearer or farther across a wide plain, dodging hazards and picking up samples (score) and battery cells (power). The sun charges the battery and the night drains it. Each night is a stretch to survive, and dawn is the relief.

Status: **MVP.** The core loop is playable in the browser. It hasn't been played on the phone yet. There's no audio, haptics or juice yet.

## Pillars

- Performance first: a steady 60 fps on the iPhone 15, with a few ms of work per frame at most.
- Minimal but alive: big flat shapes, haze and a lot of sky. The motion comes from the day cycle, the swinging shadows and the parallax.
- The day cycle is the rhythm of the game: safe noon, warning sunset, dangerous night, relieved dawn.

## Look

- Smooth poster style at full device resolution. This is not pixel art, unlike Get2Mars. The flat shapes are pre-baked as soft-edged masks, the sky is a gradient, and the haze is translucent bands.
- **Palette** (`src/gfx/palette.ts`): every named color has a value per keyframe (NOON, SUNSET, DUSK, NIGHT, DAWN). NOON is sampled from concept.jpg: sky `#28454B` → `#6F8F8A` → `#F3DBAA`, mesa `#B85407`, hills `#AF8A5E`, plain `#EF9F60` / `#EC8A3E`, shadow `#A57D54`. DUSK is the blue Martian sunset.
- Samples are teal, picked up from the sky, so they pop against the orange. Cells are pale yellow.
- **Rover:** chibi C at the small size (big head, big lens eye, chunky wheels), rebuilt from flat shapes the way the astronaut is in the poster. Its long shadow points away from the sun.
- **Font:** Jost (bundled through @fontsource), Futura-like with wide tracking, as in the poster's "MARS".
- Tried and dropped during exploration:
  - detailed pixel canyons
  - dithered fog
  - hoodoo layers that looked like buildings
  - pixel-poster edges (the gradient banded)

## Screen and depth

- Logical units: **height 180**. Width follows the screen, clamped to 280–420, with letterboxing beyond that. On the iPhone 15 in landscape that's about 355 units, at about 6.2 device px per unit.
- The horizon is at y 80. The plain spans depth d 0 (far) to 1 (near), mapped to y 104–166, with scale 0.5–1. A thing's screen speed is world speed × scale, so far things crawl and near things rush.
- Distant things fade into the horizon haze: below d 0.35 they get a haze overlay.

## Controls

- The rover's depth eases toward the depth under the finger, with a speed cap. After a new touch, the speed ramps up over 0.15 s (from the Get2Mars playbook). On desktop, use the up and down arrows.
- The rover's x is fixed at 28% of the view width.

## Core loop

- **Battery** 0–100, starting at 60. It drains 2.6/s, and the sun recharges it by `sun × 4.0`, where sun is 1 at NOON, 0.5 at SUNSET and DAWN, 0.15 at DUSK and 0 at NIGHT. So noon runs net +1.4/s and night runs −2.6/s. At 0 the run ends.
- **Hull:** 3 hits. A hit costs 1 and gives 1.2 s of invulnerability with a blink. At 0 the run ends.
- **Rocks** (hit, so dodge them) are there from the start. **Craters** (hit, wide and shallow) unlock at 25 s.
- **Samples** are worth +50 score. **Cells** give +20 battery. They come every 16 s by day and every 6.4 s at night.
- Tuning check (an autopilot over 320 s): the battery bottoms out at 26–39 during the night when cells are chased. Tried first: cells every 7 s and +25 each, with a drain of 2.2. The battery never fell below 84, so the night had no tension.
- **Score** = metres driven + samples. The best score is saved.
- The world speed ramps up with run time. Spawn intervals shrink. All numbers are in `config.ts`.
- A run starts at NOON. One full day is 150 s.

## Renderer (src/gfx/)

- WebGL2 instanced quads with one draw call per frame. Each instance is 12 floats: destination rect (units), source rect (atlas texels, negative w flips), top and bottom palette index, top and bottom alpha.
- The atlas is a single R8 coverage texture, 2048², with linear filtering. Every shape is a mask drawn in a palette color, so the edges stay smooth at any scale. Multi-color art (the rover) is a stack of single-color mask layers.
- Gradients are the same quad with different top and bottom colors and alphas. The sky is two stacked gradient quads.
- The palette blend (day rows A and B, mix) happens per vertex, so the fragment shader only does one texture read.
- Shapes are baked at startup with canvas 2D at a set number of texels per unit: about 6 for small things, 3–4 for big strips. Nothing is baked during play.
- A lost WebGL context is rebuilt from the CPU copies of the atlas and palette.

## Not done yet

- Juice: dust particles, haptics, audio, hit flashes, popups, a resume countdown.
- More hazards: dust devils, meteors with growing shadows, fissures.
- The headlight should properly reveal hazards at night.
- `npx cap add ios`, the landscape lock, and the first install on the phone.
