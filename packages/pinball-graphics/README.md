# Pinball graphics

Deterministic presentation budgets for the KEEL pinball renderer. Style (`pixel`, `dither`, `arcade`, `realistic`, `cartoon`) and detail (`low`, `balanced`, `high`, `ultra`) are independent. The world, native simulation, input, and replay never depend on this module.

```ts
import {resolvePinballGraphics, createPinballGraphicsGovernor} from '@keel-engine/pinball-graphics';

const plan = resolvePinballGraphics({
  quality: 'auto', style: 'pixel',
  viewport: {width: 1200, height: 720, pixelRatio: 2},
  device: {webgl2: true, maxTextureSize: 16384, maxRenderbufferSize: 16384},
});
const timing = createPinballGraphicsGovernor({initial: plan.quality, automatic: true});
// Feed actual intervals between active rendered frames, before simulation clamping.
const sample = timing.observe(rawFrameIntervalMs, pageVisible && playing);
```

The renderer must consume the returned resolution, mesh/cache, triangle, shadow, light, texture, and effect budgets. A budget is not a frame-rate result. Mandatory balls, blades, and physical route cues must remain present; report a mandatory triangle overrun rather than silently dropping them.

Automatic detail uses warm-up, measured p95 intervals, hysteresis, and cooldown. Manual selection stays manual. Hidden or paused intervals reset timing. A change requires a bounded renderer/cache rebuild, including the look/decal atlas; replacing geometry alone does not lower texture memory. Capability hints only lower initial cost and do not establish device performance.

The current renderer requires WebGL2. The canonical retro target profiles describe art budgets; they do not imply a native console port or software-renderer fallback. Real browser, physical mobile, controller, and platform acceptance remain separate checks.

Local KEEL module preparation, reproducible builds, and the linked runtime smoke are recorded under `work/design-reset/graphics-module-build-current` and `graphics-module-linked-smoke.json`. No on-chain publication is implied.
