import { test } from "node:test";
import assert from "node:assert/strict";
import { createTerrain } from "@keel-engine/terrain";
import type { Terrain } from "@keel-engine/terrain";
import {
  ACT, COMMAND_BYTES, bakedScale, commandOf, createCommandStream, createViewModes, createZoom, decodeCommands, dollyShot, encodeCommands, faceOf, matchingPersp, moveOf, nearestRung,
  newDriven, perspectiveScale, sampleCommand, solidBandFor, solidShare, spriteLod, stepPossessed, terrainChunkMesh, terrainRectMesh, zoomLadder,
} from "../src/index.ts";
import type { PossessCommand, Shot, ViewPhase } from "../src/index.ts";

// ---------------------------------------------------------------- zoom

test("the zoom ladder: 2 to 128 px/m, a rung every quarter octave, whole pixels from 4 up", () => {
  const L = zoomLadder(2, 128);
  assert.equal(L[0], 2);
  assert.equal(L[L.length - 1], 128);
  assert.ok(L.length >= 24 && L.length <= 26, `${L.length} rungs`);
  for (let i = 1; i < L.length; i += 1) {
    assert.ok(L[i]! > L[i - 1]!);
    assert.ok(L[i]! / L[i - 1]! < 1.3, `${L[i - 1]} -> ${L[i]}: never a jump`);
    if (L[i]! >= 4) assert.equal(L[i], Math.round(L[i]!));
  }
  assert.equal(nearestRung(L, 100), 108);
  assert.equal(nearestRung(L, 7), 7);
});

test("the zoom eases continuously toward its target and lands exactly on a rung", () => {
  const zoom = createZoom({ ladder: zoomLadder(2, 128), k: 16 });
  assert.equal(zoom.k, 16);
  zoom.wheel(4); // (an octave in)
  assert.equal(zoom.target, 32);
  const seen: number[] = [];
  for (let i = 0; i < 200 && !zoom.settled; i += 1) { zoom.step(1 / 120); seen.push(zoom.k); }
  assert.ok(zoom.settled, "settles");
  assert.equal(zoom.k, 32);
  // (Continuous: many in-between scales, each larger than the last.)
  assert.ok(seen.length > 10);
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i]! >= seen[i - 1]!);
  assert.ok(seen.some((k) => !zoom.ladder.includes(k)), "drawn between rungs while it moves");
  zoom.wheel(-100);
  assert.equal(zoom.target, 2);
  zoom.wheel(1000);
  assert.equal(zoom.target, 128);
});

test("pitch buckets tilt with the zoom, with a hysteresis band at each edge", () => {
  const zoom = createZoom({ ladder: zoomLadder(2, 128), k: 8, buckets: [{ upTo: 16, pitch: 0.7 }, { upTo: Infinity, pitch: 0.5 }], hysteresis: 1.15 });
  assert.equal(zoom.pitch, 0.7);
  zoom.set(19, true);
  assert.equal(zoom.bucket, 1, "19 > 16 x 1.15: over the edge");
  assert.equal(zoom.pitch, 0.5);
  zoom.set(16, true);
  assert.equal(zoom.bucket, 1, "back at 16: inside the band, still the near bucket");
  zoom.set(13, true);
  assert.equal(zoom.bucket, 0, "13 < 16 / 1.15: back to the far bucket");
  assert.equal(zoom.bucketFor(18, 0), 0, "18: inside the band from below");
  assert.equal(zoom.bucketFor(100), 1);
  assert.equal(zoom.pitchOf(1), 0.5);
});

// ---------------------------------------------------------------- modes

const subjectAt = (x: number, z: number, yaw = 0, vel: [number, number, number] = [0, 0, 0]) => ({ pos: [x, 1, z] as [number, number, number], yaw, vel, height: 1.7, radius: 0.35 });

function run(modes: ReturnType<typeof createViewModes>, seconds: number, s: ReturnType<typeof subjectAt> | null, dt = 1 / 120) {
  const phases: ViewPhase[] = [];
  let last: ReturnType<typeof modes.step> | null = null;
  for (let t = 0; t < seconds; t += dt) { last = modes.step(dt, s, {}); if (phases[phases.length - 1] !== last.phase) phases.push(last.phase); }
  return { phases, last: last! };
}

test("possess: overview -> glide -> swap (both paths, dissolved) -> dolly -> chase; release goes back the same way", () => {
  const zoom = createZoom({ ladder: zoomLadder(2, 128), k: 8, buckets: [{ upTo: 16, pitch: 0.7 }, { upTo: Infinity, pitch: 0.5 }] });
  const modes = createViewModes({ zoom, center: [50, 0, 50], picture: [480, 270] });
  const s = subjectAt(60, 40, 1.2);
  assert.equal(modes.mode, "overview");
  assert.equal(modes.step(1 / 120, null).shot.kind, "ortho");
  modes.possess(7, s);
  assert.equal(modes.subject, 7);
  let sawSwap = false;
  const phases: ViewPhase[] = [];
  for (let t = 0; t < 2; t += 1 / 120) {
    const f = modes.step(1 / 120, s);
    if (phases[phases.length - 1] !== f.phase) phases.push(f.phase);
    if (f.phase === "swap") { sawSwap = true; assert.ok(f.blend, "a swap draws two shots"); assert.equal(f.shot.kind, "ortho"); assert.equal(f.blend!.shot.kind, "persp"); }
    if (f.phase === "glide") assert.equal(f.shot.kind, "ortho");
    if (f.phase === "dolly" || f.phase === "chase") assert.equal(f.shot.kind, "persp");
  }
  assert.ok(sawSwap);
  assert.deepEqual(phases, ["glide", "swap", "dolly", "chase"]);
  assert.equal(modes.mode, "chase");
  // (Centred on the unit, zoomed in, when it swapped.)
  assert.ok(Math.hypot(modes.center[0] - 60, modes.center[2] - 40) < 1e-6);
  modes.toggleFirstPerson();
  const r1 = run(modes, 1, s);
  assert.deepEqual(r1.phases, ["toFps", "fps"]);
  assert.equal(modes.mode, "fps");
  assert.ok(r1.last.hideSubject, "first person hides the body");
  assert.ok(Math.abs((r1.last.shot as Extract<Shot, { kind: "persp" }>).eye[1] - (1 + 1.7 * 0.93)) < 0.1, "eye at eye height");
  modes.release();
  const r2 = run(modes, 2, s);
  assert.deepEqual(r2.phases, ["undolly", "unswap", "unglide", "overview"]);
  assert.equal(modes.subject, null);
  assert.equal(modes.zoom.k, 8, "the overview's zoom as it was");
  assert.ok(Math.hypot(modes.center[0] - 50, modes.center[2] - 50) < 1e-6, "and its centre");
});

test("the matching perspective camera draws an orthographic shot's middle within a pixel", () => {
  const H = 270, W = 480;
  const o = { kind: "ortho" as const, center: [10, 2, 30] as [number, number, number], yaw: 0.4, pitch: 0.5, k: 40 };
  const p = matchingPersp(o, H, 60);
  // Ortho projection (keel/bake's pixelView) against the perspective one (keel/render's), for points round the centre.
  const f = [Math.sin(o.yaw) * Math.cos(-o.pitch), Math.sin(-o.pitch), Math.cos(o.yaw) * Math.cos(-o.pitch)];
  const right = [Math.cos(o.yaw), 0, -Math.sin(o.yaw)];
  const up = [f[1]! * right[2]! - f[2]! * right[1]!, f[2]! * right[0]! - f[0]! * right[2]!, f[0]! * right[1]! - f[1]! * right[0]!];
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  let worst = 0;
  for (const d of [[0, 0, 0], [1, 0, 0], [0, 1.7, 0], [-1, 0.5, 1], [2, 0, -2]]) {
    const P = [o.center[0] + d[0]!, o.center[1] + d[1]!, o.center[2] + d[2]!];
    const rel = [P[0]! - o.center[0], P[1]! - o.center[1], P[2]! - o.center[2]];
    const ox = W / 2 + dot(rel, right) * o.k, oy = H / 2 - dot(rel, up) * o.k;
    const e = [P[0]! - p.eye[0], P[1]! - p.eye[1], P[2]! - p.eye[2]];
    const z = dot(e, f), t = Math.tan(p.fov / 2);
    const px = W / 2 + (dot(e, right) / (z * t * (W / H))) * (W / 2), py = H / 2 - (dot(e, up) / (z * t)) * (H / 2);
    worst = Math.max(worst, Math.hypot(px - ox, py - oy));
  }
  assert.ok(worst < 2.5, `${worst.toFixed(2)} px off at most (a perspective 60 m off)`);
});

test("the dolly: starts and ends on its shots, and the framed height changes one way", () => {
  const a = { kind: "persp" as const, eye: [0, 40, -40] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 0.1 };
  const b = { kind: "persp" as const, eye: [0, 3, -5] as [number, number, number], target: [0, 1.2, 0] as [number, number, number], fov: 1.1 };
  const s0 = dollyShot(a, b, 0), s1 = dollyShot(a, b, 1);
  for (let i = 0; i < 3; i += 1) { assert.ok(Math.abs(s0.eye[i]! - a.eye[i]!) < 1e-9); assert.ok(Math.abs(s1.eye[i]! - b.eye[i]!) < 1e-9); }
  assert.ok(Math.abs(s1.fov - b.fov) < 1e-9);
  const heights: number[] = [];
  for (let t = 0; t <= 1.0001; t += 0.05) { const s = dollyShot(a, b, t); const D = Math.hypot(s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]); heights.push(2 * D * Math.tan(s.fov / 2)); }
  const falling = heights[heights.length - 1]! < heights[0]!;
  for (let i = 1; i < heights.length; i += 1) assert.ok(falling ? heights[i]! <= heights[i - 1]! + 1e-9 : heights[i]! >= heights[i - 1]! - 1e-9, "no shrinking before it grows");
});

// ---------------------------------------------------------------- possession

test("commands: quantised, 13 bytes on the wire, back the same", () => {
  const c = commandOf(1234, 42, [0.6, -0.8], 2.5, ACT.attack | ACT.run);
  assert.equal(c.mx, 76); assert.equal(c.mz, -102);
  assert.ok(Math.abs(faceOf(c) - 2.5) < 1e-4);
  const [x, z] = moveOf(c);
  assert.ok(Math.abs(Math.hypot(x, z) - 1) < 0.01);
  const long = commandOf(0, 0, [3, 4], 0);
  assert.ok(Math.hypot(...moveOf(long)) <= 1.0001, "a move is at most a unit long");
  const list: PossessCommand[] = [c, long, commandOf(99999, 7, [0, 0], -3, ACT.use)];
  const bytes = encodeCommands(list);
  assert.equal(bytes.length, 3 * COMMAND_BYTES);
  assert.deepEqual(decodeCommands(bytes), list);
});

test("sampling: W goes where the camera looks; facing by move, by camera, or kept", () => {
  const c = sampleCommand(0, 1, { forward: 1, strafe: 0 }, Math.PI / 2, 0);
  const [x, z] = moveOf(c);
  assert.ok(x > 0.99 && Math.abs(z) < 0.01, "camera yaw pi/2 looks along +x");
  assert.ok(Math.abs(faceOf(c) - Math.PI / 2) < 1e-3, "faces the way it goes");
  const d = sampleCommand(0, 1, { forward: 0, strafe: 1 }, 0, 0);
  assert.ok(moveOf(d)[0] > 0.99, "D strafes to the camera's right (+x at yaw 0)");
  assert.ok(Math.abs(faceOf(sampleCommand(0, 1, { forward: 0, strafe: 0 }, 1, 0.3)) - 0.3) < 1e-3, "standing: keeps its own facing");
  assert.ok(Math.abs(faceOf(sampleCommand(0, 1, { forward: 0, strafe: 1, facing: "camera" }, 1, 0.3)) - 1) < 1e-3, "aiming: faces where the camera looks");
});

test("the command stream is deterministic: the same commands give the same run, bit for bit; an input delay shifts them", () => {
  const rules = { walk: 2.2, run: 5.5, turn: 9, move: (x: number, z: number, nx: number, nz: number) => [Math.max(0, Math.min(40, nx)), nz < 5 && x > 10 ? z : nz] as const };
  // A scripted player: 400 ticks of turning, running, stopping, attacking.
  const script: PossessCommand[] = [];
  for (let t = 0; t < 400; t += 1) {
    const a = t * 0.05;
    const act = (t % 97 === 0 ? ACT.attack : 0) | (t % 150 < 60 ? ACT.run : 0);
    script.push(t % 70 < 10 ? commandOf(t, 3, [0, 0], a, act) : commandOf(t, 3, [Math.sin(a), Math.cos(a) * 0.7], a + 0.3, act));
  }
  const play = (cmds: readonly PossessCommand[], delay: number) => {
    const stream = createCommandStream({ delay });
    const d = newDriven(20, 20, 0);
    const trail: number[] = [];
    let i = 0;
    for (let tick = 0; tick < 400 + delay; tick += 1) {
      if (i < cmds.length && cmds[i]!.tick === tick) stream.push(cmds[i++]!);
      const c = stream.take(tick).find((q) => q.unit === 3) ?? null;
      stepPossessed(d, c, 1 / 20, rules);
      trail.push(d.x, d.z, d.yaw, d.action, d.dist);
    }
    return { d, trail };
  };
  const a = play(script, 0), b = play(script, 0);
  assert.deepEqual(a.trail, b.trail);
  // Through the wire and back: the same.
  const c = play(decodeCommands(encodeCommands(script)), 0);
  assert.deepEqual(c.trail, a.trail);
  // An input delay of 3 ticks: the same run, 3 ticks later.
  const late = play(script, 3);
  assert.deepEqual(late.trail.slice(3 * 5), a.trail.slice(0, a.trail.length - 0).slice(0, late.trail.length - 3 * 5));
  assert.ok(a.d.dist > 20, `it went somewhere (${a.d.dist.toFixed(1)} m)`);
  // An attack plants it: no distance walked on the ticks it swings.
  const d = newDriven(0, 0, 0);
  stepPossessed(d, commandOf(0, 0, [1, 0], 0, ACT.attack), 1 / 20, rules);
  assert.equal(d.action, ACT.attack);
  const before = d.dist;
  for (let t = 1; t < 5; t += 1) stepPossessed(d, commandOf(t, 0, [1, 0], 0), 1 / 20, rules);
  assert.equal(d.dist, before, "planted while it strikes");
  for (let t = 5; t < 20; t += 1) stepPossessed(d, commandOf(t, 0, [1, 0], 0), 1 / 20, rules);
  assert.equal(d.action, 0);
  assert.ok(d.dist > before, "and moves again after");
});

test("the stream: the last command per unit and tick wins, in unit order; late ones are dropped", () => {
  const s = createCommandStream();
  s.push(commandOf(5, 2, [1, 0], 0));
  s.push(commandOf(5, 1, [0, 1], 0));
  s.push(commandOf(5, 2, [-1, 0], 0));
  s.push(commandOf(3, 9, [0, 0], 0));
  assert.equal(s.pending.length, 3);
  const at5 = s.take(5);
  assert.deepEqual(at5.map((c) => c.unit), [1, 2]);
  assert.equal(at5[1]!.mx, -127);
  assert.equal(s.take(3).length, 0, "tick 3's command was late (tick 5 was taken first)");
});

// ---------------------------------------------------------------- terrain meshes

const MATS = { material: (type: number, part: "top" | "face") => (part === "top" ? 10 + type : 40 + type), water: 4 };
function bumpy(): Terrain {
  const t = createTerrain({ width: 64, depth: 48, chunk: 16, tileSize: 2 });
  let s = 7;
  const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (let j = 0; j < t.depth; j += 1) for (let i = 0; i < t.width; i += 1) t.setHeight(i, j, Math.floor(3 * Math.sin(i * 0.21) + 2 * Math.cos(j * 0.17) + r() * 1.4));
  // (A few ramps and some water.)
  for (let j = 0; j < t.depth; j += 1) for (let i = 1; i < t.width - 1; i += 1) {
    const k = t.index(i, j);
    if (r() < 0.05 && t.height[t.index(i + 1, j)] === t.height[k]! + 1 && t.height[t.index(i - 1, j)] === t.height[k]) t.setRamp(i, j, 1);
    if (r() < 0.03) t.setWater(i, j, t.height[k]! + 1);
  }
  return t;
}

test("a flat chunk is two triangles a tile (and a skirt where it meets the map's edge)", () => {
  const t = createTerrain({ width: 64, depth: 64, chunk: 32, tileSize: 2 });
  const inner = terrainChunkMesh(t, t.chunkOf(40, 40), MATS);
  assert.equal(inner.counts.tops, 32 * 32);
  assert.equal(inner.triangles, 32 * 32 * 2 + inner.counts.skirts * 2);
  assert.equal(inner.positions.length, inner.triangles * 9);
  assert.equal(inner.looks.length, inner.triangles * 12);
  // (The chunk at a corner of a 2 x 2 map has two map edges: 64 border tiles skirted.)
  assert.equal(inner.counts.skirts, 64);
  assert.equal(inner.counts.faces, 0);
  for (let v = 0; v < inner.normals.length; v += 9) if (Math.abs(inner.normals[v + 1]!) > 0.5) assert.ok(inner.normals[v + 1]! > 0.99, "tops face up");
  assert.equal(terrainChunkMesh(t, 0, { ...MATS, floor: null }).counts.skirts, 0);
});

test("chunks meet without seams: every chunk's triangles together are exactly the whole map's", () => {
  const t = bumpy();
  const key = (m: ReturnType<typeof terrainRectMesh>) => {
    const out: string[] = [];
    for (let i = 0; i < m.positions.length; i += 9) {
      const vs = [0, 1, 2].map((v) => Array.from(m.positions.slice(i + v * 3, i + v * 3 + 3), (x) => x.toFixed(3)).join(",")).sort();
      out.push(vs.join("|"));
    }
    return out.sort();
  };
  const whole = terrainRectMesh(t, [0, 0, t.width, t.depth], MATS);
  const parts: string[] = [];
  for (let c = 0; c < t.chunksX * t.chunksZ; c += 1) parts.push(...key(terrainChunkMesh(t, c, MATS)));
  assert.deepEqual(parts.sort(), key(whole));
  assert.ok(whole.counts.faces > 300, `${whole.counts.faces} cliff faces`);
  assert.ok(whole.counts.water > 10, `${whole.counts.water} water tiles`);
  // Every tile edge between two tops at different levels is closed by a face spanning the drop (no gap to look through).
  let edges = 0;
  for (let j = 0; j < t.depth; j += 1) for (let i = 0; i < t.width - 1; i += 1) {
    const a = t.heightAt(i * 2 + 1.999, j * 2 + 1), b = t.heightAt(i * 2 + 2.001, j * 2 + 1);
    if (Math.abs(a - b) > 0.01) edges += 1;
  }
  assert.ok(edges > 100);
});

test("a ramp's top slopes; a cliff's face belongs to its high side, facing out", () => {
  const t = createTerrain({ width: 8, depth: 8, chunk: 8, tileSize: 2 });
  t.setHeight(4, 4, 3);
  const m = terrainChunkMesh(t, 0, { ...MATS, floor: null });
  assert.equal(m.counts.faces, 4, "a raised tile: four faces");
  let out = 0;
  for (let v = 0; v < m.normals.length; v += 3) {
    const [nx, ny, nz] = [m.normals[v]!, m.normals[v + 1]!, m.normals[v + 2]!];
    if (Math.abs(ny) < 0.01) {
      const p = [m.positions[v]!, m.positions[v + 2]!];
      const toCentre = [9 - p[0]!, 9 - p[1]!];
      if (nx * toCentre[0]! + nz * toCentre[1]! < 0) out += 1;
    }
  }
  assert.equal(out, 4 * 6, "every face vertex's normal points away from the raised tile");
  const r = createTerrain({ width: 8, depth: 8, chunk: 8, tileSize: 2 });
  r.setHeight(5, 3, 1);
  r.setRamp(4, 3, 1);
  const rm = terrainChunkMesh(r, 0, { ...MATS, floor: null });
  let sloped = 0;
  for (let v = 0; v < rm.normals.length; v += 9) if (rm.normals[v + 1]! > 0.3 && rm.normals[v + 1]! < 0.99) sloped += 1;
  assert.equal(sloped, 2, "the ramp's two triangles slope");
});

// ---------------------------------------------------------------- LOD

test("LOD by on-screen size: dot, far, near; the baked scale nearest; solids and sprites dissolve into each other", () => {
  assert.equal(spriteLod(4), 0); assert.equal(spriteLod(20), 1); assert.equal(spriteLod(80), 2);
  const L = zoomLadder(2, 128);
  const b = bakedScale(L, 30);
  assert.equal(b.rung, 32, "30 px/m: the 32 bake, drawn a little smaller");
  assert.ok(Math.abs(b.scale - 30 / 32) < 1e-9);
  assert.equal(bakedScale(L, 64).scale, 1);
  // Perspective scale: 270 px tall, fov 60 degrees, 10 m off -> 23.4 px/m.
  assert.ok(Math.abs(perspectiveScale(10, Math.PI / 3, 270) - 270 / (20 * Math.tan(Math.PI / 6))) < 1e-9);
  const band = solidBandFor(1.7, 1.15, 270);
  assert.ok(band.solid < band.sprite && band.sprite < band.cull);
  let lastSolid = 1;
  for (let d = 0; d < 140; d += 0.25) {
    const s = solidShare(d, band);
    assert.ok(s.solid <= lastSolid + 1e-12, "a solid only gives way with distance");
    lastSolid = s.solid;
    assert.equal(s.solid * 16, Math.round(s.solid * 16), "whole steps of the 4x4 screen");
    if (d > band.solid && d < band.sprite) assert.equal(s.solid, s.sprite, "the sprite keeps exactly the pixels the solid gives up");
  }
  assert.deepEqual(solidShare(0, band), { solid: 1, sprite: 1 });
  assert.deepEqual(solidShare(band.sprite + 1, band), { solid: 0, sprite: 0 });
  assert.deepEqual(solidShare(band.cull + 1, band), { solid: 0, sprite: 1 });
});
