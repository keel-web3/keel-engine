// World PACKS: how a content pack ships biomes, tilesets, room templates and
// acts. A world pack is data (no code runs to read it) and a manifest that
// PROVIDES a contract per item -- "biome/<id>@1.0.0", "tileset/<id>@1.0.0",
// "rooms/<pack>@1.0.0", "act/<id>@1.0.0" -- so a game or a recipe can NEED
// one ("contract:biome/mire@^1") and the registry resolves whichever pack
// provides it (keel/runtime). Its contents list the codec schemas its data
// is written in (schema.ts), so the editor reads it without running it.
//
//   const mire = defineWorldPack({ id: "packs/bogs", version: "1.0.0", biomes: [MIRE], rooms: [...] });
//   const world = worldOptions([mire]);          // the engine's biomes, acts and rooms, then the packs'
//   runPipeline(recipe, world);

import { defineManifest } from "@keel-engine/runtime";
import type { ModuleManifest } from "@keel-engine/runtime";
import type { TilesetRules } from "@keel-engine/terrain";
import { DEFAULT_ACTS, DEFAULT_BIOMES } from "./biomes.ts";
import type { ActDef, BiomeDef } from "./biomes.ts";
import { ROOM_TEMPLATES } from "./dungeon.ts";
import type { RoomTemplate } from "./dungeon.ts";
import type { PipelineOptions } from "./pipeline.ts";

export interface WorldPack {
  readonly id: string;
  readonly version: string;
  readonly biomes: readonly BiomeDef[];
  readonly tilesets: readonly TilesetRules[];
  readonly rooms: readonly RoomTemplate[];
  readonly acts: readonly ActDef[];
  /** The contracts it provides (its manifest's `provides`). */
  contracts(): string[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

export function defineWorldPack({ id, version, biomes = [], tilesets = [], rooms = [], acts = [] }: { readonly id: string; readonly version: string; readonly biomes?: readonly BiomeDef[]; readonly tilesets?: readonly TilesetRules[]; readonly rooms?: readonly RoomTemplate[]; readonly acts?: readonly ActDef[] }): WorldPack {
  const bad = (why: string): never => { throw new TypeError(`World pack ${id}: ${why}`); };
  const seen = new Set<string>();
  for (const b of biomes) { if (!ID.test(b.id)) bad(`biome id "${b.id}" must be lower-case words and dashes.`); if (seen.has(b.id)) bad(`two biomes called ${b.id}.`); seen.add(b.id); if (!b.ground.length) bad(`biome ${b.id} has no ground.`); }
  for (const t of tilesets) if (!ID.test(t.id)) bad(`tileset id "${t.id}" must be lower-case words and dashes.`);
  for (const r of rooms) {
    const w = r.rows[0]?.length ?? 0;
    if (!r.rows.length || r.rows.some((row) => row.length !== w)) bad(`room ${r.id}: its rows must be the same length.`);
    if (!r.rows.some((row) => row.includes("D"))) bad(`room ${r.id} has no door anchor (D).`);
  }
  const packName = id.split("/").pop()!;
  return Object.freeze({
    id, version, biomes, tilesets, rooms, acts,
    contracts: () => [
      ...biomes.map((b) => `biome/${b.id}@${version}`),
      ...tilesets.map((t) => `tileset/${t.id}@${version}`),
      ...(rooms.length ? [`rooms/${packName}@${version}`] : []),
      ...acts.map((a) => `act/${a.id}@${version}`),
    ],
  });
}

/** A world pack's engine manifest: kind pack, needs keel/worldgen, provides a contract per item. */
export function worldPackManifest(pack: WorldPack, { title, description }: { readonly title?: string; readonly description?: string } = {}): ModuleManifest {
  return defineManifest({
    id: pack.id, version: pack.version, kind: "pack", needs: ["keel/worldgen@^0.1"], provides: pack.contracts(),
    ...(title ? { title } : {}), ...(description ? { description } : {}),
  });
}

/** The engine's worlds content with packs' added (a pack's biome replaces the engine's of the same id; new ones append). */
export function worldOptions(packs: readonly WorldPack[] = []): Required<Pick<PipelineOptions, "biomes" | "acts" | "templates">> & { readonly tilesets: readonly TilesetRules[] } {
  const biomes: BiomeDef[] = [...DEFAULT_BIOMES];
  const acts: ActDef[] = [...DEFAULT_ACTS];
  const rooms: RoomTemplate[] = [...ROOM_TEMPLATES];
  const tilesets: TilesetRules[] = [];
  for (const p of packs) {
    for (const b of p.biomes) { const at = biomes.findIndex((x) => x.id === b.id); if (at >= 0) biomes[at] = b; else biomes.push(b); }
    for (const a of p.acts) { const at = acts.findIndex((x) => x.id === a.id); if (at >= 0) acts[at] = a; else acts.push(a); }
    rooms.push(...p.rooms);
    tilesets.push(...p.tilesets);
  }
  return { biomes, acts, templates: rooms, tilesets };
}
