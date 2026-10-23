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

Games using this template save side, size and height preferences. Do not expose
the old four-scheme cycling UI as the racing experience.

## Generated visuals with exact input geometry

For visuals produced by the maintained KEEL UI generator, use
`createTouchSurface(host, virtual, layout, { visuals: "external" })`. The DOM
surface remains transparent, interactive and accessible; the generated UI owns
the visible pixels. Supply the host's normal control stylesheet for positioning
and hit testing. External mode suppresses CSS press motion and ripple allocation.

Button and stick controls accept `rect: [x, y, width, height]`, normalized to the
overlay. This exact rectangle overrides their legacy anchored placement. Keep
every rectangle finite, positive and inside the overlay, and account for safe
insets in the shared layout once. An exact stick uses half its measured shorter
side as its input radius and cannot also have a floating `region`. Invalid
geometry throws before mounting or replacing a live layout.

`overlay.snapshot()` returns current primitive bounds, values and pressed state
for a generated visual layer. Its array and bound tuples are borrowed and reused;
copy primitives when retaining a measurement. Values aggregate controls sharing
an action id. It exposes no DOM or pointer owners. Layout replacement releases
held input, and `destroy()` clears the borrowed view. The visual layer owns and
disposes its own UI, atlas and presenter resources.

Design references:
- [Apple game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls)
- [Microsoft touch design guide](https://learn.microsoft.com/en-us/gaming/gdk/docs/features/common/game-streaming/building-touch-layouts/game-streaming-tak-designers-guide)

Their recommendations for reachable primary actions, two simultaneous thumbs,
combined actions and immediate feedback inform this template. Browser tests
and synthetic pointer regression tests do not establish physical-phone feel.
