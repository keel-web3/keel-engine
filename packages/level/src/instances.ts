// A level's things made real: every thing and every grown plant resolved
// through the content (its style settled by the settings), split by where it
// loads -- sprites (main / foreground / background tiers, drawn upright like
// units) and the GROUND tier (bridges, buildings: their solids baked into the
// terrain's chunk layers, per-texel depth), handed to the ground baker per
// chunk with a key that changes when they do.

import type { ObjectDef } from "@keel-engine/object";
import { hashText } from "@keel-engine/terrain";
import type { GroundExtra } from "@keel-engine/terrain";
import type { ContentRef, Level, LoadTier, Style, V3 } from "./document.ts";
import { STYLES } from "./document.ts";
import { groundSolids } from "./content.ts";
import type { ContentResolver } from "./content.ts";
import { expandAll } from "./scatter.ts";

export interface PlacedInstance {
  readonly id: string;
  readonly ref: ContentRef;
  readonly def: ObjectDef<Record<string, unknown>>;
  readonly pos: V3;
  readonly yaw: number;
  readonly scale: number;
  readonly tier: LoadTier;
  /** A thing, or a plant grown by a scatter region. */
  readonly source: "thing" | "scatter";
}

export interface LevelInstances {
  /** Things drawn as sprites (not the ground tier), things first, then plants. */
  readonly sprites: readonly PlacedInstance[];
  /** Ground-tier things' solids, per chunk (by the chunk of the tile under each). */
  readonly ground: ReadonlyMap<number, readonly GroundExtra[]>;
  /** A chunk's ground extras' key (what the ground baker's extrasKey returns). */
  groundKey(chunk: number): string;
  /** References nothing resolved (the content packs don't have them yet). */
  readonly missing: readonly string[];
}

/** Resolve a level's things and its foliage. */
export function levelInstances(level: Level, content: ContentResolver): LevelInstances {
  const t = level.terrain;
  const sprites: PlacedInstance[] = [];
  const ground = new Map<number, GroundExtra[]>();
  const missing = new Set<string>();
  const add = (id: string, ref: ContentRef, pos: V3, yaw: number, scale: number, tier: LoadTier, source: "thing" | "scatter"): void => {
    const def = content.resolve(ref);
    if (!def) { missing.add(`${ref.pack}/${ref.object}`); return; }
    if (tier === "ground") {
      const [i, j] = t.tileAt(pos[0], pos[2]);
      const c = t.chunkOf(i, j);
      const list = ground.get(c) ?? [];
      list.push(...groundSolids(def, pos, yaw, scale));
      ground.set(c, list);
      return;
    }
    sprites.push({ id, ref, def, pos, yaw, scale, tier, source });
  };
  for (const th of [...level.things.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) add(th.id, level.refOf(th), th.pos, th.yaw, th.scale, th.tier, "thing");
  // (Plants: their style through the settings as a thing tagged foliage, its region and its content.)
  const styles = new Map<string, Style>();
  for (const p of expandAll(level)) {
    const sk = `${p.region}|${p.pack}|${p.object}`;
    let style = styles.get(sk);
    if (!style) {
      const v = level.settings.get("style", { id: `${p.region}#`, tags: ["foliage", `scatter:${p.region}`, `pack:${p.pack}`, `object:${p.object}`] });
      style = typeof v === "string" && (STYLES as readonly string[]).includes(v) ? (v as Style) : "pixel";
      styles.set(sk, style);
    }
    add(p.id, { pack: p.pack, object: p.object, pins: {}, look: null, style, seed: `${level.seed}:${p.id}` }, p.pos, p.yaw, p.scale, "foreground", "scatter");
  }
  const keys = new Map<number, string>();
  return {
    sprites, ground, missing: [...missing].sort(),
    groundKey(chunk) {
      let k = keys.get(chunk);
      if (k === undefined) { const list = ground.get(chunk); k = list?.length ? hashText(JSON.stringify(list)) : ""; keys.set(chunk, k); }
      return k;
    },
  };
}

/** The ground baker's extras and extrasKey for a level (createGroundBaker({ extras, extrasKey })). */
export function groundExtrasOf(inst: LevelInstances): { extras: (chunk: number) => readonly GroundExtra[]; extrasKey: (chunk: number) => string } {
  return { extras: (c) => inst.ground.get(c) ?? [], extrasKey: (c) => inst.groundKey(c) };
}
