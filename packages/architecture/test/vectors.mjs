// Test vectors for keel/architecture, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

// (A catalogue, a district and a corner lot, built here so the vector needs nothing but keel/architecture.)
const CAT = {
  version: "vec@1",
  archetypes: [{
    id: "tower", fits: { minFront: 8, minDepth: 8 }, storeys: [12, 40], setbacks: [0, 0, 0],
    massing: [{ op: "podium", storeys: [2, 4] }, { op: "tower", inset: [3, 6], tiers: [1, 3] }, { op: "crown", kinds: { fins: 1, mast: 1, stepped: 1 } }],
    facades: ["f"], materials: { glassBlue: 1, limestone: 1 },
    signs: [{ kind: "storefront", chance: 1 }, { kind: "ledCrown", chance: 1 }], roof: [{ kind: "hvac", chance: 1, count: [1, 3] }],
  }],
  facades: { f: { id: "f", bay: [1.5, 1.8], storey: [3.8, 4.2], groundH: [5, 6] } },
  materials: { glassBlue: { hue: 235, chroma: 0.08, light: 0.32, span: 0.35, finish: "leather", windows: { type: "curtain", fill: 0.85, share: 0.45, warm: false } } },
  looks: { core: [{ share: 1, warm: 0.3, dirt: 0 }] },
  weights: { core: { tower: 1 } },
};
const district = { id: 0, kind: "core", density: 1, wealth: 0.5, decay: 0, hues: [322, 192], blocks: [0] };
const lot = { obb: { x: 10, z: -4, hw: 22, hd: 18, yaw: 0.3 }, height: [14, 60], use: "tower", frontage: 0, block: 0, key: "0:0:0", district: 0, left: null, right: null, fronts: [{ edge: 0, face: 0, cls: "arterial" }, { edge: 1, face: 1, cls: "street" }] };
const city = { site: { seed: "neon" }, districts: [district], lots: [lot] };

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":16,"digest":"2567a5e946430e3e5d6fbce5afbe9e280f86a99953856dc49ba715aa2d720c5d"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "48f12f0493a4c22523349b5848e84758cc5c8cac602d667c70b084f0b8393b42",
  },
  {
    name: "a lot's tower is the same solids, footprint and height on every machine",
    run: async ({ planLot }) => { const p = planLot(CAT, city, lot); return { archetype: p.archetype, wall: p.wall, solids: p.solids.length, height: p.height, digest: await digest([p.solids, p.footprint]) }; },
    expect: {"archetype":"tower","digest":"601338265ac18713f1624b1083dac69e8874ad281f3f5f54af8905f945713c86","height":73.67708947048521,"solids":18,"wall":"glassBlue"},
  },
  {
    name: "the city of 'neon's streets are the same lamps, signals and furniture",
    run: async ({ planStreets }, engine) => {
      const c = engine.get("keel/city").generateCity("neon");
      const kit = { version: "vec", lampStyles: { arm: { kind: "arm", height: 8, arm: 2, heads: 1, head: "lampCool", reach: 14 } }, lamps: Object.fromEntries(["core", "midtown", "oldtown", "industrial", "docks", "strip", "suburb", "highway"].map((k) => [k, "arm"])), spacing: { highway: 70, arterial: 34, street: 30, alley: 0 }, furniture: Object.fromEntries(["core", "midtown", "oldtown", "industrial", "docks", "strip", "suburb"].map((k) => [k, [{ kind: "bin", every: 40, chance: 1, roads: ["arterial", "street"] }]])), materials: {} };
      const p = planStreets(kit, c);
      return { chunks: p.chunks.length, lights: p.lights.length, props: p.props.length, digest: await digest([p.props, p.chunks.map((ch) => ch.solids.length)]) };
    },
    expect: {"chunks":48,"digest":"beba8d796a7679a904d3f1c88c3fde78275afc248536cdf06dd299fe4a5a2bc3","lights":415,"props":732},
  },
]);
