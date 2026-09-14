// Worn things as attributes: on their own body, built to their socket, they
// land on the voxels they came from; on other bodies (a catalogue human, a
// big-headed bear, a mouse; a cat and a bear on four legs) they scale with the
// socket and sit where they sat; runtime's fits() lets them on only where the
// body contract and the packs agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, stream } from "@keel-engine/core";
import { entityOf, placeAttribute, poseSkeleton, posed, socketsOf, speciesEntity, wear } from "@keel-engine/entity";
import { defineManifest, fits } from "@keel-engine/runtime";
import { SAMPLES, importModel } from "../src/index.ts";
import type { ImportResult } from "../src/index.ts";

const S = () => stream(createRoll("0x2a"), 0);
const load = (name: string): ImportResult => { const s = SAMPLES().find((x) => x.name === name)!; return importModel(s.bytes!, { name, ...(s.options as object) }); };
const knight = load("knight"), dog = load("dog");

test("on its own body, at rest, each worn thing lands on the voxels it came from", () => {
  for (const r of [knight, dog]) {
    const rig = r.rig!;
    const u = rig.model.unit, O = rig.analysis.origin;
    const skel = poseSkeleton(rig.spec.rig, {}, {});
    for (const a of r.attributes) {
      const worn = wear(a.def, rig.spec, S());
      const placed = placeAttribute(skel, worn.socket, worn.design);
      // Every cell the placed boxes cover (own frame -> voxel coordinates), against the part's own cells.
      const covered = new Set<string>();
      for (const b of placed.boxes) {
        const lo = [0, 1, 2].map((k) => Math.round((b.c[k]! - b.h[k]!) / u + O[k]!));
        const hi = [0, 1, 2].map((k) => Math.round((b.c[k]! + b.h[k]!) / u + O[k]!));
        for (let z = lo[2]!; z < hi[2]!; z += 1) for (let y = lo[1]!; y < hi[1]!; y += 1) for (let x = lo[0]!; x < hi[0]!; x += 1) covered.add(`${x},${y},${z}`);
      }
      const own = new Set<string>();
      a.model.forEach((x, y, z) => own.add(`${x},${y},${z}`));
      let inter = 0;
      for (const k of covered) if (own.has(k)) inter += 1;
      const iou = inter / (covered.size + own.size - inter);
      assert.ok(iou > 0.999, `${r.proposal.name} ${a.part}: ${iou.toFixed(4)} (${covered.size} placed, ${own.size} own)`);
    }
  }
});

test("on other bodies they scale with the socket and sit where they sat, as a share of it", () => {
  const helmet = knight.attributes.find((a) => a.part === "helmet")!;
  const sword = knight.attributes.find((a) => a.part === "sword")!;
  const bodies = [entityOf("3", { kind: "humanoid" }), entityOf("4", { kind: "anthro", species: "bear" }), entityOf("5", { kind: "anthro", species: "mouse" })];
  const ratios: number[] = [];
  const lows: number[] = [];
  for (const spec of bodies) {
    const socket = socketsOf(spec)["head"]!;
    const w = wear(helmet.def, spec, S());
    const xs = w.design.boxes.flatMap((b) => [b.c[0] - b.h[0], b.c[0] + b.h[0]]);
    const ys = w.design.boxes.flatMap((b) => [b.c[1] - b.h[1], b.c[1] + b.h[1]]);
    ratios.push((Math.max(...xs) - Math.min(...xs)) / socket.size[0]);
    lows.push(Math.min(...ys) / socket.size[1]);
    // It rides the head through a run.
    const run = placeAttribute(posed(spec, "run", { phase: 0.3 }), w.socket, w.design);
    assert.ok(run.boxes.every((b) => b.c.every(Number.isFinite)));
    // The sword: in the hand socket, pointing ahead (+z), sized to the hand.
    const sw = wear(sword.def, spec, S());
    const zs = sw.design.boxes.flatMap((b) => [b.c[2] - b.h[2], b.c[2] + b.h[2]]);
    assert.ok(Math.max(...zs) > 4 * socketsOf(spec)["hand.R"]!.size[2], "the blade reaches well ahead of the hand");
  }
  // (Width / head width and bottom / head height: the same share on every head.)
  for (const r of ratios) assert.ok(Math.abs(r - helmet.fill) < 1e-9, `${r} vs fill ${helmet.fill}`);
  for (const l of lows) assert.ok(Math.abs(l - lows[0]!) < 1e-9);
  // The collar on a cat and a bear: round their necks, scaled to them.
  const collar = dog.attributes.find((a) => a.part === "collar")!;
  for (const species of ["cat", "bear"] as const) {
    const spec = entityOf("6", { kind: "animal", species });
    const w = wear(collar.def, spec, S());
    const neck = socketsOf(spec)["neck"]!;
    const xs = w.design.boxes.flatMap((b) => [b.c[0] - b.h[0], b.c[0] + b.h[0]]);
    assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) / neck.size[0] - collar.fill) < 1e-9);
    assert.ok(Math.min(...xs) < 0 && Math.max(...xs) > 0, "centred on the neck");
  }
});

test("fits(): the body contract and the packs decide where they may go", () => {
  const imported = defineManifest({ id: "packs/imported", version: "0.1.0", kind: "pack" });
  const open = defineManifest({ id: "packs/imported", version: "0.1.0", kind: "pack", compatible: ["packs/people@^1"] });
  const people = defineManifest({ id: "packs/people", version: "1.0.0", kind: "pack", compatible: ["*"] });
  const shy = defineManifest({ id: "packs/people", version: "1.0.0", kind: "pack" });
  const human = speciesEntity("humanoid", "human");
  const dogDef = speciesEntity("animal", "dog");
  const helmet = knight.attributes.find((a) => a.part === "helmet")!.def;
  const collar = dog.attributes.find((a) => a.part === "collar")!.def;
  assert.deepEqual(helmet.targets, [{ body: "body/humanoid@^1" }]);
  assert.equal(fits({ def: helmet, pack: open }, { def: human, pack: people }).ok, true, "both packs agree");
  assert.equal(fits({ def: helmet, pack: imported }, { def: human, pack: people }).ok, false, "the importing pack hasn't opened itself");
  assert.equal(fits({ def: helmet, pack: open }, { def: human, pack: shy }).ok, false, "the people pack hasn't opened itself");
  const wrong = fits({ def: helmet, pack: open }, { def: dogDef, pack: people });
  assert.equal(wrong.ok, false);
  assert.match(wrong.why, /body\/humanoid@\^1/);
  assert.equal(fits({ def: collar, pack: imported }, { def: dogDef, pack: imported }).ok, true, "the same pack's dog");
});
