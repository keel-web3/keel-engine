import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({
  "id": "keel/pinball-map",
  "version": "0.1.0",
  "kind": "runtime",
  "title": "Pinball authored maps",
  "description": "Validated and deeply frozen canonical authored pinball geometry; precise fixedpoint table coordinates.",
  "needs": [
    "keel/runtime@^0.1"
  ]
});
