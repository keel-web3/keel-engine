import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({
  "id": "keel/pinball-arena",
  "version": "0.1.0",
  "kind": "runtime",
  "needs": [
    "keel/runtime@^0.1",
    "keel/core@^0.1",
    "keel/codec@^0.1"
  ],
  "title": "Shared pinball arena",
  "description": "Canonical multi-owner integer WASM arena physics, field mechanisms and snapshots."
});
