import { test } from "node:test";
import assert from "node:assert/strict";
import { poseSkeleton } from "@keel-engine/entity";
import { stream, createRoll } from "@keel-engine/core";
import { slotOf } from "@keel-engine/object";
import { ROBOT_ROLES, ROBOT_FAMILIES, ROBOT_BODY_CONTRACT, createRobotGenome, validateRobotGenome, robotIdentityKey, robotAttributes, createRobotDesign, robotPrototypeFoldMesh, robotPaint, robotEntity, defineRobotFamily } from "../src/index.ts";

test("named parts use independent streams and every form keeps the exact resolved identity", () => {
  for (const family of ROBOT_FAMILIES) {
    const g = createRobotGenome("cafe", { family: family.id }), face = family.faces.find(([base]) => base !== g.face.base)![0], pinned = createRobotGenome("cafe", { family: family.id, face });
    assert.notDeepEqual(pinned.face, g.face); for (const site of ["hull", "shell", "limbs", "material", "livery", "gear"] as const) assert.deepEqual(pinned[site], g[site], `face pin must preserve ${site}`);
    const robot = createRobotDesign(g), before = JSON.stringify(g); assert.equal(robot.identity, robotIdentityKey(g)); assert.deepEqual(validateRobotGenome(JSON.parse(before)), g);
    for (const form of ["rolled", "portrait", "unfolded"] as const) { const mesh = robot.mesh(form); assert.ok(mesh.indices.length); assert.ok([...mesh.positions, ...mesh.normals].every(Number.isFinite)); assert.equal(JSON.stringify(robot.genome), before); }
    assert.deepEqual(robotAttributes(robot.genome), robotAttributes(g)); assert.equal(JSON.stringify(g), before);
    const palettes = createRobotGenome("cafe", { family: family.id, palette: g.material.base === "oxide-cream" ? "signal-cobalt" : "oxide-cream" }); assert.deepEqual(palettes.hull, g.hull); assert.deepEqual(palettes.face, g.face); assert.deepEqual(palettes.limbs, g.limbs);
  }
});

test("all family/seed rolled vertices fit the physical unit sphere with outward faces", () => {
  const signatures = new Set<string>();
  for (const family of ROBOT_FAMILIES) for (let seed = 1; seed <= 32; seed++) {
    const g = createRobotGenome(seed.toString(16), { family: family.id }), mesh = createRobotDesign(g).mesh("rolled");
    for (let i = 0; i < mesh.positions.length; i += 3) assert.ok(Math.hypot(...mesh.positions.slice(i, i + 3)) <= 1.000001);
    for (let i = 0; i < mesh.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(...mesh.normals.slice(i, i + 3)) - 1) < .00001, "folded panels retain finite unit surface normals");
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const p = [0, 1, 2].map(n => [...mesh.positions.slice(mesh.indices[i + n]! * 3, mesh.indices[i + n]! * 3 + 3)]), a = p[1]!.map((n, k) => n - p[0]![k]!), b = p[2]!.map((n, k) => n - p[0]![k]!), cross = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
      assert.ok(cross.reduce((n, v, k) => n + v * p[0]![k]!, 0) >= -.000001, "visible shell faces point outward");
    }
    assert.ok(mesh.indices.length <= 6000, "bounded mesh topology"); if (seed === 1) signatures.add(JSON.stringify([...mesh.positions, ...mesh.attrs]));
  }
  assert.equal(signatures.size, ROBOT_FAMILIES.length, "different shell segmentation and face grammar survive rolled form");
});

test("all resolved rolled face marks stay in front of the actual opaque shell facets", () => {
  const glow = slotOf(ROBOT_ROLES, "glow"), dot = (a: readonly number[], b: readonly number[]) => a.reduce((n, v, i) => n + v * b[i]!, 0);
  for (const family of ROBOT_FAMILIES) for (const [face] of family.faces) {
    const mesh = createRobotDesign(createRobotGenome("cafe", { family: family.id, face })).mesh("rolled"), triangles = [], marks = new Set<number>();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ids = [mesh.indices[i]!, mesh.indices[i + 1]!, mesh.indices[i + 2]!];
      if (mesh.attrs[ids[0]! * 4] === glow) { for (const id of ids) marks.add(id); continue; }
      const p = ids.map(id => [...mesh.positions.slice(id * 3, id * 3 + 3)]), u = p[1]!.map((v, axis) => v - p[0]![axis]!), v = p[2]!.map((v, axis) => v - p[0]![axis]!);
      const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!], uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), denominator = uu * vv - uv * uv;
      if (denominator > 1e-14) triangles.push({ p: p[0]!, u, v, normal, uu, uv, vv, denominator });
    }
    assert.ok(marks.size, "the actual rolled mesh retains the resolved face");
    for (const id of marks) {
      const p = [...mesh.positions.slice(id * 3, id * 3 + 3)], radius = Math.hypot(...p), direction = p.map(v => v / radius); let opaqueRadius = 0;
      for (const t of triangles) {
        const facing = dot(t.normal, direction); if (facing <= 1e-12) continue;
        const distance = dot(t.normal, t.p) / facing, q = direction.map((v, axis) => v * distance - t.p[axis]!);
        const qu = dot(q, t.u), qv = dot(q, t.v), a = (t.vv * qu - t.uv * qv) / t.denominator, b = (t.uu * qv - t.uv * qu) / t.denominator;
        if (a >= -1e-6 && b >= -1e-6 && a + b <= 1.000001) opaqueRadius = Math.max(opaqueRadius, distance);
      }
      assert.ok(opaqueRadius > .70, "every face mark has an actual shell underneath");
      assert.ok(radius - opaqueRadius > .0001 && radius - opaqueRadius < .025, `${family.id}/${face} mark must sit above the actual facet, not an analytic sphere`);
    }
  }
});

test("canonical entity definitions provide actual fold bones and deterministic explicit skins", () => {
  for (const family of ROBOT_FAMILIES) {
    const entity = robotEntity(family), robot = entity.build(stream(createRoll("cafe"), 0), { seed: "cafe" }); assert.equal(entity.body, ROBOT_BODY_CONTRACT.ref);
    for (const name of ROBOT_BODY_CONTRACT.requiredBones) assert.ok(robot.rig.index[name] !== undefined);
    const skeleton = poseSkeleton(robot.rig), skin = robot.skin(skeleton); assert.ok(skin.capsules.length && skin.boxes.length); assert.deepEqual(robot.skin(skeleton), skin);
    assert.ok(Object.keys(entity.sockets(robot)).includes("face")); assert.ok(robotPaint(robot.genome).length > 5);
    const base = robot.mesh("unfolded"); assert.deepEqual(robotPrototypeFoldMesh(robot.genome, 1).positions, base.positions);
    for (const amount of [0, .25, .50, .75, 1]) { const mesh = robotPrototypeFoldMesh(robot.genome, amount); assert.ok([...mesh.positions, ...mesh.normals].every(Number.isFinite)); assert.deepEqual(robotPrototypeFoldMesh(robot.genome, amount).positions, mesh.positions, "rerender has no pose accumulator"); }
    assert.throws(() => robotPrototypeFoldMesh(robot.genome, NaN)); assert.throws(() => entity.build(stream(createRoll("cafe"), 0), { seed: "cafe", family: "other-family" }));
  }
});

test("resolved JSON fails closed on seed/part/geometry edits and admits an additional named family", () => {
  const g = createRobotGenome("cafe");
  assert.throws(() => validateRobotGenome({ ...g, generatorVersion: "pinball-robots/2026-10-07.1" } as any), "an earlier resolved identity cannot silently use a changed shell implementation");
  for (const change of [(x: any) => x.face.width = NaN, (x: any) => x.shell.panels = 99, (x: any) => x.seed = "0x01", (x: any) => x.gear.base = "unregistered", (x: any) => x.extra = true, (x: any) => x.extra = undefined, (x: any) => x.extra = () => 1, (x: any) => x[Symbol("hidden")] = true, (x: any) => Object.defineProperty(x, "hidden", { get: () => 1 })]) { const fake = JSON.parse(JSON.stringify(g)); change(fake); assert.throws(() => validateRobotGenome(fake)); }
  assert.throws(() => createRobotGenome("cafe", { face: "unknown" })); assert.throws(() => createRobotGenome("cafe", { typo: "x" } as any));
  const family = defineRobotFamily({ ...ROBOT_FAMILIES[0]!, id: "salt-courier", title: "Salt Courier", body: [.31, .38, .24] }), custom = createRobotGenome("cafe", { family: family.id }, [family]);
  assert.equal(custom.family.title, "Salt Courier"); assert.deepEqual(validateRobotGenome(custom, [family]), custom);
  assert.ok(createRobotDesign(custom, [family]).mesh("unfolded").indices.length);
  for (const site of ["hulls", "faces", "gear"] as const) assert.throws(() => defineRobotFamily({ ...family, [site]: [["missing-geometry", 1]] }), "unknown bases cannot silently render a fallback part");
  assert.throws(() => defineRobotFamily({ ...family, limbs: 5 })); assert.throws(() => defineRobotFamily({ ...family, body: [.3, .2] } as any)); assert.throws(() => defineRobotFamily({ ...family, extra: true } as any));
  assert.throws(() => robotEntity({ ...family, hulls: [["missing-geometry", 1]] }), "pack discovery rejects unimplemented geometry before exposing choices");
  const editable = JSON.parse(JSON.stringify(family)), entity = robotEntity(editable); editable.title = "mutated"; editable.hulls[0][0] = "unregistered";
  assert.equal(entity.title, "Salt Courier"); assert.ok(Array.isArray(entity.choices?.hull)); assert.ok((entity.choices!.hull as readonly string[]).includes(family.hulls[0]![0]));
  assert.throws(() => defineRobotFamily({ ...family, id: "custom/salt-courier" }), "family grammar agrees with canonical entity discovery ids");
  assert.ok(Object.isFrozen(ROBOT_BODY_CONTRACT.requiredBones) && Object.isFrozen(ROBOT_BODY_CONTRACT.sockets) && Object.isFrozen(ROBOT_BODY_CONTRACT.forms));
});

test("every named hull and gear base has distinct source geometry at a fixed seed", () => {
  const hulls = new Map<string, string>(), gears = new Map<string, string>();
  for (const family of ROBOT_FAMILIES) {
    for (const [hull] of family.hulls) { const robot = createRobotDesign(createRobotGenome("cafe", { family: family.id, hull })), skin = robot.skin(poseSkeleton(robot.rig)); hulls.set(hull, JSON.stringify([...skin.boxes, ...skin.capsules].filter(p => p.part.startsWith("body.")))); }
    for (const [gear] of family.gear) { const robot = createRobotDesign(createRobotGenome("cafe", { family: family.id, gear })), skin = robot.skin(poseSkeleton(robot.rig)); gears.set(gear, JSON.stringify([...skin.boxes, ...skin.capsules].filter(p => p.part.startsWith("gear.")))); }
  }
  assert.equal(hulls.size, 8); assert.equal(new Set(hulls.values()).size, 8); assert.equal(gears.size, 4); assert.equal(new Set(gears.values()).size, 4);
});

test("retracted gear remains distinct on rolled shells without changing the other seeded parts", () => {
  for (const family of ROBOT_FAMILIES) {
    const meshes = new Set<string>(), before = createRobotGenome("cafe", { family: family.id });
    for (const [gear] of family.gear) {
      const genome = createRobotGenome("cafe", { family: family.id, gear });
      for (const site of ["hull", "face", "shell", "limbs", "material", "livery"] as const) assert.deepEqual(genome[site], before[site]);
      const mesh = createRobotDesign(genome).mesh("rolled"); meshes.add(JSON.stringify([...mesh.positions, ...mesh.attrs]));
    }
    assert.equal(meshes.size, family.gear.length, "each admitted gear base produces its own retracted hatch geometry");
  }
});
