# `@keel-engine/core`

The foundation: seeded streams, the frame convention, math, SDF primitives,
OKLCH palettes, looks (what each role of a thing wears), dither screens, the
quantizer, and (optional) the GIF encoder.
No dependencies. Module `keel/core@0.1.0` (`kind: "runtime"`, needs nothing).

```ts
import { createRoll, stream, makePalette, buildPalette } from "@keel-engine/core";
import type { Stream, Palette, LayerScreen } from "@keel-engine/core";
```

A TypeScript port of the proof of concept's `src/core` (`../keel-pixel-engine`),
names unchanged. Most of it is a copy of a NOCTURNES module
(`../keel-nocturnes/src/`); the frame, the **Resolution** helpers and the
wide GIF tables are the engine's own. Both are proven identical, bit for bit:

- `test/poc-equality.test.ts` — every export against the proof of concept's JS
  (streams, rolls, the frame, noise, SDFs, 480 harmonies and builds, every
  threshold cell, screens for targets, quantized buffers, GIF bytes at 1..255 colours);
- `test/nocturnes-equality.test.ts` — the copied exports against NOCTURNES
  itself, including its quantize step on REAL NOCTURNES shade buffers and the
  GIF bytes of real rendered loops.

A reference that isn't on the machine skips its test (`KEEL_POC=path`,
`NOCTURNES=path` point elsewhere). Do not "improve" a copied function: change
it with NOCTURNES and the proof of concept, or not at all.

| Module | From | What |
| --- | --- | --- |
| `rng.ts` | NOCTURNES `rng.js` + `genome.js` (`stream`, `deriveSeed`) | seeds, fixed-slot rolls, float streams |
| `frame.ts` | engine | +z front, +x right, +y up; yaws, local/world, camera basis |
| `math.ts` | NOCTURNES `math.js` | scalars, hashes, loop-safe noise, vec3 |
| `sdf.ts` | NOCTURNES `sdf.js` | signed distance primitives |
| `palette.ts` | NOCTURNES `palette.js` + `genome.js` (harmonies) | OKLCH, palettes, harmony schemes; **engine:** `rampForTarget` |
| `dither.ts` | NOCTURNES `dither.js` + `genome.js` (`screenPair`) | 13 screens (threshold maps), `screenIndex`; **engine:** `screenForTarget` |
| `quantize.ts` | NOCTURNES `render.js` (the quantize step) | shade buffer -> palette indices |
| `gif.ts` | NOCTURNES `gif.js`; **engine:** tables past 32 | GIF89a encoder, delta frames (optional export) |
| `look.ts` | engine | looks: per-role ramps, patterns and finishes through colour profiles; perceptual distance; a pool that keeps a population apart |

## Concepts

**Determinism.** A seed is `bytes32` (`0x` + 64 hex). A generator never calls
`Math.random`: it reads fixed **slots** of the seed (`roll.at(slot)`) or a
private **stream** hanging off one slot (`stream(roll, slot)`). Adding a new
decision means a NEW slot, so existing seeds never reshuffle.

**Palette.** Colours are never chosen: a **harmony** (scheme + base hue) makes
up to four **ramps** (`key`, `accent`, and `outside` or `accent2`), each a run
of tones from dark to light built in OKLCH, laid into a 32-entry table (31 is
kept free: the transparent index when a piece is exported as a GIF).

| Layout | Ramps (base, len) |
| --- | --- |
| one room | key 0..21 (22), accent 22..30 (9) |
| two worlds | outside 0..9 (10), key 10..21 (12), accent 22..30 (9) |
| two inks | key 0..17 (18), accent 18..24 (7), accent2 25..30 (6) |

**Screen.** Light is continuous; it is only ever SHOWN through a screen: a
threshold map `at(x, y) -> 0..1` plus a few tone **steps** on a ramp. A
*layer screen* is `LayerScreen { id, steps, bias }`. Maps depend only on pixel
position, so a still pixel never changes index.

**Resolution.** Assets are resolution-free; the target size decides how they
are shown: `screenForTarget(w, h, pref)` picks a screen that reads at that
size (and fewer tone steps on small targets); `rampForTarget(ramp, shortSide)`
shortens ramps for tiny targets (foot and top kept, even walk between).

## Types

| Type | What |
| --- | --- |
| `Seed` | `"0x" + 64 hex` |
| `Roll` | `seed`, `at(slot)`, `pick`, `index`, `range`, `chance`, `weighted`, `sub(slot): SubStream` |
| `SubStream` | integer stream: `next`, `index`, `pick`, `range`, `chance`, `weighted` |
| `Stream` | float stream: `f`, `between`, `int`, `pick`, `chance`, `weighted` (what every generator draws from) |
| `Weighted<T>` | `[[value, weight], ...]` |
| `Vec3` / `Vec3Like` | `[x, y, z]` / its readonly form (inputs) |
| `CameraBasis` | `{ forward, right, up }` |
| `Profile` | a lathe outline: `{ xs, ys, rmax, ymin, ymax }` |
| `RGB` | `[r, g, b]` bytes |
| `RampSpec` | `{ hues, chroma, lift, top, gamma, shift, coolTop? }` |
| `PaletteRamps` / `PaletteSpec` | `{ key, accent, outside?, accent2? }` / `{ ramps }` (what `buildPalette` reads) |
| `Harmony` | `makePalette`'s spec: `{ scheme, hue, ramps, hues, name, accentName }` |
| `Palette` | `{ colours: RGB[], ramps: PaletteSlots }`; `RampSlot` = `{ base, len }` |
| `Scheme` / `SchemeName` | `[name, weight, (S, hue) => PaletteRamps]` / the nine names |
| `ScreenId` / `ScreenFamily` / `Band` | the 13 screens / ordered, dot, line, noise, pattern / tiny, small, large |
| `ScreenDef` / `ThresholdMap` | `{ name, at }` / `(x, y) => 0..1` |
| `LayerScreen` / `TargetScreen` | `{ id, steps, bias }` / plus `{ family, band }` |
| `ScreenMeasure` / `ScreenGeometry` | what `measureScreen` finds / its period, angle, r, lines |
| `ShadeBuf` / `QuantizeInput` | the full shade buffer / the fields quantize reads (`L`, `accent`, `layer`, `halo`, `cyc`) |
| `QuantizeRamps` / `QuantizerSpec` / `Quantize` / `Region` | the quantizer's ramps, spec, function and `[x0, y0, x1, y1]` |
| `GifSpec` / `GifFrame` | `{ width, height, palette, frames, loop?, once? }` / `{ pixels, delay }` |

## rng.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `normalizeSeed` | `(value: unknown)` | `Seed`; throws `TypeError` on non-hex / too long |
| `seedFromToken` | `(tokenId: number \| bigint \| string, collection = "nocturnes-v0")` | a local gallery seed (FNV-1a) |
| `createRoll` | `(seed)` | `Roll` |
| `stream` | `(roll, slot)` | `Stream` |
| `deriveSeed` | `(seed, label)` | a child seed named by `label` |

```ts
const seed = seedFromToken(7, "wallrun");
const roll = createRoll(seed);
roll.at(0);                                        // 0..65535, same forever
roll.weighted(3, [["cat", 2], ["fox", 1]]);        // "cat" | "fox"
const S = stream(roll, 1);                         // generators draw from S
S.between(0.2, 0.8); S.int(1, 6); S.pick(["a", "b"]);
const hatSeed = deriveSeed(seed, "hat");           // an independent asset seed
```

## frame.ts

`FRONT` `[0,0,1]`, `RIGHT` `[1,0,0]`, `UP` `[0,1,0]`; `frontOf(yaw) = [sin, 0, cos]`,
`rightOf(yaw) = [cos, 0, -sin]`, `yaw = atan2(dx, dz)`.

| Export | Signature | Returns |
| --- | --- | --- |
| `wrapAngle` | `(a)` | a in (-PI, PI] |
| `frontOf` / `rightOf` | `(yaw)` | `Vec3` |
| `yawOf` / `yawTo` | `(dir)` / `(from, to)` | a yaw |
| `localToWorld` / `worldToLocal` | `(pos, yaw, p)` | `Vec3` |
| `cameraBasis` | `(eye, target)` | `CameraBasis` (right = up x forward) |
| `moveFromView` | `(viewYaw, forward, strafe)` | `[x, z]`, length <= 1 |
| `fromNocturnesYaw` / `toNocturnesYaw` | `(y)` | `-y` (NOCTURNES turns the other way) |

## math.ts

`TAU`, `clamp`, `sat`, `mix`, `fract`, `smooth` (smoothstep), `tri` (triangle
wave, peak at 0.5), `hash2(x, y, s = 0)` / `hash3(x, y, z, s = 0)` (in [0,1)),
`vnoise2`, `wrapNoise2(x, y, period, s)`, `fbm2(x, y, s = 0, octaves = 3)`,
`loopFbm2(x, y, dx, dy, t, s, octaves)` (drifts and closes over a loop), and
vec3 helpers `v3 add sub scale dot cross len norm` (allocate: keep out of hot loops).

## sdf.ts

All take scalars (no allocation) and return a signed distance (negative inside):
`sdSphere(x,y,z,r)`, `sdBox(x,y,z,bx,by,bz,round=0)`, `sdTorus(x,y,z,R,r)`,
`sdCylinder(x,y,z,r,h,round=0)`, `sdCapsule(x,y,z,ax,ay,az,bx,by,bz,r)`,
`sdHexPrism(x,y,z,r,h)`, `sdEllipsoid(x,y,z,rx,ry,rz)` (a bound),
`smin(a,b,k)`, `sdPolygon(px,py,xs,ys)`, `profile([[r,y],...]): Profile`,
`sdLathe(x,y,z,prof,round=0)`, `sdPlanes(x,y,z,planes)` (stride 4 `[nx,ny,nz,d]`).

## palette.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `TABLE` / `TRANSPARENT` | | `32` / `31` |
| `oklch` | `(L, C, hueDeg)` | `RGB`, chroma pulled into gamut |
| `cmax` | `(L, hueDeg)` | the most chroma sRGB holds there (cached) |
| `wrap` / `hueName` | `(h)` / `(deg)` | hue in [0,360) / "Cobalt", "Amber", ... |
| `buildPalette` | `(spec: PaletteSpec)` | `Palette` |
| `hueCount` | `(spec)` | distinct 30° hue families present |
| `makePalette` | `(S: Stream, force: PaletteForce = {})` | `Harmony`; `force.scheme` / `force.hue` pin them |
| `SCHEMES` / `SCHEME_NAMES` | | the nine harmonies |
| `baseHue` / `ramp` / `accentRamp` | `(S)` / `(S, hues, extra)` / `(S, hue, extra)` | a hue / a room ramp / an accent ramp |
| `rampBudget` / `rampIndicesForTarget` / `rampForTarget` | `(side)` / `(len, side)` / `(ramp, side)` | see Resolution; `rampForTarget` takes a colour array, a length, or `{ len }` (overloaded) |
| `RAMP_BUDGET` | | `[[24,4],[32,5],[48,6],[64,8],[96,11],[128,14]]` |

```ts
const spec = makePalette(stream(createRoll(seed), 0), { scheme: "Duotone" });
const pal = buildPalette(spec);
const key = pal.colours.slice(pal.ramps.key.base, pal.ramps.key.base + pal.ramps.key.len);
const tiny = rampForTarget(key, 32);                    // 5 colours: darkest, 3 between, brightest
```

## look.ts (engine)

What a thing's ROLES wear when it's drawn -- never geometry. A look gives each
role a ramp (hue, chroma, middle lightness, lightness span in OKLCH), a finish
and a pattern, drawn from a seed through a colour PROFILE. Why here, not a
package of its own: it's palette maths (OKLCH, gamut, ramps) like the rest of
this file's neighbours, and everything that needs it (bake, packs' roles)
already reads core. The bake paints baked shapes with looks at draw time
(`@keel-engine/bake`'s look table and layer renderer).

```ts
const look = lookOf(seed, { primary: { stuff: "knit" }, secondary: { stuff: "knit", like: "primary" }, trim: { stuff: "paint" } });
look.roles.primary   // { hue: 205, chroma: 0.14, light: 0.52, span: 0.44, finish: "cloth", pattern: { kind: "bands", freq: 3, angle: 0, width: 4, shift: 0, ink: "trim" } }
rampColours(look.roles.primary!, 5)   // five sRGB entries, dark to light, the finish showing
lookOf(seed, roles, { profile: "neon", pins: { "primary.hue": 120, "trim.pattern": "none" } })
const pool = createLookPool({ threshold: 0.08 });
pool.draw(unitSeed, roles, {}, "anthro-fox|top=tee")   // at least 0.08 from every look already in that group
```

| Export | What |
| --- | --- |
| `LOOK_ROLES` | the 16 roles: `skin fur furAlt hair cloth clothAlt accent dark blush eye primary secondary trim detail glow metal` |
| `PROFILES` | `analogous complementary triad team earthy neon pastel metallic` (`PROFILE_WEIGHTS`: how often each is drawn) |
| `PATTERNS` / `FINISHES` | `none stripes bands spots checks camo gradient trim` / `matte cloth leather metal glow` |
| `lookOf(seed, roles, { profile, team, pins })` | a `Look`: `{ profile, hue, roles, order, signature }` |
| `lookDistance(a, b)` | OKLab ΔE over the leading three roles (weighted 1, 0.8, 0.5), + `PATTERN_STEP` (0.06) for another pattern on the first |
| `createLookPool({ threshold, tries })` | `draw(seed, roles, options, group)`: the seed's look, or a re-roll, clear of its group; `rerolls`, `failures` |
| `rampColours(roleLook, len)` / `rampKey` | a role's ramp / the key ramps are shared by |
| `roleLab`, `finishIndex`, `patternIndex`, `roleIndex` | a role's middle colour in OKLab; the shader's codes |

- **Roles by stuff.** A role says what it's made of (runtime's `RoleSpec.stuff`: cloth, knit, leather, metal, wood,
  bone, skin, fur, hair, dark, glow, paint...), which picks where its colour comes from (skin tones, natural furs
  most of the time, metals, woods; the profile's harmony for cloth and paint), its finishes and its patterns (both
  overridable per role). The first role in the order leads the harmony; `like` wears another role's colour a shade off.
- **Deterministic, pins local.** Every role draws sixteen numbers from its own stream (FNV-1a over `seed:look/role/<r>`
  into mulberry32 -- core's slot streams hash the whole seed per draw, too dear for tens of thousands of looks),
  so pinning one field of one role moves nothing else.
- **Quantised** (hue 5°, chroma 0.01, lightness 0.02, span 0.02): a look's `signature` is stable and ramps are shared.
- **Distinct.** The pool hashes each look's leading colour into OKLab cells a threshold wide, so a draw compares
  against its neighbours only (10,000 looks in ~1 s).

## dither.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `SCREENS` / `SCREEN_IDS` | | `Record<ScreenId, ScreenDef>` / the 13 ids |
| `screenIndex` | `(light, x, y, screen: LayerScreen, rampLen, lums = null)` | ramp index in [0, rampLen); `lums` mixes two tones in light |
| `measureScreen` / `SCREEN_GEOM` | `(at, T = 24)` | `ScreenMeasure` / every screen's geometry |
| `SCREEN_KIND` / `SCREEN_PAIRS` / `KIND_PAIRS` / `screenPair` | `(a, b)` | 0 (never together) .. 4 |
| `bandOf` | `(width, height = width)` | `Band` |
| `screenForTarget` | `(width, height = width, preference = "ordered")` | `TargetScreen` (a family or an id; anything else is a `RangeError`) |
| `TARGET_BANDS` / `TARGET_SCREENS` / `TARGET_STEPS` / `SCREEN_MIN_BAND` | | the tables below |

| band | short side | ordered | dot | line | noise | pattern | steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tiny | <= 48 | bayer2 | bayer2 | bayer2 | ign | checker | 3 |
| small | <= 128 | bayer4 | halftone | lines | stipple | bayer4 | 5 |
| large | > 128 | bayer8 | halftone | hatch | stipple | weave | 7 |

## quantize.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `makeBuf` | `(width, height)` | `ShadeBuf` |
| `createQuantizer` | `(spec: QuantizerSpec)` | `quantize(buf, region = null, out = new Uint8Array(w*h), t = 0) -> out` |
| `quantizerFor` | `(paletteSpec, screens, width, height)` | `{ pal, quantize }` |
| `rampsOf` / `lumsOf` | `(pal)` / `(colours)` | `QuantizeRamps` (missing ones fall back) / OKLab L per entry |
| `accentCode` | `({ accent, share })` | the ink code for `buf.accent` |
| `BAYER4Q` / `HALO_SCREEN` / `LAYER_KEYS` | | partial-ink thresholds / `{ id: "bayer4", steps: 3, bias: 0 }` / NOCTURNES' layer order |

Buffer fields read: `L` (light, may exceed 1), `accent` (0 none, 1/2 an accent
ramp; bits 2..5 a partial share), `layer` (index into `screens`; layer 0 reads
the `outside` ramp), `halo` (wear `HALO_SCREEN`), `cyc` (colour-cycle with `t`).

## gif.ts (optional)

| Export | Signature | Returns |
| --- | --- | --- |
| `PALETTE_SIZE` | | `32` (the GIF's `TRANSPARENT` is the palette's 31, exported once) |
| `encodeGif` | `(spec: GifSpec)` | `Uint8Array` GIF89a |
| `encodeGifSteps` | `(spec)` | `Generator<number, Uint8Array>`: yields after each written frame, returns the same bytes |

One global table: 32 colours (5-bit codes, 31 transparent) as NOCTURNES has
always written; a palette of 33..255 colours gets the next power-of-two table
with its last slot kept free as the transparent index (256 colours is a
`RangeError`: no slot left). Frames after the first are delta frames;
identical neighbours merge into one longer frame; `delay` in centiseconds (min 2).
