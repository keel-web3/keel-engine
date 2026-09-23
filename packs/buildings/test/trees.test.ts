// packs/buildings city trees: every climate grows only its own species (every PlantKind resolves inside the climate),
// no design wider than its kind's crown is drawn wider (treeFit), the crowns the street plan keeps are the same in every
// climate, the seasons turn the paints and strip the broadleaf trees in a temperate winter -- and NOTHING FLOATS: every
// solid of every design (summer and bare) touches the ground or, through a chain of touching solids, something that
// does. A branch that starts in the air, a clump the lean carried off its limb, a frond off its crown all fail here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANT_CROWNS, TREE_CLIMATES, TREE_FLORA, cityTreeDesigns, climateSpecies, treeBare, treeFit, treeSeasonPaint, treeSpecies } from "../src/index.ts";
import type { TreeDesign } from "../src/index.ts";

const KINDS = ["street", "tree", "palm", "conifer", "bush", "hedge", "flowers", "grass"] as const;

type Seg = { a: readonly number[]; b: readonly number[]; r: number };
/** A design's solids as fat segments (a box as its centre with its half-diagonal: generous, never too strict). */
const solidsOf = (d: TreeDesign): Seg[] => [
  ...(d.world.capsules ?? []).map((c) => ({ a: Array.from(c.a), b: Array.from(c.b), r: c.r })),
  ...(d.world.boxes ?? []).map((b) => ({ a: Array.from(b.c), b: Array.from(b.c), r: Math.hypot(b.h[0]!, b.h[1]!, b.h[2]!) })),
];
/** The closest distance between two segments (sampled finely: exact enough at these sizes). */
const segDist = (p: Seg, q: Seg): number => {
  let best = Infinity;
  const N = 12;
  for (let i = 0; i <= N; i += 1) {
    const t = i / N, x = p.a.map((v, k) => v + (p.b[k]! - v) * t);
    const ab = q.b.map((v, k) => v - q.a[k]!), l2 = ab.reduce((s, v) => s + v * v, 0) || 1;
    const u = Math.max(0, Math.min(1, x.reduce((s, v, k) => s + (v - q.a[k]!) * ab[k]!, 0) / l2));
    best = Math.min(best, Math.hypot(...x.map((v, k) => v - (q.a[k]! + ab[k]! * u))));
  }
  return best;
};
/** The solids not connected to the ground through touching solids. */
function floating(d: TreeDesign): number[] {
  const S = solidsOf(d), grounded = new Array<boolean>(S.length).fill(false), todo: number[] = [];
  S.forEach((s, i) => { if (Math.min(s.a[1]!, s.b[1]!) - s.r <= 0.05) { grounded[i] = true; todo.push(i); } });
  while (todo.length) {
    const i = todo.pop()!;
    S.forEach((s, j) => { if (!grounded[j] && segDist(S[i]!, s) <= S[i]!.r + s.r + 0.02) { grounded[j] = true; todo.push(j); } });
  }
  return S.map((_, i) => i).filter((i) => !grounded[i]);
}

test("nothing floats: every solid of every design (summer and winter-bare) touches the ground or a solid that does", () => {
  for (const bare of [false, true]) {
    for (const d of cityTreeDesigns(undefined, { bare })) {
      const off = floating(d);
      assert.equal(off.length, 0, `${d.key}: ${off.length} solid(s) float, e.g. #${off[0]} ${JSON.stringify(solidsOf(d)[off[0]!])}`);
    }
  }
});

test("a climate grows only its own species: every kind resolves inside it, and no two climates' trees are mixed", () => {
  for (const c of TREE_CLIMATES) {
    const own = new Set(climateSpecies(c));
    for (const kind of KINDS) {
      assert.ok(TREE_FLORA[c][kind].length > 0, `${c} ${kind}`);
      for (let seed = 0; seed < 200; seed += 1) {
        const sp = treeSpecies(c, kind, seed * 7919);
        if (sp !== null) assert.ok(own.has(sp), `${c} ${kind} -> ${sp}`);
      }
    }
  }
  // (The broad strokes: no palm in the cold, no spruce on the warm coast, no cactus outside the desert.)
  const all = (c: (typeof TREE_CLIMATES)[number]): Set<string> => new Set(climateSpecies(c));
  assert.ok(!all("boreal").has("palm") && !all("boreal").has("fanpalm") && !all("temperate").has("palm"));
  assert.ok(!all("subtropical").has("spruce") && !all("subtropical").has("fir") && !all("arid").has("spruce"));
  for (const c of ["temperate", "boreal", "subtropical", "mediterranean"] as const) assert.ok(!all(c).has("saguaro"), c);
});

test("crowns: the same for every climate (placement never depends on it), and every design drawn within its kind's", () => {
  const designs = cityTreeDesigns();
  for (const c of TREE_CLIMATES) for (const kind of KINDS) {
    for (const sp of new Set(TREE_FLORA[c][kind])) {
      if (!sp) continue;
      for (const d of designs.filter((x) => x.species === sp)) assert.ok(d.radius * treeFit(d, kind) <= PLANT_CROWNS[kind] + 1e-9, `${d.key} as ${kind}`);
    }
  }
});

test("the year: a temperate winter strips the broadleaf trees, evergreens keep theirs; autumn and snow change the paint", () => {
  assert.ok(treeBare("temperate", 0.85) && !treeBare("temperate", 0.3) && !treeBare("boreal", 0.85) && !treeBare("subtropical", 0.85));
  const bare = cityTreeDesigns("temperate", { bare: true }), summer = cityTreeDesigns("temperate");
  assert.ok(bare.some((d) => d.key.includes("~bare")) && bare.filter((d) => d.species === "spruce").every((d) => !d.key.includes("~bare")));
  assert.equal(bare.length, summer.length);
  const hue = (p: ReturnType<typeof treeSeasonPaint>, slot: number): number => p[slot]!.look.hue;
  assert.notEqual(hue(treeSeasonPaint("temperate", 0.3), 3), hue(treeSeasonPaint("temperate", 0.6), 3));
  assert.equal(hue(treeSeasonPaint("subtropical", 0.3), 8), hue(treeSeasonPaint("subtropical", 0.6), 8));
  assert.ok(treeSeasonPaint("boreal", 0.85, { snow: 1 })[9]!.look.light > treeSeasonPaint("boreal", 0.85)[9]!.look.light + 0.2);
});
