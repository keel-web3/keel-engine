// A sheet: the numbers a game reads for its hero, made by laying programs over
// the contract's bases -- sets, then adds, then multiplies, then each clamped
// to its range -- and the triggers the programs carry, fired as the run goes:
// a pool topped up now, or a stat moved for a while (a buff with a clock).
//
//   const sheet = createSheet(contract, [classProgram, ...gear, ...infusions], vars);
//   sheet.get("bolt.count");          // what the game reads
//   sheet.fire("kill", liveVars, t);  // -> pool gifts { hp: 3 } (the game adds them), buffs started
//   sheet.tick(dt);                   // buffs run out
//
// Deterministic (a sim reads it): pure arithmetic, fixed order, and a
// checksum-able state.

import { evalExpr } from "./expr.ts";
import type { Contract, Mod, Program, Trigger } from "./contract.ts";

interface Buff { readonly stat: string; readonly op: Mod["op"]; readonly value: number; left: number }

export interface Sheet {
  /** A stat now (its built value with the buffs running on it, clamped). */
  get(stat: string): number;
  /** All the built values (no buffs). */
  readonly built: Readonly<Record<string, number>>;
  /** An event happened: the pool gifts it brings (the game adds them to its pools), and buffs started. */
  fire(event: string, live: Readonly<Record<string, number>>, now: number): Record<string, number>;
  /** Time passes: buffs run out. */
  tick(dt: number): void;
  /** Everything that changes as the run goes, as numbers (for a checksum). */
  state(): number[];
  readonly programs: readonly Program[];
}

export function createSheet(c: Contract, programs: readonly Program[], vars: Readonly<Record<string, number>>): Sheet {
  const built: Record<string, number> = {};
  for (const [k, s] of Object.entries(c.stats)) built[k] = s.base;
  const ordered: Array<[Mod, number]> = [];
  for (const p of programs) for (const m of p.mods) if (c.stats[m.stat]) ordered.push([m, evalExpr(m.value, vars)]);
  for (const op of ["set", "add", "mul"] as const) for (const [m, v] of ordered) if (m.op === op) {
    built[m.stat] = op === "set" ? v : op === "add" ? built[m.stat]! + v : built[m.stat]! * v;
  }
  const clamp = (k: string, v: number): number => { const s = c.stats[k]; return s ? (v < s.min ? s.min : v > s.max ? s.max : v) : v; };
  for (const k of Object.keys(built)) built[k] = clamp(k, built[k]!);

  const triggers: Array<{ t: Trigger; ready: number }> = [];
  for (const p of programs) for (const t of p.triggers) if (c.events[t.on]) triggers.push({ t, ready: 0 });
  const buffs: Buff[] = [];

  return {
    built,
    programs,
    get(stat) {
      let v = built[stat] ?? 0;
      for (const b of buffs) if (b.stat === stat && b.op === "add") v += b.value;
      for (const b of buffs) if (b.stat === stat && b.op === "mul") v *= b.value;
      for (const b of buffs) if (b.stat === stat && b.op === "set") v = b.value;
      return clamp(stat, v);
    },
    fire(event, live, now) {
      const gifts: Record<string, number> = {};
      const all = { ...vars, ...live };
      for (const q of triggers) {
        if (q.t.on !== event || now < q.ready) continue;
        q.ready = now + (q.t.every ?? 0);
        for (const m of q.t.do) {
          const v = evalExpr(m.value, all);
          if (c.stats[m.stat]?.pool) gifts[m.stat] = (gifts[m.stat] ?? 0) + v;
          else if (m.for) buffs.push({ stat: m.stat, op: m.op, value: v, left: m.for });
        }
      }
      return gifts;
    },
    tick(dt) {
      for (let i = buffs.length - 1; i >= 0; i -= 1) { buffs[i]!.left -= dt; if (buffs[i]!.left <= 0) buffs.splice(i, 1); }
    },
    state() {
      const out: number[] = [];
      for (const q of triggers) out.push(q.ready);
      for (const b of buffs) out.push(b.value, b.left);
      return out;
    },
  };
}
