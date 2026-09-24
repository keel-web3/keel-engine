import assert from "node:assert/strict";
import { test } from "node:test";
import { SEA_LEVEL, cityHeight, cityReach, cityRegion, citySite, generateCity, generateCityWorld, placeAt, portalRadius, regionAround, worldCity } from "../src/index.ts";
import type { CityWorld } from "../src/index.ts";

const TAU = Math.PI * 2;
const apart = (a: number, b: number): number => { const d = (((a - b) % TAU) + TAU) % TAU; return d > Math.PI ? TAU - d : d; };
const reachOf = (w: CityWorld, id: number): number => { const p = w.places[id]!; return cityReach(citySite(p.seed, p.size, null, p.options)); };
const linked = (w: CityWorld, a: number, b: number): boolean => w.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

/** A spread of worlds, laid out once (laying one out builds no city: it's cheap). */
const WORLDS = Array.from({ length: 120 }, (_, i) => generateCityWorld(`world-test-${i}`));

test("world: the same seed is the same world", () => {
  const a = generateCityWorld("neon"), b = generateCityWorld("neon");
  assert.deepEqual(a.places, b.places);
  assert.equal(a.links.length, b.links.length);
  a.links.forEach((l, i) => { assert.deepEqual(Array.from(l.path.x), Array.from(b.links[i]!.path.x)); assert.deepEqual(Array.from(l.y), Array.from(b.links[i]!.y)); });
  assert.notDeepEqual(generateCityWorld("neon2").places.map((p) => p.x), a.places.map((p) => p.x));
});

test("world: two to nine places, the first the biggest, the second a city over the water on the first bridge", () => {
  const counts = new Set<number>();
  for (const w of WORLDS) {
    counts.add(w.places.length);
    assert.ok(w.places.length >= 2 && w.places.length <= 9);
    assert.equal(w.places[0]!.kind, "metro");
    assert.equal(w.places[1]!.kind, "city");
    for (const p of w.places.slice(1)) assert.ok(p.size < w.places[0]!.size, `${w.seed}: place ${p.id} is smaller than the first`);
    const main = w.links[0]!;
    assert.deepEqual([main.kind, main.a, main.b], ["bridge", 0, 1]);
    assert.ok(main.clearance >= 40, "a ship goes under the big one");
    // (Its sea is both cities' own coast, facing each other.)
    for (const [p, at] of [[0, main.at[0]], [1, main.at[1]]] as const) {
      const place = w.places[p]!, b = place.options.links![at]!.bearing;
      assert.ok(place.options.edges!.some((e) => e.trait === "ocean" && apart(e.bearing, b) < 0.01), `${w.seed}: place ${p} has its coast where the bridge leaves`);
    }
  }
  for (const n of [2, 3, 4, 5, 6, 7]) assert.ok(counts.has(n), `some world has ${n} places: ${[...counts]}`);
  // (The size is the seed's: the big city isn't always the same size.)
  const sizes = WORLDS.map((w) => w.places[0]!.size);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 700);
});

test("world: bridges past the first are rare, and a place over the water can have one of its own (a bridge to a bridge)", () => {
  const extra = WORLDS.filter((w) => w.links.slice(1).some((l) => l.kind === "bridge")).length;
  assert.ok(extra > 0 && extra < WORLDS.length * 0.45, `worlds with a second bridge: ${extra} of ${WORLDS.length}`);
  const chains = WORLDS.filter((w) => w.links.slice(1).some((l) => l.kind === "bridge" && w.links.some((m) => m.id !== l.id && m.kind === "bridge" && (m.b === l.a || m.a === l.a))));
  assert.ok(chains.length > 0, "some world crosses the water twice in a row");
});

test("world: places stand clear of each other, links leave well apart, and each link's water or land is its own", () => {
  for (const w of WORLDS) {
    for (const p of w.places) for (const q of w.places) {
      if (p.id >= q.id || linked(w, p.id, q.id)) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      assert.ok(d > reachOf(w, p.id) + reachOf(w, q.id) + 600, `${w.seed}: places ${p.id} and ${q.id} are ${d.toFixed(0)} m apart`);
    }
    for (const p of w.places) {
      const bs = p.options.links!.map((l) => l.bearing);
      for (let i = 0; i < bs.length; i += 1) for (let j = i + 1; j < bs.length; j += 1) assert.ok(apart(bs[i]!, bs[j]!) > 0.9, `${w.seed}: place ${p.id}'s links ${i} and ${j}`);
      // (A freeway never leaves into the place's sea.)
      p.options.links!.forEach((l) => { if (!l.bridge) for (const e of p.options.edges!) if (e.trait === "ocean") assert.ok(apart(e.bearing, l.bearing) > 0.85, `${w.seed}: place ${p.id} freeway into the sea`); });
    }
    for (const l of w.links) {
      assert.ok(l.path.length > 850, `${w.seed}: link ${l.id} is ${l.path.length} m`);
      assert.equal(l.y.length, l.path.length);
      assert.equal(l.seam, Math.floor(l.path.length / 2));
      // (The world's places see it from both ends: it starts at a's portal and ends at b's.)
      for (const [end, p, at] of [[0, l.a, l.at[0]], [l.path.length - 1, l.b, l.at[1]]] as const) {
        const place = w.places[p]!, b = place.options.links![at]!.bearing, r = portalRadius(citySite(place.seed, place.size, null, place.options), b);
        assert.ok(Math.hypot(l.path.x[end]! - (place.x + Math.sin(b) * r), l.path.z[end]! - (place.z + Math.cos(b) * r)) < 0.01);
      }
      // (A deck no steeper than a freeway's grade anywhere.)
      for (let i = 1; i < l.y.length; i += 1) assert.ok(Math.abs(l.y[i]! - l.y[i - 1]!) < 0.05, `${w.seed}: link ${l.id} climbs ${(l.y[i]! - l.y[i - 1]!).toFixed(3)} at ${i}`);
    }
  }
});

test("world: a place's city ends each link's freeway exactly at its portal, and a city with no links is the one it always was", () => {
  for (const w of [WORLDS[3]!, WORLDS[17]!, generateCityWorld("redline:world:2")]) {
    for (const p of w.places) {
      const c = worldCity(w, p.id);
      assert.equal(c.portals.length, p.links.length);
      p.links.forEach((lid, k) => {
        const l = w.links[lid]!, node = c.graph.nodes[c.portals[k]!]!, end = l.a === p.id ? 0 : l.path.length - 1;
        assert.ok(Math.hypot(node.x + p.x - l.path.x[end]!, node.z + p.z - l.path.z[end]!) < 0.01, `${w.seed}: place ${p.id} link ${lid}`);
        // (A portal is a dead end: the link carries on from it.)
        assert.equal(c.graph.at[c.portals[k]!]!.length, 1);
        // (A bridge link leaves over the water on a deck.)
        if (l.kind === "bridge") assert.ok(c.graph.edges[c.graph.at[c.portals[k]!]![0]!]!.bridge, `${w.seed}: place ${p.id} bridge link ${lid} leaves on a deck`);
      });
    }
  }
  assert.deepEqual(generateCity("neon").portals, []);
  assert.deepEqual(generateCity("neon", 1500, null, [], {}).graph.nodes, generateCity("neon").graph.nodes);
});

test("world: the big city is several times the old one, and still builds fast", () => {
  const w = generateCityWorld("redline:world:2");
  const t0 = performance.now(), c = worldCity(w, 0), ms = performance.now() - t0;
  const old = generateCity("redline:world:1", undefined, null, [], { bridges: 2 });
  assert.ok(c.graph.nodes.length > old.graph.nodes.length * 4, `${c.graph.nodes.length} junctions vs ${old.graph.nodes.length}`);
  assert.ok(c.lots.length > old.lots.length * 8, `${c.lots.length} lots vs ${old.lots.length}`);
  assert.ok(ms < 3000, `built in ${ms.toFixed(0)} ms`);
});

test("world: each place's region stands the others on their own ground, over the sea where they are, and draws its links as the world lays them", () => {
  const w = generateCityWorld("redline:world:2");
  for (const p of w.places.slice(0, 3)) {
    const city = worldCity(w, p.id), around = regionAround(w, p.id), region = cityRegion(city, around);
    // (Every other place near enough is a settlement of this region, on dry ground.)
    for (const q of around.places) {
      const s = region.settlements.find((t) => t.place === q.place);
      assert.ok(s, `place ${p.id} sees place ${q.place}`);
      assert.ok(region.heightAt(q.x, q.z) > SEA_LEVEL + 1, `place ${q.place} stands dry from place ${p.id}: ${region.heightAt(q.x, q.z)}`);
      assert.equal(region.ground(q.x, q.z).water, null);
    }
    // (Its own links run out of its portals; every link near it is one of its roads, the deck the world's.)
    for (const [k, lid] of p.links.entries()) {
      const r = region.links.find((l) => l.link === lid);
      assert.ok(r, `place ${p.id} draws its link ${lid}`);
      assert.equal(r.portal, k);
      const road = region.roads[r.road]!, l = w.links[lid]!;
      const start = l.a === p.id ? 0 : l.path.length - 1;
      assert.ok(Math.hypot(road.x[0]! + p.x - l.path.x[start]!, road.z[0]! + p.z - l.path.z[start]!) < 0.01, "from its portal");
      const mid = Math.floor(road.x.length / 2), s = l.a === p.id ? mid * 20 : l.path.length - 1 - mid * 20;
      assert.ok(Math.abs(road.y[mid]! - l.y[s]!) < 1e-9, `place ${p.id} link ${lid}: the deck is the world's`);
    }
  }
  // (The big bridge crosses real water: its middle is over the sea from both ends.)
  const main = w.links[0]!, mx = main.path.x[main.seam]!, mz = main.path.z[main.seam]!;
  for (const id of [0, 1]) {
    const p = w.places[id]!, region = cityRegion(worldCity(w, id), regionAround(w, id));
    assert.notEqual(region.ground(mx - p.x, mz - p.z).water, null, `the bridge's middle is over the water from place ${id}`);
    assert.ok(main.y[main.seam]! > SEA_LEVEL + 30);
  }
});

test("world: which place a point is in", () => {
  const w = generateCityWorld("redline:world:2");
  for (const p of w.places) assert.equal(placeAt(w, p.x, p.z), p.id);
  assert.equal(placeAt(w, 1e6, 1e6), -1);
});

test("world: a place's city grades its bridge link up over the sea to the world's deck at its portal", () => {
  const w = generateCityWorld("redline:world:2"), c = worldCity(w, 0), h = cityHeight(c), main = w.links[0]!;
  const portal = c.portals[main.at[0]]!, edge = c.graph.at[portal]![0]!, e = c.graph.edges[edge]!;
  const y = h.roadAt(edge, e.b === portal ? e.path.length - 1 : 0);
  assert.ok(Math.abs(y - main.y[0]!) < 4, `the city's deck at its portal ${y.toFixed(2)} vs the link's ${main.y[0]!.toFixed(2)}`);
});

test("world: a freeway between places runs down a valley of its own, never through a cutting", () => {
  let checked = 0;
  for (const seed of ["redline:world:2", "world-test-5", "world-test-40"]) {
    const w = generateCityWorld(seed);
    for (const p of w.places.slice(0, 2)) {
      const region = cityRegion(worldCity(w, p.id), regionAround(w, p.id));
      for (const l of region.links) {
        if (w.links[l.link]!.kind !== "freeway") continue;
        const r = region.roads[l.road]!;
        for (let i = 5; i + 1 < r.x.length - 5; i += 5) {
          const dx = r.x[i + 1]! - r.x[i]!, dz = r.z[i + 1]! - r.z[i]!, len = Math.hypot(dx, dz) || 1;
          // (80 m off each side, clear of the city's own ground -- the valley's floor and its first slope.)
          for (const side of [-1, 1]) {
            const x = r.x[i]! + (dz / len) * 80 * side, z = r.z[i]! - (dx / len) * 80 * side;
            if (Math.max(Math.abs(x), Math.abs(z)) < region.edge + 200) continue;
            assert.ok(region.heightAt(x, z) < r.y[i]! + 8, `${seed} place ${p.id} link ${l.link}: the land 80 m off stands ${(region.heightAt(x, z) - r.y[i]!).toFixed(1)} m over the deck`);
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked > 100, `looked along ${checked} points`);
});
