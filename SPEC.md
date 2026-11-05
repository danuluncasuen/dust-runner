# Dust Runner: spec

**Steer across Mars, grab samples, and make it through the night.**

A landscape, one-thumb endless run in a minimal travel-poster style (see `art-brainstorm/concept.jpg`). The rover drives on its own. You drag your thumb up and down to move it nearer or farther across a wide plain, dodging hazards and picking up samples (score) and battery cells (power). The sun charges the battery and the night drains it. Each night is a stretch to survive, and dawn is the relief.

Status: **MVP with juice.** The core loop runs on the phone, with sound, haptics and effects.

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

- Logical units: **height 180**. Width follows the screen, clamped to 280–460, with letterboxing beyond that. The canvas fills the whole screen, under the notch and home bar, so there are no black bars; only the HUD keeps inside the safe-area insets (the renderer reads them from the hidden `#safe` element). On the iPhone 15 in landscape that's about 390 units.
- The horizon is at y 80. The plain spans depth d 0 (far) to 1 (near), mapped to y 104–166, with scale 0.5–1. A thing's screen speed is world speed × scale, so far things crawl and near things rush.
- Distant things fade into the horizon haze: below d 0.35 they get a haze overlay.

## Controls

- The rover's depth eases toward the depth under the finger, with a speed cap. After a new touch, the speed ramps up over 0.15 s (from the Get2Mars playbook). On desktop, use the up and down arrows.
- The rover's x is fixed at 28% of the view width.
- The depth speed cap is 2.0/s with an ease of 11/s, raised to keep up with the faster world.

## Core loop

- **Battery** 0–100, starting at 60. It drains 2.6/s, and the sun recharges it by `sun × 4.0`, where sun is 1 at NOON, 0.5 at SUNSET and DAWN, 0.15 at DUSK and 0 at NIGHT. So noon runs net +1.4/s and night runs −2.6/s. At 0 the run ends.
- **Hull:** 3 hits. A hit costs 1 and gives 1.2 s of invulnerability with a blink. At 0 the run ends.
- **Rocks** (they cost a hit) are there from the start: lumpy boulders in four sizes, 28–58 units wide and 19–38 tall at depth 1, about rover-sized or bigger. Tried: small boulders 9–15 wide (not worth dodging) and pointed mini mountains (Dan preferred the boulder shape, so it came back at the bigger size). **Craters** (they cost a hit, wide and shallow) unlock at 12 s.
- **Hits are footprints:** two ovals on the ground, centered on what's drawn, must touch. A rock's ground shadow is its footprint, drawn 20% wider, so what you see is what hits you. The rover's footprint is about its wheels' contact patch. `?hits` draws them all.
  - Tried first: rectangles with a depth reach of ±6.5 units, shifted left of the art. Rocks were only about 6 units tall, so the rover could visibly clear one and still take the hit.
- A rock turns half see-through while the rover is behind it, so you never lose sight of yourself.
- **Samples** are worth +50 score, and their chime climbs when they come within 2.5 s of each other. A hazard passing within 1.9 footprints without touching is a **near miss**: +10. **Cells** give +20 battery. They come every 16 s by day and every 6.4 s at night.
- Tuning check (an autopilot over 320 s at the new speeds): the battery bottoms out at 13–31 during the night when cells are chased. Tried first: cells every 7 s and +25 each, with a drain of 2.2. The battery never fell below 84, so the night had no tension.
- **Score** = metres driven + samples + near misses. The best score is saved.
- **Speed** starts at 85 and closes on 190 with a 40 s time constant, so it climbs fast early and then levels off: 140 at 30 s, 167 at 60 s, 179 at 90 s. Spawn intervals reach their minimum at 90 s (rocks every 0.36 s), so the middle of a run is busy: up to about 19 objects on screen. Earlier curves: 55 rising 0.45 per second (a boring opening), then 175 with a 60 s constant and 150 s spawn ramp (too calm mid-game). All numbers are in `config.ts`.
- A run starts at NOON. One full day is 150 s.

## Juice

- **Dust** from the wheels, thicker with speed. **Speed streaks** over the plain from 30% of the speed range.
- **Hit:** screen shake, a red fade at all four edges, debris, the rover thrown back, the lost hull pip blinking red. No hit-stop (it felt like a freeze in Get2Mars).
- **Pickups:** a sparkle burst and a popup (`+50`, `POWER`). A cell makes the gauge swell yellow.
- **Callouts:** HIGH NOON, SUNSET, DUSK, NIGHT FALLS, DAWN as the day turns, and every 1000 m.
- **Headlight:** at night, hazards ahead on the rover's line light up.
- **Low battery:** below 25 the gauge blinks red, with a beep and a tick every 1.3 s.
- **Audio** (`audio.ts`, synth only, no files): an original bouncy tune in C major at 126 bpm, 8 bars of oom-pah bass, off-beat shaker and a plucked melody, with a music-box octave on every other loop. It speeds up with the rover. Don't reuse Get2Mars's music. Plus a motor hum and rumble that rise with speed, and an effect per event. Engine updates run a few times a second, since each one schedules audio events.
- **Haptics** per event (`haptics.ts`).
- **Pause:** the icon next to the hull pips (or P / Esc), and auto-pause on leaving the app. Resuming runs a 3-2-1. The mute icon shows on the title, pause and game-over screens (or press M).

## Renderer (src/gfx/)

- WebGL2 instanced quads with one draw call per frame. Each instance is 12 floats: destination rect (units), source rect (atlas texels, negative w flips), top and bottom palette index, top and bottom alpha.
- The atlas is a single R8 coverage texture, 2048², with linear filtering. Every shape is a mask drawn in a palette color, so the edges stay smooth at any scale. Multi-color art (the rover) is a stack of single-color mask layers.
- Gradients are the same quad with different top and bottom colors and alphas. The sky is two stacked gradient quads.
- The palette blend (day rows A and B, mix) happens per vertex, so the fragment shader only does one texture read.
- Shapes are baked at startup with canvas 2D at a set number of texels per unit: about 6 for small things, 3–4 for big strips. Nothing is baked during play.
- A lost WebGL context is rebuilt from the CPU copies of the atlas and palette.

## Not done yet

- More hazards: dust devils, meteors with growing shadows, fissures.
- The rover has no tilt or lean yet, because the renderer's quads don't rotate.
- The ground panels may still be too strong.
- An app icon and splash screen.
