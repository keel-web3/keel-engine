import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({
  "id": "keel/pinball-world",
  "version": "0.1.0",
  "kind": "runtime",
  "title": "Classic pinball world",
  "description": "Classic score, ball lifecycle, launch saves and authored shooter relaunch rules over the same deterministic pinball kernel.",
  "needs": [
    "keel/runtime@^0.1",
    "keel/pinball-map@^0.1",
    "keel/pinball-physics@^0.1"
  ]
});
