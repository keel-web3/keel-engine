# Seeded robot ball art

`rollingRobotBallSprite(identity, orientation, contactFlash, reducedMotion, elevationRatio)` returns a 24×24 indexed spherical shell using the existing eleven palette roles. The small face and seeded shell marks curve across the surface. Fixed upper-left lighting and glints use the visible sphere normal, independently of material rotation. The camera view ratio affects surface sampling, never body position or radius.

Observe every completed native frame with `createRobotBallMotion().update(frame)`. Each pose contains `orientation`, a frozen unit quaternion `[x,y,z,w]` in native world axes. Signed XY displacement applies a cosmetic no-slip ground-roll approximation: rotation axis `(-dy,dx,0)`, angle `distance/radius`. Stopped bodies retain their orientation. Discontinuities, missing consecutive ticks, identity changes and displacement over 96 native units reset rolling orientation. Captured, inactive and eliminated bodies have no visible pose. Reset the observer before replay or backwards seek.

This module does not change or infer native spin, angular momentum, slopes, contact physics, native positions, or trajectories. Ground rolling is a cosmetic approximation of observed native displacement.

Reduced motion renders the resting orientation and suppresses contact flash. Continue observing native frames while reduced motion is enabled, so toggling the preference does not discard the actual displacement history. Draw with the existing `drawRobotBall` and scene palette mapping; native radius, offsets and clipping still bound all written cells.

The historical `robotBallSprite(identity, frame, contactFlash, reducedMotion)` API and its authored eight-frame output remain available unchanged. `pose.frame` remains available for those callers.

Focused source tests are in `test/rolling-shell.test.ts`. The local prepared runner in `work/design-reset/next-art/25/rolling-shell-v2/run.mjs` bundles those exact package sources and captures its inputs. Tests require the coordinated CPU lane and a fresh load preflight; source preparation alone is not a passing test or live visual acceptance.
