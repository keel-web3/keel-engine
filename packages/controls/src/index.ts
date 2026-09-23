// @keel-engine/controls: controllers for any game -- an action map over the keyboard, any gamepad (with the glyphs
// printed on it: Xbox, PlayStation, Switch) and touch; device detection by what a device can do, not its screen size,
// written onto <html> for stylesheets; and on-screen touch schemes (buttons, a virtual stick, tilt, tap zones, a
// throttle lever) built from data and styled and animated by CSS.

export { manifest } from "./module.ts";
export type { ActionSpec, ActionState, Controls, Source, VirtualControls } from "./actions.ts";
export { createControls, shapeAnalog } from "./actions.ts";
export type { Device, DeviceKind, DeviceOs, DeviceSignals, InputKind } from "./device.ts";
export { classifyDevice, detectDevice, markDevice, readSignals } from "./device.ts";
export type { Glyph, PadAxis, PadButton, PadControl, PadFamily, PadState } from "./pads.ts";
export { PAD_AXES, PAD_BUTTONS, PAD_GLYPHS, axisValue, buttonValue, keyGlyph, padFamily } from "./pads.ts";
export type { Anchor, ButtonControl, Rect, SliderControl, StickControl, TiltControl, TouchControl, TouchLayout, ZoneControl } from "./touch/layout.ts";
export { DPAD_BUTTONS, RACING_BUTTONS, RACING_STICK, RACING_TILT, RACING_ZONES, TOUCH_LAYOUTS, TWIN_STICK } from "./touch/layout.ts";
export { rollOf, sliderValue, stickValue, tiltValue } from "./touch/math.ts";
export type { OverlayOptions, TouchOverlay } from "./touch/overlay.ts";
export { createTouchOverlay } from "./touch/overlay.ts";
export { CONTROLS_CSS, injectControlsCss } from "./touch/styles.ts";
