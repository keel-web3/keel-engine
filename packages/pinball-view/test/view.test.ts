import assert from "node:assert/strict";
import test from "node:test";
import { createPinballView } from "../src/view.ts";
import type { PinballViewMap, PinballViewSnapshot } from "../src/types.ts";

type Call = { name: string; args: unknown[]; font: string };
function fixtureCanvas() {
  const calls: Call[] = [];
  let caches = 0;
  const context = new Proxy<Record<string, unknown>>({}, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args, font: String(target.font ?? "") });
        if (key.startsWith("create") && key.endsWith("Gradient")) return { addColorStop() {} };
        if (key === "measureText") return { width: String(args[0]).length * Number(String(target.font).match(/([\d.]+)px/)?.[1] ?? 10) * 0.55 };
        if (key === "getImageData") {
          const width = args[2] as number, height = args[3] as number;
          return { width, height, data: new Uint8ClampedArray(width * height * 4) };
        }
        return undefined;
      };
    },
    set(target, key, value) { target[String(key)] = value; return true; },
  });
  const fake = {
    width: 600, height: 1000, clientWidth: 360, clientHeight: 640,
    getContext: () => context,
    ownerDocument: { createElement: () => { caches++; return { width: 1, height: 1, getContext: () => context }; } },
  };
  return { canvas: fake as unknown as HTMLCanvasElement, calls, cacheCount: () => caches };
}

const map: PinballViewMap = Object.freeze({
  width: 600, height: 1000, ballRadius: 9, drainY: 950,
  segments: Object.freeze([Object.freeze({ id: "rail", ax: 42, ay: 210, bx: 52, by: 790 })]),
  bumpers: Object.freeze([Object.freeze({ id: "coil-a", x: 242, y: 300, radius: 30 })]),
  flippers: Object.freeze([Object.freeze({ id: "left", pivotX: 200, pivotY: 846, length: 88, radius: 7, restAngle: 25, activeAngle: -28, side: "left" as const })]),
});
const snapshot: PinballViewSnapshot = Object.freeze({
  tick: 20, phase: "playing", score: 100,
  balls: Object.freeze([Object.freeze({ id: "ball-1", x: 288, y: 780, radius: 9, layer: 0, ownerId: 0, active: true })]),
  flippers: Object.freeze([Object.freeze({ id: "left", angle: -15, pivotX: 200, pivotY: 846, tipX: 285, tipY: 823, radius: 7 })]),
});

test("render uses canonical ball/coil radii and the current physics flipper tip", () => {
  const fixture = fixtureCanvas();
  const view = createPinballView(fixture.canvas);
  view.render(map, snapshot, { timeMs: 10 });
  const has = (name: string, args: number[]) => fixture.calls.some(call => call.name === name && args.every((value, index) => call.args[index] === value));
  assert.ok(has("arc", [242, 300, 30]));
  assert.ok(has("arc", [288, 780, 9]));
  assert.ok(has("moveTo", [42, 210]));
  assert.ok(has("lineTo", [52, 790]));
  assert.ok(has("moveTo", [200, 846]));
  assert.ok(has("lineTo", [285, 823]));
  assert.ok(!has("lineTo", [200 + Math.cos(25 * Math.PI / 180) * 88, 846 + Math.sin(25 * Math.PI / 180) * 88]));
  assert.equal(map.bumpers[0]?.radius, 30);
  assert.equal(snapshot.balls[0]?.radius, 9);
});

test("immutable table layers cache once and resize invalidates the cache", () => {
  const fixture = fixtureCanvas();
  const view = createPinballView(fixture.canvas);
  view.render(map, snapshot, { timeMs: 10 });
  const count = fixture.cacheCount();
  view.render(map, { ...snapshot, tick: 21 }, { timeMs: 20 });
  assert.equal(fixture.cacheCount(), count);
  assert.equal(view.getStats().cachedLayers, 1);
  view.resize(400, 700, 3); view.render(map, snapshot, { timeMs: 30 });
  assert.equal(fixture.canvas.width, 800); // pixel ratio cap is two
  assert.equal(fixture.cacheCount(), count + 2);
  view.dispose();
  assert.equal(view.getStats().cachedLayers, 0);
  assert.throws(() => view.render(map, snapshot, { timeMs: 40 }), /disposed/);
});

test("a ready inactive ball remains visible and reduced motion has no trail", () => {
  const fixture = fixtureCanvas();
  const view = createPinballView(fixture.canvas, { reducedMotion: true, finish: "gold" });
  view.render(map, { ...snapshot, phase: "ready", balls: [{ ...snapshot.balls[0]!, active: false }] }, { timeMs: 10 });
  assert.ok(fixture.calls.some(call => call.name === "arc" && call.args[0] === 288 && call.args[1] === 780 && call.args[2] === 9));
  assert.equal(view.getStats().trailBalls, 0);
});

test("pixel and dither use bounded real buffers and keep the cabinet text after raster processing", () => {
  for (const style of ["pixel", "dither"] as const) {
    const fixture = fixtureCanvas();
    const view = createPinballView(fixture.canvas, { style, theme: "cyberpunk" });
    view.resize(1170, 2532, 3); view.render(map, snapshot, { timeMs: 0 });
    const stats = view.getStats();
    assert.ok(stats.renderPixels < stats.backingPixels / 4);
    if (style === "dither") {
      assert.ok(stats.renderPixels <= 130_000);
      const ditherIndex = fixture.calls.findIndex(call => call.name === "putImageData");
      const scoreIndex = fixture.calls.findIndex(call => call.name === "fillText" && call.args[0] === "100");
      assert.ok(ditherIndex >= 0 && scoreIndex > ditherIndex);
    }
    view.dispose();
  }
});

test("all 25 theme/style combinations consume the same immutable physics frame", () => {
  for (const theme of ["nightshift", "cyberpunk", "vaporwave", "gold", "nature"] as const) {
    for (const style of ["pixel", "dither", "arcade", "realistic", "cartoon"] as const) {
      const fixture = fixtureCanvas();
      const view = createPinballView(fixture.canvas, { theme, style });
      view.render(map, snapshot, { timeMs: 10 });
      assert.ok(fixture.calls.some(call => call.name === "arc" && call.args[0] === 288 && call.args[1] === 780 && call.args[2] === 9));
      assert.ok(fixture.calls.some(call => call.name === "lineTo" && call.args[0] === 285 && call.args[1] === 823));
      assert.ok(view.getStats().leaves <= 36);
      view.dispose();
    }
  }
  assert.equal(snapshot.balls[0]?.x, 288);
  assert.equal(snapshot.flippers[0]?.tipX, 285);
});

test("short landscape cabinets keep readable score/credits on one row and restore the objective in portrait", () => {
  const hudMap = { ...map, presentation: { scoreDisplay: { x: 85, y: 10, width: 430, height: 58 } } };
  for (const style of ["pixel", "dither", "arcade", "realistic", "cartoon"] as const) {
    const fixture = fixtureCanvas(), view = createPinballView(fixture.canvas, { style });
    view.resize(615, 328, 1); view.render(hudMap, snapshot, { timeMs: 0 });
    const landscapeText = fixture.calls.filter(call => call.name === "fillText");
    assert.ok(!landscapeText.some(call => call.args[0] === "HIT THE THREE COILS"));
    const score = landscapeText.find(call => call.args[0] === "100")!;
    const credits = landscapeText.find(call => String(call.args[0]).startsWith("BALL "))!;
    assert.ok(score && credits);
    assert.equal(score.args[2], credits.args[2]);
    const scale = (328 - 13.12) / 1000;
    assert.ok(Number(score.font.match(/([\d.]+)px/)?.[1]) * scale >= 12);
    fixture.calls.length = 0;
    view.resize(368, 584, 1); view.render(hudMap, snapshot, { timeMs: 40 });
    assert.ok(fixture.calls.some(call => call.name === "fillText" && call.args[0] === "HIT THE THREE COILS"));
    view.dispose();
  }
});

test("host status and canonical objective lights stay in the same HUD and collider footprint", () => {
  const fixture = fixtureCanvas(), view = createPinballView(fixture.canvas);
  const hudMap = { ...map, presentation: { scoreDisplay: { x: 85, y: 10, width: 430, height: 58 } } };
  view.render(hudMap, snapshot, { timeMs: 0 });
  fixture.calls.length = 0;
  const live = Object.freeze({ ...snapshot, tick: 21, statusLabel: "HP 4/6 · STAGE 2", activeIndicatorIds: Object.freeze(["coil-a"]) });
  view.render(hudMap, live, { timeMs: 20 });
  assert.ok(fixture.calls.some(call => call.name === "fillText" && call.args[0] === live.statusLabel));
  assert.ok(!fixture.calls.some(call => call.name === "fillText" && String(call.args[0]).startsWith("BALL ")));
  assert.equal(fixture.calls.filter(call => call.name === "arc" && call.args[0] === 242 && call.args[1] === 300 && call.args[2] === 30 * 0.72).length, 1);
  assert.equal(map.bumpers[0]?.radius, 30);
  view.dispose();
});

test("bank targets and kickers retain their canonical circular faces in every style", () => {
  const richer = Object.freeze({ ...map, bumpers: Object.freeze([
    ...map.bumpers,
    Object.freeze({ id: "target-bank-2", x: 161, y: 535, radius: 11, points: 400 }),
    Object.freeze({ id: "kicker-right", x: 416, y: 636, radius: 14, points: 50 }),
  ]) });
  for (const style of ["pixel", "dither", "arcade", "realistic", "cartoon"] as const) {
    const fixture = fixtureCanvas(), view = createPinballView(fixture.canvas, { style });
    view.render(richer, snapshot, { timeMs: 0 });
    for (const [x, y, radius] of [[161, 535, 11], [416, 636, 14]]) {
      assert.ok(fixture.calls.some(call => call.name === "arc" && call.args[0] === x && call.args[1] === y && call.args[2] === radius));
    }
    assert.ok(fixture.calls.some(call => call.name === "fillText" && call.args[0] === "2" && call.args[1] === 161));
    assert.equal(view.getStats().cachedLayers, 1); view.dispose();
  }
});

test("guardian telegraph reads canonical health and countdown behind the real ball", () => {
  const fixture = fixtureCanvas(), view = createPinballView(fixture.canvas);
  const guardian = Object.freeze({ ...snapshot, encounter: "guardian" as const, bossHealth: 4, maxBossHealth: 8, bossPhase: 2 as const, hazardWarning: true, hazardCountdown: 30 });
  const before = JSON.stringify(guardian);
  view.render(map, guardian, { timeMs: 10 });
  const emblem = fixture.calls.findIndex(c => c.name === "fillText" && c.args[0] === "GUARDIAN / PHASE 2");
  const ball = fixture.calls.findIndex(c => c.name === "arc" && c.args[0] === 288 && c.args[1] === 780 && c.args[2] === 9);
  assert.ok(emblem >= 0 && ball > emblem);
  assert.ok(fixture.calls.some(c => c.name === "fillRect" && c.args[0] === 240 && c.args[1] === 664 && c.args[2] === 60 && c.args[3] === 4));
  assert.equal(JSON.stringify(guardian), before);
  assert.equal(view.getStats().particles, 0);
});
