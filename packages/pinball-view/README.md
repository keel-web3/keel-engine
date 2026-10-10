# @keel-engine/pinball-view

An optional original Canvas2D presentation for canonical pinball resources. EMBERLINE is the default table title; NIGHTSHIFT is the blue steel, emerald and brass art recipe. The package owns no input, animation loop, score rules, collision detection, or synthetic ball motion.

```ts
import { createPinballView } from "@keel-engine/pinball-view";

const view = createPinballView(canvas, {
  skinSeed: "nightshift-1",
  finish: "steel", // also "gold" or "jade": ball material only
  theme: "nature", // nightshift, cyberpunk, vaporwave, gold, nature
  style: "pixel", // pixel, dither, arcade, realistic, cartoon
  visualDensity: "medium", // low, medium, high
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
});

// The game owns the canvas's CSS size and its resize observer.
view.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio);

// Reuse the canonical immutable map. Frame coordinates are table units, +y down.
// Use readFrame() from the simulation/world; angles and tips come from that frame.
view.ingest(world.readFrame().events);
view.render(world.map, world.readFrame(), { timeMs: performance.now() });

// After a replay seek or restart, before delivering replay events:
view.resetEffects();
// At unmount:
view.dispose();
```

The structurally compatible types in `src/types.ts` accept the `pinball-map` and `pinball-physics` shapes. Extra game fields can include `score`, `ballNumber`, `ballsRemaining`, `phase`, `objective`, `multiplier` and current world-space lamps. Optional `statusLabel` replaces the credit text within the same cabinet row, for example `HP 4/6 · STAGE 2`. `activeIndicatorIds` lights matching actual bumper inner rings or floor indicator IDs from the host's objective state. Both are read-only presentation fields. An inactive ball is visible while `phase === "ready"` so the shooter remains readable. All supplied active balls are rendered, including owned balls on distinct layers; physics determines which balls can exist.

`map.presentation` optionally places a backbox through `scoreDisplay: {x,y,width,height}`, names the table through `title`/`subtitle`, and adds flat floor lamps through `indicators`. Snapshot `indicators` are dynamic. An indicator's `id,x,y,label,value,active,kind,layer` describes cosmetic lamp state; it creates no collider. Pass the current real objective from the world. The default objective is `HIT THE THREE COILS`, with no claim that locks, targets or a raised field exist.

Geometry stays canonical: rails use the supplied segment endpoints; coils use exact supplied centers/radii; moving flippers use the read-frame pivot/tip/radius; balls keep their supplied physical radius. Shadows, gasket rings and bevels are decorative extrusion. No decoration creates an alternate rail path. Layers are sorted and rendered separately so a raised rail has its own material and occlusion order. This adapter currently supports eight distinct authored geometry layers.

EMBERLINE's `target-bank-*` bumpers use numbered brass contact faces and `kicker-*` bumpers use engraved emerald arrow faces. Their physical silhouette remains the supplied circle. Bank guides and orbit rails receive material accents on the actual endpoints. A subdued flat machinery print follows the authored coil positions beneath the moving objects; its dashed traces and routing marks are floor ink, with no collision or scoring authority.

Fixed backgrounds and geometry layers are cached until resize, map identity change or `map.viewRevision` change. Keep the map identity stable; increment `viewRevision` if intentionally editing it in place. Ball trails contain at most six observed frame positions for at most sixteen balls and clear at layer transfer, respawn, inactivity or seek. The cosmetic seed only drives faint floor traces, coil notch phase and contact particles. Finishes never modify table geometry or physics state.

Effects use a recycled particle pool (24/64/128 by density, hard cap 256), at most 32 brief contact pulses, a 64-event pending queue and a 512-ID dedupe ring. Duplicate delivery does not repeat a hit effect within that ring. Reduced motion removes particles/trails and retains a short contact pulse. Use `getStats()` for inspection. Cosmetic effects, fonts and gradients require Canvas2D; the backbuffer pixel ratio defaults to a cap of 2, with maximum dimension 2048 pixels. The embedding game's input, audio, controller/physical-phone qualification, selected-chain publication and live release remain separate responsibilities.

Themes and styles are independent. Cyberpunk has holographic towers/circuit paths; vaporwave has a sunset, monuments and a perspective grid; gold has carved obelisks/filigree; nature has layered fronds, canopy light and spring leaves; nightshift retains the induction-floor recipe. Pass `biome: createPinballBiome(...)` from the optional `@keel-engine/pinball-biomes` pack to use its deterministic, frozen ornaments and palette. The renderer has its own deterministic fallback for standalone use. Ornament coordinates are table units, `rotation` and `phase` radians. This differs deliberately from the physics flipper angles, which remain degrees.

Pixel renders the geometry into a real half-CSS-resolution canvas, then upscales with nearest-neighbor sampling. Dither caps its real canvas at 130,000 pixels and applies ordered 4×4 Bayer color quantization, at most 30 presentation frames per second. The 120Hz physics clock belongs to the host and is unaffected. Cabinet score/objective text is drawn afterward at the native backing resolution. Arcade uses compact rail/coil/ball glows, realistic uses layered metallic gradients/shadows, and cartoon uses flat fills and dark outlines. All 25 combinations consume identical canonical collider geometry and ball/flipper frames.

The cabinet preserves its supplied world-space footprint. Below 52 CSS pixels high it uses two compact rows; below 26 CSS pixels it keeps only a centred score/credit row, so a short landscape viewport cannot overlap the objective with score text. The objective reappears when sufficient height returns. The host can continue showing its current objective elsewhere in existing status text.

Visual density caps static ornaments at 20/48/96 and reactive leaves at 16/36/64 for low/medium/high; leaves have a global hard cap of 96. Particle defaults are 24/64/128 by density. Nature leaves sample ball proximity/velocity and relax through damped springs; they draw before rails and balls, and cannot apply forces to balls or create collisions. Reduced motion leaves foliage static. Actual game-affecting foliage would require a new canonical map collider/rules implementation.

The KEEL module manifest and lazy `keel/entry.ts` follow the standard engine module linkage. This package needs only `keel/runtime`; canonical map/physics inputs are structural data contracts rather than runtime dependencies. Focused checks exercise exact frame geometry, immutable inputs, cache invalidation, event dedupe, memory bounds, reduced motion and deterministic cosmetic effects.
