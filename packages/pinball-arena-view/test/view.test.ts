import { test } from "node:test";
import assert from "node:assert/strict";
import { standIn } from "../../render/test/gl-stand-in.ts";
import { ARENA_BODY_MESH_ID, createPinballArenaView } from "../src/view.ts";
import { createArenaWorld } from "@keel-engine/pinball-arena-gen";
import { ArenaInput, createArenaMatch, createArenaRoster } from "@keel-engine/pinball-arena";
import type { ArenaField, ArenaWorldDefinition } from "@keel-engine/pinball-arena";
import { sha256, toHex } from "@keel-engine/codec/hash";
import { compilePinballMachine } from "../../pinball-arena-gen/src/machine.ts";
import { arenaReturnReceiver, arenaReceiverLookahead, arenaCatchAimAvailable } from "../src/camera.ts";
import type { MeshGBuffer } from "@keel-engine/bake";

function machineRenderWorld(field: ArenaField): ArenaWorldDefinition {
  const body = { schema: "keel-pinball-arena-world@1" as const, generatorVersion: "renderer-fixture", id: "renderer-fixture", seed: field.seed, unitScale: .025, arenas: [field], links: [] };
  const canonical = JSON.stringify(body);
  return { ...body, canonical, sha256: toHex(sha256(new TextEncoder().encode(canonical))) };
}

test("the opt-in mesh admission callback identifies physical bodies without enabling pixel readback", () => {
  const field = compilePinballMachine({ id: "visibility-fixture", seed: "0x2026", attempt: 0, origin: { x: 800, y: 300 }, ownerId: 0, teamId: 0, variation: false });
  const world = machineRenderWorld(field), frame = createArenaMatch(world, { players: createArenaRoster({ players: 1 }) }).readFrame();
  const fake = standIn({ width: 800, height: 600 }), frames: MeshGBuffer[] = [];
  const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 800, height: 600, density: "low", onMeshFrame: buffer => frames.push(buffer) });
  view.setWorld(world); view.render(frame, { timeMs: 0, camera: { mode: "follow", ownerId: 0 } });
  assert.equal(frames.length, 1);
  const buffer = frames[0]!;
  assert.equal(buffer.width, view.getStats().width); assert.equal(buffer.height, view.getStats().height);
  assert.ok(buffer.ga && buffer.gb && buffer.gc && buffer.gd);
  const bodies = buffer.draws!.filter(draw => draw.mesh === ARENA_BODY_MESH_ID && draw.owner === 0);
  assert.equal(bodies.length, 1, "the actual physical sphere must have an unambiguous draw identity");
  assert.ok(buffer.draws!.some(draw => draw.mesh === "owned-ball-beacon"));
  assert.ok(!fake.calls.some(([name]) => name === "readPixels"));
  view.dispose();
});

test("sparse exterior framing cannot remove real central rails from follow or overview", () => {
  const physical = compilePinballMachine({ id: "sparse-framing-fixture", seed: "0x2026", attempt: 0, origin: { x: 800, y: 300 }, ownerId: 0, teamId: 0, variation: false });
  const field = { ...physical, chunks: [{ id: "outside-only", bounds: [4000, 4000, 4500, 4500] as const, layer: 0, height: 0, biome: physical.regions[0]!.biome, seed: physical.seed, instances: [] }] };
  const world = machineRenderWorld(field), frame = createArenaMatch(world, { players: createArenaRoster({ players: 1 }) }).readFrame();
  const fake = standIn({ width: 800, height: 600 }), buffers: MeshGBuffer[] = [];
  const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 800, height: 600, density: "low", onMeshFrame: buffer => buffers.push(buffer) });
  view.setWorld(world);
  for (const mode of ["follow", "overview"] as const) {
    view.render(frame, { timeMs: 0, camera: { mode, ownerId: 0 } });
    assert.ok(buffers.at(-1)!.draws!.some(draw => draw.mesh.includes("/physical-grid/")), `${mode} must draw actual rails even without central scenery`);
    assert.ok(!buffers.at(-1)!.draws!.some(draw => draw.mesh.includes("/physical/outside-only")));
  }
  assert.deepEqual(field.bounds, physical.bounds, "renderer cannot expand storm authority for cosmetic extents"); view.dispose();
});

test("real KEEL pass accepts generated layered worlds, protects canonical frames and switches target profiles", () => {
  const fake = standIn({ width: 800, height: 600 });
  const world = createArenaWorld("0x7654", { arenas: 3, players: 1, detail: "low" });
  const frame = createArenaMatch(world, { players: createArenaRoster({ players: 1 }), mode: "expedition" }).readFrame();
  const before = JSON.stringify(frame), descriptor = world.canonical;
  const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 800, height: 600, density: "low", maxMovingFoliage: 4 });
  view.setWorld(world);
  view.render(frame, { timeMs: 0, camera: { mode: "overview", scope: "world" } });
  assert.equal(view.getStats().chunks, world.arenas.reduce((n, a) => n + a.chunks.length, 0));
  assert.equal(view.getStats().backend, "keel-live-mesh");
  assert.ok(view.getStats().triangles > 0);
  assert.ok(view.getStats().cachedMeshes <= 320);
  assert.equal(view.getStats().height, 256);
  view.setStyle("realistic"); assert.equal(view.getStats().height, 600);
  view.setStyle("pixel"); assert.equal(view.getStats().height, 256);
  fake.calls.length = 0;
  view.render(frame, { timeMs: 120, camera: { mode: "follow", ownerId: 0 } });
  assert.ok(view.getStats().movingFoliage <= 4);
  assert.equal(JSON.stringify(frame), before); assert.equal(world.canonical, descriptor);
  const [x, y] = view.project(frame.balls[0]!.x, frame.balls[0]!.y, frame.balls[0]!.elevation)!;
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
  view.dispose(); assert.equal(view.getStats().cachedMeshes, 0);
  assert.throws(() => view.render(frame, { timeMs: 0 }), /disposed/);
});

test("mesh residency remains bounded even when an overview submits more surface meshes than the budget", () => {
  const fake = standIn({ width: 320, height: 256 });
  const source = createArenaWorld("0x9876", { arenas: 1, players: 1, detail: "low" });
  const original = source.arenas[0]!;
  const world = machineRenderWorld({ ...original, chunks: [], surfaces: Array.from({ length: 220 }, (_, i) => ({ ...original.surfaces[0]!, id: `overlap-${i}` })) });
  const frame = createArenaMatch(source, { players: createArenaRoster({ players: 1 }) }).readFrame();
  const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 320, height: 256, density: "low", maxChunkMeshes: 1, maxMovingFoliage: 0 });
  view.setWorld(world);
  view.render(frame, { timeMs: 0, camera: { mode: "overview" } });
  assert.ok(view.getStats().cachedMeshes <= 193);
  view.dispose();
});

test("follow tracking keeps an unleased body readable before its next bank becomes local control", () => {
  const world = createArenaWorld("0x5521", { arenas: 1, players: 1, detail: "low" });
  const initial = createArenaMatch(world, { players: createArenaRoster({ players: 1 }), mode: "expedition" }).readFrame();
  const bank = world.arenas[0]!.stations[0]!;
  for (const [width, height] of [[1100, 600], [360, 800]] as const) {
    const fake = standIn({ width, height });
    const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width, height, density: "low" });
    const body = { ...initial.balls[0]!, x: bank.x + 270, y: bank.y - 230, vx: 0, vy: 0, active: true, nextStationId: bank.id, stationId: null };
    const frame = { ...initial, balls: [body] };
    view.setWorld(world); view.render(frame, { timeMs: 0, camera: { mode: "follow", ownerId: 0 } });
    const stats = view.getStats();
    assert.equal(arenaCatchAimAvailable(world.arenas[0]!,body,bank),false,"a next-station hint does not grant control of the physical pair");
    for (const p of [body]) {
      const [x, y] = view.project(p.x, p.y)!;
      assert.ok(x > stats.width * .04 && x < stats.width * .96, `${width}x${height} x ${x}`);
      assert.ok(y > stats.height * .10 && y < stats.height * .78, `${width}x${height} y ${y}`);
    }
    view.dispose();
  }
});

test("an unpartitioned mechanical candidate keeps the same physical rails as its single-chunk form", () => {
  // This checks renderer admission, not generator gameplay qualification.
  const field = compilePinballMachine({ id: "mesh-fixture", seed: "0x5521", attempt: 0, origin: { x: 800, y: 300 }, ownerId: 0, teamId: 0, variation: false });
  const world = machineRenderWorld(field), frame = createArenaMatch(world, { players: createArenaRoster({ players: 1 }) }).readFrame();
  const fake = standIn({ width: 800, height: 600 });
  const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 800, height: 600, density: "low" });
  view.setWorld(world); view.render(frame, { timeMs: 0, camera: { mode: "follow", ownerId: 0 } });
  const unpartitioned = view.getStats().triangles;
  assert.ok(unpartitioned > 0); assert.equal(view.getStats().chunks, 0);
  const chunk = { id: "whole-physical-field", bounds: field.bounds, seed: field.seed, layer: 0, height: 0, biome: field.regions[0]!.biome, instances: [] };
  view.setWorld(machineRenderWorld({ ...field, chunks: [chunk] }));
  view.render(frame, { timeMs: 0, camera: { mode: "follow", ownerId: 0 } });
  assert.equal(view.getStats().triangles, unpartitioned); assert.equal(view.getStats().chunks, 1);
  view.setWorld(machineRenderWorld({ ...field, rails: [], bumpers: [] }));
  view.render(frame, { timeMs: 0, camera: { mode: "follow", ownerId: 0 } });
  assert.ok(view.getStats().triangles < unpartitioned, "the unpartitioned static colliders must contribute real mesh geometry");
  view.dispose();
});

test("shooter tracking and local catch framing preserve real body scale without fitting every distant mouth", () => {
  // Position fixtures judge projection only; they are not physical shot tapes.
  const field = compilePinballMachine({ id: "aim-fixture", seed: "0x7621", attempt: 0, origin: { x: 800, y: 300 }, ownerId: 0, teamId: 0, variation: false });
  const world = machineRenderWorld(field), initial = createArenaMatch(world, { players: createArenaRoster({ players: 1 }) }).readFrame(), bank = field.stations[0]!;
  const entryPorts = field.pinball!.ports.filter(p => p.role === "shot-entry");
  assert.equal(entryPorts.length, 2);
  const drain = field.hazards!.find(h => h.kind === "drain")!;
  for (const [width, height] of [[1100, 600], [360, 800]] as const) for (const yaw of [0, .35]) {
    const fake = standIn({ width, height }), view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width, height, density: "low" });
    view.setWorld(world);
    for (const [i, body] of [initial.balls[0]!, { ...initial.balls[0]!, x: bank.x, y: bank.y + 90, vx: 0, vy: 0, active: true }].entries()) {
      const frame = { ...initial, balls: [body] };
      view.render(frame, { timeMs: i * 16, deltaMs: 16, camera: { mode: "follow", ownerId: 0, yaw } });
      const stats = view.getStats();
      // The served body belongs to the remote shooter; the control pose has
      // the actual local pair and drain. Distant mouth context is subordinate
      // to an8-logical-pixel native sphere, as in the exact14 regression.
      const points=i===0?[body]:[body,{x:drain.x,y:drain.y,elevation:drain.elevation},...frame.flippers.flatMap(f=>[{x:f.pivotX,y:f.pivotY,elevation:f.elevation},{x:f.tipX,y:f.tipY,elevation:f.elevation}])];
      for (const p of points) {
        const [x, y] = view.project(p.x, p.y, p.elevation)!;
        assert.ok(x >= 4 && x <= stats.width-4, `${width}x${height} body/blade x ${x}`);
        assert.ok(y >= 4 && y <= stats.height-4, `${width}x${height} body/blade y ${y}`);
      }
      const center=view.project(body.x,body.y,body.elevation+body.radius)!,x=view.project(body.x+body.radius,body.y,body.elevation+body.radius)!,y=view.project(body.x,body.y+body.radius,body.elevation+body.radius)!;
      assert.ok(2*Math.hypot(x[0]-center[0],y[0]-center[0])>=8-.0001,"the native sphere retains readable logical scale");
    }
    view.dispose();
  }
});

test("declared imminent returns anticipate a landing beyond600 units without selecting an unrelated higher layer", () => {
  const field = compilePinballMachine({ id: "return-fixture", seed: "0x2026", attempt: 0, origin: { x: 800, y: 300 }, ownerId: 0, teamId: 0, variation: false });
  const world = machineRenderWorld(field), initial = createArenaMatch(world, { players: createArenaRoster({ players: 1 }) }).readFrame(), bank = field.stations[0]!;
  const path = field.pinball!.paths.find(p => p.role === "cross-return")!;
  const ground = path.vertices.find((p, i) => i >= path.returnStartVertex! && p.layer === 0 && Math.hypot(p.x - bank.x, p.y - bank.y) > 600)!;
  assert.ok(ground);
  const body = { ...initial.balls[0]!, ...ground, vx: 0, vy: -18, active: true, rampId: null };
  assert.equal(arenaReturnReceiver(field, body)?.id, bank.id);
  const upper = path.vertices.find((p, i) => i >= path.returnStartVertex! && p.layer === 1)!;
  assert.equal(arenaReturnReceiver({ ...field, pinball: { ports: field.pinball!.ports, paths: [path] } }, { ...body, x: upper.x, y: upper.y, elevation: 0, layer: 0 }), undefined);
  const arriving = { ...body, ...path.vertices.at(-2)! };
  for (const [width, height] of [[1100, 600], [360, 800]] as const) {
    const fake = standIn({ width, height }), view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width, height, density: "low" });
    view.setWorld(world); view.render(initial, { timeMs: 0, camera: { mode: "follow", ownerId: 0 } });
    view.render({ ...initial, balls: [arriving] }, { timeMs: 16, deltaMs: 16, camera: { mode: "follow", ownerId: 0 } });
    const stats = view.getStats(), drain = field.hazards!.find(h => h.kind === "drain")!;
    for (const p of [arriving, bank, drain, ...initial.flippers.flatMap(f => [{ x: f.pivotX, y: f.pivotY, elevation: f.elevation }, { x: f.tipX, y: f.tipY, elevation: f.elevation }])]) {
      const [x, y] = view.project(p.x, p.y, p.elevation)!;
      assert.ok(x >= 4 && x <= stats.width-4, `${width}x${height} receiving x ${x}`);
      assert.ok(y >= 4 && y <= stats.height-4, `${width}x${height} receiving y ${y}`);
    }
    view.dispose();
  }
});

test("recorded raised descents keep local body scale and reserve outgoing mouth fits for actual catch control", () => {
  // Exact .2 diagnostic recipe and poses from candidate-captures-v2. This tests
  // projection, not legal-input replay, pixel survival or product admission.
  const field = compilePinballMachine({ id: "descent-fixture", seed: "0x2026", attempt: 2, origin: { x: 2000, y: 500 }, ownerId: 0, teamId: 0, centerCatch: true, deck: "wireform", shotBindings: {
    orbit: { x: 376.888671875, y: 409.3154296875, vx: 11.9189453125, vy: 12.1669921875 },
    cross: { x: 53.01171875, y: 404.318359375, vx: 2.5009765625, vy: 16.8642578125 },
  } });
  const world = machineRenderWorld(field), initial = createArenaMatch(world, { players: createArenaRoster({ players: 1 }) }).readFrame(), bank = field.stations[0]!;
  const descending = { ...initial.balls[0]!, x: 1570.44921875, y: 1237.52734375, vx: -.3330078125, vy: -16.4814453125, layer: 1, elevation: 54.142578125, active: true, rampId: `${field.id}.cross-return.slope.16`, stationId: null, nextStationId: null };
  const descentExit = { ...descending, x: 1484.4970703125, y: 962.384765625, vx: -.7783203125, vy: -16.5654296875, layer: 0, elevation: 0, rampId: null, nextStationId: bank.id };
  const returned = { ...descending, x: 2006.5986328125, y: 474.466796875, vx: -8.017578125, vy: 12.3857421875, layer: 0, elevation: 0, rampId: null, stationId: bank.id, nextStationId: bank.id };
  assert.equal(arenaReturnReceiver(field, descending, arenaReceiverLookahead(descending)), undefined, "a distant catch must not shrink a body halfway down a long return");
  assert.equal(arenaCatchAimAvailable(field, descending, bank), false);
  assert.equal(arenaCatchAimAvailable(field, returned, bank), true);
  assert.equal(arenaCatchAimAvailable(field, { ...returned, layer: 1, elevation: 106 }, bank), false, "XY overlap alone cannot activate catch aiming");
  for (const [width, height] of [[1200, 720], [360, 800]] as const) for (const body of [descending, descentExit]) {
    const fake = standIn({ width, height }), view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width, height, density: "medium" });
    view.setWorld(world); view.render({ ...initial, balls: [body] }, { timeMs: 0, camera: { mode: "follow", ownerId: 0 } });
    const left = view.project(body.x - body.radius, body.y, body.elevation + body.radius)!, right = view.project(body.x + body.radius, body.y, body.elevation + body.radius)!;
    assert.ok(Math.abs(left[0] - right[0]) >= 4.49, "local travel needs at least4.5logical-pixel sphere diameter before raster/depth admission");
    const [x, y] = view.project(body.x, body.y, body.elevation + body.radius)!;
    assert.ok(x > view.getStats().width * .2 && x < view.getStats().width * .8);
    assert.ok(y > view.getStats().height * .2 && y < view.getStats().height * .7, `${width}x${height} body y${y}/${view.getStats().height}, layer${body.layer}`);
    view.dispose();
  }
});

test("real capture transport alone suppresses a physical body and lights its bound mouth until authoritative release", () => {
  const base = compilePinballMachine({ id: "capture-fixture", seed: "0x2026", attempt: 0, origin: { x: 800, y: 300 }, ownerId: 0, teamId: 0, variation: false });
  const polygon = [{ x: 50, y: 50 }, { x: 500, y: 50 }, { x: 500, y: 500 }, { x: 50, y: 500 }], biome = base.regions[0]!.biome;
  const port = (id: string, role: "capture-entry" | "release-exit", x: number, y: number) => ({ id, role, mechanismId: "fixture-controller", x, y, layer: 0, elevation: 0, tangent: { x: 0, y: 1 }, clearWidth: 64, direction: "forward" as const, surfaceIds: ["fixture-bed"], maxBallRadius: 12, admittedSpeed: { min: 0, max: 18 } });
  const field: ArenaField = { ...base, bounds: [50, 50, 500, 500], regions: [{ ...base.regions[0]!, bounds: [50, 50, 500, 500], polygon, center: { x: 250, y: 250 } }], chunks: [], rails: [], bumpers: [], flippers: [], ramps: [], portals: [], switches: [], flows: [], challenges: [], requirements: [], hazards: [],
    stations: [{ id: "fixture-launch", ownerId: 0, teamId: 0, x: 100, y: 100, layer: 0, elevation: 0, launchX: 100, launchY: 100, launchVx: 0, launchVy: 10, flipperIds: [] }],
    surfaces: [{ id: "fixture-bed", kind: "ground", polygon, layer: 0, height: 0, material: "pinball-inlay", biome }],
    gates: [{ id: "fixture-busy", ax: 60, ay: 110, bx: 140, by: 110, radius: 3, restitution: .8, layer: 0, elevation: 0, initiallyOpen: true, kind: "lock" }],
    pinball: { paths: [], ports: [port("fixture-entry", "capture-entry", 100, 110), port("fixture-exit", "release-exit", 300, 300), port("fixture-fallback", "release-exit", 400, 300)] },
    captures: [{ id: "fixture-controller", kind: "tunnel", entryPortId: "fixture-entry", exitArenaId: base.id, exitPortId: "fixture-exit", fallbackExitPortId: "fixture-fallback", approach: { minSpeed: 1, maxSpeed: 18, minDot: .9 }, captureTicks: 12, travelTicks: 12, maxExitWaitTicks: 12, exitVelocity: { x: 0, y: 4 }, release: { kind: "timer" }, busyGateIds: ["fixture-busy"], blockedTerminal: "drain" }],
  };
  const world = machineRenderWorld(field), match = createArenaMatch(world, { players: createArenaRoster({ players: 1 }), mode: "expedition" });
  const fake = standIn({ width: 360, height: 800 }), buffers: MeshGBuffer[] = [];
  const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 360, height: 800, density: "medium", onMeshFrame: b => buffers.push(b) });
  view.setWorld(world);
  view.render(match.readFrame(), { timeMs: 0 });
  assert.ok(buffers.at(-1)!.draws!.some(d => d.mesh === ARENA_BODY_MESH_ID), "an inactive served body is still real and visible");
  match.step([{ ownerId: 0, bits: ArenaInput.LAUNCH }]);
  let frame = match.readFrame();
  assert.equal(frame.balls[0]!.transport?.phase, "captured");
  const before = JSON.stringify(frame);
  view.render(frame, { timeMs: 16 });
  assert.equal(JSON.stringify(frame), before);
  assert.ok(!buffers.at(-1)!.draws!.some(d => d.mesh === ARENA_BODY_MESH_ID || d.mesh === "owned-ball-beacon"));
  assert.ok(buffers.at(-1)!.draws!.some(d => d.mesh === "capture-progress-lamp"));
  assert.ok(buffers.at(-1)!.draws!.some(d => d.mesh.startsWith("capture-readout:HOLD:")));
  assert.ok(buffers.at(-1)!.draws!.some(d => d.mesh === "capture-destination-locator:local"));
  for (let i = 0; i < 12; i++) match.step([]);
  frame = match.readFrame(); assert.equal(frame.balls[0]!.transport?.phase, "transit");
  view.render(frame, { timeMs: 120 });
  assert.ok(!buffers.at(-1)!.draws!.some(d => d.mesh === ARENA_BODY_MESH_ID));
  assert.ok(buffers.at(-1)!.draws!.some(d => d.mesh.startsWith("capture-readout:TRANSIT:")));
  for (let i = 0; i < 12; i++) match.step([]);
  frame = match.readFrame(); assert.equal(frame.balls[0]!.transport, null);
  assert.ok(frame.events.some(e => e.type === "capture-release"));
  view.render(frame, { timeMs: 240 });
  assert.ok(buffers.at(-1)!.draws!.some(d => d.mesh === ARENA_BODY_MESH_ID));
  view.render(match.readFrame(), { timeMs: 256 });
  view.dispose();
});
