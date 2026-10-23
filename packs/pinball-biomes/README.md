# Pinball biomes

Optional `packs/pinball-biomes` module. `createPinballBiome({theme,seed,width,height,density})` returns immutable decorative scene data in table units, plus a palette. Themes: `nightshift`, `cyberpunk`, `vaporwave`, `gold`, `nature`. Density defaults to `medium`; low/medium/high retain 12/24/44 ornaments. Existing ornaments have identical IDs and values across density changes.

Each theme has a separate placement and shape grammar: industrial circuit strips, neon tower skyline, vaporwave sun/grid/fronds, gold obelisks/gems, or nature canopy/fronds/leaves. The palette is additional identity, not the whole theme. Rotation and phase are radians; size is a nominal dimension in table units. Render these behind canonical ball, rails, flippers, lamps, and warnings.

Recipes use narrow KEEL `core/rng` streams. Each ID owns its stream. This module contains no DOM, renderer, input, physics, networking, image importer, or unseeded random source. Springs and impact response belong in a read-only presentation consumer. Rendering style (`pixel`, `dither`, `arcade`, `realistic`, `cartoon`) is a separate consumer choice.

The lower central landing corridor is reserved. Nature leaves approach outer side/inlane regions for cosmetic ball-driven motion; decorative leaves never imply colliders or alter ball state. Gameplay-affecting foliage must be a separately declared, compiled map mechanism.

The module manifest and KEEL entry follow engine conventions. Source revision remains a local-development placeholder until release packaging pins it. No chain registration, publication, device certification, or sustained-performance measurement is claimed.
