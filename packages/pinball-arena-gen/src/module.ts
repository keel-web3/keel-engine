import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({
  "id": "keel/pinball-arena-gen",
  "version": "0.1.0",
  "kind": "runtime",
  "needs": [
    "keel/runtime@^0.1",
    "keel/core@^0.1",
    "keel/codec@^0.1",
    "keel/pinball-arena@^0.1",
    "packs/pinball-world-art@^0.1"
  ],
  "title": "Pinball world generator",
  "description": "Seeded connected shared arenas, regional biome plans, shot routes and real mechanisms."
});
