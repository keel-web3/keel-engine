import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({
  "id": "keel/pinball-physics",
  "version": "0.1.0",
  "kind": "runtime",
  "title": "Deterministic pinball physics",
  "description": "An integer C17 WASM pinball kernel with swept rail, bumper and rotating-flipper contacts, owned balls and complete snapshots.",
  "needs": [
    "keel/runtime@^0.1",
    "keel/pinball-map@^0.1"
  ]
});
