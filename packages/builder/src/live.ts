// The live preview: what the editor draws while ops stream in -- by hand or
// from an agent -- updated from each op's change event, not rebuilt.
//
//   const live = livePreview(session);
//   for (const r of streamOps(ops, session)) { if (r.ok) live.apply(r.event); draw(live.solids()); }
//
// Voxels are meshed per 16^3 chunk (greedy boxes within each chunk, by group
// and role), and a voxel event re-meshes only the chunks its cells touch: a
// brush stroke costs its chunks, whatever the model's size. (Boxes don't
// cross chunk borders here, so a preview has a few more than the final
// conversion's global merge.) A character is re-skinned on any change (its
// capsules are few). Events that change what everything is (a new model,
// a group, a rig) rebuild all.

import { posed } from "@keel-engine/entity";
import type { ObjectSolids } from "./animate.ts";
import { characterLook, characterSolids, characterSpec } from "./character.ts";
import { builderLook, materialOf } from "./look.ts";
import type { Look } from "./look.ts";
import { greedyGrid } from "./mesh.ts";
import type { ChangeEvent, Session } from "./ops.ts";
import type { V3, VoxelModel } from "./voxels.ts";

const CHUNK = 16;

export interface LivePreview {
  /** Take in an op's change. */
  apply(event: ChangeEvent): void;
  /** What to draw now (metres, own frame; a character at rest in its idle), and the look it wears. */
  solids(): { solids: ObjectSolids; look: Look };
  /** Work done: chunks meshed in all, and on the last event; boxes now. */
  readonly stats: { readonly chunks: number; readonly meshed: number; readonly lastMeshed: number; readonly boxes: number };
}

interface ChunkBoxes { boxes: Array<{ min: V3; size: V3; role: string }> }

export function livePreview(session: Session): LivePreview {
  const chunks = new Map<string, ChunkBoxes>();
  let meshed = 0, lastMeshed = 0;
  let model: VoxelModel = session.editor.model;
  let charCache: { solids: ObjectSolids; look: Look } | null = null;

  const keyOf = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`;
  const meshChunk = (cx: number, cy: number, cz: number): void => {
    const m = model;
    const names = [...m.groups.keys()];
    const labels = new Int32Array(CHUNK * CHUNK * CHUNK);
    let any = false;
    for (let z = 0; z < CHUNK; z += 1) for (let y = 0; y < CHUNK; y += 1) for (let x = 0; x < CHUNK; x += 1) {
      const vx = cx * CHUNK + x, vy = cy * CHUNK + y, vz = cz * CHUNK + z;
      const v = m.get(vx, vy, vz);
      if (!v) continue;
      any = true;
      const g = names.length ? m.groupAt(vx, vy, vz) : null;
      labels[x + CHUNK * (y + CHUNK * z)] = (g === null ? 0 : names.indexOf(g) + 1) * 256 + v;
    }
    meshed += 1; lastMeshed += 1;
    const k = keyOf(cx, cy, cz);
    if (!any) { chunks.delete(k); return; }
    const boxes = greedyGrid(labels, [CHUNK, CHUNK, CHUNK], [cx * CHUNK, cy * CHUNK, cz * CHUNK], [0, 2, 1]).map((b) => ({ min: b.min, size: b.size, role: m.roles[(b.label & 255) - 1] ?? "primary" }));
    chunks.set(k, { boxes });
  };
  const rebuildAll = (): void => {
    chunks.clear();
    model = session.editor.model;
    charCache = null;
    if (session.design) return;
    const seen = new Set<string>();
    model.forEach((x, y, z) => { const c = [Math.floor(x / CHUNK), Math.floor(y / CHUNK), Math.floor(z / CHUNK)] as V3; const k = keyOf(...c); if (!seen.has(k)) { seen.add(k); meshChunk(...c); } });
  };
  rebuildAll();

  return {
    apply(e) {
      lastMeshed = 0;
      if (session.design) { charCache = null; return; }
      if (session.editor.model !== model || e.rebuild === "all" && !(e.kind === "voxels" || e.of === "voxels")) { rebuildAll(); return; }
      // (A region added to a group changes the labels -- so the merging -- of only the chunks under it.)
      if (e.kind === "group" && e.region) {
        const lo = e.region.min.map((v) => Math.floor(v / CHUNK)), hi = e.region.max.map((v) => Math.floor(v / CHUNK));
        for (let cz = lo[2]!; cz <= hi[2]!; cz += 1) for (let cy = lo[1]!; cy <= hi[1]!; cy += 1) for (let cx = lo[0]!; cx <= hi[0]!; cx += 1) {
          if (chunks.has(keyOf(cx, cy, cz))) meshChunk(cx, cy, cz);
        }
        return;
      }
      if (!e.cells) return;
      const touched = new Set<string>();
      const at = e.cells.at;
      for (let i = 0; i < at.length; i += 3) {
        const c: V3 = [Math.floor(at[i]! / CHUNK), Math.floor(at[i + 1]! / CHUNK), Math.floor(at[i + 2]! / CHUNK)];
        const k = keyOf(...c);
        if (touched.has(k)) continue;
        touched.add(k);
        meshChunk(...c);
      }
    },
    solids() {
      if (session.design) {
        if (!charCache) {
          const spec = characterSpec(session.design);
          const look = characterLook(spec);
          charCache = { solids: characterSolids(session.design, posed(spec, "idle", { t: 0.4 }), look, session.attributes, spec), look };
        }
        return charCache;
      }
      const look = builderLook(session.colours, { extra: [...model.roles] });
      const p = model.pivot();
      const u = model.unit;
      const boxes: ObjectSolids["boxes"] = [];
      for (const c of chunks.values()) for (const b of c.boxes) {
        boxes.push({ c: [(b.min[0] + b.size[0] / 2 - p[0]) * u, (b.min[1] + b.size[1] / 2 - p[1]) * u, (b.min[2] + b.size[2] / 2 - p[2]) * u], h: [(b.size[0] / 2) * u, (b.size[1] / 2) * u, (b.size[2] / 2) * u], yaw: 0, mat: materialOf(look, b.role) });
      }
      return { solids: { boxes, capsules: [] }, look };
    },
    get stats() {
      let boxes = 0;
      for (const c of chunks.values()) boxes += c.boxes.length;
      return { chunks: chunks.size, meshed, lastMeshed, boxes };
    },
  };
}
