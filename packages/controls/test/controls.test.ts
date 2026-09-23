import assert from "node:assert/strict";
import { test } from "node:test";
import { PAD_GLYPHS, TOUCH_LAYOUTS, classifyDevice, createControls, markDevice, padFamily, rollOf, shapeAnalog, sliderValue, stickValue, tiltValue } from "../src/index.ts";
import type { DeviceSignals, PadState } from "../src/index.ts";

const DESKTOP: DeviceSignals = { touchPoints: 0, coarse: false, anyFine: true, hover: true, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", standalone: false, orientation: false };

test("device: told apart by what it can do, not its screen -- a phone, an iPad posing as a Mac, a touch laptop", () => {
  assert.equal(classifyDevice(DESKTOP).kind, "desktop");
  const iphone = classifyDevice({ ...DESKTOP, touchPoints: 5, coarse: true, anyFine: false, hover: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148", orientation: true });
  assert.deepEqual([iphone.kind, iphone.os, iphone.touchFirst, iphone.tilt], ["phone", "ios", true, true]);
  // (iPadOS asks for the desktop site: a Mac user agent with a touch screen is an iPad.)
  const ipad = classifyDevice({ ...DESKTOP, touchPoints: 5, coarse: true, anyFine: false, hover: false });
  assert.deepEqual([ipad.kind, ipad.os], ["tablet", "ios"]);
  const pixel = classifyDevice({ ...DESKTOP, touchPoints: 5, coarse: true, anyFine: false, hover: false, uaMobile: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36" });
  assert.deepEqual([pixel.kind, pixel.os], ["phone", "android"]);
  const tab = classifyDevice({ ...DESKTOP, touchPoints: 10, coarse: true, anyFine: false, hover: false, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36" });
  assert.equal(tab.kind, "tablet");
  // A Windows laptop with a touch screen: touch, but a mouse is its main pointer.
  const laptop = classifyDevice({ ...DESKTOP, touchPoints: 10, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  assert.deepEqual([laptop.kind, laptop.touch, laptop.touchFirst], ["desktop", true, false]);
  const root = { dataset: {} as Record<string, string | undefined> };
  markDevice(iphone, "touch", root);
  assert.deepEqual(root.dataset, { keelDevice: "phone", keelOs: "ios", keelTouch: "first", keelStandalone: "no", keelInput: "touch" });
});

test("pads: the family printed on the pad, and its glyphs -- the same button 0 is A on Xbox and Cross on PlayStation", () => {
  assert.equal(padFamily("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)"), "xbox");
  assert.equal(padFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), "playstation");
  assert.equal(padFamily("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"), "switch");
  assert.equal(padFamily("Some Pad"), "generic");
  assert.equal(PAD_GLYPHS.xbox.a.label, "A");
  assert.equal(PAD_GLYPHS.playstation.a.label, "✕");
  assert.equal(PAD_GLYPHS.playstation.rt.label, "R2");
});

const pad = (id: string, axes: number[], pressed: Record<number, number> = {}): PadState => ({
  id, connected: true, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ value: pressed[i] ?? 0, pressed: (pressed[i] ?? 0) > 0.5 })),
});
const MAP = {
  steer: { kind: "axis", negKeys: ["KeyA"], keys: ["KeyD"], stick: "lx", negPad: ["left"], pad: ["right"], touch: "steer" },
  gas: { kind: "button", keys: ["KeyW"], pad: ["rt"], touch: "gas" },
  boost: { kind: "button", keys: ["ShiftLeft"], pad: ["x"], touch: "boost" },
} as const;

test("actions: every device folds into one value an action, saying which it was and whether it was digital", () => {
  const c = createControls(MAP);
  c.key("KeyD", true); c.update();
  assert.deepEqual([c.value("steer"), c.digital("steer"), c.state("steer").source, c.source], [1, true, "keyboard", "keyboard"]);
  assert.ok(c.pressed("steer"));
  c.update();
  assert.ok(c.down("steer") && !c.pressed("steer"), "held, not pressed again");
  c.key("KeyD", false);
  // A stick a little over: analog, and the device in use turns to the pad (with its family, for glyphs).
  c.setPads([pad("DualSense (Vendor: 054c)", [-0.45, 0, 0, 0], { 7: 0.8 })]);
  c.update();
  assert.ok(c.value("steer") < -0.3 && !c.digital("steer") && c.state("steer").released);
  assert.ok(Math.abs(c.value("gas") - shapeAnalog(0.8, 0.04)) < 1e-9 && !c.digital("gas"), "a trigger is analog");
  assert.deepEqual([c.source, c.family], ["gamepad", "playstation"]);
  assert.deepEqual(c.glyphs("boost").map((g) => g.label), ["□"]);
  // Touch writes through the virtual controls; the strongest reading wins.
  c.setPads([]);
  c.virtual.set("steer", 0.3, false);
  c.update();
  assert.deepEqual([c.value("steer"), c.state("steer").source, c.source], [0.3, "touch", "touch"]);
  c.key("KeyA", true); c.update();
  assert.deepEqual([c.value("steer"), c.digital("steer")], [-1, true]);
});

test("actions: a touch tap survives until the next update even after its pointer is released", () => {
  const c = createControls(MAP);
  c.virtual.press("gas");
  c.update();
  assert.deepEqual([c.down("gas"), c.pressed("gas"), c.digital("gas"), c.source], [true, true, true, "touch"]);
  c.update();
  assert.deepEqual([c.down("gas"), c.state("gas").released], [false, true]);
});

test("actions: a resting pad's drift doesn't take the prompts off the keyboard; a button press does", () => {
  const c = createControls(MAP), seen: string[] = [];
  c.onSource((s) => seen.push(s));
  c.setPads([pad("Xbox (045e)", [0.08, -0.05, 0, 0])]);
  c.update();
  assert.equal(c.source, "keyboard");
  assert.equal(c.value("steer"), 0, "inside the dead zone");
  c.setPads([pad("Xbox (045e)", [0, 0, 0, 0], { 2: 1 })]);
  c.update();
  assert.deepEqual([c.source, c.family, c.value("boost"), c.digital("boost")], ["gamepad", "xbox", 1, true]);
  assert.deepEqual(seen, ["gamepad"]);
  assert.deepEqual(c.glyphs("boost").map((g) => g.label), ["X"]);
});

test("touch maths: a stick's reach through its dead zone, a tilt from level, a slider's travel", () => {
  assert.deepEqual(stickValue(0, 0, 60), { x: 0, y: 0, knob: { x: 0, y: 0 } });
  const full = stickValue(120, 0, 60);
  assert.deepEqual([full.x, full.knob.x], [1, 60]);
  assert.equal(stickValue(3, 0, 60).x, 0, "inside the dead zone");
  const half = stickValue(0, -36, 60, 0.2);
  assert.ok(Math.abs(half.y - -0.5) < 1e-9);
  assert.equal(tiltValue(1, 0, 28, 2.5), 0);
  assert.equal(tiltValue(40, 0, 28, 2.5), 1);
  assert.ok(tiltValue(-14, 0, 28, 2.5) < -0.4);
  assert.equal(tiltValue(355, 0, 20, 0), -0.25, "round the wrap");
  assert.equal(rollOf(10, 3, 90), 10);
  assert.equal(rollOf(10, 3, 0), 3);
  assert.equal(sliderValue(150, 100, 100), 0.5);
});

test("touch layouts: every racing scheme writes the same ids, so a game binds them once", () => {
  const idsOf = (l: (typeof TOUCH_LAYOUTS)[keyof typeof TOUCH_LAYOUTS]): Set<string> => new Set(l.controls.flatMap((c) => (c.type === "stick" ? [c.x, c.y].filter((x): x is string => !!x) : [c.id])));
  for (const l of [TOUCH_LAYOUTS.RACING_BUTTONS, TOUCH_LAYOUTS.RACING_STICK, TOUCH_LAYOUTS.RACING_TILT, TOUCH_LAYOUTS.RACING_ZONES]) {
    const ids = idsOf(l);
    for (const id of ["steer", "gas", "brake", "boost", "handbrake", "camera"]) assert.ok(ids.has(id), `${l.name} has ${id}`);
  }
});
