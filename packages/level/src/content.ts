// Content: where a level's things come from. A level names content by
// reference -- pack, object, pins, look, style, seed -- and a RESOLVER turns a
// reference into an object definition (@keel-engine/object's ObjectDef). The
// content packs (packs/foliage, packs/buildings, their style contract:
// pixel | voxel | custom) provide the real resolver; until they land, and in
// tests, placeholderContent() builds simple stand-ins from boxes and capsules
// (and the object catalogue's pieces), in both styles.
//
//   const content = chainContent(packsResolver, placeholderContent());
//   const def = content.resolve(level.refOf(thing));   // an ObjectDef, or null
//
// The pack ids a level uses by default are in CONTENT_IDS (one table to
// re-point when the packs name things differently).

import { buildPiece, defineObject } from "@keel-engine/object";
import type { ObjectDef, PieceKey } from "@keel-engine/object";
import { dcos, deriveSeed, dhypot, dsin } from "@keel-engine/core";
import type { GroundExtra } from "@keel-engine/terrain";
import type { ContentRef, Style } from "./document.ts";

export interface ContentResolver {
  /** A definition for a reference (its style resolved), or null when this resolver doesn't know it. */
  resolve(ref: ContentRef): ObjectDef<Record<string, unknown>> | null;
  /** The objects it knows in a pack (for the editor's palette and the generator's choices). */
  list?(pack: string): readonly string[];
}

/** The packs and objects a generated level asks for (what the content packs are expected to provide). */
export const CONTENT_IDS = {
  foliage: "packs/foliage",
  buildings: "packs/buildings",
  trees: ["tree", "pine", "palm", "dead-tree"],
  plants: ["bush", "flowers", "reeds", "cactus", "tuft"],
  rocks: ["rock", "boulder", "crystal"],
  houses: ["house", "cottage", "tower", "barn", "shrine", "hut"],
  bridge: "bridge",
} as const;

/** Try resolvers in order: the first that knows a reference wins. */
export function chainContent(...list: readonly ContentResolver[]): ContentResolver {
  return {
    resolve(ref) { for (const r of list) { const d = r.resolve(ref); if (d) return d; } return null; },
    list(pack) { return [...new Set(list.flatMap((r) => r.list?.(pack) ?? []))]; },
  };
}

// ---------------------------------------------------------------- placeholders

type Part = { box: { c: [number, number, number]; h: [number, number, number]; yaw?: number }; name: string; mat: string; collide?: boolean } | { capsule: { a: [number, number, number]; b: [number, number, number]; r: number }; name: string; mat: string; collide?: boolean };
const box = (name: string, c: [number, number, number], h: [number, number, number], mat: string, yaw = 0): Part => ({ box: { c, h, yaw }, name, mat });
const cap = (name: string, a: [number, number, number], b: [number, number, number], r: number, mat: string): Part => ({ capsule: { a, b, r }, name, mat });

// A small seeded float source for a placeholder's variation.
function drawer(seed: string): () => number {
  let h = 0x811c9dc5;
  const s = deriveSeed(seed, "placeholder");
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5; h >>>= 0; return h / 4294967296; };
}

/** A pitched roof as ground-baked wedges: two slopes over a w x d footprint, the ridge along x. */
function roof(w: number, d: number, y0: number, rise: number, mat: string, over = 0.25): GroundExtra[] {
  return [
    { kind: "wedge", c: [0, y0 + rise / 2, d / 4 + over / 2], h: [w / 2 + over, rise / 2, d / 4 + over / 2], yaw: 0, mat },
    { kind: "wedge", c: [0, y0 + rise / 2, -d / 4 - over / 2], h: [w / 2 + over, rise / 2, d / 4 + over / 2], yaw: Math.PI, mat },
  ];
}

function tree(kind: string, style: Style, f: () => number): ObjectDef<Record<string, unknown>> {
  const s = 0.85 + f() * 0.3;
  if (style === "voxel") {
    // (Voxel trees: cubes stacked -- the voxel style's blockiness.)
    const parts: Part[] = [box("trunk", [0, 0.9 * s, 0], [0.18, 0.9 * s, 0.18], "wood")];
    if (kind === "pine") for (let n = 0; n < 3; n += 1) parts.push(box(`crown${n}`, [0, (1.5 + n * 0.8) * s, 0], [(0.95 - n * 0.28) * s, 0.35 * s, (0.95 - n * 0.28) * s], "pine"));
    else { parts.push(box("crown", [0, 2.4 * s, 0], [0.95 * s, 0.75 * s, 0.95 * s], "leaf")); parts.push(box("top", [0.15, 3.25 * s, -0.1], [0.55 * s, 0.3 * s, 0.55 * s], "leaf")); }
    return defineObject({ key: `placeholder/${kind}/voxel`, parts, front: "+z", tags: ["foliage", "tree"], meta: { height: 3.6 * s, radius: 1 * s } });
  }
  if (kind === "pine") {
    const parts: Part[] = [cap("trunk", [0, 0, 0], [0, 1.2 * s, 0], 0.14, "wood")];
    for (let n = 0; n < 3; n += 1) parts.push(cap(`crown${n}`, [0, (1.3 + n * 0.75) * s, 0], [0, (1.45 + n * 0.75) * s, 0], (0.85 - n * 0.24) * s, "pine"));
    return defineObject({ key: `placeholder/pine/${f().toFixed(3)}`, parts, front: "+z", tags: ["foliage", "tree"], meta: { height: 3.4 * s, radius: 0.9 * s } });
  }
  if (kind === "palm") {
    const lean = (f() - 0.5) * 0.6;
    const parts: Part[] = [cap("trunk", [0, 0, 0], [lean, 2.4 * s, 0], 0.13, "wood")];
    for (let n = 0; n < 5; n += 1) { const a = (n / 5) * Math.PI * 2 + f(); parts.push(cap(`frond${n}`, [lean, 2.45 * s, 0], [lean + dsin(a) * 1.1, 2.1 * s, dcos(a) * 1.1], 0.12, "leaf")); }
    return defineObject({ key: `placeholder/palm/${f().toFixed(3)}`, parts, front: "+z", tags: ["foliage", "tree"], meta: { height: 2.8 * s, radius: 1.2 } });
  }
  if (kind === "dead-tree") {
    const parts: Part[] = [cap("trunk", [0, 0, 0], [0, 1.9 * s, 0], 0.13, "wood"), cap("branch0", [0, 1.2 * s, 0], [0.6, 1.8 * s, 0.1], 0.07, "wood"), cap("branch1", [0, 1.5 * s, 0], [-0.5, 2.1 * s, -0.2], 0.06, "wood")];
    return defineObject({ key: `placeholder/dead-tree/${f().toFixed(3)}`, parts, front: "+z", tags: ["foliage", "tree"], meta: { height: 2.2 * s, radius: 0.7 } });
  }
  const parts: Part[] = [cap("trunk", [0, 0, 0], [0, 1.5 * s, 0], 0.16, "wood"), cap("crown", [-0.1, 2.1 * s, 0], [0.15, 2.3 * s, 0.05], 0.85 * s, "leaf"), cap("crown2", [0.35, 2.7 * s, -0.1], [0.3, 2.8 * s, -0.1], 0.5 * s, "leaf")];
  return defineObject({ key: `placeholder/tree/${f().toFixed(3)}`, parts, front: "+z", tags: ["foliage", "tree"], meta: { height: 3.3 * s, radius: 1 * s } });
}

function plant(kind: string, style: Style, f: () => number): ObjectDef<Record<string, unknown>> {
  const s = 0.8 + f() * 0.4;
  const v = style === "voxel";
  switch (kind) {
    case "bush": return defineObject({ key: `placeholder/bush/${style}/${f().toFixed(3)}`, parts: v ? [box("b", [0, 0.35 * s, 0], [0.45 * s, 0.35 * s, 0.4 * s], "leaf")] : [cap("b0", [-0.2, 0.3, 0], [0.2, 0.35, 0], 0.35 * s, "leaf"), cap("b1", [0.05, 0.45, 0.1], [0.05, 0.5, 0.1], 0.3 * s, "leaf")], tags: ["foliage"], meta: { height: 0.8 * s, radius: 0.6 } });
    case "flowers": return defineObject({ key: `placeholder/flowers/${style}/${f().toFixed(3)}`, parts: [cap("stem", [0, 0, 0], [0.03, 0.3, 0], 0.03, "leaf"), v ? box("bloom", [0.03, 0.36, 0], [0.08, 0.08, 0.08], "petal") : cap("bloom", [0.03, 0.36, 0], [0.03, 0.36, 0], 0.08, "petal"), cap("stem2", [0.15, 0, 0.1], [0.18, 0.22, 0.1], 0.025, "leaf"), cap("bloom2", [0.18, 0.26, 0.1], [0.18, 0.26, 0.1], 0.06, "petal")], tags: ["foliage"], meta: { height: 0.45, radius: 0.25 } });
    case "reeds": return defineObject({ key: `placeholder/reeds/${f().toFixed(3)}`, parts: Array.from({ length: 5 }, (_, n) => cap(`r${n}`, [(n - 2) * 0.08, 0, (n % 2) * 0.08], [(n - 2) * 0.12, 0.7 + f() * 0.3, (n % 2) * 0.1], 0.03, "leaf")), tags: ["foliage"], meta: { height: 1, radius: 0.3 } });
    case "cactus": return defineObject({ key: `placeholder/cactus/${style}/${f().toFixed(3)}`, parts: v ? [box("c", [0, 0.7, 0], [0.18, 0.7, 0.18], "leaf"), box("arm", [0.3, 0.9, 0], [0.12, 0.25, 0.12], "leaf")] : [cap("c", [0, 0, 0], [0, 1.3, 0], 0.18, "leaf"), cap("arm", [0.1, 0.7, 0], [0.4, 1.0, 0], 0.1, "leaf")], tags: ["foliage"], meta: { height: 1.5, radius: 0.5 } });
    default: return defineObject({ key: `placeholder/tuft/${f().toFixed(3)}`, parts: Array.from({ length: 4 }, (_, n) => { const a = (n / 4) * 6.28 + f(); return cap(`blade${n}`, [0, 0, 0], [dsin(a) * 0.12, 0.3 + f() * 0.15, dcos(a) * 0.12], 0.035, "leaf"); }), tags: ["foliage"], meta: { height: 0.45, radius: 0.2 } });
  }
}

function rock(kind: string, style: Style, f: () => number): ObjectDef<Record<string, unknown>> {
  const s = 0.7 + f() * 0.6;
  if (kind === "crystal") return defineObject({ key: `placeholder/crystal/${f().toFixed(3)}`, parts: [cap("c0", [0, 0, 0], [0.1, 1.1 * s, 0.05], 0.16, "crystal"), cap("c1", [0.15, 0, 0.1], [0.4, 0.7 * s, 0.2], 0.12, "crystal"), cap("c2", [-0.15, 0, -0.05], [-0.35, 0.6 * s, -0.1], 0.1, "crystal")], tags: ["foliage", "rock"], meta: { height: 1.2 * s, radius: 0.5 } });
  const big = kind === "boulder" ? 1.8 : 1;
  if (style === "voxel") return defineObject({ key: `placeholder/${kind}/voxel/${f().toFixed(3)}`, parts: [box("r", [0, 0.3 * s * big, 0], [0.45 * s * big, 0.3 * s * big, 0.35 * s * big], "stone"), box("r2", [0.15, 0.7 * s * big, 0], [0.25 * s * big, 0.15 * s * big, 0.2 * s * big], "stone")], tags: ["foliage", "rock"], meta: { height: 0.85 * s * big, radius: 0.5 * big } });
  return defineObject({ key: `placeholder/${kind}/${f().toFixed(3)}`, parts: [cap("r", [-0.15 * big, 0.25 * s * big, 0], [0.2 * big, 0.3 * s * big, 0.05], 0.32 * s * big, "stone"), cap("r2", [0.1, 0.2, 0.2 * big], [0.1, 0.2, 0.2 * big], 0.2 * s * big, "stone")], tags: ["foliage", "rock"], meta: { height: 0.7 * s * big, radius: 0.55 * big } });
}

/**
 * A house, cottage, tower, barn, shrine or hut: walls and a pitched roof.
 * Houses are baked into the ground's layers (tier "ground": per-texel depth,
 * so units walk behind them properly); `meta.ground` lists the solids to
 * bake, including the roof's wedges (an object's parts are boxes and
 * capsules; a wedge is the ground baker's).
 */
function house(kind: string, style: Style, f: () => number): ObjectDef<Record<string, unknown>> {
  const sz: Record<string, [number, number, number]> = { house: [5, 4, 2.6], cottage: [4, 3.4, 2.2], tower: [3, 3, 6], barn: [6, 4.5, 3.2], shrine: [2.6, 2.6, 2.2], hut: [3, 3, 1.8] };
  const [w, d, h] = sz[kind] ?? sz["house"]!;
  const wall = kind === "barn" ? "wood" : kind === "shrine" || kind === "tower" ? "stone" : "plaster";
  const ground: GroundExtra[] = [
    { c: [0, 0.15, 0], h: [w / 2 + 0.15, 0.15, d / 2 + 0.15], mat: "stone" }, // (the footing)
    { c: [0, h / 2, 0], h: [w / 2, h / 2, d / 2], mat: wall },
    { c: [w * 0.18, 0.9, d / 2 + 0.03], h: [0.45, 0.9, 0.05], mat: "wood" }, // (a door)
    { c: [-w * 0.22, h * 0.6, d / 2 + 0.03], h: [0.4, 0.35, 0.05], mat: "glass" },
  ];
  if (kind === "tower") ground.push({ c: [0, h + 0.4, 0], h: [w / 2 + 0.2, 0.4, d / 2 + 0.2], mat: "stone" }, { c: [0, h + 1.1, 0], h: [w / 2 - 0.4, 0.3, d / 2 - 0.4], mat: "roof" });
  else if (style === "voxel") for (let n = 0; n < 3; n += 1) ground.push({ c: [0, h + 0.3 + n * 0.55, 0], h: [w / 2 + 0.3 - n * 0.1, 0.28, d / 2 + 0.3 - n * (d / 7)], mat: "roof" });
  else ground.push(...roof(w, d, h, d * 0.42 * (0.9 + f() * 0.2), "roof"));
  if (kind === "house" || kind === "cottage") ground.push({ c: [w * 0.3, h + d * 0.3, -d * 0.12], h: [0.25, d * 0.35, 0.25], mat: "stone" }); // (a chimney)
  const parts = ground.filter((g) => g.kind !== "wedge").map((g, n) => box(`part${n}`, [g.c[0], g.c[1], g.c[2]], [g.h[0], g.h[1], g.h[2]], g.mat, g.yaw ?? 0));
  return defineObject({ key: `placeholder/${kind}/${style}`, parts, front: "+z", tags: ["building"], meta: { height: h + d * 0.45, radius: dhypot(w, d) / 2, footprint: [w, d], ground } });
}

/** A bridge over `length` metres (along its +z), `width` wide: deck, rails, posts -- baked into the ground. */
function bridge(length: number, width: number, style: Style): ObjectDef<Record<string, unknown>> {
  const ground: GroundExtra[] = [{ c: [0, -0.15, 0], h: [width / 2, 0.15, length / 2], mat: "deck" }];
  for (const side of [-1, 1]) {
    ground.push({ c: [side * (width / 2 - 0.08), 0.55, 0], h: [0.07, 0.06, length / 2], mat: "wood" });
    const posts = Math.max(2, Math.round(length / 1.6));
    for (let n = 0; n <= posts; n += 1) ground.push({ c: [side * (width / 2 - 0.08), 0.3, -length / 2 + (n * length) / posts], h: style === "voxel" ? [0.1, 0.32, 0.1] : [0.07, 0.3, 0.07], mat: "wood" });
  }
  const parts = ground.map((g, n) => box(`part${n}`, [g.c[0], g.c[1], g.c[2]], [g.h[0], g.h[1], g.h[2]], g.mat));
  return defineObject({ key: `placeholder/bridge/${length.toFixed(2)}x${width.toFixed(2)}/${style}`, parts, front: "+z", tags: ["bridge"], meta: { height: 0.7, radius: length / 2, ground } });
}

/** Simple stand-ins for every id in CONTENT_IDS (both styles; custom draws as pixel), and the object catalogue's pieces under "keel/object". */
export function placeholderContent(): ContentResolver {
  const cache = new Map<string, ObjectDef<Record<string, unknown>>>();
  return {
    resolve(ref) {
      const style: Style = ref.style === "voxel" ? "voxel" : "pixel";
      // (Foliage varies by seed a little; a few variants each are plenty for a stand-in, so they're shared.)
      const variant = Math.floor(drawer(ref.seed)() * 4);
      const pinKey = JSON.stringify(ref.pins);
      const key = `${ref.pack}|${ref.object}|${style}|${variant}|${pinKey}`;
      const have = cache.get(key);
      if (have) return have;
      const f = drawer(`${ref.object}:${variant}`);
      let def: ObjectDef<Record<string, unknown>> | null = null;
      const o = ref.object;
      if (ref.pack === CONTENT_IDS.foliage) {
        if ((CONTENT_IDS.trees as readonly string[]).includes(o)) def = tree(o, style, f);
        else if ((CONTENT_IDS.plants as readonly string[]).includes(o)) def = plant(o, style, f);
        else if ((CONTENT_IDS.rocks as readonly string[]).includes(o)) def = rock(o, style, f);
      } else if (ref.pack === CONTENT_IDS.buildings) {
        if (o === CONTENT_IDS.bridge) def = bridge(Number(ref.pins["length"] ?? 6), Number(ref.pins["width"] ?? 2), style);
        else if ((CONTENT_IDS.houses as readonly string[]).includes(o)) def = house(o, style, f);
      } else if (ref.pack === "keel/object") {
        try { def = buildPiece(o as PieceKey, deriveSeed(ref.seed, "piece"), ref.pins as never) as unknown as ObjectDef<Record<string, unknown>>; } catch { def = null; }
      }
      if (def) cache.set(key, def);
      return def;
    },
    list(pack) {
      if (pack === CONTENT_IDS.foliage) return [...CONTENT_IDS.trees, ...CONTENT_IDS.plants, ...CONTENT_IDS.rocks];
      if (pack === CONTENT_IDS.buildings) return [...CONTENT_IDS.houses, CONTENT_IDS.bridge];
      if (pack === "keel/object") return ["pillar", "wall", "pad", "ramp", "stairs", "rail", "arch", "tunnel", "crate", "bench", "sign", "lampPost"];
      return [];
    },
  };
}

/**
 * The solids a definition bakes into the ground at a placement (world frame):
 * its `meta.ground` list when it has one (wedges allowed), else its box parts
 * (capsules as the boxes round them), each with its part's material name.
 */
export function groundSolids(def: ObjectDef<Record<string, unknown>>, pos: readonly [number, number, number], yaw: number, scale = 1): GroundExtra[] {
  const c = dcos(yaw), s = dsin(yaw);
  // (Own frame -> world: the inverse of physics' world -> local.)
  const place = (g: GroundExtra): GroundExtra => {
    const lx = g.c[0] * scale, lz = g.c[2] * scale;
    const out: GroundExtra = { c: [pos[0] + c * lx + s * lz, pos[1] + g.c[1] * scale, pos[2] - s * lx + c * lz], h: [g.h[0] * scale, g.h[1] * scale, g.h[2] * scale], yaw: (g.yaw ?? 0) + yaw, mat: g.mat, ...(g.kind ? { kind: g.kind } : {}), ...(g.lo !== undefined ? { lo: g.lo } : {}) };
    return out;
  };
  const listed = def.meta["ground"];
  if (Array.isArray(listed)) return (listed as GroundExtra[]).map(place);
  const out: GroundExtra[] = [];
  for (const p of def.parts) {
    const mat = typeof p.mat === "string" ? p.mat : "stone";
    if (p.prim?.type === "box") out.push(place({ c: p.prim.c, h: p.prim.h, yaw: p.prim.yaw, mat }));
    else { const b = p.bounds; out.push(place({ c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], mat })); }
  }
  return out;
}
