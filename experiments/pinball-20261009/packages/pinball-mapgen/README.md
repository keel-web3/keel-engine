# KEEL seeded pinball cabinets

Optional narrow imports: `@keel-engine/pinball-mapgen` and `/runtime`. Uses the existing KEEL `core/rng` fixed slots/named derivation and `codec/hash` synchronous SHA-256. No Node imports, global RNG, renderer, wallet, HTTP service, clock, device quality input or physics implementation is bundled here.

```
const cabinet = createCabinetRecipe('0x1234', {theme:'cyberpunk', style:'pixel'});
const stage = createCabinetStage(cabinet, 100, authoredBaseMap, {layouts});
```

A layout is `{id,bumperPositions:[{id,x,y},...]}`, covering every existing bumper exactly once. Supply 1–32 game-authored layouts. IDs and array order are canonicalized; duplicated layouts are rejected. With no layouts, existing base-map positions are retained. The generator never invents random collider coordinates. It validates every supplied layout against map bounds, pairwise bumper corridors, rails, launch socket and conservative full flipper sweep bounds. Clearance arithmetic is exact over quantized Q10 coordinates using BigInt. Static clearance is screening evidence, not proof of reachable or enjoyable shots.

Recipe and stage results are deeply immutable. Every recipe identifies its canonical body, SHA-256, normalized bytes32 seed, versioned style family and decoration seed. A stage binds recipe identity, base-map/layout template digest, generator version, index, derived stage seed and compiled map digest. Its own canonical SHA-256 binds all these fields. Map IDs encode the identity, so physics/world snapshots reject use with another generated stage. KEEL named seed derivation is deterministic procedural arithmetic, not a cryptographic ownership or unpredictable-mint guarantee.

Indices are integers 0–2,147,483,647. Any index can be derived independently; asking for stage 100 does not evaluate or consume stages 0–99. Only the requested fixed-size map is returned. A cabinet-specific fixed slot chooses the cycle offset through sorted authored layouts; consecutive stages change geometry when at least two distinct layouts exist. Named stage/decoration streams vary independently. Cabinet theme/style stay fixed.

`difficulty` is `{progressionStep,scoreMultiplierQ10,bumperImpulseBonus}`. Progression clamps at 200: base bumper impulse rises by at most 200/256 units/tick, base scores scale by at most 2624/1024, and each value is also clamped to the map's admitted bounds. Gravity, launcher, rail restitution, ball radius, flipper mechanics and simulation tick stay fixed. Beyond the cap, layouts cycle and decoration seeds vary; this finite template family does not promise infinitely novel geometry or perpetually increasing difficulty.

This module supplies cabinet/stage identity and map generation. It does not mint tokens, verify ownership, deploy chain artifacts, implement a survival run, persist player progress, award roguelike upgrades or certify ranked scores. Hosts must select explicit practice/endless/classic rules. Chain integration needs a selected chain and verified receipt/read-back later.

Checks: `node --test packages/pinball-mapgen/test/*.test.ts`. Normal engine prepare/index builds `src/module.ts` and `keel.module.json` through the shared catalog; no parallel loader is introduced.
