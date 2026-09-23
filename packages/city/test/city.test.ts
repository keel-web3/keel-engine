import assert from "node:assert/strict";
import { test } from "node:test";
import { ROAD_CLASS, pointAt, roadField } from "@keel-engine/road";
import { KERB_STEP, MAX_GRADE, SEA_LEVEL, SIDEWALK, blocksOf, cityHeight, cityRegion, crossingsOf, districtsOf, gatesOf, generateCity, groundAt, junctionRadius, layRoads, regionOf, sidewalkReach, siteOf } from "../src/index.ts";

const SEEDS = ["a", "b", "neon", "7", "docks"];

test("city: the same seed is the same city", () => {
  const a = generateCity("neon"), b = generateCity("neon");
  assert.equal(a.graph.edges.length, b.graph.edges.length);
  assert.deepEqual(a.graph.nodes, b.graph.nodes);
  assert.deepEqual(a.lots, b.lots);
  assert.deepEqual(Array.from(a.graph.edges[5]!.path.x), Array.from(b.graph.edges[5]!.path.x));
});

test("city: every road holds its class's width, and there are arterials, a ring highway and streets", () => {
  for (const seed of SEEDS) {
    const c = generateCity(seed);
    const count = { highway: 0, arterial: 0, street: 0, alley: 0, ramp: 0, freeway: 0 };
    for (const e of c.graph.edges) { count[e.cls] += 1; assert.ok(e.half >= ROAD_CLASS[e.cls].minHalf); }
    assert.ok(count.arterial > 20 && count.highway > 4 && count.street > 5, `${seed}: ${JSON.stringify(count)}`);
  }
});

test("city: every junction can be driven to from every other", () => {
  for (const seed of SEEDS) {
    const g = generateCity(seed).graph;
    const seen = new Set([0]), stack = [0];
    const index = new Map(g.nodes.map((n, i) => [n.id, i]));
    while (stack.length) {
      const n = stack.pop()!;
      for (const e of g.at[n]!) { const ed = g.edges[e]!; for (const m of [ed.a, ed.b]) { const k = index.get(m)!; if (!seen.has(k)) { seen.add(k); stack.push(k); } } }
    }
    assert.equal(seen.size, g.nodes.length, `${seed}: ${g.nodes.length - seen.size} junctions unreachable`);
  }
});

test("city: no two roads share ground away from a junction, and roads leave a junction well apart", () => {
  for (const seed of [...SEEDS, "downtown-7", "mint-17", "redline:world:1"]) {
    // (The last one asks for two bridges over its sea: the crossings keep the same rules as every other road.)
    const g = (seed === "redline:world:1" ? generateCity(seed, undefined, null, [], { bridges: 2 }) : generateCity(seed)).graph, node = new Map(g.nodes.map((n) => [n.id, n]));
    // (Every sample on a 30 m grid, then every pair of roads' samples closer than both their sidewalks reach.)
    const cells = new Map<string, number[]>(), cellOf = (x: number, z: number): string => `${Math.floor(x / 30)},${Math.floor(z / 30)}`;
    for (const e of g.edges) for (let s = 0; s < e.path.length; s += 1) { const k = cellOf(e.path.x[s]!, e.path.z[s]!); const l = cells.get(k); if (l) l.push(e.id, s); else cells.set(k, [e.id, s]); }
    for (const e of g.edges) for (let s = 0; s < e.path.length; s += 2) {
      const x = e.path.x[s]!, z = e.path.z[s]!, cx = Math.floor(x / 30), cz = Math.floor(z / 30);
      for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
        const l = cells.get(`${cx + dx},${cz + dz}`) ?? [];
        for (let k = 0; k < l.length; k += 2) {
          const f = g.edges[l[k]!]!, t = l[k + 1]!;
          if (f.id <= e.id) continue;
          const qx = f.path.x[t]!, qz = f.path.z[t]!, d = Math.hypot(qx - x, qz - z);
          if (d >= sidewalkReach(e.cls, e.half) + sidewalkReach(f.cls, f.half)) continue;
          // (Two roads meeting at a junction share its mouth: its box and a few tens of metres out.)
          const mouth = [e.a, e.b].some((n) => {
            if (n !== f.a && n !== f.b) return false;
            const N = node.get(n)!, r = junctionRadius(g, n) + 26;
            return Math.hypot(x - N.x, z - N.z) < r && Math.hypot(qx - N.x, qz - N.z) < r;
          });
          assert.ok(mouth, `${seed}: edges ${e.id} (${e.cls}) and ${f.id} (${f.cls}) ${d.toFixed(1)} m apart at ${x.toFixed(0)},${z.toFixed(0)}`);
        }
      }
    }
    // (And no shallow mouths: every two roads leaving a junction part at 50 degrees or more, 20 m out.)
    g.nodes.forEach((n, i) => {
      const out = g.at[i]!.flatMap((id) => {
        const e = g.edges[id]!, p = e.path, L = p.length, w: [number, number][] = [];
        if (e.a === n.id) w.push([p.x[Math.min(20, L - 1)]! - n.x, p.z[Math.min(20, L - 1)]! - n.z]);
        if (e.b === n.id) w.push([p.x[Math.max(0, L - 21)]! - n.x, p.z[Math.max(0, L - 21)]! - n.z]);
        return w;
      });
      for (let a = 0; a < out.length; a += 1) for (let b = a + 1; b < out.length; b += 1) {
        const [ax, az] = out[a]!, [bx, bz] = out[b]!;
        assert.ok((ax * bx + az * bz) / Math.hypot(ax, az) / Math.hypot(bx, bz) < Math.cos((50 * Math.PI) / 180), `${seed}: node ${n.id} has a shallow mouth`);
      }
    });
  }
});

test("city: roads meet at their junctions -- each road starts and ends on its nodes", () => {
  const g = generateCity("b").graph;
  for (const e of g.edges) {
    const a = g.nodes.find((n) => n.id === e.a)!, b = g.nodes.find((n) => n.id === e.b)!, p = e.path;
    assert.ok(Math.hypot(p.x[0]! - a.x, p.z[0]! - a.z) < 0.6, `edge ${e.id} start`);
    assert.ok(Math.hypot(p.x[p.length - 1]! - b.x, p.z[p.length - 1]! - b.z) < 0.6, `edge ${e.id} end`);
  }
});

test("city: lots stand clear of the roads, inside the slab", () => {
  for (const seed of ["a", "docks"]) {
    const c = generateCity(seed), f = roadField(c.graph);
    assert.ok(c.lots.length > 80, `${seed}: ${c.lots.length} lots`);
    for (const lot of c.lots) {
      const { x, z, hw, hd, yaw } = lot.obb, cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, 0]] as const) {
        const px = x + u * cy + v * sy, pz = z - u * sy + v * cy;
        const at = f.at(px, pz);
        if (at) assert.ok(Math.abs(at.d) > at.half + 1, `${seed}: lot at ${x.toFixed(0)},${z.toFixed(0)} is on a road (${at.d.toFixed(1)} vs ${at.half})`);
        assert.ok(Math.abs(px) < c.site.size / 2 && Math.abs(pz) < c.site.size / 2);
      }
    }
  }
});

test("city: the core is flat; past it, the edge traits shape the land", () => {
  const c = generateCity("docks");
  assert.equal(groundAt(c.site, 0, 0).height, 0);
  const e = c.site.edges[0]!;
  const far = groundAt(c.site, Math.sin(e.bearing) * (c.site.core + 200), Math.cos(e.bearing) * (c.site.core + 200));
  assert.equal(far.biome, e.trait);
});

test("world: two neighbouring cities, minted apart, meet at the same gates on their shared border", () => {
  const size = 1500, world = "keel-world";
  const west = generateCity("mint-17", size, { world, x: 0, z: 0 }), east = generateCity("mint-942", size, { world, x: 1, z: 0 });
  const out = gatesOf({ world, x: 0, z: 0 }, size).filter((g) => g.side === "east");
  const into = gatesOf({ world, x: 1, z: 0 }, size).filter((g) => g.side === "west");
  assert.ok(out.length >= 1);
  assert.deepEqual(out.map((g) => g.z), into.map((g) => g.z));
  // Each city has a road ending exactly at every gate on that border (in its own frame: +h in the west city, -h in the east).
  const endsAt = (c: typeof west, x: number, z: number): boolean => c.graph.nodes.some((n) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.z - z) < 1e-6 && c.graph.at[c.graph.nodes.indexOf(n)]!.length > 0);
  for (const g of out) assert.ok(endsAt(west, size / 2, g.z) && endsAt(east, -size / 2, g.z), `gate at z ${g.z.toFixed(1)}`);
});

test("districts: 200 seeds, every city has a downtown and at least three other kinds, each district one connected run", () => {
  for (let n = 0; n < 200; n += 1) {
    const site = siteOf(`d${n}`), blocks = blocksOf(layRoads(site));
    const { districts, blockDistrict } = districtsOf(site, blocks);
    const kinds = new Set(districts.map((d) => d.kind));
    assert.ok(kinds.has("core") && kinds.size >= 4, `d${n}: ${[...kinds].join(", ")}`);
    const touch = (a: number, b: number): boolean => Math.abs(blocks[a]!.cell[0] - blocks[b]!.cell[0]) + Math.abs(blocks[a]!.cell[1] - blocks[b]!.cell[1]) <= 1;
    for (const d of districts) {
      const seen = new Set([d.blocks[0]!]), stack = [d.blocks[0]!];
      while (stack.length) { const b = stack.pop()!; for (const o of d.blocks) if (!seen.has(o) && touch(b, o)) { seen.add(o); stack.push(o); } }
      assert.equal(seen.size, d.blocks.length, `d${n}: district ${d.id} (${d.kind}) is in pieces`);
      for (const b of d.blocks) assert.equal(blockDistrict[b], d.id);
      assert.ok(d.hues.length >= 2 && d.decay >= 0 && d.decay <= 0.6 && d.wealth >= 0 && d.wealth <= 1);
    }
  }
});

test("lots: stable keys, their district, the roads they front and their neighbours along the row", () => {
  const c = generateCity("neon");
  const keys = new Set(c.lots.map((l) => l.key));
  assert.equal(keys.size, c.lots.length);
  for (const lot of c.lots) {
    assert.ok(c.districts[lot.district]!.blocks.includes(lot.block));
    for (const f of lot.fronts) assert.equal(c.graph.edges[f.edge]!.cls, f.cls);
    if (lot.left) assert.equal(c.lots.find((l) => l.key === lot.left)!.right, lot.key);
  }
  const fronting = c.lots.filter((l) => l.fronts.length > 0).length;
  assert.ok(fronting >= c.lots.length * 0.97, `${c.lots.length - fronting} lots front no road`);
  // (The old town's lots are narrow walk-up frontages; downtown's are tower sites.)
  const widest = (kind: string) => Math.max(...c.lots.filter((l) => c.districts[l.district]!.kind === kind).map((l) => 2 * Math.min(l.obb.hw, l.obb.hd)));
  assert.ok(widest("oldtown") < widest("core"));
});

test("sidewalks: every lot starts past its roads' sidewalks; crossings sit clear of their junctions", () => {
  const c = generateCity("neon"), f = roadField(c.graph);
  for (const lot of c.lots) {
    const { x, z, hw, hd, yaw } = lot.obb, cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const) {
      const at = f.at(x + u * cy + v * sy, z - u * sy + v * cy);
      if (at) assert.ok(Math.abs(at.d) > sidewalkReach(c.graph.edges[at.edge]!.cls, Math.abs(at.half)) - 0.6, `${lot.key} on a sidewalk`);
    }
  }
  const xs = crossingsOf(c.graph);
  assert.ok(xs.length > 40);
  for (const x of xs) assert.ok(x.from >= junctionRadius(c.graph, x.node) && x.to - x.from === 3);
  assert.equal(SIDEWALK.highway.slab, 0);
});

test("height: roads keep to their grade, junctions are level, the surface along and across a road is continuous", () => {
  const c = generateCity("neon"), h = cityHeight(c), g = c.graph;
  // Every road keeps its grade end to end: no two roads share ground away from a junction (see the layout test), so
  // there's no strip of it one must ramp up to meet the other's surface on.
  for (const e of g.edges) for (let s = 1; s < e.path.length; s += 1) {
    const d = Math.abs(h.roadAt(e.id, s) - h.roadAt(e.id, s - 1));
    assert.ok(d <= MAX_GRADE[e.cls] + 1e-3, `edge ${e.id} (${e.cls}) at ${s}: ${d.toFixed(3)}`);
  }
  // (Every road into a junction meets it at one height; the surface there is that height.)
  g.nodes.forEach((n, i) => {
    const ends = g.at[i]!.map((id) => { const e = g.edges[id]!; return e.a === n.id ? h.roadAt(id, 0) : h.roadAt(id, e.path.length - 1); });
    if (ends.length < 2) return;
    assert.ok(Math.max(...ends) - Math.min(...ends) < 0.2, `node ${n.id}: ${ends.map((x) => x.toFixed(2))}`);
    assert.ok(Math.abs(h.heightAt(n.x, n.z) - ends[0]!) < 0.2);
  });
  // Across each road, from its centre out to its sidewalk's back edge: flat across the carriageway, no more than a
  // gentle blend on the pavement where a junction or a pad meets it (the kerb's step is the renderer's).
  for (const e of g.edges) for (let s = 30; s < e.path.length - 30; s += 40) {
    // (Straight out sideways from the line: keel/road's own offset, not a guess at the yaw's convention.)
    let prev = h.heightAt(e.path.x[s]!, e.path.z[s]!);
    for (let o = 0.5; o < sidewalkReach(e.cls, e.half) - 1; o += 0.5) {
      const q = pointAt(e.path, s, o), y = h.heightAt(q.x, q.z);
      assert.ok(Math.abs(y - prev) <= (o <= e.half ? 0.06 : 0.2), `edge ${e.id} at ${s}, ${o} m out: ${(y - prev).toFixed(2)}`);
      prev = y;
    }
  }
});

test("height: a pure function of the city, the grid covering it and its lots standing on level pads", () => {
  const c = generateCity("neon"), a = cityHeight(c), b = cityHeight(generateCity("neon"));
  assert.equal(a.elevation.grid, a.grid);
  assert.equal(a.elevation.heightAt(12, -40), a.heightAt(12, -40));
  assert.deepEqual(Array.from(a.grid.data.subarray(0, 5000)), Array.from(b.grid.data.subarray(0, 5000)));
  const [x0, z0, x1, z1] = c.graph.bounds;
  assert.ok(a.grid.x0 <= x0 && a.grid.z0 <= z0 && a.grid.x0 + a.grid.cell * (a.grid.w - 1) >= x1 && a.grid.z0 + a.grid.cell * (a.grid.h - 1) >= z1);
  let hilly = 0;
  for (const lot of c.lots) {
    const p = a.pad(lot);
    assert.ok(Math.abs(a.heightAt(lot.obb.x, lot.obb.z) - p) < 0.05, `${lot.key}: pad ${p.toFixed(2)} vs ${a.heightAt(lot.obb.x, lot.obb.z).toFixed(2)}`);
    hilly = Math.max(hilly, Math.abs(p));
  }
  assert.ok(hilly > 3, "the city isn't flat");
});

test("bridges: rare by the seed, as many as a game asks for, on land at both ends and a deck over the sea", () => {
  const site = generateCity("redline:world:1", undefined, null, [], { bridges: 2 }), h = cityHeight(site);
  const decks = site.graph.edges.filter((e) => e.bridge);
  assert.ok(decks.filter((e) => e.path.length > 800).length >= 2, `two long crossings: ${decks.map((e) => e.path.length)}`);
  for (const e of decks) {
    let top = -Infinity;
    for (let s = 0; s < e.path.length; s += 1) top = Math.max(top, h.roadAt(e.id, s));
    assert.ok(top >= SEA_LEVEL + 12, `edge ${e.id} clears the sea: ${top}`);
  }
  assert.equal(generateCity("redline:world:1", undefined, null, [], { bridges: 0 }).graph.edges.filter((e) => e.bridge).length, 0);
  let rolled = 0;
  for (let i = 0; i < 40; i += 1) if (generateCity(`bridge-roll-${i}`).graph.edges.some((e) => e.bridge)) rolled += 1;
  assert.ok(rolled <= 10, `rare: ${rolled} of 40`);
});

/** The sample of cities the region tests look over (built once). */
let sample: { seed: string; city: ReturnType<typeof generateCity> }[] | null = null;
const regionSample = (): { seed: string; city: ReturnType<typeof generateCity> }[] => {
  if (!sample) {
    sample = [...SEEDS, "downtown-7", "mint-17"].map((seed) => ({ seed, city: generateCity(seed) }));
    sample.push({ seed: "redline:world:1", city: generateCity("redline:world:1", undefined, null, [], { bridges: 2 }) });
  }
  return sample;
};

test("venues: every city gets a dirt track, a drift park and a derby bowl, out past its ground on dry level land, clear of the rest", () => {
  for (const { seed, city } of regionSample()) {
    const r = regionOf(city), edge = r.edge, list = [r.venues.dirt, r.venues.drift, r.venues.derby];
    assert.deepEqual(list.map((v) => v.kind), ["dirt", "drift", "derby"], seed);
    const frame = (v: (typeof list)[number], a: number, b: number): [number, number] => [v.x + Math.cos(v.yaw) * a + Math.sin(v.yaw) * b, v.z - Math.sin(v.yaw) * a + Math.cos(v.yaw) * b];
    for (const v of list) {
      const name = `${seed} ${v.kind} at ${v.x.toFixed(0)},${v.z.toFixed(0)}`, R = Math.hypot(v.hw, v.hd);
      // Out past the city's own square ground (never on it), no more than 2.5 km.
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) { const [x, z] = frame(v, a * v.hw, b * v.hd); assert.ok(Math.max(Math.abs(x), Math.abs(z)) >= edge + 399, `${name}: past the city`); }
      assert.ok(Math.max(Math.abs(v.x), Math.abs(v.z)) <= edge + 2500, `${name}: in reach`);
      // Dry and level: no water over it, above the sea, one height away from its gate's road.
      const hs: number[] = [];
      for (let a = -1; a <= 1.001; a += 0.125) for (let b = -1; b <= 1.001; b += 0.125) {
        const [x, z] = frame(v, a * v.hw, b * v.hd);
        assert.equal(r.ground(x, z).water, null, `${name}: dry at ${x.toFixed(0)},${z.toFixed(0)}`);
        if (Math.hypot(x - v.gate.x, z - v.gate.z) > 40) hs.push(r.heightAt(x, z));
      }
      assert.ok(Math.max(...hs) - Math.min(...hs) < 1.5 && Math.abs(hs[0]! - v.y) < 1.5, `${name}: level (${(Math.max(...hs) - Math.min(...hs)).toFixed(2)} m)`);
      if (r.water.sea) assert.ok(v.y >= r.water.sea.level + 2.9, `${name}: above the sea`);
      // Clear of the towns, the airport's field and each other.
      for (const s of r.settlements) assert.ok(Math.hypot(s.x - v.x, s.z - v.z) > s.r + R, `${name}: clear of a ${s.kind}`);
      const ap = r.airport, c = Math.cos(ap.yaw), sn = Math.sin(ap.yaw);
      for (let a = -1; a <= 1.001; a += 0.5) for (let b = -1; b <= 1.001; b += 0.5) {
        const [x, z] = frame(v, a * v.hw, b * v.hd), dx = x - ap.x, dz = z - ap.z;
        assert.ok(Math.abs(dx * sn + dz * c) > ap.length / 2 + 250 || dx * c - dz * sn < -260 - ap.spacing || dx * c - dz * sn > 520, `${name}: off the airfield`);
      }
      for (const w of list) if (w !== v) assert.ok(Math.hypot(w.x - v.x, w.z - v.z) > R + Math.hypot(w.hw, w.hd), `${name}: clear of the ${w.kind}`);
      // Its gate on its box's edge, a country road ending there.
      const [ga, gb] = [Math.cos(v.yaw) * (v.gate.x - v.x) - Math.sin(v.yaw) * (v.gate.z - v.z), Math.sin(v.yaw) * (v.gate.x - v.x) + Math.cos(v.yaw) * (v.gate.z - v.z)];
      assert.ok(Math.abs(Math.abs(ga) - v.hw) < 0.01 || Math.abs(Math.abs(gb) - v.hd) < 0.01, `${name}: gate on the edge`);
      assert.ok(r.roads.some((q) => q.kind === "road" && Math.hypot(q.x[q.x.length - 1]! - v.gate.x, q.z[q.z.length - 1]! - v.gate.z) < 1), `${name}: a road to its gate`);
      // (And no road across its ground but that one, its last metres in to the gate.)
      for (const q of r.roads) for (let i = 0; i < q.x.length; i += 1) {
        const dx = q.x[i]! - v.x, dz = q.z[i]! - v.z, a = Math.cos(v.yaw) * dx - Math.sin(v.yaw) * dz, b = Math.sin(v.yaw) * dx + Math.cos(v.yaw) * dz;
        if (Math.abs(a) < v.hw && Math.abs(b) < v.hd) assert.ok(Math.hypot(q.x[i]! - v.gate.x, q.z[i]! - v.gate.z) < 30, `${name}: a ${q.kind} across it at ${q.x[i]!.toFixed(0)},${q.z[i]!.toFixed(0)}`);
      }
      // Its courses: inside its box, a sample a metre, wide enough to drive.
      for (const k of v.courses) {
        let step = 0;
        for (let i = 0; i < k.x.length; i += 1) {
          const j = (i + 1) % k.x.length, a = Math.cos(v.yaw) * (k.x[i]! - v.x) - Math.sin(v.yaw) * (k.z[i]! - v.z), b = Math.sin(v.yaw) * (k.x[i]! - v.x) + Math.cos(v.yaw) * (k.z[i]! - v.z);
          assert.ok(Math.abs(a) + k.half[i]! < v.hw && Math.abs(b) + k.half[i]! < v.hd, `${name} ${k.name}: inside its box`);
          assert.ok(k.half[i]! >= 4 && k.crest[i]! > -0.01 && k.crest[i]! < 3.5, `${name} ${k.name}: half ${k.half[i]} crest ${k.crest[i]}`);
          if (j || k.closed) step = Math.max(step, Math.hypot(k.x[j]! - k.x[i]!, k.z[j]! - k.z[i]!));
        }
        assert.ok(step < 1.3 && k.length > 150, `${name} ${k.name}: ${k.length.toFixed(0)} m, steps ${step.toFixed(2)}`);
      }
    }
    const [dirt, drift, derby] = list;
    assert.deepEqual(dirt!.courses.map((k) => [k.name, k.surface]), [["oval", "dirt"], ["rally", "dirt"]], seed);
    assert.ok(dirt!.courses[1]!.jumps.length >= 3 && dirt!.courses[1]!.jumps.every((j) => j.h >= 1.2), `${seed}: the rally's jumps`);
    assert.deepEqual(drift!.courses.map((k) => [k.name, k.surface]), [["skidpad", "tarmac"], ["technical", "tarmac"]], seed);
    assert.ok(derby!.courses.length === 0 && derby!.bowl && derby!.bowl.hw * 2 >= 45 && derby!.bowl.hd * 2 >= 70, `${seed}: the derby's bowl`);
    // Their sites stand where they do.
    assert.deepEqual(r.sites.filter((s) => ["dirttrack", "driftpark", "derby"].includes(s.kind)).map((s) => [s.x, s.z]), list.map((v) => [v.x, v.z]), seed);
  }
});

test("region: a pure function of the city (venues and all)", () => {
  const a = cityRegion(generateCity("neon")), b = cityRegion(generateCity("neon"));
  const pick = (r: typeof a) => ({
    venues: [r.venues.dirt, r.venues.drift, r.venues.derby].map((v) => ({ ...v, courses: v.courses.map((k) => ({ ...k, x: Array.from(k.x), z: Array.from(k.z), half: Array.from(k.half), crest: Array.from(k.crest) })) })),
    sites: r.sites, roads: r.roads.map((q) => [q.kind, Array.from(q.x), Array.from(q.y)]), lines: r.lines, pipes: r.pipes, airport: r.airport, settlements: r.settlements, industry: r.industry,
    rally: { ...r.rally, x: Array.from(r.rally.x), z: Array.from(r.rally.z), y: Array.from(r.rally.y), half: Array.from(r.rally.half), crest: Array.from(r.rally.crest) },
    at: [r.heightAt(2500, -1800), r.heightAt(r.venues.dirt.x, r.venues.dirt.z), r.ground(-3000, 900)],
  });
  assert.deepEqual(pick(a), pick(b));
});

test("rally: every city gets a dirt stage out through the country, joined to its roads at both ends, round what's in the way", () => {
  for (const { seed, city } of regionSample()) {
    const r = regionOf(city), st = r.rally, n = st.x.length, name = `${seed} rally`;
    assert.equal(st.surface, "dirt", name);
    assert.ok(st.length > 2500 && n > 2500, `${name}: ${st.length.toFixed(0)} m`);
    const road = r.roads[st.road]!;
    assert.equal(road.kind, "dirt", name);
    assert.ok(road.half >= 3.5 && road.half <= 4.5, name);
    // (Its road is its line: every 5th sample.)
    assert.ok(Math.hypot(road.x[0]! - st.x[0]!, road.z[0]! - st.z[0]!) < 0.01 && Math.hypot(road.x[road.x.length - 1]! - st.x[n - 1]!, road.z[road.z.length - 1]! - st.z[n - 1]!) < 0.01, `${name}: its road`);
    // Joined to the network: each end on another road.
    const onOther = (x: number, z: number): boolean => r.roads.some((q, k) => k !== st.road && q.kind !== "rail" && Array.from(q.x).some((qx, i) => Math.hypot(qx - x, q.z[i]! - z) < 25));
    assert.ok(onOther(st.x[0]!, st.z[0]!) && onOther(st.x[n - 1]!, st.z[n - 1]!), `${name}: joined at both ends`);
    let step = 0, fordN = 0;
    for (let i = 0; i < n; i += 1) {
      if (i + 1 < n) step = Math.max(step, Math.hypot(st.x[i + 1]! - st.x[i]!, st.z[i + 1]! - st.z[i]!));
      assert.ok(st.crest[i]! >= 0 && st.crest[i]! < 2.5, `${name}: crest ${st.crest[i]}`);
      if (i % 10) continue;
      const x = st.x[i]!, z = st.z[i]!;
      // (Graded in: the land under it is its road's height.)
      assert.ok(Math.abs(r.heightAt(x, z) - (st.y[i]! - 0.25)) < 0.6, `${name}: graded at ${i}: ${r.heightAt(x, z).toFixed(2)} vs ${st.y[i]!.toFixed(2)}`);
      if (i < 80 || i > n - 80) continue;
      for (const s of r.settlements) assert.ok(Math.hypot(s.x - x, s.z - z) > s.r, `${name}: through a ${s.kind} at ${x.toFixed(0)},${z.toFixed(0)}`);
      for (const v of [r.venues.dirt, r.venues.drift, r.venues.derby]) {
        const a = Math.cos(v.yaw) * (x - v.x) - Math.sin(v.yaw) * (z - v.z), b = Math.sin(v.yaw) * (x - v.x) + Math.cos(v.yaw) * (z - v.z);
        assert.ok(Math.abs(a) > v.hw || Math.abs(b) > v.hd, `${name}: across the ${v.kind}`);
      }
      const g = r.ground(x, z);
      if (g.water !== null) { fordN += 1; assert.ok(st.splashes.some((w) => i >= w.i0 - 12 && i <= w.i1 + 12), `${name}: in the water off a ford at ${i}`); }
    }
    void fordN;
    assert.ok(step < 1.3, `${name}: a sample a metre (${step.toFixed(2)})`);
    assert.ok(st.jumps.length >= 2 && st.jumps.every((j) => j.h >= 0.8 && j.i > 0 && j.i < n), `${name}: jumps`);
    assert.ok(st.hairpins.length >= 1, `${name}: hairpins`);
  }
});

test("power: farms, lines, pipes and masts clear of the water, the towns, the venues and the airfield; the grid feeds every town", () => {
  let solar = 0, wind = 0;
  for (const { seed, city } of regionSample()) {
    const r = regionOf(city), ap = r.airport, c = Math.cos(ap.yaw), sn = Math.sin(ap.yaw);
    const onField = (x: number, z: number): boolean => { const dx = x - ap.x, dz = z - ap.z, along = Math.abs(dx * sn + dz * c), across = dx * c - dz * sn; return along < ap.length / 2 + 250 && across > -260 - ap.spacing && across < 520; };
    const inVenue = (x: number, z: number): boolean => [r.venues.dirt, r.venues.drift, r.venues.derby].some((v) => Math.abs(Math.cos(v.yaw) * (x - v.x) - Math.sin(v.yaw) * (z - v.z)) < v.hw && Math.abs(Math.sin(v.yaw) * (x - v.x) + Math.cos(v.yaw) * (z - v.z)) < v.hd);
    for (const l of [...r.lines, ...r.pipes]) for (let i = 0; i < l.x.length; i += 1) {
      const x = l.x[i]!, z = l.z[i]!, name = `${seed}: a ${l.kind} at ${x.toFixed(0)},${z.toFixed(0)}`;
      assert.equal(r.ground(x, z).water, null, `${name} in the water`);
      assert.ok(!inVenue(x, z) && !onField(x, z), `${name} on a venue or the airfield`);
      for (const s of r.settlements) assert.ok(Math.hypot(s.x - x, s.z - z) > s.r * 0.9, `${name} in a ${s.kind}`);
    }
    for (const f of r.sites.filter((q) => q.kind === "solar" || q.kind === "windfarm")) {
      const name = `${seed}: a ${f.kind} at ${f.x.toFixed(0)},${f.z.toFixed(0)}`;
      if (f.kind === "solar") solar += 1; else wind += 1;
      assert.equal(r.ground(f.x, f.z).water, null, name);
      assert.ok(!inVenue(f.x, f.z) && !onField(f.x, f.z), name);
      for (const s of r.settlements) assert.ok(Math.hypot(s.x - f.x, s.z - f.z) > s.r + f.size * 0.3, `${name} on a ${s.kind}`);
      // (Its substation by it.)
      assert.ok(r.sites.some((q) => q.kind === "substation" && Math.hypot(q.x - f.x, q.z - f.z) < f.size * 0.5 + 120), `${name}: its substation`);
    }
    // Only the city's own lines feed its streets.
    assert.ok(r.lines.filter((l) => l.feed).every((l) => l.kind === "pylon"), seed);
    // Every town near enough has its substation and a line to it.
    for (const s of r.settlements.filter((q) => q.kind !== "metro" && q.kind !== "city" && Math.hypot(q.x, q.z) < 7000)) {
      const sub = r.sites.find((q) => q.kind === "substation" && Math.hypot(q.x - s.x, q.z - s.z) < s.r + 100);
      if (!sub) continue;
      assert.ok(r.lines.some((l) => Math.hypot(l.x[0]! - sub.x, l.z[0]! - sub.z) < 400 || Math.hypot(l.x[l.x.length - 1]! - sub.x, l.z[l.z.length - 1]! - sub.z) < 400), `${seed}: a line to the ${s.kind}'s substation`);
    }
  }
  assert.ok(solar >= 3 && wind >= 3, `farms across the sample: ${solar} solar, ${wind} wind`);
});

test("industry: about half the regions have an industrial town, a road straight through it", () => {
  const seeds = ["neon", "a", "b", "7", "docks", "downtown-7", "mint-17", "i-1", "i-2", "i-3", "i-4", "i-5"];
  let n = 0;
  for (const seed of seeds) {
    const r = cityRegion(regionSample().find((q) => q.seed === seed)?.city ?? generateCity(seed)), s = r.industry;
    if (!s) { assert.ok(!r.settlements.some((q) => q.kind === "industrial"), seed); continue; }
    n += 1;
    assert.equal(s.kind, "industrial", seed);
    assert.ok(r.settlements.includes(s), seed);
    assert.ok(r.roads.some((q) => (q.kind === "freeway" || q.kind === "road") && Array.from(q.x).some((x, i) => Math.hypot(x - s.x, q.z[i]! - s.z) < s.r * 0.3)), `${seed}: a road through the works`);
    assert.ok(r.roads.some((q) => q.kind === "rail" && Array.from(q.x).some((x, i) => Math.hypot(x - s.x, q.z[i]! - s.z) < s.r)), `${seed}: its rail`);
  }
  assert.ok(n >= 3 && n <= 10, `${n} of ${seeds.length} with an industrial town`);
});
