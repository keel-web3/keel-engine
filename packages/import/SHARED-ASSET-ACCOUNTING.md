# Shared-module asset accounting

For the engine module architecture, the primary size is **the required per-asset KAP payload compressed with Brotli**, compared with the original model compressed with the same encoder and settings. The reusable compiler, decoder, loader and one-time licenses are not charged to every asset. KAP includes all unique geometry, texture pixels/bytes, materials, scene records, rigs, morphs, animation and executable reconstruction recipes. The generated loader contains no unique model instructions; those are in KAP.

A complete cold runnable ZIP is a secondary distribution metric. Earlier experimental selectors minimized that cold ZIP using zlib9. Their choices are not necessarily optimal for the corrected shared-module objective. In particular, paying for a smaller decoder by choosing larger index data can be wrong when the engine already has the complete shared decoder.

## Measured existing candidates

Node Brotli quality11, equal settings on both sides, bytes:

| Asset | Original | v4 exact-data | v4 bounded-lossy | Visual | Topology | Raw transport |
|---|---:|---:|---:|---:|---:|---:|
| Fox (all 3 clips) |72,937|72,256|72,245|64,314|64,314|59,944|
| LittlestTokyo |3,526,281|3,937,820|2,705,393|3,906,115|3,836,484|3,537,265|

The raw Fox payload is 17.8% smaller; Tokyo is 0.31% larger. These are actual compressed asset files, not values obtained by subtracting a separately compressed runtime from a whole ZIP. One common decoder now replays both raw variants: 24,334 B Brotli once, with common licenses 3,669 B separately. This replaces the earlier sum of two separate runtime variants.

The original buffer/view-layout report (`sourceStorageMetadata`) is copied to a native-scene audit property and is not read to reconstruct geometry or a GLB. Separating that property into an optional audit sidecar is permissible only when explicitly declared and verified. Attribution, ordinary scene metadata, extensions, materials and all required model data remain in the payload.

## Selection contract

The separate `selectSharedAssetPayload` selector accepts a pinned Brotli codec identity and score each complete required asset payload after its chosen delivery transform. It must include all per-asset recipe instructions and metadata; it must not omit the texture/animation payload or mix partial-component sums with whole-file compression. Shared module capabilities are fixed once for the asset set, and their cost is reported separately. The optional cold-distribution objective must be explicit.

Selection remains bounded and deterministic. Compression encoder/version, quality and window are part of settings; different Brotli implementations may choose different streams or candidates. Node's Brotli C implementation and a browser WASM encoder should not be mixed in a side-by-side comparison. Both sides use the same pinned encoder. Final payload decompression and native replay must match the selected candidate, and per-asset source fidelity remains a separate gate.

Primary accounting does not imply the existing cold selector has already been changed, nor that the experimental visual/topology/raw modes are deployed on the demo. The v4 default remains separately frozen. Runtime sharing substantially changes the earlier size conclusion, but does not make every source model compress smaller automatically.


## Implemented shared module

`asset-replay-shared.ts` is one decoder for plain native, topology-predicted and raw-transformed packages. A single browser-targeted module replays the selected Fox and Tokyo payloads exactly; it is 89,461 bytes raw / 24,334 bytes Node Brotli 11 once. `asset-shared-transport.ts` produces the raw transform transport using bounded inflation and can explicitly separate storage-layout provenance. User JSON is never interpreted as transport metadata.

`asset-payload-selection.ts` scores complete, already fidelity-validated candidates with a pinned supplied Brotli codec, checks every compression roundtrip, and breaks ties by stable candidate ID. It includes no shared runtime/archive wrappers in per-asset cost. The codec identity, quality and window are in its report. Re-scoring existing native candidates selects Fox 59,801 B with optional audit sidecar and Tokyo 3,537,265 B with audit provenance retained (removing it makes the compressed stream 39 B larger). These are bounded candidate-set results, not a global minimum. Source-preserved fallback is explicitly labeled if the caller includes it.

Build the common decoder and portable asset tools with `node tools/build-shared-native.mjs output`. The old experimental cold selector remains available for compatibility; application pipelines should pass their complete validated candidates through the shared selector when that is the intended objective. Browser live measurements use pinned brotli-wasm 3.0.1; Node measurements here use Node 24.19.0/Brotli 1.2.0. Do not mix those byte totals in one comparison.


## Exact geometric-normal post-pass

The additional experimental post-pass predicts octahedral normal coordinates from positions and ordered topology, then stores exact residuals. Whole-array and GLB equality are mandatory; noneligible streams keep their existing representation. `optimizeGeometricNormalPayload` accepts a native KAP and the same pinned codec used by the shared selector. It chooses streams using complete entry cost, then compares the complete resulting asset with unchanged fallback. There are no model-name rules.

On Tokyo the fixed selector uses 48 eligible stored normal streams and produces 3,511,903 B with Node Brotli 1.2.0, quality11/window22, versus original 3,526,281 B: 0.408% smaller. This is a modest development result; different Brotli encoders must be measured independently. Fox has no eligible oct-normal stream and retains its prior 59,801 B result. The shared decoder grows once to support this operation; measure its current built bytes independently. This experiment is not deployed on the v4 demo.
