// The TypeScript core against the JavaScript proof of concept it was ported
// from (src/core/*.js, imported from its repo, never written to): the same
// outputs, bit for bit, over many seeds and inputs -- including what the
// engine added on top of NOCTURNES (the frame, the resolution helpers, GIF
// tables past 32 colours) and so has no NOCTURNES twin to be checked against.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as tRng from "../src/rng.ts";
import * as tFrame from "../src/frame.ts";
import * as tMath from "../src/math.ts";
import * as tSdf from "../src/sdf.ts";
import * as tPal from "../src/palette.ts";
import * as tDith from "../src/dither.ts";
import * as tQ from "../src/quantize.ts";
import * as tGif from "../src/gif.ts";
import type { Vec3 } from "../src/index.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
const ref = hasPoc
  ? await Promise.all([
    poc<typeof tRng>("src/core/rng.js"), poc<typeof tFrame>("src/core/frame.js"), poc<typeof tMath>("src/core/math.js"), poc<typeof tSdf>("src/core/sdf.js"),
    poc<typeof tPal>("src/core/palette.js"), poc<typeof tDith>("src/core/dither.js"), poc<typeof tQ>("src/core/quantize.js"), poc<typeof tGif>("src/core/gif.js"),
  ])
  : null;
const [jRng, jFrame, jMath, jSdf, jPal, jDith, jQ, jGif] = ref ?? ([] as unknown as NonNullable<typeof ref>);
const { same, exact, summary } = counter();
const SEEDS = hasPoc ? Array.from({ length: 300 }, (_, i) => jRng.seedFromToken(i, "keel-engine")) : [];

test("rng: seeds, derived seeds, rolls and streams", { skip }, () => {
  for (let t = 0; t < 2000; t += 1) same("rng seeds", tRng.seedFromToken(t, "wallrun"), jRng.seedFromToken(t, "wallrun"));
  for (const s of ["0x1", "ABC", "0x0", "f".repeat(64), 123]) same("rng seeds", tRng.normalizeSeed(s), jRng.normalizeSeed(s));
  for (const bad of ["xyz", "0x", "1".repeat(65), null]) {
    assert.throws(() => tRng.normalizeSeed(bad), TypeError);
    assert.throws(() => jRng.normalizeSeed(bad), TypeError);
  }
  assert.throws(() => tRng.seedFromToken(-1), RangeError);
  const items = ["a", "b", "c"];
  const w: tRng.Weighted<string> = [["a", 1], ["b", 2.5], ["c", 0.5]];
  for (const seed of SEEDS) {
    for (const label of ["hat", 7, "entity/dog"]) same("rng seeds", tRng.deriveSeed(seed, label), jRng.deriveSeed(seed, label));
    const a = tRng.createRoll(seed);
    const b = jRng.createRoll(seed);
    for (let slot = 0; slot < 64; slot += 1) {
      exact("rng rolls", a.at(slot * 37), b.at(slot * 37));
      exact("rng rolls", a.index(slot, 13), b.index(slot, 13));
      same("rng rolls", a.weighted(slot, w), b.weighted(slot, w));
      same("rng rolls", a.chance(slot, 1, 3), b.chance(slot, 1, 3));
    }
    const sa = a.sub(3);
    const sb = b.sub(3);
    for (let i = 0; i < 200; i += 1) {
      exact("rng sub-streams", sa.index(10), sb.index(10));
      exact("rng sub-streams", sa.range(-3, 3), sb.range(-3, 3));
      same("rng sub-streams", sa.pick(items), sb.pick(items));
      same("rng sub-streams", sa.chance(40), sb.chance(40));
      same("rng sub-streams", sa.weighted(w), sb.weighted(w));
    }
    const fa = tRng.stream(tRng.createRoll(seed), 11);
    const fb = jRng.stream(jRng.createRoll(seed), 11);
    for (let i = 0; i < 1000; i += 1) {
      exact("rng float streams", fa.f(), fb.f());
      exact("rng float streams", fa.between(0.2, 0.9), fb.between(0.2, 0.9));
      exact("rng float streams", fa.int(-4, 4), fb.int(-4, 4));
      same("rng float streams", fa.pick(items), fb.pick(items));
      same("rng float streams", fa.chance(0.25), fb.chance(0.25));
      same("rng float streams", fa.weighted(w), fb.weighted(w));
    }
  }
});

test("frame: the convention, at random yaws and points", { skip }, () => {
  same("frame", [...tFrame.FRONT, ...tFrame.RIGHT, ...tFrame.UP], [...jFrame.FRONT, ...jFrame.RIGHT, ...jFrame.UP]);
  const r = rand(31);
  const v = (): Vec3 => [r() * 20 - 10, r() * 20 - 10, r() * 20 - 10];
  for (let i = 0; i < 20000; i += 1) {
    const yaw = r() * 20 - 10;
    const [p, q, s] = [v(), v(), v()];
    exact("frame", tFrame.wrapAngle(yaw), jFrame.wrapAngle(yaw));
    same("frame", tFrame.frontOf(yaw), jFrame.frontOf(yaw));
    same("frame", tFrame.rightOf(yaw), jFrame.rightOf(yaw));
    exact("frame", tFrame.yawOf(p), jFrame.yawOf(p));
    exact("frame", tFrame.yawTo(p, q), jFrame.yawTo(p, q));
    same("frame", tFrame.localToWorld(p, yaw, q), jFrame.localToWorld(p, yaw, q));
    same("frame", tFrame.worldToLocal(p, yaw, q), jFrame.worldToLocal(p, yaw, q));
    same("frame", tFrame.cameraBasis(p, i % 50 ? s : [p[0], p[1] + 3, p[2]]), jFrame.cameraBasis(p, i % 50 ? s : [p[0], p[1] + 3, p[2]]));
    const [fw, st] = [r() * 2 - 1, r() * 2 - 1];
    same("frame", tFrame.moveFromView(yaw, fw, st), jFrame.moveFromView(yaw, fw, st));
    exact("frame", tFrame.fromNocturnesYaw(yaw), jFrame.fromNocturnesYaw(yaw));
    exact("frame", tFrame.toNocturnesYaw(yaw), jFrame.toNocturnesYaw(yaw));
  }
  // (Degenerate: a camera looking at itself, and straight down.)
  same("frame", tFrame.cameraBasis([1, 2, 3], [1, 2, 3]), jFrame.cameraBasis([1, 2, 3], [1, 2, 3]));
  same("frame", tFrame.cameraBasis([0, 5, 0], [0, 0, 0]), jFrame.cameraBasis([0, 5, 0], [0, 0, 0]));
});

test("math and sdf: every export at random points", { skip }, () => {
  const r = rand(47);
  const prof = tSdf.profile([[0, 0], [0.4, 0], [0.3, 0.6], [0.1, 1], [0, 1]]);
  const jprof = jSdf.profile([[0, 0], [0.4, 0], [0.3, 0.6], [0.1, 1], [0, 1]]);
  const planes = Float64Array.from([1, 0, 0, 0.5, -1, 0, 0, 0.5, 0, 1, 0, 0.5, 0, -1, 0, 0.5, 0.7, 0.7, 0, 0.6]);
  for (let i = 0; i < 20000; i += 1) {
    const [x, y, z] = [r() * 4 - 2, r() * 4 - 2, r() * 4 - 2];
    const s = Math.floor(r() * 99);
    exact("math", tMath.hash2(x * 50, y * 50, s), jMath.hash2(x * 50, y * 50, s));
    exact("math", tMath.hash3(x * 50, y * 50, z * 50, s), jMath.hash3(x * 50, y * 50, z * 50, s));
    exact("math", tMath.fbm2(x, y, s, 4), jMath.fbm2(x, y, s, 4));
    const t = r();
    exact("math", tMath.loopFbm2(x, y, 2, 1, t, s), jMath.loopFbm2(x, y, 2, 1, t, s));
    exact("math", tMath.wrapNoise2(x * 9, y, 5, s), jMath.wrapNoise2(x * 9, y, 5, s));
    exact("math", tMath.smooth(0, 1, x), jMath.smooth(0, 1, x));
    same("math", tMath.norm([x, y, z]), jMath.norm([x, y, z]));
    same("math", tMath.cross([x, y, z], [z, x, y]), jMath.cross([x, y, z], [z, x, y]));
    exact("sdf", tSdf.sdSphere(x, y, z, 0.7), jSdf.sdSphere(x, y, z, 0.7));
    exact("sdf", tSdf.sdBox(x, y, z, 0.5, 0.3, 0.8, 0.05), jSdf.sdBox(x, y, z, 0.5, 0.3, 0.8, 0.05));
    exact("sdf", tSdf.sdTorus(x, y, z, 0.6, 0.1), jSdf.sdTorus(x, y, z, 0.6, 0.1));
    exact("sdf", tSdf.sdCylinder(x, y, z, 0.4, 0.9, 0.02), jSdf.sdCylinder(x, y, z, 0.4, 0.9, 0.02));
    exact("sdf", tSdf.sdCapsule(x, y, z, 0, 0, 0, 1, 1, 0, 0.2), jSdf.sdCapsule(x, y, z, 0, 0, 0, 1, 1, 0, 0.2));
    exact("sdf", tSdf.sdHexPrism(x, y, z, 0.5, 0.4), jSdf.sdHexPrism(x, y, z, 0.5, 0.4));
    exact("sdf", tSdf.sdEllipsoid(x, y, z, 0.5, 0.9, 0.3), jSdf.sdEllipsoid(x, y, z, 0.5, 0.9, 0.3));
    exact("sdf", tSdf.sdEllipsoid(0, 0, 0, 0.5, 0.9, 0.3), jSdf.sdEllipsoid(0, 0, 0, 0.5, 0.9, 0.3));
    exact("sdf", tSdf.smin(x, y, 0.3), jSdf.smin(x, y, 0.3));
    exact("sdf", tSdf.sdLathe(x, y, z, prof, 0.01), jSdf.sdLathe(x, y, z, jprof, 0.01));
    exact("sdf", tSdf.sdPlanes(x, y, z, planes), jSdf.sdPlanes(x, y, z, planes));
  }
});

test("palette: harmonies and builds for 300 seeds, every scheme forced, and the resolution helpers", { skip }, () => {
  for (const seed of SEEDS) {
    const a = tPal.makePalette(tRng.stream(tRng.createRoll(seed), 0));
    const b = jPal.makePalette(jRng.stream(jRng.createRoll(seed), 0));
    same("palette harmonies", JSON.stringify(a), JSON.stringify(b));
    same("palette builds", JSON.stringify(tPal.buildPalette(a)), JSON.stringify(jPal.buildPalette(b)));
  }
  for (const [k, scheme] of tPal.SCHEME_NAMES.entries()) {
    for (const seed of SEEDS.slice(k * 20, k * 20 + 20)) {
      const force = { scheme, hue: tRng.createRoll(seed).at(5) % 360 };
      const a = tPal.makePalette(tRng.stream(tRng.createRoll(seed), 2), force);
      const b = jPal.makePalette(jRng.stream(jRng.createRoll(seed), 2), force);
      same("palette harmonies", JSON.stringify(a), JSON.stringify(b));
      const pa = tPal.buildPalette(a);
      same("palette builds", JSON.stringify(pa), JSON.stringify(jPal.buildPalette(b)));
      for (const side of [16, 24, 32, 40, 48, 64, 96, 128, 200]) {
        const { base, len } = pa.ramps.key;
        const key = pa.colours.slice(base, base + len);
        same("palette resolution", tPal.rampForTarget(key, side), jPal.rampForTarget(key, side));
        same("palette resolution", tPal.rampForTarget(len, side), jPal.rampForTarget(len, side));
        same("palette resolution", tPal.rampForTarget(pa.ramps.accent, side), jPal.rampForTarget(pa.ramps.accent, side));
        same("palette resolution", tPal.rampIndicesForTarget(len, side), jPal.rampIndicesForTarget(len, side));
        same("palette resolution", tPal.rampBudget(side), jPal.rampBudget(side));
      }
    }
  }
  same("palette", tPal.RAMP_BUDGET, jPal.RAMP_BUDGET);
  same("palette", tPal.SCHEMES.map(([n, w]) => [n, w]), jPal.SCHEMES.map(([n, w]) => [n, w]));
  const r = rand(2);
  for (let i = 0; i < 3000; i += 1) {
    const [L, C, h] = [r(), r() * 0.4, r() * 1000 - 500];
    same("palette oklch", tPal.oklch(L, C, h), jPal.oklch(L, C, h));
    exact("palette oklch", tPal.cmax(L, h), jPal.cmax(L, h));
    same("palette oklch", tPal.hueName(h), jPal.hueName(h));
  }
  for (let i = 0; i < 200; i += 1) {
    const S1 = tRng.stream(tRng.createRoll(SEEDS[i]!), 4);
    const S2 = jRng.stream(jRng.createRoll(SEEDS[i]!), 4);
    exact("palette", tPal.baseHue(S1), jPal.baseHue(S2));
    same("palette", tPal.ramp(S1, [10, 40], { shift: 2 }), jPal.ramp(S2, [10, 40], { shift: 2 }));
    same("palette", tPal.accentRamp(S1, 200), jPal.accentRamp(S2, 200));
  }
});

test("dither: thresholds, screenIndex, geometry, pairing and screens for targets", { skip }, () => {
  same("dither", tDith.SCREEN_IDS, jDith.SCREEN_IDS);
  same("dither", tDith.SCREEN_GEOM, jDith.SCREEN_GEOM);
  same("dither", [tDith.SCREEN_KIND, tDith.SCREEN_PAIRS, tDith.KIND_PAIRS, tDith.TARGET_BANDS, tDith.TARGET_SCREENS, tDith.TARGET_STEPS, tDith.SCREEN_MIN_BAND], [jDith.SCREEN_KIND, jDith.SCREEN_PAIRS, jDith.KIND_PAIRS, jDith.TARGET_BANDS, jDith.TARGET_SCREENS, jDith.TARGET_STEPS, jDith.SCREEN_MIN_BAND]);
  for (const id of tDith.SCREEN_IDS) {
    for (let y = -70; y < 70; y += 1) for (let x = -70; x < 70; x += 1) exact("dither thresholds", tDith.SCREENS[id].at(x, y), jDith.SCREENS[id].at(x, y), `${id} ${x},${y}`);
    same("dither", tDith.measureScreen(tDith.SCREENS[id].at, 28), jDith.measureScreen(jDith.SCREENS[id].at, 28));
    for (const other of tDith.SCREEN_IDS) exact("dither", tDith.screenPair(id, other), jDith.screenPair(id, other));
  }
  const r = rand(8);
  const lums = Float32Array.from({ length: 24 }, (_, i) => Math.sqrt(i / 23));
  for (let i = 0; i < 80000; i += 1) {
    const screen = { id: tDith.SCREEN_IDS[i % 13]!, steps: 2 + (i % 9), bias: i % 3 };
    const [light, x, y, len] = [r() * 1.4 - 0.2, Math.floor(r() * 512) - 128, Math.floor(r() * 512) - 128, 2 + Math.floor(r() * 22)];
    exact("dither screenIndex", tDith.screenIndex(light, x, y, screen, len, i & 1 ? lums.subarray(0, len) : null), jDith.screenIndex(light, x, y, screen, len, i & 1 ? lums.subarray(0, len) : null));
  }
  const prefs = [...Object.keys(tDith.TARGET_SCREENS), ...tDith.SCREEN_IDS];
  for (let w = 8; w <= 520; w += 7) {
    for (const h of [w, Math.floor(w / 2) + 1, w * 2]) {
      same("dither targets", tDith.bandOf(w, h), jDith.bandOf(w, h));
      for (const p of prefs) same("dither targets", tDith.screenForTarget(w, h, p), jDith.screenForTarget(w, h, p));
    }
  }
  assert.throws(() => tDith.screenForTarget(64, 64, "plaid"), RangeError);
});

test("quantize: random buffers, regions and loop times through both quantizers", { skip }, () => {
  same("quantize", [tQ.BAYER4Q, tQ.HALO_SCREEN, tQ.LAYER_KEYS], [jQ.BAYER4Q, jQ.HALO_SCREEN, jQ.LAYER_KEYS]);
  for (const accent of [0, 1, 2, true, false]) for (const share of [undefined, 0, 0.1, 0.5, 0.9, 0.97, 1.2]) exact("quantize", tQ.accentCode({ accent, share }), jQ.accentCode({ accent, share }));
  same("quantize", tQ.makeBuf(7, 5), jQ.makeBuf(7, 5));
  const r = rand(123);
  for (let i = 0; i < 80; i += 1) {
    const seed = SEEDS[i]!;
    const spec = tPal.makePalette(tRng.stream(tRng.createRoll(seed), 0));
    const S = tRng.stream(tRng.createRoll(seed), 6);
    const screens = tQ.LAYER_KEYS.map(() => ({ id: S.pick(tDith.SCREEN_IDS), steps: S.int(2, 8), bias: S.int(0, 2) }));
    const [width, height] = [16 + (i % 5) * 12, 12 + (i % 3) * 20];
    const a = tQ.quantizerFor(spec, screens, width, height);
    const b = jQ.quantizerFor(spec, screens, width, height);
    same("quantize", JSON.stringify(a.pal), JSON.stringify(b.pal));
    same("quantize", [...tQ.lumsOf(a.pal.colours)], [...jQ.lumsOf(b.pal.colours)]);
    same("quantize", tQ.rampsOf(a.pal), jQ.rampsOf(b.pal));
    const buf = tQ.makeBuf(width, height);
    for (let k = 0; k < width * height; k += 1) {
      buf.L[k] = r() * 1.3 - 0.1;
      buf.accent[k] = r() < 0.6 ? 0 : r() < 0.5 ? 1 + Math.floor(r() * 2) : (1 + Math.floor(r() * 2)) | ((1 + Math.floor(r() * 15)) << 2);
      buf.layer[k] = Math.floor(r() * 5);
      buf.halo[k] = r() < 0.1 ? 1 : 0;
      buf.cyc[k] = r() < 0.15 ? 1 : 0;
    }
    for (const t of [0, 0.25, r()]) {
      same("quantize buffers", a.quantize(buf, null, undefined, t), b.quantize(buf, null, undefined, t));
      const region = [1, 2, width - 3, height - 2] as const;
      const base = Uint8Array.from({ length: width * height }, (_, k) => k % 31);
      same("quantize buffers", a.quantize(buf, region, base.slice(), t), b.quantize(buf, region, base.slice(), t));
    }
    // (A custom halo screen.)
    const halo = { id: "stipple", steps: 4, bias: 1 } as const;
    const qa = tQ.createQuantizer({ width, height, screens, ramps: tQ.rampsOf(a.pal), lums: tQ.lumsOf(a.pal.colours), halo });
    const qb = jQ.createQuantizer({ width, height, screens, ramps: jQ.rampsOf(b.pal), lums: jQ.lumsOf(b.pal.colours), halo });
    same("quantize buffers", qa(buf, null, undefined, 0.5), qb(buf, null, undefined, 0.5));
  }
});

test("gif: bytes for random animations, 1..255 colours (the opt-in wide tables included)", { skip }, () => {
  exact("gif", tGif.PALETTE_SIZE, jGif.PALETTE_SIZE);
  exact("gif", tGif.TRANSPARENT, jGif.TRANSPARENT);
  const r = rand(77);
  for (let i = 0; i < 120; i += 1) {
    const colours = i < 40 ? 1 + Math.floor(r() * 32) : 33 + Math.floor(r() * 223);
    const width = 1 + Math.floor(r() * 80);
    const height = 1 + Math.floor(r() * 60);
    const palette = Array.from({ length: colours }, () => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)]);
    const top = colours > 32 ? colours : 31;
    const frames: tGif.GifFrame[] = [];
    let prev = Uint8Array.from({ length: width * height }, () => Math.floor(r() * top));
    for (let f = 0; f < 1 + Math.floor(r() * 7); f += 1) {
      const px = prev.slice();
      const mode = r();
      if (mode < 0.3) for (let k = 0; k < 1 + r() * 40; k += 1) px[Math.floor(r() * px.length)] = Math.floor(r() * top);
      else if (mode < 0.5) px.fill(Math.floor(r() * top));
      else if (mode < 0.8) for (let k = 0; k < px.length; k += 1) px[k] = Math.floor(r() * top);
      frames.push({ pixels: px, delay: Math.floor(r() * 10) });
      prev = px;
    }
    const spec = { width, height, palette, frames, loop: Math.floor(r() * 3), once: r() < 0.2 };
    const a = tGif.encodeGif(spec);
    same(colours > 32 ? "gif wide tables (33-255 colours)" : "gif 32-colour tables", a, jGif.encodeGif(spec));
    // The generator yields the same steps and returns the same bytes.
    const it = tGif.encodeGifSteps(spec);
    const jt = jGif.encodeGifSteps(spec);
    let s = it.next();
    let js = jt.next();
    while (!s.done && !js.done) { exact("gif steps", s.value, js.value); s = it.next(); js = jt.next(); }
    assert.equal(s.done, js.done);
    same("gif steps", s.value, js.value);
  }
  // Long single frames that reset the LZW table, narrow and wide.
  for (const colours of [32, 200]) {
    const big = Uint8Array.from({ length: 200 * 180 }, () => Math.floor(r() * (colours === 32 ? 31 : colours)));
    const palette = Array.from({ length: colours }, (_, k) => [k, 255 - k, (k * 7) & 255]);
    const spec = { width: 200, height: 180, palette, frames: [{ pixels: big, delay: 4 }] };
    same(colours > 32 ? "gif wide tables (33-255 colours)" : "gif 32-colour tables", tGif.encodeGif(spec), jGif.encodeGif(spec));
  }
  // (Past 32 colours the last slot is kept free as the transparent index: 255 colours is the most a table takes.)
  const full = { width: 1, height: 1, palette: new Array(256).fill([0, 0, 0]), frames: [{ pixels: [0], delay: 1 }] };
  assert.throws(() => tGif.encodeGif(full), RangeError);
  assert.throws(() => jGif.encodeGif(full), RangeError);
  assert.throws(() => tGif.encodeGif({ width: 1, height: 1, palette: [[0, 0, 0]], frames: [] }), RangeError);
});

test("summary", { skip }, () => {
  console.log(summary("core vs the proof of concept (all identical)"));
});
