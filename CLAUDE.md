# Dust Runner

@../game-kit/PLAYBOOK.md

## This game

- A landscape, one-thumb endless Mars rover run in a smooth travel-poster style (art-brainstorm/concept.jpg). Steer across the plain, grab samples and cells, and make it through the night.
- **The spec is SPEC.md.** Keep it in sync with every gameplay, visual or renderer change.
- **This game departs from the playbook in two places:**
  - **Rendering is a custom WebGL2 renderer** (`src/gfx/`), not canvas 2D. Every shape is a soft coverage mask drawn in a palette color, and the time of day is a palette blend in the shader. Draw only through `Renderer` (`shape`, `stretch`, `slice`, `rect`, `gradient`, `text`). Never bake atlas regions during play; `art.ts` bakes everything at startup.
  - **It's not pixel art.** It's a smooth poster look at full device resolution, using the Jost font rather than Press Start 2P.
- Logical height is 180 units. The width follows the screen (280–460). The canvas is full screen; the HUD uses `renderer.insetL/R/B` to stay clear of the notch. Colors live in `src/gfx/palette.ts`, one value per keyframe (NOON, SUNSET, DUSK, NIGHT, DAWN).
- **Tunables live in src/config.ts.** `TESTING.lagLog` must be off for release.
- Bundle ID `com.dustrunner.app`. Dev server: `npm run dev` on port 5190 (see .claude/launch.json). `?debug` exposes `game`, `renderer`, `input` and `art`.
- Tried and removed, so don't re-add without asking:
  - a direct NOON → DUSK blend (it went muddy grey)
  - dark HUD text at noon (it disappeared mid-blend)
  - pointed mini mountains as rocks (Dan prefers the lumpy boulders)
  - Get2Mars's music (each game gets its own)
  - pixel-art looks: detailed canyons, dithered fog, pixel-poster edges (Dan picked the smooth poster)
