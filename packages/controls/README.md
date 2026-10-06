# Racing touch controls

`racingTouchLayout()` is one shared two-thumb driving template, exported through
`@keel/game-engine/controls`. Use `createTouchSurface()` with the standalone `RACING_THUMBS_CSS`; this avoids
bundling CSS for unused zones, sliders and decorative effects. `createTouchOverlay()`
retains its default generic styling for other games.
Map `steer`, `gas`, `brake`, `handbrake`, `boost`, `camera`, `rearview`, `phone`
and `pause` to your game's actions. `manual` adds `shiftUp` and `shiftDown`.

The fixed horizontal steering pad ignores vertical movement. Its first pointer
owns the axis until release. Pedal buttons share a slide group: drag between
GAS, BRAKE, DRIFT and BOOST without lifting. DRIFT and BOOST include GAS so
steering plus either action needs only two thumbs. Lifting the pedal thumb
releases every included action. Brake remains the game's brake/reverse input;
the template never changes vehicle physics or enables automatic acceleration.

`swap` exchanges the thumb groups without reversing steering. `lift` adjusts
both groups together; `--keel-ctl-scale` adjusts reach. Keep secondary touch
hit targets at least 44 CSS pixels and fit controls within the safe viewport.
Hide controls outside active driving. Call `overlay.release()` when pausing or
resizing; blur, visibility change, cancellation and lost capture also release
owned input. Call `destroy()` when removing the game.

The game saves only side, size and height preferences. Do not expose the old
four-scheme cycling UI as the racing experience.

Design references:
- [Apple game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls)
- [Microsoft touch design guide](https://learn.microsoft.com/en-us/gaming/gdk/docs/features/common/game-streaming/building-touch-layouts/game-streaming-tak-designers-guide)

Their recommendations for reachable primary actions, two simultaneous thumbs,
combined actions and immediate feedback inform this template. Browser tests
and synthetic pointer regression tests do not establish physical-phone feel.
