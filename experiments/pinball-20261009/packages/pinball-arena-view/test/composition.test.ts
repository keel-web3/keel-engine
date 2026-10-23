import { test } from "node:test";
import assert from "node:assert/strict";
import { projectionOf, meshMatrix, lookMesh, type LookMesh, type MeshGBuffer } from "@keel-engine/bake";
import { slotOf } from "@keel-engine/object";
import { createArenaMatch } from "@keel-engine/pinball-arena";
import { field, player, worldFrom, pairedFlipperWorld } from "../../pinball-arena/test/fixtures.ts";
import { PINBALL_SCENE_BLUEPRINTS, planPinballSceneGenome, validatePinballSceneGenome, worldArtPaint } from "@keel-engine/pinball-world-art";
import { standIn } from "../../render/test/gl-stand-in.ts";
import { compilePinballMachine } from "../../pinball-arena-gen/src/machine.ts";
import { createPinballArenaView } from "../src/view.ts";
import { arenaArtRegionAt } from "../src/scene-regions.ts";
import { arenaCatchYaw } from "../src/camera.ts";
import { arenaBodyCutaway, arenaTransformedBodyCutaway } from "../src/cutaway.ts";
import { arenaStructuralRim, arenaEnvironmentFloor, arenaFoundationHeight, arenaPivotHousing, ARENA_STRUCTURE_ROLES, arenaCatchSideMachinery } from "../src/structural-art.ts";
import { arenaChamberBoundary, arenaEnvironmentMount, arenaTrackFoundation } from "../src/construction.ts";
import { pinballEnvironmentClear, planPinballFraming, pinballCatchFronts, pinballCatchFrontClear } from "@keel-engine/pinball-world-art";

test("overlapping regions and same-seed recipes retain their exact canonical materials in real mesh draws", () => {
  const original = planPinballSceneGenome("cafe", 0, PINBALL_SCENE_BLUEPRINTS.cyber), red = validatePinballSceneGenome({ ...original, material: { tones: { ...original.material.tones, ground: [10, .12, .48] } } }), blue = validatePinballSceneGenome({ ...original, material: { tones: { ...original.material.tones, ground: [210, .12, .48] } } });
  assert.equal(red.seed, blue.seed);
  const defaults = field(), biome = defaults.regions[0]!.biome, source = field({ scene: original, regions: defaults.regions.map((r, i) => ({ ...r, bounds: defaults.bounds, center: { x: i ? 1050 : 390, y: 450 } })), stations: defaults.stations.map((s, i) => i ? s : { ...s, x: 1050, y: 450, launchX: 1050, launchY: 450 }), sceneRegions: [{ regionId: "start", scene: red }, { regionId: "arrival", scene: blue }], surfaces: [390, 1050].map((x, i) => ({ id: i ? "blue-bed" : "red-bed", kind: "playfield", polygon: [{ x: x - 210, y: 200 }, { x: x + 210, y: 200 }, { x: x + 210, y: 700 }, { x: x - 210, y: 700 }], layer: 0, height: 0, material: "pinball-inlay", biome })) });
  assert.equal(arenaArtRegionAt(source, 720, 450), "start", "source order owns an exact center tie");
  const match = createArenaMatch(worldFrom([source]), { players: [player()], mode: "expedition" }), frame = match.readFrame(), before = JSON.stringify(frame);
  assert.equal(frame.balls[0]!.regionId, "arrival");
  const fake = standIn({ width: 800, height: 600 }), buffers: MeshGBuffer[] = [], view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 800, height: 600, density: "low", onMeshFrame: buffer => buffers.push(buffer) });
  view.setWorld(match.world); view.render(frame, { timeMs: 0, camera: { mode: "overview" } });
  const draws = buffers[0]!.draws!, a = draws.find(d => d.mesh.includes("/surface/red-bed"))!, b = draws.find(d => d.mesh.includes("/surface/blue-bed"))!;
  assert.ok(a && b); assert.notEqual(a.look, b.look); assert.equal(JSON.stringify(frame), before); view.dispose();
});

test("each rotated physical flipper pair reads horizontally with down-table pointing down-screen", () => {
  const source = pairedFlipperWorld().arenas[0]!, bank = source.stations[0]!;
  for (let turn = 0; turn < 4; turn++) {
    const a = turn * Math.PI / 2, co = Math.cos(a), si = Math.sin(a), rotate = (x: number, y: number) => [co * x - si * y, si * x + co * y] as const;
    const rotated = { ...source, hazards: (source.hazards ?? []).map(h => { const [x, y] = rotate(h.x, h.y); return { ...h, x, y }; }), flippers: source.flippers.map(f => { const [x, y] = rotate(f.pivotX, f.pivotY); return { ...f, pivotX: x, pivotY: y }; }) }, yaw = arenaCatchYaw(rotated, bank), view = projectionOf({ kind: "ortho", center: [0, 0, 0], yaw, pitch: 1.1, k: 1 }, 320, 320, 400);
    const [left, right] = rotated.flippers.map(f => view.project([f.pivotX, 0, f.pivotY])); assert.ok(Math.abs(left![1] - right![1]) < .0001); assert.ok(right![0] < left![0], "native side labels remain unchanged by presentation orientation");
    const origin = view.project([0, 0, 0]), downhill = rotate(0, 100), screen = view.project([downhill[0], 0, downhill[1]]); assert.ok(screen[1] > origin[1]);
  }
});

test("recessed floor, chassis and low pivot geometry preserve the admitted authority object", () => {
  const source = pairedFlipperWorld().arenas[0]!, scene = planPinballSceneGenome("cafe", 0, PINBALL_SCENE_BLUEPRINTS.cyber), before = JSON.stringify(source);
  const surface = { id: "bed", kind: "playfield" as const, polygon: [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 1600 }, { x: 100, y: 1600 }], layer: 0, height: 0, material: "pinball-inlay", biome: scene.biome };
  const rim = arenaStructuralRim(surface, .025, scene), floor = arenaEnvironmentFloor(source, .025, scene), hub = arenaPivotHousing(source.flippers[0]!, .025, scene, 0, false);
  assert.ok(rim.indices.length && floor.indices.length && hub.indices.length);
  assert.ok(Array.from(rim.positions).filter((_, i) => i % 3 === 1).every(y => y <= 0));
  assert.ok(Array.from(floor.positions).filter((_, i) => i % 3 === 1).every(y => y <= -32 * .025), "all dimensional environment parts remain below native support");
  assert.ok(Array.from(hub.positions).filter((_, i) => i % 3 === 1).every(y => y <= source.flippers[0]!.radius * .025 * .5 + .001));
  assert.equal(JSON.stringify(source), before);
});

test("recessed theme volumes follow real bay geometry, retain one foundation and respect per-vertex low decks", () => {
  const original = pairedFlipperWorld().arenas[0]!;
  const native = { id: "native-rising-bed", kind: "playfield" as const, polygon: [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 1600 }, { x: 100, y: 1600 }], layer: 0, height: 50, vertexElevations: [-20, 115, 115, -20], material: "pinball-inlay", biome: original.regions[0]!.biome };
  const source = { ...original, surfaces: [native] }, before = JSON.stringify(source), signatures = new Set<string>();
  for (const blueprint of Object.values(PINBALL_SCENE_BLUEPRINTS)) {
    const current = planPinballSceneGenome("cafe", 0, blueprint), scene = { ...current, environment: { ...current.environment!, substrate: { ...current.environment!.substrate!, layout: "lattice" as const } } }, mesh = arenaEnvironmentFloor(source, .025, scene), again = arenaEnvironmentFloor(source, .025, scene);
    assert.deepEqual(mesh.positions, again.positions); assert.deepEqual(mesh.indices, again.indices);
    const lowest = Math.min(...source.surfaces.flatMap(s => s.vertexElevations ?? [s.height]));
    for (let i = 1; i < mesh.positions.length; i += 3) assert.ok(mesh.positions[i]! <= (lowest - 32) * .025 + .00001);
    assert.ok(mesh.indices.length > 100, "surroundings include actual dimensional masses");
    signatures.add(JSON.stringify([...mesh.positions, ...mesh.indices]));
    const invalid = { ...scene, environment: { ...scene.environment!, substrate: { ...scene.environment!.substrate!, rise: 1000 } } };
    assert.throws(() => arenaEnvironmentFloor(source, .025, invalid), /playable plane/);
  }
  assert.equal(signatures.size, Object.keys(PINBALL_SCENE_BLUEPRINTS).length, "themes own different relief rather than recoloring a shared foundation");
  assert.equal(JSON.stringify(source), before);
});

test("screen-side mapping follows the actual rendered canonical pair without changing input or frame", () => {
  const world = pairedFlipperWorld(), match = createArenaMatch(world, { players: [player()], mode: "expedition" }), frame = match.readFrame(), before = JSON.stringify(frame), fake = standIn({ width: 800, height: 600 }), view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { width: 800, height: 600, density: "low" });
  view.setWorld(world);
  for (const [yaw, left, right] of [[0, "left", "right"], [Math.PI, "right", "left"]] as const) {
    view.render(frame, { timeMs: 0, camera: { mode: "follow", yaw } }); const mapping = view.inputSideMapping(frame);
    assert.ok(mapping); assert.equal(mapping.left, left); assert.equal(mapping.right, right); assert.equal(mapping.stationId, frame.balls[0]!.stationId);
    assert.ok(view.project(world.arenas[0]!.flippers.find(f => f.id === mapping.leftFlipperId)!.pivotX, 1500)![0] < view.project(world.arenas[0]!.flippers.find(f => f.id === mapping.rightFlipperId)!.pivotX, 1500)![0]);
  }
  assert.equal(JSON.stringify(frame), before); view.dispose();
});

test("cutaway removes only the foreground aperture and preserves untouched source geometry", () => {
  const view = projectionOf({ kind: "ortho", center: [0, 0, 0], yaw: 0, pitch: Math.PI / 2, k: 10 }, 320, 320, 400), body = view.project([0, 0, 0]);
  const triangle = (height: number): LookMesh => ({ positions: Float32Array.from([-4, height, -4, 4, height, -4, 0, height, 4]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]), attrs: new Float32Array(12), indices: Uint32Array.from([0, 1, 2]), bodies: new Float32Array(9) });
  const front = triangle(10), original = [...front.positions], cut = arenaBodyCutaway(front, view, body, 8); assert.ok(cut); assert.deepEqual([...front.positions], original);
  assert.ok([...cut.positions, ...cut.normals, ...cut.attrs].every(Number.isFinite)); assert.ok(cut.indices.length > 3, "local outside polygon remains solid");
  for (let i = 0; i < cut.indices.length; i += 3) { const points = [0, 1, 2].map(j => { const n = cut.indices[i + j]! * 3; return view.project([cut.positions[n]!, cut.positions[n + 1]!, cut.positions[n + 2]!]); }); const x = points.reduce((n, p) => n + p[0], 0) / 3, y = points.reduce((n, p) => n + p[1], 0) / 3; assert.ok(x <= body[0] - 8 || x >= body[0] + 8 || y <= body[1] - 8 || y >= body[1] + 8); }
  assert.equal(arenaBodyCutaway(triangle(-10), view, body, 8), null, "background stays opaque and whole");
});

test("all authored structure roles bind real distinct paint slots and missing materials fail closed", () => {
  for (const blueprint of Object.values(PINBALL_SCENE_BLUEPRINTS)) {
    const scene = planPinballSceneGenome("cafe", 0, blueprint), paint = worldArtPaint(ARENA_STRUCTURE_ROLES, "binding", scene.biome, scene.material.tones);
    const construction = scene.environment!.construction!;
    for (const role of new Set([...scene.structure!.rim.map(b => b.role), ...scene.structure!.hubs.map(h => h.role), ...construction.boundary!.parts.map(p => p.role), ...construction.mounts.flatMap(m => m.parts.map(p => p.role))])) { const id = slotOf(ARENA_STRUCTURE_ROLES, role); assert.ok(id > 0 && paint[id]); const difference=(paint[id]!.look.hue-scene.material.tones[role]![0])*Math.PI/180;
      // Profile ±3°, integer world pin and canonical core's5° hue quantizer.
      assert.ok(Math.abs(Math.atan2(Math.sin(difference),Math.cos(difference)))*180/Math.PI<=6.0001);
    }
  }
  const world = pairedFlipperWorld(), scene = planPinballSceneGenome("cafe", 0, PINBALL_SCENE_BLUEPRINTS.cyber), native = compilePinballMachine({ id: "native-casing", seed: "cafe", attempt: 0, origin: { x: 3000, y: 2000 }, ownerId: 0, teamId: 0, variation: false }), sides = arenaCatchSideMachinery(native, native.stations[0]!, .025, scene);
  assert.ok(sides.indices.length > 0, "native funnel guide chains receive a solid local casing");
  assert.throws(() => arenaPivotHousing(world.arenas[0]!.flippers[0]!, .025, { ...scene, structure: { rim: [], hubs: [{ ...scene.structure!.hubs[0]!, role: "unbound" }] } }, 0, false), /Unbound/);
});

test("theme construction fills safe native exterior intervals and mounts real objects to their foundation", () => {
  const source = compilePinballMachine({ id: "construction-fixture", seed: "cafe", attempt: 0, origin: { x: 4000, y: 3000 }, ownerId: 0, teamId: 0, variation: false }), before = JSON.stringify(source), scene = planPinballSceneGenome("cafe", 0, PINBALL_SCENE_BLUEPRINTS.cyber);
  const surface = source.surfaces.find(s => s.kind === "playfield")!, wall = arenaChamberBoundary(source, surface, .025, scene);
  assert.ok(wall.indices.length); assert.ok([...wall.positions, ...wall.normals].every(Number.isFinite));
  for (let i = 0; i < wall.positions.length; i += 3) assert.ok(pinballEnvironmentClear(source, { x: wall.positions[i]! / .025, y: wall.positions[i + 2]! / .025 }, 0, 0), "complete wall geometry stays outside native physical footprints");
  const framing = planPinballFraming(source, { family: "loop-gallery", sceneBlueprint: PINBALL_SCENE_BLUEPRINTS.cyber, seed: "cafe", unitScale: .025 });
  const items = framing.chunks.flatMap(chunk => chunk.instances.map(item => ({ item, layer: chunk.layer }))), mounts = items.map(({ item, layer }) => arenaEnvironmentMount(source, item, layer, .025, scene));
  assert.ok(mounts.some(m => m.indices.length > 0));
  for (const [{ item, layer }, mesh] of items.map((item, i) => [item, mounts[i]!] as const)) if (scene.environment!.construction!.mounts.some(m => m.assetId === item.assetId) && item.z > arenaFoundationHeight(source, scene) + 4) {
    assert.equal(source.surfaces.find(s => s.id === item.anchorSurfaceId)!.layer, layer); assert.ok(mesh.indices.length, "every generated raised socket has its complete admitted mounting geometry");
  }
  assert.ok(mounts.flatMap(m => [...m.positions]).every(Number.isFinite)); assert.equal(JSON.stringify(source), before);
  const track = { ...surface, id: "raised-native-track", kind: "bridge" as const, polygon: [{ x: 6000, y: 2984 }, { x: 6200, y: 2984 }, { x: 6200, y: 3016 }, { x: 6000, y: 3016 }], layer: 1, height: 115, vertexElevations: [100, 130, 130, 100] };
  assert.ok(arenaTrackFoundation(source, track, 0, .025, scene).indices.length); assert.equal(arenaTrackFoundation(source, track, 1, .025, scene).indices.length, 0, "support cadence belongs to stable source segment identity");
  const raised = { ...surface, id: "upper-native-bed", layer: 1, height: 115, polygon: surface.polygon.map(p => ({ x: p.x + 2400, y: p.y })) }, layers = { ...source, surfaces: [...source.surfaces, raised] };
  assert.deepEqual(arenaEnvironmentFloor(layers, .025, scene, layers.bounds, 0).positions, arenaEnvironmentFloor(layers, .025, scene, layers.bounds, 1).positions, "the native foundation does not jump when the active camera changes layer");
});

test("native catch front keeps its attached rim while raised facade sections leave the real drain opening",()=>{
  const source=pairedFlipperWorld().arenas[0]!,scene=planPinballSceneGenome("cafe",0,PINBALL_SCENE_BLUEPRINTS.cyber),surface={id:"front-opening-bed",kind:"playfield"as const,polygon:[{x:250,y:1100},{x:950,y:1100},{x:950,y:1740},{x:250,y:1740}],height:0,layer:0,material:"pinball-inlay",biome:scene.biome},field={...source,surfaces:[surface]},before=JSON.stringify(field),fronts=pinballCatchFronts(field),wall=arenaChamberBoundary(field,surface,.025,scene),rim=arenaStructuralRim(surface,.025,scene);
  assert.ok(wall.indices.length>0,"side and upfield masses remain solid");assert.ok(rim.indices.length>0,"native attached apron survives");
  for(let i=0;i<wall.positions.length;i+=3){const point={x:wall.positions[i]!/.025,y:wall.positions[i+2]!/.025};assert.ok(pinballCatchFrontClear(fronts,point,0,surface.layer,surface.height,wall.positions[i+1]!/.025),"no raised facade fragment enters the declared down-table window");}
  assert.equal(JSON.stringify(field),before);
});

test("posed and transformed scenery cutaway preserves native paint coordinates and does not double pose", () => {
  const view = projectionOf({ kind: "ortho", center: [0, 0, 0], yaw: 0, pitch: Math.PI / 2, k: 10 }, 320, 320, 400), mesh = lookMesh({ boxes: [{ c: [0, 0, 0], h: [4, 1, 4], mat: 1 }] }), before = [...mesh.positions], parts = meshMatrix({ y: 2 }), matrix = meshMatrix({ y: 8 }), cut = arenaTransformedBodyCutaway(mesh, view, view.project([0, 0, 0]), 8, matrix, parts);
  assert.ok(cut); assert.deepEqual([...mesh.positions], before); assert.ok([...cut.bodies].every(n => n >= 0 && n <= 1));
  assert.ok([...cut.positions].filter((_, i) => i % 3 === 1).every(y => y >= 9 && y <= 11), "pose and instance translation each apply exactly once");
  const rotor = lookMesh({ boxes: [{ c: [0, 0, 0], h: [4, 1, .1], mat: 1 }] });
  assert.ok(arenaTransformedBodyCutaway(rotor, view, view.project([0, 0, 3]), 5, matrix, meshMatrix({ yaw: Math.PI / 2 })), "rotating a part can bring foreground over a body outside the unposed envelope");
});
