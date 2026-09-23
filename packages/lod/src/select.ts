// Choosing each node's level, frame by frame: the coarsest level whose missing
// detail is under tau pixels (screen-space error, error.ts), with a hysteresis
// band so a steady camera never flickers a level, a dwell after each switch,
// and a dithered fade across every switch -- refining as soon as detail is
// missing, coarsening only once it has been gone a while. Presentation state
// only: nothing here is hashed or stored.
//
//   const lod = createLodSelector({ tau: 2, triangles: 40_000 });
//   for (const pick of lod.select(projection, nodes, dt)) for (const r of rangesOf(pick, node)) draw(r);

import { coarsestUnder, pixelError, viewOf } from "./error.ts";
import type { LodNode, LodPick, LodPolicy, LodView } from "./types.ts";

export interface LodSelector {
  /** Choose levels for this frame. `dt` in seconds (presentation time). Nodes not passed are forgotten. */
  select(view: LodView, nodes: readonly LodNode[], dt: number): readonly LodPick[];
  /** Triangles the last selection draws (before culling), counting a fading delta whole. */
  readonly triangles: number;
  /** Forget every node's state: the next selection places each at its level with no fade. */
  reset(): void;
}

interface State { level: number; to: number; t: number; held: number; seen: number }

/** How many triangles a pick draws (a fading delta counted whole: it is rasterised, then dithered). */
export function pickTriangles(pick: Pick<LodPick, "level" | "fading">, node: Pick<LodNode, "levels">): number {
  const l = pick.fading ? Math.min(pick.level, pick.fading.to) : pick.level;
  return (node.levels[Math.max(0, Math.min(node.levels.length - 1, l))] ?? 0) / 3;
}

export function createLodSelector(policy: LodPolicy = {}): LodSelector {
  const tau = policy.tau ?? 1, band = policy.band ?? 1.4, dwell = policy.dwell ?? 0.3, fade = policy.fade ?? 0.25;
  const budget = policy.triangles ?? Infinity;
  const states = new Map<string, State>();
  let frame = 0, triangles = 0;

  const step = (s: State, node: LodNode, errors: readonly number[], dt: number): void => {
    const top = node.levels.length - 1;
    const fine = Math.min(top, coarsestUnder(errors, tau)), coarse = Math.min(top, coarsestUnder(errors, tau / band));
    s.held += dt;
    if (s.to >= 0) {
      // A coarsening that detail is needed back for turns round: the same delta, fading in again from where it is.
      if (s.to > s.level && fine <= s.level) { const l = s.level; s.level = s.to; s.to = l; s.t = 1 - s.t; }
      s.t = fade > 0 ? s.t + dt / fade : 1;
      if (s.t >= 1) { s.level = s.to; s.to = -1; s.t = 0; s.held = 0; }
      return;
    }
    // (Detail plainly missing -- twice tau on any step the level drops -- refines at once, dwell or not.)
    let urgent = false;
    for (let i = fine; i < s.level; i += 1) if ((errors[i] ?? 0) >= 2 * tau) urgent = true;
    const target = fine < s.level && (urgent || s.held >= dwell) ? fine : coarse > s.level && s.held >= dwell ? coarse : s.level;
    if (target === s.level) return;
    if (fade <= 0) { s.level = target; s.held = 0; return; }
    s.to = target; s.t = Math.min(1, dt / fade);
  };

  const pickOf = (key: string, s: State, distance: number): LodPick => {
    if (s.to < 0) return { key, level: s.level, distance };
    // (What's drawn of the delta: rising while refining, falling while coarsening.)
    return { key, level: s.level, fading: { to: s.to, t: s.to < s.level ? s.t : 1 - s.t }, distance };
  };

  return {
    get triangles() { return triangles; },
    reset() { states.clear(); },
    select(view, nodes, dt) {
      frame += 1;
      const picks: LodPick[] = [];
      const byKey = new Map<string, LodNode>();
      for (const node of nodes) {
        byKey.set(node.key, node);
        const errors = node.steps.map((st) => pixelError(view, node, st));
        let s = states.get(node.key);
        if (!s) {
          // (A node seen for the first time takes its level at once: there is nothing on screen yet to fade from.)
          s = { level: Math.min(node.levels.length - 1, coarsestUnder(errors, tau)), to: -1, t: 0, held: dwell, seen: frame };
          states.set(node.key, s);
        } else step(s, node, errors, dt);
        s.seen = frame;
        picks.push(pickOf(node.key, s, viewOf(view, node).distance));
      }
      for (const [key, s] of states) if (s.seen !== frame) states.delete(key);
      triangles = 0;
      for (const p of picks) triangles += pickTriangles(p, byKey.get(p.key)!);
      if (triangles <= budget) return picks;
      // Over budget: the farthest nodes go a level coarser first, at once, until the frame fits.
      const order = picks.map((p, i) => i).sort((a, b) => picks[b]!.distance - picks[a]!.distance);
      // (One level at a time, always the farthest node that can still give one up.)
      let from = 0;
      while (triangles > budget && from < order.length) {
        const i = order[from]!, p = picks[i]!, node = byKey.get(p.key)!, s = states.get(p.key)!;
        const level = Math.max(p.level, p.fading?.to ?? 0);
        const next = p.fading ? level : level + 1;
        if (next > node.levels.length - 1) { from += 1; continue; }
        const before = pickTriangles(p, node);
        s.level = next; s.to = -1; s.t = 0; s.held = 0;
        picks[i] = { key: p.key, level: next, distance: p.distance };
        triangles += pickTriangles(picks[i]!, node) - before;
      }
      return picks;
    },
  };
}
