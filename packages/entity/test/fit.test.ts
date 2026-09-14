// Attribute fitting: a hat and a backpack, each built to its socket, placed
// on posed entities of both bodies -- they stay on through runs, jumps and
// sits, and their size tracks the socket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, frontOf, stream } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { defineAttribute, defineManifest, fits } from "@keel-engine/runtime";
import type { Socket } from "@keel-engine/runtime";
import {
  HUMANOID_BODY, QUADRUPED_BODY, animator, apply, entityOf, fittedParts, placeAttribute, posed, skinOf, socketFrame, socketsOf, speciesEntity, wear, worldToSocket,
} from "../src/index.ts";
import type { AttributeShape, Capsule, EntitySocket, EntitySpec, Fitted, Kind, Skeleton } from "../src/index.ts";

const sub = (a: Vec3Like, b: Vec3Like): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3Like): number => Math.hypot(a[0], a[1], a[2]);
const sdSeg = (p: Vec3Like, a: Vec3Like, b: Vec3Like): number => {
  const e = sub(b, a);
  const ee = dot(e, e);
  const h = ee > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), e) / ee)) : 0;
  return len(sub(p, [a[0] + e[0] * h, a[1] + e[1] * h, a[2] + e[2] * h]));
};
const sdPart = (caps: readonly Capsule[], part: string, p: Vec3Like): number => Math.min(...caps.filter((c) => c.part === part).map((c) => sdSeg(p, c.a, c.b) - c.r));
const ballOf = (caps: readonly Capsule[], part: string): Capsule => caps.find((c) => c.part === part)!;

/** A hat built to any head socket: a crown up its out, a brim round its base -- sized by the socket. */
const hatFor = (s: Pick<Socket, "size">): AttributeShape => ({
  capsules: [{ a: [0, s.size[1] * 0.1, 0], b: [0, s.size[1] * 0.8, 0], r: s.size[0] * 0.36, part: "hat" }],
  boxes: [{ c: [0, 0, s.size[2] * 0.08], h: [s.size[0] * 0.55, s.size[0] * 0.03, s.size[2] * 0.55], part: "hat.brim", role: "dark" }],
});
/** A backpack built to any back socket: a box standing off the back along its out. */
const packFor = (s: Pick<EntitySocket, "size" | "out">): AttributeShape => {
  const d = s.size[2] * 0.3;
  const up = s.out[1] !== 0;
  const depth = up ? s.size[1] * 0.35 : d;
  return {
    boxes: [{ c: [s.out[0] * depth, s.out[1] * depth, s.out[2] * depth], h: up ? [s.size[0] * 0.4, depth, s.size[2] * 0.4] : [s.size[0] * 0.4, s.size[1] * 0.45, depth], part: "pack" }],
    capsules: [{ a: [-s.size[0] * 0.35, 0, 0], b: [s.size[0] * 0.35, 0, 0], r: s.size[0] * 0.06, part: "pack.strap" }],
  };
};

const CLIPS: Record<"humanoid" | "quadruped", Array<[string, object]>> = {
  humanoid: [["run", { speed: 9 }], ["jump", {}], ["fall", {}], ["sit", {}], ["sit", { seat: 0 }], ["wallRun", { wall: 1, speed: 8 }], ["grind", {}], ["idle", {}]],
  quadruped: [["move", { speed: 8 }], ["gallop", {}], ["leap", {}], ["sit", {}], ["lie", {}], ["idle", {}]],
};

/** On a posed skeleton: the hat and pack ride their bones exactly, the hat's base on the head's skin, the pack on the back. */
function checkOn(spec: EntitySpec, skel: Skeleton, where: string): { hat: Fitted; pack: Fitted } {
  const sockets = socketsOf(spec);
  const head = sockets["head"]!;
  const back = sockets["back"]!;
  const hat = placeAttribute(skel, head, hatFor(head));
  const pack = placeAttribute(skel, back, packFor(back));
  const caps = skinOf(spec, skel);
  const hf = socketFrame(skel, head);
  const bf = socketFrame(skel, back);
  // Riding the bone: back in the socket's frame, every piece is where it was built.
  const design = hatFor(head);
  for (const [i, c] of hat.capsules.entries()) {
    const want = design.capsules![i]!;
    assert.ok(len(sub(worldToSocket(hf, c.a), want.a)) < 1e-9 && len(sub(worldToSocket(hf, c.b), want.b)) < 1e-9, `${where}: the hat rides the head bone`);
  }
  // The base of the hat sits on the head's skin (the crown), the head ball a radius below it.
  const hb = ballOf(caps, "head");
  assert.ok(Math.abs(sdPart(caps, "head", hf.p)) < 1e-9 * (1 + spec.body.headR), `${where}: the hat's base on the head's skin`);
  assert.ok(Math.abs(len(sub(hat.capsules[0]!.a, hb.a)) - len(sub([0, head.size[1] * 0.1, 0], [0, -spec.body.headR, 0]))) < 1e-9, `${where}: the hat keeps its place on the head`);
  // The brim turns with the head: its frame is the bone's.
  assert.deepEqual(hat.boxes[0]!.m, skel.bones["head"]!.m);
  // The pack's anchor on the back's skin, the pack standing off it along out.
  const backPart = spec.plan === "quadruped" ? "body" : "chest";
  // (A person's chest capsule rides the chest bone, so the anchor stays exactly on it. An anthro's runs spine to
  // neck and a quadruped's pelvis to chest, straight, while the bones between bend: the anchor, riding the chest,
  // stays within a few percent of the skin in every gait -- a leap's arched spine is the most, 15% of the radius.)
  const tol = spec.plan === "quadruped" ? 0.16 * spec.body.bodyR : spec.kind === "anthro" ? 0.14 * spec.body.torsoR : 1e-9;
  assert.ok(Math.abs(sdPart(caps, backPart, bf.p)) < tol, `${where}: the pack's anchor on the back (${sdPart(caps, backPart, bf.p)})`);
  const outW = apply(bf.m, back.out);
  assert.ok(dot(sub(pack.boxes[0]!.c, bf.p), outW) > 0, `${where}: the pack stands off the back`);
  assert.ok(sdPart(caps, backPart, pack.boxes[0]!.c) > sdPart(caps, backPart, bf.p) - 1e-9, `${where}: the pack's middle is outside the body`);
  return { hat, pack };
}

test("a hat and a backpack stay on through runs, jumps and sits, on every kind", () => {
  let checked = 0;
  for (const kind of ["humanoid", "anthro", "animal"] as Kind[]) {
    for (let s = 0; s < 40; s += 1) {
      const spec = entityOf(String(s * 3 + 1), { kind });
      for (const [clip, params] of CLIPS[spec.plan]) {
        for (let k = 0; k < 6; k += 1) {
          const yaw = -3 + k * 1.1;
          const skel = posed(spec, clip, { phase: k / 6, t: k * 0.7, yaw, pos: [k, 0, -k], params, landT: 0.05 });
          checkOn(spec, skel, `${kind} ${spec.species} seed ${spec.seed} ${clip} phase ${k / 6}`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 3000);
});

test("through an animator: run, jump, land, sit -- the hat and pack follow every frame", () => {
  for (const kind of ["humanoid", "anthro", "animal"] as Kind[]) {
    for (const seed of ["2", "9", "31"]) {
      const spec = entityOf(seed, { kind });
      const anim = animator(spec);
      const reach = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH;
      const body = { pos: [0, 0, 0] as Vec3, vel: [0, 0, 0] as Vec3, facing: 0.7, mode: "ground" as "ground" | "air" };
      const dt = 1 / 60;
      let lastHat: Vec3 | null = null;
      for (let i = 0; i < 300; i += 1) {
        const t = i * dt;
        const v = t < 2 ? reach * 8 : 0;
        const vy = t >= 2 && t < 2.3 ? 3 : t >= 2.3 && t < 2.6 ? -3 : 0;
        body.mode = vy !== 0 ? "air" : "ground";
        const f = frontOf(body.facing);
        body.vel = [f[0] * v, vy, f[2] * v];
        body.pos = [body.pos[0] + body.vel[0] * dt, Math.max(0, body.pos[1] + vy * dt), body.pos[2] + body.vel[2] * dt];
        if (t > 3.5 && t - dt <= 3.5) anim.hold("sit");
        anim.step(dt, body);
        const { hat } = checkOn(spec, anim.skeleton(), `${kind} seed ${seed} frame ${i} (${anim.state.clip})`);
        // (No jumps: the hat moves with the body, frame to frame, never teleports.)
        const now = hat.capsules[0]!.b;
        if (lastHat) assert.ok(len(sub(now, lastHat)) < spec.body.H * 0.2, `${kind} seed ${seed} frame ${i}: the hat moved ${len(sub(now, lastHat))}`);
        lastHat = now;
      }
      assert.equal(anim.state.clip, "sit");
    }
  }
});

test("the size tracks the socket: the same hat on a mouse and a bear, a person and a cat", () => {
  for (const kind of ["anthro", "animal"] as const) {
    for (const seed of ["1", "4", "8", "15"]) {
      const mouse = entityOf(seed, { kind, species: "mouse" });
      const bear = entityOf(seed, { kind, species: "bear" });
      const [hm, hb] = [socketsOf(mouse)["head"]!, socketsOf(bear)["head"]!];
      const [m, b] = [placeAttribute(posed(mouse, "idle"), hm, hatFor(hm)), placeAttribute(posed(bear, "idle"), hb, hatFor(hb))];
      assert.ok(b.capsules[0]!.r > m.capsules[0]!.r && b.boxes[0]!.h[0] > m.boxes[0]!.h[0], `${kind} seed ${seed}: a bear's hat is bigger`);
      // (In proportion to the head it sits on, always the same hat.)
      assert.ok(Math.abs(m.capsules[0]!.r / mouse.body.headR - b.capsules[0]!.r / bear.body.headR) < 1e-12);
      const [pm, pb] = [socketsOf(mouse)["back"]!, socketsOf(bear)["back"]!];
      assert.ok(packFor(pb).boxes![0]!.h[0] > packFor(pm).boxes![0]!.h[0], `${kind} seed ${seed}: a bear's pack is bigger`);
    }
  }
  const person = entityOf("3", { kind: "humanoid" });
  const cat = entityOf("3", { kind: "anthro", species: "cat" });
  assert.ok(socketsOf(cat)["head"]!.size[0] > socketsOf(person)["head"]!.size[0], "an anthro's big head takes a bigger hat than a person's");
});

test("a runtime attribute: fits() by body contract, built to the socket with wear(), placed, and as scene parts", () => {
  const beanie = defineAttribute<AttributeShape>({
    id: "beanie", slot: "head", targets: [{ body: HUMANOID_BODY.range }, { body: QUADRUPED_BODY.range }],
    choices: { pompom: [true, false] },
    build: (S, fit, pins) => {
      const pom = pins["pompom"] ?? S.chance(0.5);
      const hat = hatFor(fit);
      return pom ? { ...hat, capsules: [...hat.capsules!, { a: [0, fit.size[1] * 0.95, 0], b: [0, fit.size[1] * 0.95, 0], r: fit.size[0] * 0.12, part: "pompom" }] } : hat;
    },
  });
  const pack = defineManifest({ id: "packs/zoo", version: "1.0.0", kind: "pack", provides: [QUADRUPED_BODY.ref, HUMANOID_BODY.ref] });
  for (const def of [speciesEntity("animal", "dog"), speciesEntity("anthro", "fox"), speciesEntity("humanoid", "human")]) {
    assert.ok(fits({ def: beanie, pack }, { def, pack }).ok);
    const spec = def.build(stream(createRoll("0x7"), 0), {});
    const worn = wear(beanie, spec, stream(createRoll("0x7"), 1), { pompom: true });
    assert.deepEqual(worn.socket, socketsOf(spec)["head"]);
    assert.equal(worn.design.capsules!.length, 2);
    const skel = posed(spec, spec.plan === "quadruped" ? "gallop" : "run", { phase: 0.3, yaw: 1 });
    const fitted = placeAttribute(skel, worn.socket, worn.design, { materials: { accent: 11, dark: 12 } });
    assert.deepEqual(fitted.capsules.map((c) => [c.part, c.mat]), [["hat", 11], ["pompom", 11]]);
    assert.equal(fitted.boxes[0]!.mat, 12);
    // As scene parts: SDFs a scene can bound, ray and touch -- the pompom's centre is inside its part.
    const parts = fittedParts(fitted);
    assert.equal(parts.length, 3);
    const pom = fitted.capsules[1]!;
    assert.ok(parts[1]!.sdf(pom.a[0], pom.a[1], pom.a[2]) < 0);
    const brim = fitted.boxes[0]!;
    assert.ok(parts[2]!.sdf(brim.c[0], brim.c[1], brim.c[2]) < 0);
    const edge = apply(brim.m, [brim.h[0] * 1.2, 0, 0]);
    assert.ok(parts[2]!.sdf(brim.c[0] + edge[0], brim.c[1] + edge[1], brim.c[2] + edge[2]) > 0, "the brim turns with its bone, as scene parts too");
  }
  // A slot the body hasn't got.
  const glove = defineAttribute<AttributeShape>({ id: "glove", slot: "hand.R", targets: [{ body: HUMANOID_BODY.range }], build: () => ({}) });
  assert.throws(() => wear(glove, entityOf("1", { kind: "animal" }), stream(createRoll("0x1"), 0)), /no such socket/);
});
