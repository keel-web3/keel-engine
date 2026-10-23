# Pinball device input

Canonical `keel/pinball-input@0.1.0` device adapter for the shared pinball authority. The game owns control placement; this module supplies held button state, between-step taps and quantized controller aim. It does not simulate or steer balls outside the admitted input API.

```ts
const input = createPinballInput({ownerId: 0});
const detach = input.attach({target: window});
const releaseLeft = input.bindButton(existingLeftButton, 'touch-left', ArenaInput.LEFT);
// At each fixed simulation step:
match.step([input.sample()]);
```

Keyboard: arrows or A/D hold flippers; Space launches; Q/W/E are the current authority's dash/pulse/shield actions. Standard controller: shoulders/triggers hold blades, A launches, X/B/Y select those actions, left stick supplies canonical signed aim with a radial deadzone. These are the present input bindings; complete RPG skills/ultimate remain a separate authority revision and design task.

`setButtons(source, bits)` supports an existing KEEL UI's held control state. `key`, `setPad` and `sample` work without the DOM. Device states combine without releasing another device's held button. A press/release between simulation steps lasts one admitted sample. Held actions remain held so the authority decides rising-edge activation. External held/pending sources have a shared limit of32; keyboard/gamepad reserve their own two bounded source slots. Zero-valued unused sources allocate no state.

Browser attachment excludes text entry and command shortcuts, neutralizes blur/hidden state, and polls only connected standard gamepads. Pointer bindings capture each finger and preserve multi-touch holds until all fingers release. Detach controls when disposing a game. No physical phone or hardware-controller acceptance is claimed by the scoped source tests.

`keyBindings` and `gamepadBindings` optionally replace the corresponding device map. The adapter validates and freezes a copy; `readBindings()` exposes that admitted map for control hints. Default arena bindings remain unchanged.

`createPinballSessionInput({ownerId})` adds the session's separate medicine action: R, standard-controller button8, or `bindActionButton(existingMedkitButton, source)`. `medkitKeys` and `medkitPadButtons` replace those bindings. Conflicting arena/medicine assignments reject. `sample()` returns canonical arena bits plus `actions: SessionAction.MEDKIT` while pressed. Keyboard/pointer taps latch for one sample; holding an action leaves rising-edge admission, inventory and healing to the actual session. Both channels read one controller snapshot per fixed step and share focus/cancellation behavior.

Use `createPinballSessionControlBinding(ownerId)` with the existing real pair resolver when passing these samples into a session. Pair changes suppress stale blades while retaining the separate medicine action. `setActions(source, actions)` supplies admitted0/1 values from an existing control. These adapters neither grant HP nor consume a medkit. This is an engine input API; a product medicine control, hardware-controller and phone acceptance remain pending.

`createPinballControlBinding(ownerId)` maps screen-side press intent through a real native pair. `readPinballInputPair(world, frame, ownerId, project)` reads the body’s current or declared upcoming station and uses the existing renderer’s projection for screen order. A zero lease records an approach; the core exclusively decides ownership and blade actuation, so an early held flipper remains ready when the body arrives. Each press retains its native blade until release through camera yaw. Changing or losing the intended pair suppresses existing holds until release. Launch and equipment remain independent. An edge-on pair supplies both projected sides as `null`: existing presses remain bound, and new ambiguous presses require release. `cancel()` clears bindings and suppresses preceding holds until release. These helpers never write world or authority state.
