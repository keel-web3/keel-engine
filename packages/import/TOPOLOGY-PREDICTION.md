# Experimental topology-conditioned prediction

The separate `./topology-asset-compiler` API extends the experimental render-input mode. It never changes decoded attribute values. A fixed causal predictor derives earlier-neighbor or parallelogram values from the actual ordered triangle indices, then encodes exact residuals. It tests component words and, when verified, the source quantizer's integer domain. It stores no hidden parent table or source mesh. The actual topology remains in the native package and is required by replay.

Use `node tools/build-native-topology.mjs output` to produce the portable compiler and all runtime variants. Call `compileAsset` with `mode:'visual-preservation'` and `support:{decoder, coreDecoder, topologyDecoder, topologyCoreDecoder, licenses}`. Use this module's `makeNativeArchive(result,support)` so the chosen decoder bytes are included. Nonvisual modes retain v4 behavior. This is an explicit experiment, not the default engine import path or published demo.

Candidate streams must reconstruct every component word exactly. Binding metadata connects the recipe to a specific primitive/accessor; replay validates descriptors, topology, owner markers and combined prediction/native/affine/index allocation budgets before reconstruction. Independent tests cover malformed descriptors, shared owners, implicit/meshopt topology, signed zeros, morph/skin/animation data and archive replay. The source and browser-targeted bundles produce equal recipes in Node. Actual browser execution of this experiment and GPU parity are unverified.

## Complete measured result

One Brotli11 stream over the full executable ZIP including runtime and licenses:

| Model | Original | Visual baseline | With predictor |
|---|---:|---:|---:|
| Fox, all 3 clips |72,937 B|84,380 B|84,380 B (rejected) |
| Littlest Tokyo |3,526,281 B|3,936,032 B|3,869,555 B |

The final predictor reduces Tokyo by 66,477 B relative to the visual baseline, but output is still 343,274 B (9.7%) larger than its already-Draco-compressed source. Thirty-six streams use the predictor. Normals never beat their existing octahedral encoding. Generated GLB bytes remain identical to the visual baseline, so the earlier finite CPU render comparisons still describe its geometry/material output.

An initial run took 4.3s Fox/34.3s Tokyo; a final run under concurrent shared-machine load took 10.2s/53.5s. These include normalization, candidate search, reconstruction and validation, but exclude network download, process startup and final Brotli delivery compression. They are observations, not speed guarantees. The zlib9 selection metric compares complete runnable archives; the table independently reports Brotli11.

This closes the bounded predictor experiment. The desired smaller-than-source visually preserving conversion is still not achieved. Further similar residual codecs are unlikely to erase the entire gap. A larger next experiment would reconstruct connected planar patches only when the complete interpolated fields are provably preserved, or use an explicitly defined visual-error/rendering contract. Hidden surfaces cannot be deleted from a few views without additional valid scene assumptions.
