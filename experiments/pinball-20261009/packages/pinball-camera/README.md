# Native pinball camera

`keel/pinball-camera` is a presentation-only module. It observes the real owner body, current source lease, live blade poses and selected capture exit. It cannot mutate native authority state.

```ts
const camera = createPinballCameraRig(world, ownerId);
camera.reset(initialFrame);
// In the native stepping loop, even when rendering is skipped:
camera.observe(nextNativeFrame);
// At any render cadence, with measured header/nav/touch-control occlusion:
const c = camera.sample({width, height, safeInsets, mode: 'follow'});
const pixel = c.project(body.x, body.y, body.elevation);
```

Use one rig per world and owner. Reset when replacing a source or seeking a replay. For identical replay camera history, reset and observe every preceding native frame. Rewinds and skipped tick discontinuities reset smoothing safely and report `framing.sourceDiscontinuity`; they cannot reconstruct missing history. Same-tick observations are idempotent; conflicting same-tick source frames require reset. Sampling, overview requests and viewport changes do not advance state. Retained memory is one source frame plus constant-size presentation state and world lookup.

Follow defaults to 0.82 pixels per native unit, with identical X/Y ground-plane scale and elevation projection at 0.8 of that scale. Source velocity gives bounded seven-tick lookahead; a source-tick dead zone and damping stabilize the camera. Near a real owned bank, the actual ball and both live blade capsules stay inside the safe area. Remote travel releases pair retention. Follow never includes distant targets, decorative artwork, cabinet bounds or the full field. `overview` explicitly fits field surfaces and rails.

During inactive capture, finite native entry/release clocks anticipate the selected exit using a matching declared route when available, otherwise the two real source anchors. No proxy ball is created. Cross-arena exits are reported but the camera keeps the source field until the native body changes arenas, then resets into the real destination field. Indefinite captures remain at the actual capture anchor. Dead/inactive states report `ballInSafeArea: null`, never pretend an active body is visible.

`framing` reports source tick/arena/station, actual ball bounds and safe-area visibility, ball pixel diameter, scale ratio, pair applicability/retention, camera-only anchor/center, discontinuity and bounded frame count. A safety clamp overrides damping when necessary to keep the active ball and applicable blade capsules clear of controls. Very small usable viewports can reduce scale; `usefulZoom` explicitly reports whether it remains at least 65% of configured scale.

The host adapter lives at `work/design-reset/next-art/25/src/camera-follow.ts`. Create it once for the source, call `observe` for every native frame, and pass `render(frame,width,height,mode,safeInsets)` to the existing scene projection path. It intentionally rejects unobserved render ticks. Existing UI controls and their placement are unchanged.

## Checks

From the workspace root:

```sh
node --test work/keel-pinball-engine/packages/pinball-camera/test/camera.test.ts
node work/keel-pinball-engine/packages/pinball-camera/test/typecheck.mjs
node work/keel-pinball-engine/packages/pinball-camera/test/run-native-evidence.mjs
node work/keel-pinball-engine/packages/pinball-camera/test/run-native-evidence.mjs work/design-reset/family-development/iteration29/checkpoints/pressure-court29-v1 three-strokes
node work/keel-pinball-engine/packages/pinball-camera/test/run-native-evidence.mjs work/design-reset/family-development/iteration30/checkpoints/connected-pressure30-v1 roundtrip-1072
node work/keel-pinball-engine/packages/pinball-camera/test/run-native-evidence.mjs work/design-reset/family-development/iteration30/checkpoints/connected-pressure30-v1 blocked-exit-fallback
```

Evidence runner bundles the chosen checkpoint's exact arena and replay modules, preserving frozen authority18 instead of silently loading generic authority17. It replays native `.kpr` inputs, checks source immutability, uniform scale, portrait/landscape/desktop safety, actual blades near bank, release of retention during travel, render cadence/resize independence, replay reset equality, guards and isolation from distant map geometry. Four captured tapes cover 5,252 native frames and 21,008 viewport samples. Follow scale in these cases is 0.649–0.82; D32 balls render 20.77–26.24 logical pixels wide. Evidence JSON records exact tape/world/kernel/authority. This is a scoped camera result, not art, physical-phone or full-game approval.

## Explicit body height (0.1.1)

`createPinballCameraRig(world, ownerId, {bodyHeight:'sphere-on-plane'})` adds the observed body's radius vertically to its native elevation for presentation focus, captured camera anchors, selected-exit anticipation and visible ball bounds. Default `native-plane` retains legacy V3 framing. Samples expose `bodyVisualElevation` and its alias `renderBallElevation`; `framing.bodyHeightConvention` states the active option. Render actors and actor-based cutaways from that sample elevation to avoid mismatched centers.

This is a flat visual height convention. It does not claim exact sphere tangency on sloped floors, alter the native frame/body, or move the native collision capsule. Raw native pair-proximity rules remain unchanged. Capture-route anchors still do not represent an active travelling body. The host must apply the same chosen convention to its own contacts/trails where appropriate. Options outside the two declared values reject at construction; failed observation retains prior state.


## Adaptive readable fit (0.1.3)

Use `{framing:'adaptive'}` when a complete playfield should remain visible whenever it is readable. Pass `cssPixelsPerPixel` from the actual fitted canvas, along with measured safe insets. The initial readability policy requires an 8-pixel logical / 12-pixel CSS ball and a 16-pixel logical / 24-pixel CSS blade. These are initial tuning values, not a physical-device acceptance claim.

Bounds are cached from the current native field's surfaces, rails and source flipper sweeps with a fixed 32-unit envelope margin. Decoration and the live ball do not change the fit bounds. A readable full view stays fixed after launch. Out-of-envelope movement switches to safe follow without growing those bounds. Follow targets a 14-pixel D32 ball, includes cabinet width when readable, and retains the existing nearby-body/blade safety rules. Large shared fields continue to follow; they are never height-fitted during gameplay when that would make controls too small. Manual overview remains available separately.

`framing.mode` reports `fit`, `follow` or explicit `overview`. `ballDiameterCssPixels`, `fullPlayfieldReadable`, `fitScale`, `readableScale` and fixed `playfieldBounds` report the decision. In adaptive mode `usefulZoom` reports actual ball readability. The host's automatic fit remains normal gameplay with scenery and working mechanisms. Native-plane centers, ball artwork, trails and diagnostic bounds must use the same convention.

Run the focused adaptive/native checks with `node work/design-reset/next-art/25/adaptive-camera-ball/run-camera.mjs` and `node work/design-reset/next-art/25/adaptive-camera-ball/run-native.mjs`. Historical fixed-follow behavior remains the default.

## Configurable arcade readability (0.1.4)

Hosts may opt into `readability: {ballDiameterPixels:16, ballDiameterCssPixels:20, bladeLengthPixels:32, bladeLengthCssPixels:40, bladeThicknessPixels:4, bladeThicknessCssPixels:6}` and `fitMaximumScale:.75`. All dimensions use the actual native body and blades; the renderer does not inflate sprites or alter collision geometry. These are review tuning values, not device or art acceptance.

The independent fit ceiling permits a larger complete view when its real safe viewport can support it. Default thresholds and the legacy follow scale remain unchanged. Safety can reduce scale in cramped viewports; `usefulZoom` is then false instead of reporting legibility. Manual/prelaunch overview and the native-launch transition can intentionally be smaller. Samples report configured thresholds, minimum projected blade length/thickness and both fit/readability scales.

Actual source-journal tests under `next-art/25/adaptive-camera-ball/arcade-readability` exercise1359 native frames and four control-constrained viewport profiles. Wide and390x844 browser captures showed D32 balls at24 and20 CSS pixels respectively. The shortest320x480 profile required8 target /5 neutral safety reductions to roughly19 CSS pixels. These limitations remain explicit; no physical-device claim follows.

## Optional source waiting-bank preview (0.1.5)

Set `waitingStationPreview:true` to frame the nearest source station after a native drain, or when joining an already waiting frame. The camera includes the station's declared launch origin and the current observed blade capsule endpoints only when their complete bounds fit the existing readability/useful-scale policy. The initial prelaunch and explicit overview retain their current framing. Active follow, native ownership, transport and eliminated bodies retain their existing rules.

`framing.waitingPairPreview` reports admission of those source bounds, and `sourceWaitingStationId` identifies the nearest source station considered. Neither is a native lease or control grant. `pairApplicable`, `retainedPair` and `retainPair` continue to describe the active owned pair; `ballInSafeArea` remains null while the actual native body is inactive. The preview does not render a ball, move the body or alter any simulation input. Omitted/false preview preserves existing geometry; the added diagnostics are false/null.

Proof preparation is under `next-art/25/adaptive-camera-ball/waiting-station-framing`. Source preparation or SDK build alone is not browser, art, physical-device or game acceptance.

## Coherent depth motion (0.1.6)

Opt in with `depthMotion: {maximumTranslationPixels: 4, maximumElevationRatioDelta: .02, dampingTicks: 24}`. Native observation history gently changes the common view origin and elevation projection. Every fixed-height play plane retains equal X/Y scale. Balls, blades, rails, tubes, atlas inverse samples and supports must use the returned projector and coefficients together. `viewToPlane(x,y,z)` inverses the displayed sample at a declared native plane height, with the usual half-raster-pixel uncertainty from rounded projection. Retained samples remain stable after subsequent observations. Rejected transport observations leave presentation history unchanged.

The option is disabled by default. The host omits it for reduced-motion preferences. It is a bounded orthographic depth cue, not a perspective camera or a simulation transform. Translation limits are raster pixels, not CSS pixels; ratio limits apply across native height separation. Real independent distant scenery can use separately declared depth planes; cabinet stock rooted to the play bed must not drift separately. Replay reconstruction still requires every observed native frame.

Root validation: 21 focused camera tests and strict camera/host typechecking; 8,672 actual recorded-frame camera samples, 96 selected final native views, and 891,306 preserved native contact pixels. Node/Bun selected pixels and camera metadata matched exactly. These are local scoped checks; physical-device FPS and complete connected-world gameplay remain unqualified.

## Explicit room framing (0.1.7)

Supply `playfieldFraming` from the exact native world's declared rooms and transitions to retain readable room bounds during connected play. The index validates complete source membership once. Active support, native path IDs and capture phases select presentation scope; this never grants station ownership. Explicit MAP and prelaunch overview continue to show the whole source field. A room may fit only while the active ball and all currently protected owned blade bounds fit inside that scope. Otherwise the ordinary safe follow policy applies.

When a scoped axis fits at the existing readable scale, its origin is centered within the measured safe area. Larger axes follow the real body inside source bounds. `sourceFraming.axes` and `originStatus` describe this policy before common depth motion, explicitly marked by `policyStage`. `scopeAvailable` reports a usable source selection; `scopeApplied` reports actual room fit or successful origin solving. Projection coefficients remain common across hardware, balls and artwork, with uniform ground-plane scale. Omitting the definition retains the default field policy.

Root checks passed 24 camera cases in Node/Bun plus 3 corrected scope regressions, strict camera/scene/consumer typing, and 48 selected recorded-frame views with 8,672 native camera observations. Camera metadata, final indexed pixels and palettes matched exactly between runtimes; 435,681 contact pixels stayed intact. These checks do not qualify physical-device performance or complete connected route gameplay. The independent source review is `work/design-reset/camera-framing-review/CAMERA-0.1.7-INTEGRATION-REVIEW.md`.
