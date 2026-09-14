// Light and sight in a dungeon, on the CPU, once: each light's VISIBILITY
// MASK (which half-metre cells round it it reaches, walls and pillars
// casting shadows -- the first wall a ray meets is lit, so the wall's face
// shows the light) packed into one atlas the renderer's light pass stamps
// from; the hero's own mask, redone as he moves; and FOG OF WAR -- what the
// hero sees now (line of sight within a radius, and the whole room he stands
// in), what he has seen (dimmed), what he never has (dark), eased so rooms
// fade in rather than pop.

import { dhypot } from "@keel-engine/core";
import { CELL } from "./dungeon.ts";
import type { DungeonDressing } from "./dungeon-dress.ts";
import { FINE, SUB } from "./dungeon-scene.ts";
import type { DungeonScene } from "./dungeon-scene.ts";

/** Mask texels a metre (one per fine subcell at the default tile). */
export const MASK_PER_METRE = 2;

export interface LightMask {
  /** The mask's texels (0..255), `size` x `size`, centred on the light: texel (a, b)'s middle is at (x0 + (a + 0.5) / MASK_PER_METRE, z0 + ...). */
  readonly size: number;
  readonly x0: number;
  readonly z0: number;
  readonly data: Uint8Array;
}

const solidAt = (s: DungeonScene, x: number, z: number): boolean => {
  const fs = s.tile / SUB;
  const fx = Math.floor(x / fs), fz = Math.floor(z / fs);
  if (fx < 0 || fz < 0 || fx >= s.fw || fz >= s.fd) return true;
  const k = s.fine[fz * s.fw + fx]!;
  return k === FINE.WALL || k === FINE.PILLAR;
};

/** A light's mask: each texel lit if a straight line from the light reaches it (or it's the first solid the line meets). */
export function lightMask(s: DungeonScene, x: number, z: number, radius: number, out?: Uint8Array): LightMask {
  const m = MASK_PER_METRE;
  const size = Math.ceil(radius * 2 * m) + 2;
  const x0 = Math.floor(x * m) / m - (size >> 1) / m, z0 = Math.floor(z * m) / m - (size >> 1) / m;
  const data = out && out.length >= size * size ? out : new Uint8Array(size * size);
  const step = 0.2;
  for (let b = 0; b < size; b += 1) for (let a = 0; a < size; a += 1) {
    const tx = x0 + (a + 0.5) / m, tz = z0 + (b + 0.5) / m;
    const dx = tx - x, dz = tz - z, len = dhypot(dx, dz);
    if (len > radius + 0.5) { data[b * size + a] = 0; continue; }
    const n = Math.max(1, Math.ceil(len / step));
    let lit = 255;
    // (Walk toward the texel; the texel's own cell may be solid -- it's what the light falls on.)
    const fs = s.tile / SUB;
    const own = Math.floor(tx / fs) + Math.floor(tz / fs) * 1e5;
    for (let q = 1; q < n; q += 1) {
      const px = x + (dx * q) / n, pz = z + (dz * q) / n;
      if (Math.floor(px / fs) + Math.floor(pz / fs) * 1e5 === own) break;
      if (solidAt(s, px, pz)) { lit = 0; break; }
    }
    data[b * size + a] = lit;
  }
  return { size, x0, z0, data };
}

// ---------------------------------------------------------------- fog of war

export interface Fog {
  readonly w: number;
  readonly d: number;
  /** 0..255 per cell as the renderer samples it: 0 never seen, `remembered` seen, 255 in sight. Eased toward the target. */
  readonly shown: Uint8Array;
  /** Cells seen at least once. */
  readonly seen: Uint8Array;
  /** Recompute what's in sight from a point (world metres); `closed(cell)` says a door blocks sight. */
  look(x: number, z: number, closed?: (cell: number) => boolean): void;
  /** Ease the shown values toward their targets (dt seconds). Returns whether anything changed. */
  ease(dt: number): boolean;
  /** Everything seen (a map scroll, a debug view). */
  revealAll(): void;
  /** Cells seen, and in sight now. */
  readonly counts: { seen: number; visible: number };
}

export function createFog(S: DungeonDressing, { radius = 12, remembered = 0.42 }: { readonly radius?: number; readonly remembered?: number } = {}): Fog {
  const { w, d, tile } = S;
  const N = w * d;
  const seen = new Uint8Array(N), visible = new Uint8Array(N), shown = new Uint8Array(N), level = new Float32Array(N);
  const rem = Math.round(remembered * 255);
  const blocksSight = (k: number): boolean => S.cells[k] === CELL.WALL;
  const counts = { seen: 0, visible: 0 };
  const setVisible = (k: number): void => { if (!visible[k]) { visible[k] = 1; counts.visible += 1; } if (!seen[k]) { seen[k] = 1; counts.seen += 1; } };
  const fog: Fog = {
    w, d, shown, seen, counts,
    look(x, z, closed = () => false) {
      visible.fill(0); counts.visible = 0;
      const ci = Math.floor(x / tile), cj = Math.floor(z / tile);
      const R = Math.ceil(radius / tile);
      // Line of sight on the cell grid: a wall (or a shut door) stops it, and is itself seen.
      for (let dj = -R; dj <= R; dj += 1) for (let di = -R; di <= R; di += 1) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= w || j >= d || dhypot(di, dj) * tile > radius) continue;
        const n = Math.max(1, Math.ceil(dhypot(di, dj) * 3));
        let ok = true;
        for (let q = 1; q < n; q += 1) {
          const a = Math.floor(ci + 0.5 + (di * q) / n), b = Math.floor(cj + 0.5 + (dj * q) / n);
          if (a === i && b === j) break;
          const k = b * w + a;
          if (blocksSight(k) || closed(k)) { ok = false; break; }
        }
        if (ok) setVisible(j * w + i);
      }
      // The room he stands in, all of it, and the walls round it.
      const k0 = cj * w + ci;
      const room = ci >= 0 && cj >= 0 && ci < w && cj < d ? S.roomOf[k0]! : -1;
      if (room >= 0) for (const k of S.rooms[room]!.cells) {
        setVisible(k);
        const i = k % w, j = Math.floor(k / w);
        for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w && b < d && S.cells[b * w + a] === CELL.WALL) setVisible(b * w + a); }
      }
    },
    ease(dt) {
      let changed = false;
      const k = Math.min(1, dt * 5);
      for (let q = 0; q < N; q += 1) {
        const target = visible[q] ? 255 : seen[q] ? rem : 0;
        const cur = level[q]!;
        if (cur === target) continue;
        const next = Math.abs(target - cur) < 2 ? target : cur + (target - cur) * k;
        level[q] = next;
        const b = Math.round(next);
        if (b !== shown[q]) { shown[q] = b; changed = true; }
      }
      return changed;
    },
    revealAll() { for (let q = 0; q < N; q += 1) { seen[q] = 1; visible[q] = 1; level[q] = 255; shown[q] = 255; } counts.seen = N; counts.visible = N; },
  };
  return fog;
}
