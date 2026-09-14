import { test } from "node:test";
import assert from "node:assert/strict";
import { entityOf } from "@keel-engine/entity";
import type { AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import {
  atlasOf, bakeCamera, bakeSize, bakeSprites, createSpriteCache, decodeBake, encodeBake, entityDesign, frameOf, keyColourFor, planBake, renderSprites, thinned, trimSprite,
} from "../src/index.ts";
import type { BakedSprite, BakeRenderer, BakeSource, BakeWorld, SpriteJob } from "../src/index.ts";

const rng = (seed: number) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// A synthetic sprite whose pixels come from its key: what a bake would make, without a GPU.
function fakeSprite(key: string, w: number, h: number): BakedSprite {
  let a = 0; for (let i = 0; i < key.length; i += 1) a = Math.imul(a ^ key.charCodeAt(i), 0x01000193) >>> 0;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) { a = Math.imul(a ^ i, 0x01000193) >>> 0; if (a & 1) { rgba[i * 4] = a >>> 24; rgba[i * 4 + 1] = (a >>> 16) & 255; rgba[i * 4 + 2] = (a >>> 8) & 255; rgba[i * 4 + 3] = 255; } }
  return { key, w, h, ax: w >> 1, ay: h - 2, rgba };
}

const designs = [
  { key: "packs/animals:animal/dog#7", clips: [{ name: "walk", frames: 8 }, { name: "idle", frames: 6 }], height: 0.7, radius: 0.5 },
  { key: "packs/people:anthro/fox#3+beanie", clips: [{ name: "run", frames: 8 }], height: 1.1, radius: 0.4 },
];

test("plan -> atlas: the same plan makes the same atlas, whatever order the sprites were baked in", () => {
  const plan = planBake(designs, { directions: 8, pixelsPerMetre: 24, pitch: 0.6, style: "s4" });
  const f = rng(9);
  const sprites = plan.sprites.map((j) => fakeSprite(j.key, 4 + Math.floor(f() * (j.w - 4)), 4 + Math.floor(f() * (j.h - 4))));
  const shuffled = sprites.slice().sort(() => f() - 0.5);
  const a = atlasOf(sprites, { size: 128 });
  const b = atlasOf(shuffled, { size: 128 });
  assert.deepEqual([...a.sprites], [...b.sprites]);
  assert.deepEqual(a.pages, b.pages);
  assert.ok(a.pages.length > 1, "a small page size opens several pages");
  // Every sprite's pixels are where its rect says.
  for (const s of sprites) {
    const r = a.sprites.get(s.key)!;
    const p = a.pages[r.page]!;
    assert.equal(r.w, s.w); assert.equal(r.h, s.h); assert.equal(r.ax, s.ax); assert.equal(r.ay, s.ay);
    for (let y = 0; y < s.h; y += 1) assert.deepEqual(p.rgba.subarray(((r.y + y) * p.width + r.x) * 4, ((r.y + y) * p.width + r.x + s.w) * 4), s.rgba.subarray(y * s.w * 4, (y + 1) * s.w * 4));
  }
  // Jobs carry what they were planned for.
  assert.ok(plan.sprites.every((j) => j.pixelsPerMetre === 24 && j.pitch === 0.6 && j.style === "s4"));
});

test("trimming: the tight box, the anchor carried into it, the background clear; bottom-first rows as GL reads them", () => {
  const key = 0xff00ff;
  const W = 20, H = 16, SW = 40; // (a picture at (7, 3) in a 40-wide buffer)
  const buf = new Uint8Array(SW * 30 * 4);
  for (let i = 0; i < buf.length; i += 4) { buf[i] = 255; buf[i + 1] = 0; buf[i + 2] = 255; buf[i + 3] = 255; }
  // Paint top-down picture pixels (x, y) into the bottom-first buffer.
  const paint = (x: number, y: number, c: number) => { const o = ((3 + H - 1 - y) * SW + 7 + x) * 4; buf[o] = c; buf[o + 1] = c; buf[o + 2] = c; };
  paint(5, 4, 10); paint(12, 4, 20); paint(8, 13, 30); paint(9, 9, 40);
  const s = trimSprite("k", buf, SW, 7, 3, W, H, key, 10, 14);
  assert.equal(s.w, 8); assert.equal(s.h, 10);
  assert.equal(s.ax, 5); assert.equal(s.ay, 10);
  const at = (x: number, y: number) => Array.from(s.rgba.subarray((y * s.w + x) * 4, (y * s.w + x) * 4 + 4));
  assert.deepEqual(at(0, 0), [10, 10, 10, 255]);
  assert.deepEqual(at(7, 0), [20, 20, 20, 255]);
  assert.deepEqual(at(3, 9), [30, 30, 30, 255]);
  assert.deepEqual(at(4, 5), [40, 40, 40, 255]);
  assert.deepEqual(at(1, 1), [0, 0, 0, 0], "background is clear");
  assert.equal(s.rgba.filter((_, i) => i % 4 === 3 && s.rgba[i] === 255).length, 4);
  // The same picture stored top-down trims the same.
  const td = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) td.set(buf.subarray(((3 + H - 1 - y) * SW + 7) * 4, ((3 + H - 1 - y) * SW + 7 + W) * 4), y * W * 4);
  assert.deepEqual(trimSprite("k", td, W, 0, 0, W, H, key, 10, 14, true), s);
  // Nothing there: one clear pixel, anchored where the origin was.
  const empty = trimSprite("e", new Uint8Array(W * H * 4).map((_, i) => (i % 4 === 1 ? 0 : 255)), W, 0, 0, W, H, key, 10, 14, true);
  assert.deepEqual([empty.w, empty.h, empty.ax, empty.ay], [1, 1, 10, 14]);
});

test("the key colour is in no ramp", () => {
  const cols = [[255, 0, 255], [254, 2, 2], [1, 2, 3]];
  const k = keyColourFor(cols);
  assert.ok(!cols.some((c) => ((c[0]! << 16) | (c[1]! << 8) | c[2]!) === k));
  assert.equal(keyColourFor([[0, 0, 0]]), 0xff00ff);
});

// Perspective projection as the raymarcher does it: world -> continuous picture pixels, y down.
function project(cam: ReturnType<typeof bakeCamera>, p: readonly number[]): [number, number] {
  const f = [cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]];
  const fl = Math.hypot(f[0]!, f[1]!, f[2]!); const F = f.map((v) => v / fl);
  const rl = Math.hypot(F[2]!, F[0]!); const R = [F[2]! / rl, 0, -F[0]! / rl];
  const U = [F[1]! * R[2]! - F[2]! * R[1]!, F[2]! * R[0]! - F[0]! * R[2]!, F[0]! * R[1]! - F[1]! * R[0]!];
  const d = [p[0]! - cam.eye[0], p[1]! - cam.eye[1], p[2]! - cam.eye[2]];
  const z = d[0]! * F[0]! + d[1]! * F[1]! + d[2]! * F[2]!;
  const tan = Math.tan(cam.fov / 2), aspect = cam.width / cam.height;
  const ux = (d[0]! * R[0]! + d[1]! * R[1]! + d[2]! * R[2]!) / z / (tan * aspect);
  const uy = (d[0]! * U[0]! + d[1]! * U[1]! + d[2]! * U[2]!) / z / tan;
  return [(ux + 1) / 2 * cam.width, cam.height - (uy + 1) / 2 * cam.height];
}

test("the bake camera: the origin lands on its pixel corner, the design's box inside the picture, direction 0 sees the front", () => {
  const plan = planBake([{ key: "d", clips: [{ name: "c", frames: 1 }], height: 1.7, radius: 0.6 }], { directions: 16, pixelsPerMetre: 32, pitch: 0.7 });
  for (const job of plan.sprites) {
    const cam = bakeCamera(job);
    assert.equal(cam.width % 2, 0);
    const [ox, oy] = project(cam, [0, 0, 0]);
    assert.ok(Math.abs(ox - cam.ox) < 1e-6 && Math.abs(oy - cam.oy) < 1e-6, `origin at ${ox},${oy} not ${cam.ox},${cam.oy}`);
    // The design's bounding cylinder, all inside the picture.
    for (let a = 0; a < 16; a += 1) for (const y of [0, 1.7]) {
      const [x, yy] = project(cam, [Math.sin(a) * 0.6, y, Math.cos(a) * 0.6]);
      assert.ok(x >= 0 && x <= cam.width && yy >= 0 && yy <= cam.height, `(${x.toFixed(1)}, ${yy.toFixed(1)}) outside ${cam.width}x${cam.height}`);
    }
    // Scale on the picture plane through the origin: a metre up the screen is k pixels.
    const up = project(cam, [0, 1, 0]);
    assert.ok(Math.abs((oy - up[1]) - 32 * Math.cos(0.7)) < 32 * 0.03, "pixels per metre (within the stand-in's perspective)");
  }
  const front = bakeCamera(plan.sprites[0]!);
  assert.ok(front.eye[2] > 0, "direction 0: the camera is in front of the design (+z)");
  const quarter = bakeCamera(plan.sprites[4]!); // (a quarter turn: the design shows its side)
  assert.ok(Math.abs(quarter.eye[0]) > Math.abs(quarter.eye[2]));
  assert.equal(thinned({ capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: 0.1 }] }, 0.03).capsules![0]!.r.toFixed(3), "0.070");
});

// A software stand-in for the pixel renderer and the few GL calls the baker makes: it "renders" a design's
// capsule ends as pixels through the same perspective, over the key -- enough to prove staging, flushing, trimming and anchors.
function softRenderer() {
  interface Tex { w: number; h: number; data: Uint8Array }
  let W = 8, H = 8, screen = new Uint8Array(W * H * 4);
  let palette: number[][] = [];
  let world: BakeWorld = {};
  const bound: { tex: Tex | null; fb: { tex: Tex | null } | null } = { tex: null, fb: null };
  const gl = {
    TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, RGBA8: 0x8058, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, FRAMEBUFFER: 0x8d40, READ_FRAMEBUFFER: 0x8ca8, COLOR_ATTACHMENT0: 0x8ce0, MAX_TEXTURE_SIZE: 0x0d33, ACTIVE_TEXTURE: 0x84e0,
    getParameter: (p: number) => (p === 0x0d33 ? 4096 : 0x84c0),
    activeTexture() {}, createTexture: (): Tex => ({ w: 0, h: 0, data: new Uint8Array(0) }), bindTexture: (_t: number, t: Tex) => { bound.tex = t; },
    texStorage2D(_t: number, _l: number, _f: number, w: number, h: number) { bound.tex!.w = w; bound.tex!.h = h; bound.tex!.data = new Uint8Array(w * h * 4); },
    createFramebuffer: () => ({ tex: null as Tex | null }),
    bindFramebuffer(target: number, fb: { tex: Tex | null } | null) { if (target !== 0x8ca8) bound.fb = fb; else if (fb) bound.fb = fb; else bound.fb = null; },
    framebufferTexture2D(_t: number, _a: number, _tt: number, tex: Tex) { bound.fb!.tex = tex; },
    copyTexSubImage2D(_t: number, _l: number, xo: number, yo: number, x: number, y: number, w: number, h: number) {
      const t = bound.tex!;
      for (let r = 0; r < h; r += 1) t.data.set(screen.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), ((yo + r) * t.w + xo) * 4);
    },
    readPixels(x: number, y: number, w: number, h: number, _f: number, _ty: number, out: Uint8Array) {
      const t = bound.fb!.tex!;
      for (let r = 0; r < h; r += 1) out.set(t.data.subarray(((y + r) * t.w + x) * 4, ((y + r) * t.w + x + w) * 4), r * w * 4);
    },
    deleteFramebuffer() {}, deleteTexture() {},
  };
  let renders = 0;
  const r: BakeRenderer & { readonly renders: number } = {
    gl: gl as unknown as WebGL2RenderingContext,
    get renders() { return renders; },
    setTarget(w, h) { W = w; H = h; screen = new Uint8Array(W * H * 4); },
    setPalette(colours) { palette = colours.map((c) => [c[0]!, c[1]!, c[2]!]); },
    setMaterials() {}, setStyle() {},
    setWorld(w) { world = w as BakeWorld; return { dropped: 0 }; },
    render(o) {
      renders += 1;
      const key = palette[palette.length - 1]!;
      for (let i = 0; i < W * H; i += 1) screen.set([key[0]!, key[1]!, key[2]!, 255], i * 4);
      const cam = { eye: o.eye, target: o.target, fov: o.fov!, width: W, height: H } as ReturnType<typeof bakeCamera>;
      for (const c of world.capsules ?? []) {
        const [x, y] = project(cam, [c.a[0]!, c.a[1]!, c.a[2]!]);
        const px = Math.floor(x), py = Math.floor(y);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const col = palette[(c.mat ?? 0) % (palette.length - 1)]!;
        screen.set([col[0]!, col[1]!, col[2]!, 255], ((H - 1 - py) * W + px) * 4); // (GL: bottom row first)
      }
    },
  };
  return r;
}

test("renderSprites: staged renders, read back when the staging fills, trimmed and anchored true", () => {
  // A design of three points: the ground under the origin... a head a metre up... a hand to the right.
  const src: BakeSource = {
    palette: { colours: [[200, 10, 10], [10, 200, 10], [10, 10, 200]], ramps: { a: [0, 3] } },
    materials: [{ ramp: "a" }],
    pose: (_clip, frame) => ({ capsules: [{ a: [0, 0.02, 0], b: [0, 0.02, 0], r: 0.1, mat: 0 }, { a: [0, 1, 0], b: [0, 1, 0], r: 0.1, mat: 1 }, { a: [0.3 + frame * 0.05, 0.5, 0], b: [0.3, 0.5, 0], r: 0.1, mat: 2 }] }),
  };
  const plan = planBake([{ key: "dot", clips: [{ name: "c", frames: 3 }], height: 1.2, radius: 0.5 }], { directions: 8, pixelsPerMetre: 20, pitch: 0.6 });
  const small = renderSprites(softRenderer(), plan.sprites, new Map([["dot", src]]), { staging: 64, distance: 80 });
  const big = renderSprites(softRenderer(), plan.sprites, () => src, { staging: 2048, distance: 80 });
  assert.equal(small.baked.length, 24);
  assert.deepEqual(small.baked, big.baked, "the staging's size changes nothing");
  for (const s of small.baked) {
    const job = plan.sprites.find((j) => j.key === s.key)!;
    // The foot point is right at the anchor (a pixel above it, from 2 cm up): the sprite stands where the unit is.
    const opaque: Array<[number, number, number]> = [];
    for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 1) if (s.rgba[(y * s.w + x) * 4 + 3]) opaque.push([x, y, s.rgba[(y * s.w + x) * 4]!]);
    const foot = opaque.find((p) => p[2] === 200)!;
    assert.ok(foot && Math.abs(foot[0] - s.ax) <= 1 && Math.abs(foot[1] - (s.ay - 1)) <= 1, `${job.key}: foot ${foot?.[0]},${foot?.[1]} vs anchor ${s.ax},${s.ay}`);
    const head = opaque.find((p) => p[2] === 10 && p[0] >= 0)!;
    assert.ok(Math.abs(head[0] - s.ax) <= 1 && Math.abs((s.ay - head[1]) - 20 * Math.cos(0.6)) <= 1.5, "a metre up is k cos(pitch) pixels up");
  }
  const result = bakeSprites(softRenderer(), plan.sprites, () => src, { staging: 64, distance: 80 });
  assert.equal(result.sprites.size, 24);
  assert.ok(result.stats.sprites === 24 && result.stats.designs === 1 && result.stats.rendered >= result.stats.kept);
});

test("the cache: missing jobs, and a round trip through the saved form and bytes", () => {
  const plan = planBake(designs, { directions: 8, pixelsPerMetre: 16 });
  const f = rng(4);
  const cache = createSpriteCache();
  const half = plan.sprites.slice(0, 50);
  cache.add(half.map((j) => fakeSprite(j.key, 3 + Math.floor(f() * 12), 3 + Math.floor(f() * 20))));
  assert.equal(cache.missing(plan.sprites).length, plan.sprites.length - 50);
  cache.add(cache.missing(plan.sprites).map((j) => fakeSprite(j.key, 3 + Math.floor(f() * 12), 3 + Math.floor(f() * 20))));
  assert.equal(cache.missing(plan.sprites).length, 0);
  const saved = cache.save(undefined, { size: 128 });
  const bytes = encodeBake(saved);
  const back = createSpriteCache();
  assert.equal(back.load(decodeBake(bytes)), plan.sprites.length);
  assert.equal(back.bytes, cache.bytes);
  for (const j of plan.sprites) assert.deepEqual(back.get(j.key), cache.get(j.key));
  assert.deepEqual(back.atlas(), cache.atlas(), "same sprites, same atlas");
  assert.throws(() => decodeBake(bytes.subarray(0, bytes.length - 5)), /cut short/);
  assert.equal(back.drop((k) => k.startsWith("packs/animals")), plan.perDesign.get(designs[0]!.key));
});

const beanie = defineAttribute<AttributeShape>({
  id: "beanie", slot: "head", targets: [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1" }],
  build: (S, fit, pins) => ({ capsules: [{ a: [0, 0, 0], b: [0, fit.size[1] * (Number(pins["tall"] ?? 0.6) + S.f() * 0.2), 0], r: fit.size[0] * 0.4, role: "accent" }] }),
});
const pack = defineAttribute<AttributeShape>({
  id: "pack", slot: "back", targets: [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1" }],
  build: (_S, fit) => ({ boxes: [{ c: [0, 0, fit.size[2] * 0.3], h: [fit.size[0] * 0.4, fit.size[1] * 0.4, fit.size[2] * 0.3], role: "cloth" }] }),
});

test("entity designs: keys stable, and distinct across seeds, pins, attributes and their pins", () => {
  const make = (seed: string, pins: Record<string, unknown> = {}, attributes: Parameters<typeof entityDesign>[1] extends infer O ? O extends { attributes?: infer A } ? A : never : never = []) =>
    entityDesign(entityOf(seed, { kind: "anthro", species: "fox", pins }), { attributes, pack: "packs/people" });
  const a = make("42");
  assert.equal(make("42").key, a.key, "stable");
  assert.ok(a.key.startsWith("packs/people:anthro/fox#42~"));
  const keys = [
    a.key, make("43").key, make("42", { top: "jacket" }).key, make("42", { hood: false, top: "hoodie" }).key,
    make("42", {}, [beanie]).key, make("42", {}, [{ def: beanie, pins: { tall: 1 } }]).key, make("42", {}, [beanie, pack]).key, make("42", {}, [pack, beanie]).key,
    entityDesign(entityOf("42", { kind: "animal", species: "dog" })).key, entityDesign(entityOf("42", { kind: "anthro", species: "fox" }), { clips: [{ name: "walk", frames: 6 }] }).key,
  ];
  assert.equal(new Set(keys).size, keys.length, keys.join("\n"));
  assert.equal(make("42", {}, [beanie, pack]).key, make("42", {}, [beanie, pack]).key);
});

test("entity designs: sized over every frame, posed at the origin facing +z, dressed, clips that play by distance", () => {
  for (const kind of ["humanoid", "anthro", "animal"] as const) for (const seed of ["1", "2", "3", "4"]) {
    const d = entityDesign(entityOf(seed, { kind }), { attributes: [beanie, pack] });
    const quad = d.spec.plan === "quadruped";
    assert.deepEqual(d.clips.map((c) => c.name), quad ? ["idle", "walk", "trot", "gallop"] : ["idle", "walk", "run"]);
    assert.ok(d.height > 0.15 && d.radius > 0.05, `${kind} ${seed}: ${d.height} ${d.radius}`);
    for (const c of d.clips) {
      assert.ok(c.frames >= 6 && c.frames <= 8);
      const info = d.clip(c.name);
      if (c.name === "idle") assert.equal(info.cycle, 0); else assert.ok(info.cycle > 0 && info.speed > 0 && info.period > 0);
      for (let f = 0; f < c.frames; f += 1) {
        const w = d.pose(c.name, f);
        assert.ok(w.capsules!.length > 8);
        for (const k of w.capsules!) assert.ok(k.a[1]! + k.r <= d.height + 1e-9 && Math.hypot(k.a[0]!, k.a[2]!) + k.r <= d.radius + 1e-9);
        // Its nose (or face) is ahead: +z.
        const face = d.capsules(c.name, f).filter((k) => k.part === "nose" || k.part === "snout" || k.part.startsWith("eye."));
        assert.ok(face.length && face.every((k) => k.a[2] > 0), `${kind} ${seed} ${c.name}: the face is on +z`);
      }
    }
    assert.ok(d.capsules("idle", 0).some((k) => k.part === "attribute" && k.mat === 8), "the beanie, in the accent's material");
    assert.ok((d.pose("idle", 0).boxes ?? []).length === 1, "the pack, a box");
    // Frames advance by distance: a cycle's distance is a full cycle of frames.
    const walk = d.clip("walk");
    assert.equal(frameOf(walk, 0, 0), 0);
    assert.equal(frameOf(walk, walk.cycle * (3.5 / walk.frames), 0), 3);
    assert.equal(frameOf(walk, walk.cycle * 7 + walk.cycle * (7.5 / walk.frames), 99), 7);
  }
});

test("planBake takes entity designs as they are", () => {
  const ds = ["5", "6"].map((s) => entityDesign(entityOf(s, { kind: "anthro" })));
  const plan = planBake(ds, { directions: 8, pixelsPerMetre: 24 });
  assert.equal(plan.sprites.length, 2 * 22 * 8);
  const sz = bakeSize(plan.sprites[0]!);
  assert.ok(sz.width > 20 && sz.height > 20);
});
