# `@keel-engine/particles`

Particles for a pixel-art engine at 120 fps: palette entries with a dithered
fade (never an alpha smear), pooled, seeded, budgeted, and drawn in one
instanced draw beside the sprites. Module `keel/particles@0.1.0`
(`kind: "runtime"`, needs `keel/core@^0.1` and `keel/codec@^0.1`; it takes
bake's `PixelView` as a type only, so it doesn't need `keel/bake` loaded).

Two pools live here:

- **`createParticlePool`**: the engine's pool, below. Budgets and
  priorities, LOD, emitters as data (recipes), sub-emitters, sockets, the
  preset library, and the GPU renderer for the sprite path.
- **`createParticles`**: the proof of concept's pool, ported and kept
  bit-for-bit (see [The ported pool](#the-ported-pool)). It's small and
  plain, and it's what the raymarch renderer's hero shots use.

## The pool

```ts
import { PRESETS, createParticlePool, createParticleRenderer, particlePalette } from "@keel-engine/particles";

const pool = createParticlePool({ capacity: 100_000, emitters: 8192, recipes: PRESETS, seed: world.rng("particles"), host });
pool.emit("explosion", x, 0, z);                                   // a world point
pool.emit("footstep-dust", 0, 0, 0, { unit: id });                 // follows a unit (the host locates it each step)
pool.emit("muzzle-flash", 0, 0, 0, { unit: id, socket: "hand.R" }); // on a socket: the cone is the socket's +z
pool.wind.set([2, 0, 0.5]);

// the fixed step:
pool.setView(view); pool.step(1 / 120);                            // the view culls and LODs
// the frame:
sprites.draw(view, instances);                                      // @keel-engine/bake's sprite renderer
parts.draw(view, pool, { ahead });                                  // same view, same depth buffer; ahead = time since the step
```

### How it works

**A particle is thrown once, then left alone.** Its motion (drag toward
the air it's carried by, gravity, a curl turning its heading) is a linear
equation with a closed form (`motionAt`). So a particle is just its birth
state: where it started, how fast, the drift velocity it tends to, and when.
Anything can work out where it is at any moment:

- **The GPU draws it at the frame's own time.** The vertex shader evaluates
  `MOTION_GLSL`, so particles move smoothly at any frame rate, between fixed
  steps.
- **The CPU visits a particle only at its events.** An event is its death,
  the ground (a bounce starts a new birth state, a stick freezes it, a
  raindrop dies there) or a live sub-emit at its rate. The ground is found
  at birth, analytically (a root of the closed form).

A step therefore costs the births, the events, the emitters, and a scan of
one `Float64Array` for events that are due (about 2.5 ns a slot). It doesn't
cost an integrator pass over every live particle. The GPU gets only the
slots that changed: births and bounces are written into four float state
textures by a scatter pass (one point each).

**Pooling.** Everything is a structure of arrays sized at creation. Slots are
stable: a particle keeps its slot for life, and a new one takes the lowest
free slot (a min-heap). Emitters are pooled the same way (a free stack, and
handles carry a generation). A sub-emit spawns straight into the pool, with
no emitter. `stats.growths` counts every typed array the pool makes, and
doesn't move after `createParticlePool` returns. Across 2,000 busy steps the
per-particle functions allocate nothing at all (`test/pool.test.ts` checks
this with V8's allocation sampler). The one exception is V8's own: an
emitter's step or `emit()`, while still cold enough to run in V8's
interpreter, boxes a few doubles. That's bounded and tested too (under
64 B a step). The code keeps doubles off function boundaries for exactly
this reason (see the comment at the top of `pool.ts`).

**Budgets and priorities.** A recipe has a priority: 0 ambient (weather,
marching dust), 1 common, 2 important (fire, explosions, muzzle flashes),
3 critical. Past `reserve[i]` of the capacity, importance *i* stops spawning
(defaults: 55%, 80%, 95%, 100%), so the headroom is kept for what matters.
Nothing is evicted and nothing is allocated. An emitter far from the view's
centre (beyond 60% of the way to a corner) counts one importance lower. An
emitter off the picture (the view's ground rectangle, padded by the recipe's
`reach`) spawns nothing, and a burst off the picture throws nothing. A recipe
can also cap its own live count with `budget`. Every refusal is counted in
`stats` (`culled`, `lod`, `budget`, `emitterBudget`, `noEmitter`).

**LOD: fewer and bigger.** When a recipe's particles would be under
`minPixels` (1.5) on screen, or the pool is filling toward that importance's
reserve, the emitter throws 1/m² of them, m times bigger (m ≤ `maxLod`,
4). That covers the same area (tested), and at 480×270 the battle's dust and
smoke read as chunkier, fewer puffs rather than noise. The thinning is a
deterministic accumulator, not a coin toss.

**Deterministic.** Every draw is a counter hash of (the pool's seed, the
emitter's serial, its spawn index, the draw number). The seed is a number,
or it's drawn from core's `Stream`. The same seed, emits and views give the
same particles. An emitter's k-th particle is the same whatever else was
dropped or spawned (tested). Particles are for the eye: the view culls and
LODs them, so no game state may read them.

**Save / load.** `save()` returns the live slots and the emitters as
typed-array copies. `load()` also takes plain number arrays (JSON turns
`Infinity` into `null`, which it reads back). A loaded pool plays on
identically, in the same slots (tested over 200 steps).

**As bytes.** `saveBytes()` / `loadBytes(bytes)` store the same snapshot
through the codec (`@keel-engine/codec`'s `PARTICLE_POOL`,
`keel/particles/pool`): every element exact, `Infinity` kept (JSON makes it
`null`), the mostly empty emitter slots run-length coded. `poolRecordOf(snap)`
and `poolSnapshotOf(bytes)` are the two halves, for a caller that encodes the
record inside its own document. Bytes of any other document (or cut short)
are a `TypeError` saying why (another document's names its schema). A mid-run pool of 544
particles and 256 emitter slots: 160 KB of JSON (47 KB gzipped), 65 KB of
codec bytes (45 KB gzipped). Loaded into a fresh pool it plays on
identically (`test/codec.test.ts`).

### Emitters as data: recipes

```ts
import { defineParticleRecipe } from "@keel-engine/particles";

export default defineParticleRecipe({
  mode: "continuous", rate: 40, shape: "disc", radius: 0.35, speed: [0, 0.3], up: [1, 2], priority: 2, budget: 80, reach: 4,
  particle: {
    life: [0.4, 0.8], size: [0.25, 0.45], sizeCurve: [1, 0.8, 0.3],        // metres; curves over the life
    light: [0.75, 1], lightCurve: [1.1, 0.85, 0.55], alpha: [1, 1, 0.6],   // lightness along the ramp; alpha = dither density
    ramp: "fire", sprite: "flame", drag: 1.5, gravity: -2, wind: 0.4,
    sub: [{ on: "death", chance: 0.12, emit: { /* an inline recipe, or a name */ } }],
  },
  also: ["embers"],                                                          // started with it, at the same anchor
});
```

| field | what |
| --- | --- |
| `mode` | `burst` (`count`, after `delay`), `continuous` (`rate`/s, or an area's `density`/m²/s, for `duration`), `trail` (`perMetre` moved). A stream's particles are born spread over the step, along the path the anchor moved |
| `shape` | `point` (random heading), `sphere`, `disc`, `ring` (outward; a negative speed draws in), `cone` (`dir`, `angle`: turned by the anchor's frame), `area` (half-extents, or `"view"`: weather over whatever the picture shows, rate following the area) |
| `speed`, `up`, `velocity`, `inherit`, `offset` | speed along the shape; extra upward; a base velocity (rain falling); how much of the anchor's own velocity they keep; where in the anchor's frame they come from |
| `priority`, `budget`, `reach` | see above |
| `also` | companion recipes (an explosion is flash, then debris, smoke and sparks, each on its own budget) |
| `particle.life/size/light` | spans, drawn per particle; `size` in metres (the view's pixels per metre turns it into pixels, at least one) |
| `sizeCurve/lightCurve/alpha` | up to 32 keys over the life, linear between. Alpha is dither density: 1 solid, 0 gone |
| `ramp`, `sprite`, `shade`, `soft`, `streak`, `depthBias` | the palette ramp by name; `dot` (round from 3 px) / `puff` (always round, a soft rim) / `spark` / `flame` / `drop` / `leaf` (8×8 baked masks, drawn from 4 px at a whole-number scale); ball shading; a soft rim, 0..1 of the radius over which a round particle's dither thins to nothing (default 0; 0.5 for `puff`); draw stretched along the velocity (seconds of travel); metres toward the camera (a flash over its own gun) |
| `gravity`, `drag`, `wind`, `curl` | m/s² down (negative floats); drag toward the air, per second; how much of `pool.wind` the air carries (read when it's thrown or bounces); a turn of its heading, rad/s (a swirl) |
| `ground` | `none` / `bounce` (`bounce`, `friction`; too slow and it lies there) / `stick` (freezes where it lands) / `die` |
| `sub` | up to two sub-emits, one per trigger: `death`, `ground` (first touch), `live` (`rate`/s); `count`, `chance`, `inherit` |

Inline sub-recipes and companions become recipes of their own, named
`explosion#also0`, `spark-shower#sub0` and so on.

### The preset library (`src/presets/`, one file each)

`dust-puff`, `footstep-dust` (a trail on a unit), `spark-shower` (sparks
dying into smoke), `muzzle-flash` (on a gun socket, with its smoke),
`explosion` (flash, then debris that bounces, trails smoke and kicks up
`dust-puff` where it lands, a smoke ball, and sparks), `smoke-column`,
`fire` (flames, some dying into smoke, plus `embers`), `embers`,
`magic-swirl`, `blood-splat` (sticks), `ichor-splat` (sticks, with acid
wisps; for the alien RTS), `rain` and `snow` (over the view), and
`water-splash`. Each one is palette-driven, naming the ramps in
`PARTICLE_RAMPS`: fire, flash, spark, ember, smoke, dust, blood, ichor,
water, snow, magic, leaf, and (for the RTS set below) energy (cyan-blue),
acid (yellow-green), crystal (glassy lilac to ice), metal (cool greys) and
spore (organic pink to cream). `particlePalette()` builds those ramps in
OKLCH with the pixel artist's hue shift. A game with its own palette maps
the same names onto its own ramps.

A note on `also`: companions are emitters of their own, and `pool.stop(handle)`
stops only the one the handle names. A continuous companion with no
`duration` keeps running after its parent stops (the `fire` preset's
`embers` does this). So every RTS preset meant to be stopped (the
construction and damage streams) is a single emitter, and its secondary
look comes from sub-emits (`live` or `death`). Their companions are all
bursts, or streams with a short `duration`.

#### The RTS set (impacts, tracers, construction, damage, deaths)

Sizes suit the classic-RTS view (metres; a tile is 2 m; 8–48 px/m). "P" is
the priority, "budget" the recipe's own live cap (per emitter; — means none
beyond the pool's). Pass `scale` to size one to the thing it's on.

| preset | what | mode | P | budget |
| --- | --- | --- | ---: | ---: |
| `impact-kinetic` | bullets, slugs, claws: 3–6 quick streaked sparks and a speck of dust | burst | 2 | — |
| `impact-piercing` | spines, AP rounds: one or two long glancing streaks (pass `dir`) and a small puff | burst | 2 | — |
| `impact-blast` | grenades, rockets: a small fireball, bouncing dark chips, a smoke puff a beat after | burst | 2 | — |
| `impact-energy` | lasers, plasma: a bright core flash, a ring snapping out and stopping, curling specks | burst | 2 | — |
| `impact-acid` | spit, bile: a yellow-green splash that sticks (some hissing up in wisps), and a 0.8 s sizzle of vapour | burst (+0.8 s stream) | 2 | 10 (sizzle) |
| `impact-siege` | artillery, slams: a white-hot core over a fireball, heavy debris kicking dust where it lands, a dark smoke ball | burst | 2 | — |
| `impact-flesh` | added on top of the class's impact when the target is organic: droplets of ichor that stick, and a mist puff | burst | 1 | — |
| `tracer` / `tracer-kinetic` | a short pale-yellow streak for a shot in flight; either way (below) | stream, 0.1 s | 2 | 12 |
| `tracer-piercing` | a thin, long white-blue needle | stream, 0.1 s | 2 | 12 |
| `tracer-energy` | a bright cyan bolt shedding violet glow specks (live sub-emit) | stream, 0.1 s | 2 | 12 |
| `tracer-acid` | a fat green-yellow glob, drops falling off it along the way (death sub-emit) | stream, 0.1 s | 2 | 10 |
| `tracer-blast` | an orange ball with a short, thin trail of smoke puffs | stream, 0.1 s | 2 | 10 |
| `tracer-siege` | a big dark shell with a bright core riding on it and a trail of dark smoke | stream, 0.1 s | 2 | 12 |
| `build-sparks` | machine construction: small arc-flashes, each spitting a shower of bouncing sparks (live sub-emit) | stream | 1 | 3 flashes |
| `build-motes` | organic construction: spores drifting up and curling, some ripening into falling drips | stream | 1 | 20 |
| `build-glow` | energy/crystal construction: motes drawn in from a ring, spiralling (curl) toward the heart | stream | 1 | 24 |
| `warp-ring` | a warp-in starting: a hanging ring drawing in, a column of specks, a flash as it closes | burst | 2 | — |
| `finish-flash` | a building completes: a white-hot core flash, a bright pale ring bursting out and stopping, a ring of pale glints lifting, a whisper of dust | burst | 2 | — |
| `smoke-light` | light damage: a pale thread of soft round puffs, 5/s, gone in ~2 s | stream | 1 | 12 |
| `smoke-heavy` | heavy damage: a dense dark column rising well above the roof (thrown up fast, then a steady climb) | stream | 1 | 38 |
| `fire-damage` | a building on fire: lean flames, some dying into smoke, embers lifting off (sub-emits) | stream | 2 | 30 |
| `damage-sparks` | a damaged machine shorting out: a bright pop, 2.2/s, each spitting a shower of sparks (live sub-emit) | stream | 1 | 2 pops |
| `debris-bits` | now and then a hot chip of plating falls, spitting sparks, and bounces (1.2/s) | stream | 1 | 6 |
| `rubble-dust` | a building's aftermath: a low roll of soft dust, rubble that lands and lies, a thin column of smoke for 5 s | burst (+5 s stream) | 1 | 8 (smoke) |
| `metal-sparks` | a machine unit hurting: a spit of sparks and a pop of light | burst | 1 | — |
| `bleed-drip` | an organic unit hurting: a few drops of ichor that fall and stick | burst | 1 | — |
| `crystal-chips` | a crystal thing cracking: glassy chips that glint and skitter, and a glint | burst | 1 | — |
| `smoke-trail` | a badly damaged unit: a thin trail of small soft puffs laid per metre moved, gone within a second | trail | 1 | 12 |
| `death-collapse` | a machine or stone body: a bright pop, a burst of sparks, bouncing plates, a short slump of dust and dark smoke | burst | 2 | — |
| `death-burst` | an organic body: a punchy pop of ichor mist, a spray of gibs that stick, and `ichor-splat` under it | burst | 2 | — |
| `death-dissolve` | an energy or crystal body: a flash, a few glassy shards, motes rising and fading | burst | 2 | — |

Every `tracer-*` takes either drive (each is one emitter; its second element
comes from sub-emits, so `pool.stop(h)` stops all of it):

```ts
pool.emit("tracer", x, y, z, { velocity: [vx, vy, vz] });                // each tick at the shot: streams its next stretch
const h = pool.emit("tracer", x, y, z, { unit: shotId, duration: Infinity }); // or a trail on it (or pool.move(h, ...) each tick)
pool.stop(h);                                                            // on impact
```

Each tick, its 0.1 s stream is born over that tenth at the spot and flies
on at the shot's speed, so it draws the next stretch of the path (0.1 s is
also the longest frame step a game's pool should take, so one step can't
skip it). On an anchor it keeps 0.6 of the anchor's speed and lags into a
tail.

### Damage states (`createDamageStates`)

A presentation-only overlay over a pool: the smoke, fire, sparks and drips
that say how hurt a building or a unit is, and its death. It never reads or
writes game state. The game tells it each tick what each thing is, and it
only emits.

```ts
import { createDamageStates } from "@keel-engine/particles";

const damage = createDamageStates(pool);            // the pool needs PRESETS (it checks, and names what's missing)
const s = { x: 0, y: 0, z: 0, hp01: 1, material: "metal", kind: "building", size: 6 }; // reuse one object
// each game tick, for every building and unit:
s.x = ...; s.hp01 = hp / maxHp; damage.set(id, s);
damage.set(unitId, { ...unit, kind: "unit", size: radius, unit: unitId }); // `unit`: continuous effects ride host.locate
damage.remove(id, "destroyed");                     // the explosion or the death; "gone" just stops its emitters
```

**Stages** (`DAMAGE_STAGES`): 0 clean at `light` (0.66) and above; 1 light
damage below it; 2 heavy below `heavy` (0.33). A stage worsens the moment
hp crosses its threshold. It improves (repair) only once hp is `band`
(0.04) back past the threshold *and* the stage has held for `settle`
(0.5 s of pool time). So a value on a boundary doesn't flicker, and hp
flapping about changes an entity's emitters at most once per `settle`. A
stage change stops the entity's emitters and starts the new stage's (a
repaired building's fire goes out, light smoke takes over).

| | stage 1 (below 0.66) | stage 2 (below 0.33) | `remove(id, "destroyed")` |
| --- | --- | --- | --- |
| building | `smoke-light` from 2–3 roof points (3 from 3 m); metal and stone also `damage-sparks` from 1–2 (2 from 4 m) and `debris-bits`; organic and crystal a material burst instead | `fire-damage` from 3–5 points (3 under 3 m, 4 under 5 m, else 5) spread over the roof; a `smoke-heavy` column from the middle (two from 4 m); `debris-bits` (metal, stone) | `explosion` (scale size/3, 0.8–2.5) + `rubble-dust` (size/4, 0.7–2); organic and crystal also come apart (`death-burst` / `death-dissolve`) |
| unit | a burst every 1.5–3 s (seeded by id): `metal-sparks`, `bleed-drip`, `crystal-chips`, or a small `dust-puff` for stone | bursts twice as often; metal and stone units also trail `smoke-trail` (on `unit`, or moved to x, y, z) | `death-collapse` (metal, stone), `death-burst` (organic), `death-dissolve` (crystal), scaled by radius |

Roof points sit `roof` × size (0.5) above the anchor: point 0 near the
middle, the rest round it a golden angle apart at 0.2–0.34 × size (so five
fires spread over the roof, never in a clump), turned by a hash of the id.
A building's effects are scaled size/3.5, at least 0.8 (so a 2 m one still
reads at 12 px/m) and at most 2. A unit's are scaled radius/0.5 (0.5–2.5),
its smoke trail at most 1.2. A unit's bursts come from `body` × radius (1)
above it. Organic and crystal units don't smoke: they drip and chip. The
first burst is staggered by the id, so a volley's victims don't spark in
step. Every recipe is overridable (`effects: { drip: "blood-splat" }`, say,
for red blood).

**Cost.** The entity table is fixed typed arrays (`capacity`, 2048; past it
a `set` is dropped and counted). Recipe ids are resolved once and one emit
options object is reused. A `set` that changes nothing costs a map lookup
and a few compares. There are at most `MAX_DAMAGE_EMITTERS` (8) continuous
emitters per entity; bursts are one-shot. Tested with 400 entities flapping
hp across both thresholds for 2,000 ticks: the emitters held stay under
8 each, the pool's emitter count doesn't grow, and in the steady state
`damage.ts` allocates nothing (V8's sampler). Two runs give identical
`pool.save()`. The pool culls what it throws like anything else: a damaged
building off the picture spawns nothing. A refused emit (the pool out of
emitter slots) is retried every half second.

| Export | What |
| --- | --- |
| `createDamageStates(pool, { capacity = 2048, seed = 1, stages, effects, roof = 0.5, body = 1 })` | returns `DamageStates` |
| `states.set(id: number, s: DamageState): void` | `s = { x, y, z, hp01, material: "metal" \| "organic" \| "crystal" \| "stone", kind: "building" \| "unit", size, unit? }` |
| `states.remove(id: number, how: "destroyed" \| "gone"): void` | its emitters stopped; "destroyed" plays its death first |
| `states.stageOf(id: number): number` | 0, 1, 2; -1 if it isn't tracked |
| `states.stats` | `{ entities, clean, light, heavy, emitters, bursts, deaths, dropped, missed }` |
| `states.clear(): void` | stop everything, forget every entity |
| `DAMAGE_STAGES`, `DAMAGE_EFFECTS`, `MAX_DAMAGE_EMITTERS` | `{ light: 0.66, heavy: 0.33, band: 0.04, settle: 0.5 }`; the role -> recipe table; 8 |

**For an RTS (MYRIAD's numbers).** `createParticlePool({ capacity: 32768,
emitters: 4096, maxLod: 2, recipes: PRESETS, host })`. `maxLod: 2` keeps
"fewer, bigger" from growing puffs past twice their size; the emitter count
covers a base on fire (a burning 6 m building holds 8, plus draining
ones). Step the pool at no more than 0.1 s. `?damage` on the bench renders
the damage states, damaged units and all six tracers at 16 px/m
(`out/particles/damage-{1,3,5}s.png`).

### Drawing (`createParticleRenderer`, the sprite path)

The renderer draws one instanced quad per slot below `pool.highWater`
(dead slots are culled in the vertex shader). It uses the same pixel view
as bake's sprite renderer, into the same framebuffer after it.

- **Pixel-snapped.** A particle is a speck, a pixel-art disc (3 px is a
  plus shape, 4 px a rounded square), a baked sprite at a whole-number
  scale, or a streak along its screen velocity.
- **Puffs are round at every size.** A `puff` is drawn as a pixel-art disc
  at its own pixel size, never its 8×8 mask scaled up (which, past 8 px,
  turned smoke into blocks of square texels), shaded as a ball, with a
  soft rim: its dither density falls toward the edge over `soft` of the
  radius. So LOD's "fewer, bigger" grows a puff into a bigger soft puff, not
  a square. Any round particle (a `dot` from 3 px) can take `soft` too. A
  game that still wants smaller growth caps it with
  `createParticlePool({ maxLod })` (default 4; the RTS should use 2).
- **Depth from its ground point.** It uses the same range as a sprite's
  depth from its anchor, so dust behind a unit is hidden by it and dust in
  front covers it, with no sorting.
- **Colour.** The lightness walks the style's ramp, with a screen-anchored
  4×4 Bayer dither between two entries. Fade is dither density against the
  same screen. Every pixel is a palette entry.
- **Life curves.** The style texture holds 32 samples a curve plus
  constants, and they're read per vertex.
- **What the GPU is sent.** It gets `takeChanges()` each frame (births and
  bounces, as points into four RGBA32F state textures), so it never
  receives the whole pool. If a load, a clear or a time rebase (every
  ~17 minutes, for float32 precision) happens, it gets everything once.
  Without `EXT_color_buffer_float`, it falls back to re-uploading the
  changed texture rows (`renderer.path === "rows"`). That's slower, but it
  works.

For the raymarch renderer, `pool.list()` gives `RenderParticle`s. It
allocates, so it's meant for hero shots and previews.

### Measured (tools/bench.html, 2026-09-13, this Mac, Chrome in the app's Browser pane)

The Mac was heavily loaded while these ran (load average 15–40 from other
work). Each row is the better of two clean runs; a third run under a load
spike measured up to 2.5× slower. The page's clock is coarse (0.1 ms), so
each phase is summed over 120 frames and divided. "GPU finished" means a
1-pixel `readPixels` after each phase. Chrome's flush and round trip for
that sync costs ~0.6–0.9 ms even for a trivial draw (it's most of the
"sprites" column), and the particles column pays it too.

The battle: 3,000 units marching in formations, each with a dust trail; a
thirtieth of them firing every 0.1 s (muzzle flashes on `hand.R`); 40 fires
and smoke columns, magic swirls, spark showers; an explosion every 0.25 s;
splats, splashes and rain; wind. The framing is the same at every size
(72 m across), so LOD does the rest:

| picture | live | sim | sprites (761) | particles | slots written / frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| 480×270 | 4,500 | 0.35 ms | 0.87 ms | 0.87 ms | 63 (4 KB) |
| 960×540 | 6,270 | 0.34 ms | 0.62 ms | 0.62 ms | 84 (6 KB) |
| 1920×1080 | 10,400 | 0.39 ms | 0.71 ms | 0.97 ms | 132 (9 KB) |

The stress: LOD and pressure off, reserves at 100%, and 1,250 (50k) or
2,500 (100k) fires, smoke columns, spark showers, swirls and embers, plus
an explosion every 10 steps. "Map" is the whole 256 m map in a 400 m view
(1–5 px particles); "close" is all of them inside a 72 m view (puffs up to
~50 px: the fill-heavy case):

| scene | picture | live | sim | sprites | particles | slots written / frame |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| map | 480×270 | 99,400 | 0.89 ms | 1.01 ms | 1.75 ms | 896 (59 KB) |
| map | 960×540 | 99,400 | 0.90 ms | 0.88 ms | 1.34 ms | 896 (59 KB) |
| map | 1920×1080 | 99,700 | 0.93 ms | 0.87 ms | 1.24 ms | 896 (59 KB) |
| close | 480×270 | 99,400 | 0.90 ms | 0.78 ms | 1.25 ms | 896 (59 KB) |
| close | 960×540 | 99,400 | 0.98 ms | 0.74 ms | 1.11 ms | 896 (59 KB) |
| close | 1920×1080 | 99,700 | 0.88 ms | 0.72 ms | 1.58 ms | 896 (59 KB) |
| map | 1920×1080 | 51,000 | 0.41 ms | 1.04 ms | 1.14 ms | 472 (31 KB) |
| close | 1920×1080 | 51,000 | 0.40 ms | 0.59 ms | 1.47 ms | 472 (31 KB) |

At 1920×1080, 50k live costs 0.4 ms of simulation plus ~0.5–0.9 ms of
particle GPU work (the particles column minus the sync overhead the
trivial sprite draw shows). That's about 1–1.3 ms, well inside the ~2 ms
budget. 100k costs 0.9 ms plus ~0.4–0.9 ms: about 1.3–1.8 ms, at the edge
of the budget. In a real frame, pressure LOD thins the ambient and common
recipes long before the pool is full.

### CPU or GPU integrator: decided by measurement

The first version integrated every particle on the CPU each fixed step
(drag, gravity, wind, curl, the ground), with live particles packed at the
front and all of them uploaded every frame. Measured on the same scenes:

| design | 100k sim (Node, best of 20) | 100k sim (Chrome) | upload / frame | 100k particles draw, 1080p close |
| --- | ---: | ---: | ---: | ---: |
| CPU integrator (swap-remove, full upload) | 1.73 ms | 1.9–2.0 ms | 2.7 MB | 2.9 ms |
| closed form on the GPU (event-driven CPU, scatter) | 0.87 ms | 0.8–0.9 ms | 59 KB | 1.6 ms |

At 50k live in Node the step is 1.07 ms against 0.60 ms, and at 30k it's
0.80 ms against 0.56 ms.

At 100k the CPU integrator alone used the whole ~2 ms particle budget before
drawing. So the integrator moved to the GPU. It isn't transform feedback,
which would have needed readbacks for sub-emitters, ground events and exact
save/load. It's the closed form above, evaluated in the vertex shader. The
CPU keeps every particle's state, so determinism, save/load, sub-emitters
and budgets are unchanged, and it only does per-event work.

What's left on the CPU at 100k is the event scan (~0.25 ms) plus the
emitters: ~0.5 ms for 5,000 emitters, 3,000 of them following marching
units.

**What the closed form costs:** a particle feels the wind it was thrown into
(or last bounced in). A gust changes new particles, not ones already in the
air. Motion is exact, rather than the old explicit step.

Re-run: `node packages/particles/tools/build.mjs`, then open
`packages/particles/tools/bench.html` on the dev server (`?sheet` for the
preset sheet, `?damage` for the RTS damage scene). It saves `out/particles/*.png`: the battle at each size,
both stresses, the sheet at 30 / 150 / 500 / 1200 ms (twelve presets a
page: `sheet-*` is the first page, `sheet-p2-*` onward the RTS set), and
rain and snow.

### API

| Export | What |
| --- | --- |
| `createParticlePool(options)` | `{ capacity = 65536, emitters = 4096, seed, recipes, host, reserve, minPixels = 1.5, maxLod = 4, pressure = true }` returns a `ParticlePool` |
| `pool.emit(recipe, x, y, z, { unit, socket, yaw, dir, velocity, priority, scale, count, duration })` | returns a handle (-1 when no emitter slot is free); `move`, `stop`, `alive` take it |
| `pool.step(dt)` / `setView(view)` / `setViewRect(...)` / `wind` | the fixed step; cull and LOD by a view; the wind |
| `pool.count`, `highWater`, `emitters`, `time`, `stats` | live particles, the slots to draw, live emitters, the seconds simulated, the counters |
| `pool.slots`, `styles`, `takeChanges(out)` | the birth states and the style table (the renderer's source); the slots changed since the last call (-1 means all) |
| `pool.isLive(slot)`, `liveSlots(out)`, `sample(slot, out, o?, at?)` | read particles: their position and velocity at any time |
| `pool.save()` / `load(snap)` / `clear()` / `list()` / `define(name, recipe)` / `recipeId(name)` | as above |
| `pool.saveBytes()` / `loadBytes(bytes)`, `poolRecordOf(snap)` / `poolSnapshotOf(bytes)` | the snapshot as codec bytes (`PARTICLE_POOL`) and back; the record either side of the bytes |
| `ParticleHost.locate(unit, socket, out)` | the game fills a position and a row-major 3×3 frame (`frameFromYaw` for a unit that only turns), and returns false when the unit is gone. The emitter stops; its particles live on |
| `frameToWorld(frame, lx, ly, lz, out)` / `motionAt(...)` / `mix32` | socket math; the closed form; the hash |
| `createParticleRenderer(gl, { capacity })` | `setPalette(colours, ramps)`, `draw(view, pool, { ahead })`, `missingRamps`, `written`, `uploaded`, `path`, `dispose()` |
| `defineParticleRecipe` / `recipeProblems` / `sampleCurve` | check a recipe (throws) / list what's wrong / sample a curve |
| `PRESETS`, `PARTICLE_RAMPS`, `particlePalette()`, `particleSpriteAtlas()` | the library, the ramps it names and their palette, the 8×8 sprites |
| `createDamageStates(pool, options)`, `DAMAGE_STAGES`, `DAMAGE_EFFECTS`, `MAX_DAMAGE_EMITTERS` | damage states over a pool (see [Damage states](#damage-states-createdamagestates)) |
| `PARTICLE_VS`, `PARTICLE_FS`, `MOTION_GLSL`, `CURVE_SAMPLES`, `STYLE_WIDTH`, `STATE_WIDTH`, `MAX_STYLES`, `NO_EMITTER`, `NEVER` | the shaders and layouts |

Limits: 256 recipes, inline ones included (a particle names its style in one
byte). Up to 65,535 emitters.

## The ported pool

```ts
import { createParticles } from "@keel-engine/particles";

const ps = createParticles(600, { stream: () => world.rng("particles") });
ps.emit("dust", at, { count: 6, vel });          // or { S } to draw from a given stream
ps.step(dt);
renderer.render({ ...view, particles: ps.list() });
const snap = ps.save();                          // plain data: survives JSON
ps.load(snap);
ps.loadBytes(ps.saveBytes());                    // or as codec bytes (keel/particles/save)
```

Emitters are small **recipes**:

- `dust`: soft puffs, out and up, slowing, fading.
- `spark`: fast, falling.
- `splash`: water thrown up by a foot.
- `mote`: specks hanging and drifting.

Every emit draws from a seeded stream, so a scene that plays itself plays
the same each time. A particle names its recipe (`kind`), so the pool is
plain data: `save()` copies it, `load()` puts it back (the world runtime's
snapshots need exactly this).

It's a TypeScript port of the proof of concept's
`src/particles/particles.js`, merged with `src/world/particles.js` (its
snapshot-able twin). `test/poc-equality.test.ts` proves them identical:

- Against `particles.js`: the count and `list()` every frame, over 150
  scripted runs (every kind and option, varying dt, a full pool).
- Against `world/particles.js`: `list(sizeScale)` every frame, over 100
  runs, plus `save()` mid-run and at the end, and a reload replayed.

| Export | Signature | Returns |
| --- | --- | --- |
| `createParticles` | `(max = 600, { recipes = baseRecipes(), stream } = {})` | `Particles` |
| `RECIPES` / `baseRecipes` | | the engine's four recipes (frozen) / a fresh copy to add to |

| `Particles` | |
| --- | --- |
| `emit(kind, at, { count = 4, S = stream(), vel = [0,0,0], spread = 1, ramp })` | draws per particle: heading, speed, up, life, size, light (in that order); never past `max`; an unknown kind is a `RangeError` |
| `step(dt)` | ages, kills, drags (`exp(-drag·dt)`), falls (`gravity`), moves |
| `list(sizeScale = 1)` | `[{ p, size, ramp, light }]`, light fading by `fade` over the life |
| `save()` / `load(list)` / `clear()` | plain `ParticleState[]` copies (`{ kind, p, v, age, life, size, light, ramp }`) / back in (every kind checked) / empty |
| `saveBytes()` / `loadBytes(bytes)` | the same through the codec's `PARTICLES` (`keel/particles/save`), exact: 11 particles are 865 bytes (JSON: 2.8 KB); other bytes are a `TypeError` |
| `recipes` / `max` / `count` | the table (add to it) / the pool's size / live particles |

Differences from `particles.js`: recipes are per pool (a copy, so adding one
doesn't change the engine's table); a particle keeps its recipe by name
rather than holding the object; and an unknown kind throws a `RangeError`
instead of a `TypeError` from inside the loop. `world/particles.js` already
did all three.
