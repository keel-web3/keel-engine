// Roles: colours clustered in OKLab and named as the engine's roles; stable
// (noise and the order of cells don't move them); a small far colour still
// gets its own; dark, glow and skin read off; the source colours kept as a look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterRoles, linearToOklab, oklabToOklch, srgbToLinear } from "../src/index.ts";
import type { VoxelGrid } from "../src/index.ts";

/** A fake grid of surface cells: (material, sRGB colour, count) runs, with optional jitter and a shuffle. */
function gridOf(runs: ReadonlyArray<readonly [number, readonly [number, number, number], number]>, { jitter = 0, seed = 1, shuffle = false, emissive = [] as number[] } = {}): VoxelGrid {
  const cells: Array<[number, number, number, number]> = [];
  let s = seed;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (const [mat, c, n] of runs) for (let i = 0; i < n; i += 1) {
    const j = (): number => (rnd() - 0.5) * 2 * jitter;
    cells.push([mat, Math.min(255, Math.max(0, c[0] + j() * 255)), Math.min(255, Math.max(0, c[1] + j() * 255)), Math.min(255, Math.max(0, c[2] + j() * 255))]);
  }
  if (shuffle) for (let i = cells.length - 1; i > 0; i -= 1) { const k = Math.floor(rnd() * (i + 1)); [cells[i], cells[k]] = [cells[k]!, cells[i]!]; }
  const n = cells.length;
  const colour = new Float32Array(n * 3), material = new Int32Array(n);
  cells.forEach(([m, r, g, b], i) => { material[i] = m; colour.set([srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)], i * 3); });
  return {
    size: [n, 1, 1], unit: 0.1, origin: [0, 0, 0], occ: new Uint8Array(n).fill(1), node: new Int32Array(n), mesh: new Int32Array(n), material, colour,
    joint: new Int32Array(n).fill(-1), weight: new Float32Array(n), depth: new Uint16Array(n), nodeNames: ["n"], materialNames: ["tunic", "trousers", "skin", "boots", "steel", "eyes", "lamp"],
    emissive: new Set(emissive), skinned: false, scale: 1, stats: { triangles: 0, surface: n, interior: 0 },
  };
}

const KNIGHTLY = [[0, [52, 84, 160], 400], [1, [92, 70, 52], 500], [2, [226, 178, 142], 200], [3, [40, 32, 30], 90], [4, [176, 184, 196], 150], [5, [40, 200, 90], 6]] as const;

test("flat materials: one role each (six green cells too), named by what they are", () => {
  const r = clusterRoles(gridOf(KNIGHTLY), { creature: true });
  const byMat = (m: number): string => r.clusters[r.roleOf[KNIGHTLY.slice(0, m).reduce((s, x) => s + x[2], 0)]!]!.role;
  assert.equal(r.k, 6);
  assert.equal(byMat(2), "skin");
  assert.equal(byMat(3), "dark");
  assert.equal(byMat(1), "primary", "the trousers cover the most");
  assert.equal(byMat(0), "secondary");
  assert.equal(byMat(4), "trim", "steel: pale and grey");
  assert.equal(byMat(5), "accent", "six green cells: a colour of their own");
  // The look keeps the source colours, as OKLCH.
  const tunic = oklabToOklch(linearToOklab(srgbToLinear(52 / 255), srgbToLinear(84 / 255), srgbToLinear(160 / 255)));
  const got = r.look.colours["secondary"]!;
  assert.ok(Math.abs(got[0] - tunic[0]) < 0.002 && Math.abs(got[2] - tunic[2]) < 0.2);
  assert.equal(r.look.name, "source");
});

test("stable: noise in the colours and the order of the cells don't change which cells play which role", () => {
  const base = clusterRoles(gridOf(KNIGHTLY), { creature: true });
  const roleAt = (r: ReturnType<typeof clusterRoles>, i: number): string => r.clusters[r.roleOf[i]!]!.role;
  for (const seed of [2, 3, 4, 5]) {
    const noisy = clusterRoles(gridOf(KNIGHTLY, { jitter: 0.02, seed }), { creature: true });
    let same = 0;
    for (let i = 0; i < base.roleOf.length; i += 1) if (roleAt(noisy, i) === roleAt(base, i)) same += 1;
    assert.ok(same / base.roleOf.length > 0.98, `seed ${seed}: ${same}/${base.roleOf.length}`);
  }
  // Shuffled: the same roles by material.
  const shuffled = gridOf(KNIGHTLY, { shuffle: true, seed: 9 });
  const r = clusterRoles(shuffled, { creature: true });
  const roleOfMat = new Map<number, string>();
  for (let i = 0; i < r.roleOf.length; i += 1) {
    const role = roleAt(r, i), m = shuffled.material[i]!;
    if (roleOfMat.has(m)) assert.equal(roleOfMat.get(m), role); else roleOfMat.set(m, role);
  }
  assert.deepEqual([...roleOfMat.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v), KNIGHTLY.map((_x, i) => roleAt(base, KNIGHTLY.slice(0, i).reduce((s, x) => s + x[2], 0))));
  // And the same input twice: the same everything.
  assert.deepEqual(clusterRoles(gridOf(KNIGHTLY)), clusterRoles(gridOf(KNIGHTLY)));
});

test("k is chosen by error: one colour, one role; a gradient, a few; emissive plays glow; no creature, no skin", () => {
  assert.equal(clusterRoles(gridOf([[0, [200, 40, 40], 100]])).k, 1);
  const ramp = Array.from({ length: 12 }, (_, i) => [0, [20 + i * 20, 60 + i * 10, 100] as const, 30] as const);
  const g = clusterRoles(gridOf(ramp));
  assert.ok(g.k >= 3 && g.k <= 7, `a gradient: ${g.k} roles`);
  assert.ok(g.error <= 0.05 || g.k === 7);
  const lit = clusterRoles(gridOf([[0, [90, 90, 100], 300], [6, [255, 220, 120], 40]], { emissive: [6] }));
  assert.ok(lit.clusters.some((c) => c.role === "glow" && c.materials.includes("lamp")));
  const prop = clusterRoles(gridOf(KNIGHTLY));
  assert.ok(!prop.clusters.some((c) => c.role === "skin"), "a prop has no skin");
});
