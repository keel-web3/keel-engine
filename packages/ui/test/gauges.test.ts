import assert from "node:assert/strict";
import { test } from "node:test";
import { createBitmap, createUi, dialInto, generateFont, generateTheme, radarInto, rgba, textInto, textWidth } from "../src/index.ts";

const count = (b: { px: Uint32Array }, c: number): number => b.px.reduce((n, p) => n + (p === c ? 1 : 0), 0);
const ON = rgba(255, 180, 60), OFF = rgba(40, 40, 60), RED = rgba(255, 40, 40), NEEDLE = rgba(255, 255, 255);
const style = { from: -2.2, to: 2.2, inner: 20, outer: 26, segments: 0, on: ON, off: OFF, red: RED, needle: NEEDLE, face: 0 };

test("gauges: a dial lights its sweep in proportion, and the stretch past its redline in red", () => {
  const lit = (v: number): number => { const b = createBitmap(64, 64); dialInto(b, 32, 32, v, 0.85, style); return count(b, ON); };
  assert.ok(lit(0) < 5);
  const half = lit(0.5), most = lit(0.8);
  assert.ok(half > 50 && most > half * 1.4, `${half} ${most}`);
  const b = createBitmap(64, 64);
  dialInto(b, 32, 32, 1, 0.85, style);
  assert.ok(count(b, RED) > 20);
});

test("gauges: a radar turns with the player -- a road ahead is drawn above the middle, the route in its colour", () => {
  const b = createBitmap(64, 64), s = { ground: rgba(10, 10, 20), rim: rgba(90, 90, 120), lines: rgba(60, 60, 90), route: rgba(0, 220, 255), player: rgba(255, 255, 255), marker: rgba(255, 80, 80) };
  // Facing +x (yaw pi/2): a road running away along +x is straight up the radar.
  const road = Float32Array.from([0, 0, 100, 0]);
  radarInto(b, 32, 32, 30, { x: 0, z: 0, yaw: Math.PI / 2, reach: 100 }, [], road, [{ x: 50, z: 0 }], s);
  let above = 0, below = 0;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) if (b.px[y * 64 + x] === s.route) { if (y < 28) above += 1; if (y > 36) below += 1; }
  assert.ok(above > 20 && below === 0, `${above} ${below}`);
  // The marker 50 m ahead: half way to the rim, straight up.
  assert.equal(b.px[(32 - 15) * 64 + 32], s.marker);
});

test("gauges: text lands where it's aligned, with its outline round it", () => {
  const font = generateFont(undefined, 7), b = createBitmap(80, 20), ink = rgba(255, 255, 255), out = rgba(0, 0, 0);
  const w = textWidth(font, "LAP 1");
  textInto(b, font, "LAP 1", 40, 4, ink, { outline: out, align: "center" });
  let x0 = 99, x1 = -1;
  for (let y = 0; y < 20; y += 1) for (let x = 0; x < 80; x += 1) if (b.px[y * 80 + x] === ink) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  assert.ok(Math.abs((x0 + x1) / 2 - 40) <= 2 && x1 - x0 <= w, `${x0}..${x1} of ${w}`);
  assert.ok(count(b, out) > count(b, ink));
});

test("ui: a frameless picture (a HUD gauge) paints just its image, where it's anchored", () => {
  const theme = generateTheme({ seed: 1, culture: "clean" });
  const ui = createUi({ theme, width: 320, height: 180, scale: 1 });
  const pic = createBitmap(8, 8);
  pic.px.fill(rgba(255, 0, 0));
  ui.load({ screen: "t", root: { type: "root", id: "r", dir: "free", w: "fill", h: "fill", children: [{ type: "image", id: "g", anchor: "br", x: 0, y: 0, w: 8, h: 8, frame: "none" }] } });
  ui.set("g", { image: pic });
  ui.render();
  assert.equal(ui.layer.px[(179) * ui.layer.w + 319], rgba(255, 0, 0));
  assert.equal(ui.layer.px[0], 0);
});

test("ui: a scale given as a function of the screen is asked again on every resize", () => {
  const ui = createUi({ theme: generateTheme({ seed: "scale" }), width: 1920, height: 1080, scale: (w, h) => Math.floor(Math.min(w / 480, h / 270)) });
  assert.equal(ui.scale, 4);
  ui.resize(2560, 1440);
  assert.equal(ui.scale, 5);
  ui.resize(960, 540);
  assert.equal(ui.scale, 2);
});
