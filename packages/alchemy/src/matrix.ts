// The matrix: every combination of two things, and what it makes -- filled in
// once, by whoever answers first, and kept forever. The base elements are
// its first row; what two of them make is a new thing, which combines again;
// the deeper a thing (its tier) and the more base elements in it (its
// leaves), the more its program may do (limitsFor). A cell's key is the pair
// (in either order); its entry is content-addressed -- its id the hash of its
// program read through the contract -- so a run that names an entry names
// exactly those numbers, and a verifier can check them against the matrix.
//
//   const M = createMatrix({ contract, store: memoryStore(), oracles: [bridgeOracle, seededOracle(contract)] });
//   const steam = await M.combine("fire", "water");   // asked once; every later call is the store's
//
// An ORACLE answers a cell: it gets the request (the two ingredients, their
// leaves and tier, the budget, and a prompt that spells out the contract) and
// returns anything -- the matrix reads it through the contract. Oracles are
// tried in order; the seeded one never fails, so the matrix always answers.

import { canonicalJson } from "@keel-engine/replay";
import { sha256, toHex } from "@keel-engine/codec";
import { limitsFor, programHash, readProgram } from "./contract.ts";
import type { Contract, Program } from "./contract.ts";
import { OPS, tidy } from "./expr.ts";

export interface Entry {
  /** Content address: the program's hash (short). */
  readonly id: string;
  /** The cell: the two ingredients' ids, sorted, joined by "+" ("" for a base element). */
  readonly key: string;
  readonly from: readonly string[];
  /** Base elements in it, by element. */
  readonly leaves: Readonly<Record<string, number>>;
  readonly tier: number;
  readonly contract: number;
  readonly program: Program;
  readonly cost: number;
  readonly budget: number;
  /** Who answered it ("seeded", "bridge:claude", a person). */
  readonly by: string;
  readonly hash: string;
}

export interface CellRequest {
  readonly key: string;
  readonly a: Entry;
  readonly b: Entry;
  readonly leaves: Readonly<Record<string, number>>;
  readonly tier: number;
  readonly limits: ReturnType<typeof limitsFor>;
  readonly prompt: string;
}
export interface Oracle { readonly name: string; answer(req: CellRequest, contract: Contract): Promise<unknown> | unknown }
export interface MatrixStore {
  get(key: string): Entry | undefined | Promise<Entry | undefined>;
  put(entry: Entry): void | Promise<void>;
  /** By id (content address). */
  byId(id: string): Entry | undefined | Promise<Entry | undefined>;
}

export const cellKey = (a: string, b: string): string => (a < b ? `${a}+${b}` : `${b}+${a}`);
const leafCount = (l: Readonly<Record<string, number>>): number => Object.values(l).reduce((p, q) => p + q, 0);

/** A store in memory (seed it with entries; `entries()` to save them). */
export function memoryStore(initial: readonly Entry[] = []) {
  const byKey = new Map<string, Entry>();
  const ids = new Map<string, Entry>();
  for (const e of initial) { byKey.set(e.key || e.id, e); ids.set(e.id, e); }
  return {
    get: (key: string) => byKey.get(key),
    put: (e: Entry) => { byKey.set(e.key || e.id, e); ids.set(e.id, e); },
    byId: (id: string) => ids.get(id),
    entries: (): Entry[] => [...ids.values()],
  };
}

/** Makes an entry from a program (read through the contract). */
export function entryOf(c: Contract, raw: unknown, cell: { key: string; from: readonly string[]; leaves: Readonly<Record<string, number>>; tier: number }, by: string): Entry {
  const r = readProgram(c, raw, cell.tier, leafCount(cell.leaves));
  const hash = programHash(c, r.program);
  return { id: hash.slice(0, 16), key: cell.key, from: cell.from, leaves: cell.leaves, tier: cell.tier, contract: c.version, program: r.program, cost: r.cost, budget: r.budget, by, hash };
}

/** The base elements, as entries (their programs: a nudge toward what they lean to). */
export function baseEntries(c: Contract): Entry[] {
  return Object.entries(c.elements).map(([id, el]) => {
    const e = entryOf(c, { name: el.name, text: el.text, mods: el.leans.slice(0, 1).map((stat) => ({ stat, op: "add", value: (c.stats[stat]?.reach ?? 0) * 0.25 * Math.sign(c.stats[stat]?.worth ?? 1) })), look: { hue: el.hue, aura: el.aura } }, { key: "", from: [], leaves: { [id]: 1 }, tier: 0 }, "base");
    return { ...e, id, key: id };
  });
}

export interface Matrix {
  /** What two things make (asked once, then the store's). */
  combine(a: string, b: string): Promise<Entry>;
  /** A cell, if it's been filled. */
  known(a: string, b: string): Promise<Entry | undefined>;
  entry(id: string): Promise<Entry | undefined>;
  readonly contract: Contract;
}

export function createMatrix(o: { contract: Contract; store: MatrixStore; oracles: readonly Oracle[] }): Matrix {
  const c = o.contract;
  const bases = new Map(baseEntries(c).map((e) => [e.id, e]));
  const pending = new Map<string, Promise<Entry>>();
  const entry = async (id: string): Promise<Entry | undefined> => bases.get(id) ?? (await o.store.byId(id));
  async function combine(a: string, b: string): Promise<Entry> {
    const key = cellKey(a, b);
    const had = await o.store.get(key);
    if (had) return had;
    const busy = pending.get(key);
    if (busy) return busy; // (two asks for one cell: one answer)
    const job = (async () => {
      const A = await entry(a), B = await entry(b);
      if (!A || !B) throw new Error(`unknown ingredient ${!A ? a : b}`);
      const leaves: Record<string, number> = { ...A.leaves };
      for (const [k, n] of Object.entries(B.leaves)) leaves[k] = (leaves[k] ?? 0) + n;
      const tier = Math.max(A.tier, B.tier) + 1;
      const limits = limitsFor(c, tier, leafCount(leaves));
      const req: CellRequest = { key, a: A, b: B, leaves, tier, limits, prompt: promptFor(c, A, B, leaves, tier) };
      let made: Entry | null = null;
      for (const or of o.oracles) {
        try {
          const raw = await or.answer(req, c);
          if (raw === undefined || raw === null) continue;
          const e = entryOf(c, raw, { key, from: [A.id, B.id].sort(), leaves, tier }, or.name);
          if (e.program.mods.length + e.program.triggers.length === 0) continue; // (nothing it could keep: the next oracle)
          made = e;
          break;
        } catch { /* (that oracle failed: the next) */ }
      }
      if (!made) throw new Error(`no oracle answered ${key}`);
      await o.store.put(made);
      return made;
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }
  return { combine, known: async (a, b) => o.store.get(cellKey(a, b)), entry, contract: c };
}

// ---------------------------------------------------------------- the prompt (for any AI oracle)
/** Spells out the contract and the cell for an AI: what it may write, what it's worth, what it must fit. */
export function promptFor(c: Contract, a: Entry, b: Entry, leaves: Readonly<Record<string, number>>, tier: number): string {
  const lim = limitsFor(c, tier, leafCount(leaves));
  const stats = Object.entries(c.stats).map(([k, s]) => `  ${k}: ${s.text} [${s.min}..${s.max}, base ${s.base}, worth ${s.worth}/unit, one mod moves it at most ${tidy(s.reach * lim.reach)}${s.whole ? ", whole numbers" : ""}${s.pool ? ", POOL: only trigger 'add'" : ""}]`).join("\n");
  const vars = Object.entries(c.vars).map(([k, v]) => `  ${k}: ${v.text}${v.live ? " (triggers only)" : ""}`).join("\n");
  const events = Object.entries(c.events).map(([k, v]) => `  ${k}: ${v.text}`).join("\n");
  const els = Object.entries(leaves).map(([k, n]) => `${c.elements[k]?.name ?? k} x${n}`).join(", ");
  return [
    `You are the element matrix of a game. Two things are being combined; invent what they make -- anything at all (a substance, a creature, an object, an idea) -- and write its effect on the hero who is infused with it, in the JSON program format below. Be imaginative, fitting to its ingredients, and a little double-edged: a strong effect may carry a drawback (a drawback earns back budget).`,
    ``,
    `Combining: "${a.program.name}" (${a.program.text || "tier " + a.tier}) + "${b.program.name}" (${b.program.text || "tier " + b.tier}). Base elements in it: ${els}. Tier ${tier}.`,
    `Budget: ${lim.budget} points (sum over mods of how far it moves a stat times that stat's worth; over budget, its good parts are scaled down). At most ${lim.mods} mods, ${lim.triggers} triggers, ${lim.nodes} expression nodes in all.`,
    ``,
    `Stats:\n${stats}`,
    `Variables formulas may read:\n${vars}`,
    `Events triggers fire on:\n${events}`,
    `Looks: hue 0..360, chroma 0..0.2, size 0.5..2, aura one of [${c.looks.auras.join(", ")}], trail one of [${c.looks.trails.join(", ")}].`,
    `Expressions: a number, ["var", name], or [op, ...args] with op in ${OPS.join(", ")}.`,
    ``,
    `Answer with ONLY this JSON object, no prose:`,
    `{"name": "<2-3 words>", "text": "<one evocative sentence>", "mods": [{"stat": "...", "op": "add|mul|set", "value": <expr>}], "triggers": [{"on": "<event>", "every": <seconds cooldown, optional>, "do": [{"stat": "...", "op": "add", "value": <expr>, "for": <seconds, 0 for a pool>}]}], "look": {"hue": 0, "chroma": 0.1, "aura": "...", "trail": "...", "size": 1}}`,
  ].join("\n");
}

/** Pulls the JSON object out of an AI's text answer (a fenced block, or the first "{" to the last "}"). */
export function jsonFromText(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  try { return JSON.parse(body); } catch { /* (try the braces) */ }
  const i = body.indexOf("{"), j = body.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(body.slice(i, j + 1)); } catch { /* (nothing) */ } }
  return undefined;
}

// ---------------------------------------------------------------- the seeded oracle (never fails, needs nothing)
/** A generator that answers any cell from its key alone: names from the elements' words, mods from what they lean to. */
export function seededOracle(): Oracle {
  return {
    name: "seeded",
    answer(req, c) {
      const h = sha256(new TextEncoder().encode(`${c.id}|${req.key}`));
      let at = 0;
      const next = (): number => { const v = h[at % h.length]! / 256 + h[(at + 7) % h.length]! / 65536; at += 1; return v; };
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length) % xs.length]!;
      const els = Object.entries(req.leaves).sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1));
      const main = c.elements[els[0]![0]]!, second = c.elements[(els[1] ?? els[0])![0]]!;
      const name = `${pick(main.words[0])} ${pick(second.words[1])}`;
      const leans = [...new Set(els.flatMap(([k]) => c.elements[k]?.leans ?? []))].filter((s) => c.stats[s] && !c.stats[s]!.pool);
      const mods: unknown[] = [];
      const n = Math.min(req.limits.mods, 1 + Math.floor(next() * 3));
      for (let q = 0; q < n && leans.length; q += 1) {
        const stat = pick(leans);
        const s = c.stats[stat]!;
        const amount = s.reach * req.limits.reach * (0.3 + 0.6 * next());
        mods.push({ stat, op: "add", value: Math.round(amount * Math.sign(s.worth) * 1000) / 1000 });
      }
      // (A drawback now and then: the budget it earns back goes to the rest.)
      const all = Object.keys(c.stats).filter((k) => !c.stats[k]!.pool && !leans.includes(k));
      if (all.length && next() < 0.5) { const stat = pick(all); const s = c.stats[stat]!; mods.push({ stat, op: "add", value: Math.round(-s.reach * 0.4 * Math.sign(s.worth) * 1000) / 1000 }); }
      const triggers: unknown[] = [];
      const pools = Object.keys(c.stats).filter((k) => c.stats[k]!.pool);
      if (req.limits.triggers > 0 && pools.length && Object.keys(c.events).length) {
        const stat = pick(pools);
        triggers.push({ on: pick(Object.keys(c.events)), every: 2, do: [{ stat, op: "add", value: Math.round(c.stats[stat]!.reach * 0.5 * 1000) / 1000 }] });
      }
      const hue = Math.round((main.hue * 2 + second.hue) / 3);
      return { name, text: `${main.name} and ${second.name}, bound together.`, mods, triggers, look: { hue, chroma: 0.12, aura: main.aura, trail: pick(c.looks.trails) } };
    },
  };
}

/** A run's loadout of entries, as a string for a header -- and its hash (what a verifier checks the entries against). */
export function loadoutText(entries: readonly Entry[]): { text: string; hash: string } {
  const text = canonicalJson(entries.map((e) => ({ id: e.id, program: e.program })) as never);
  return { text, hash: toHex(sha256(new TextEncoder().encode(text))) };
}
