// A contract: everything a generated program may touch, and what each thing
// is worth. The game writes it once -- its stats (with their ranges and their
// worth), the variables formulas may read, the events triggers may fire on,
// the looks a program may put on, the base elements and what each leans
// toward -- and every program, whoever wrote it (a person, a seeded
// generator, an AI through the bridge), is read THROUGH it: unknown stats
// and events dropped, formulas checked, values clamped, the whole thing
// priced, and pulled back toward doing nothing until it fits its budget. A
// program can be anything within that; it can never be outside it.
//
// Contracts are versioned. A newer one may add stats, events, looks (and
// rename old ones via `renames`); a program written against an older version
// is read through the newer one and keeps what still means something. So what
// the AI already made is never made again: the matrix only ever grows.
//
// A program:
//   { name, text,
//     mods:     [{ stat, op: "add"|"mul"|"set", value: Expr }],            fixed when the hero is built
//     triggers: [{ on: event, every?: s, do: [{ stat, op, value, for?: s }] }],  fired as the run goes
//     look:     { hue?, chroma?, aura?, trail?, size? } }

import { canonicalJson } from "@keel-engine/replay";
import { sha256, toHex } from "@keel-engine/codec";
import { checkExpr, evalExpr, exprVars, scaleToward, tidy } from "./expr.ts";
import type { Expr } from "./expr.ts";

export interface StatSpec {
  readonly min: number;
  readonly max: number;
  /** Its value before anything touches it (what "mul" and "set" are priced against). */
  readonly base: number;
  /** Points one unit more of it is worth -- negative when more of it is worse (damage taken, costs). */
  readonly worth: number;
  /** The most one mod may move it (a tier-0 program; deeper ones reach further). */
  readonly reach: number;
  /** A pool (health, mana, charge): triggers add to it now; it isn't a mod's to set. */
  readonly pool?: boolean;
  /** Only whole numbers count (a count, charges): a plain value is rounded -- down, if rounding up would break the budget. */
  readonly whole?: boolean;
  readonly text: string;
}
export interface VarSpec { readonly nominal: number; readonly text: string; /** Readable only when a trigger fires (else also when the hero is built). */ readonly live?: boolean }
export interface EventSpec { /** How many times a second it happens in a typical run (for pricing a trigger). */ readonly rate: number; readonly text: string }
export interface ElementSpec {
  readonly name: string;
  /** The stats it leans toward (a generator's hint; an AI's too). */
  readonly leans: readonly string[];
  readonly hue: number;
  readonly aura: string;
  /** Words for naming what it makes (adjectives, nouns): the seeded generator's. */
  readonly words: readonly [readonly string[], readonly string[]];
  readonly text: string;
}
export interface Limits {
  /** Points a program may spend: base + perLeaf x (base elements in it) + perTier x tier. */
  readonly budget: { readonly base: number; readonly perLeaf: number; readonly perTier: number };
  readonly mods: { readonly base: number; readonly perTier: number };
  readonly triggers: { readonly base: number; readonly perTier: number };
  readonly nodes: { readonly base: number; readonly perTier: number };
  /** How much further than `reach` a mod may move a stat, per tier. */
  readonly reachPerTier: number;
}
export interface Contract {
  readonly id: string;
  readonly version: number;
  readonly stats: Readonly<Record<string, StatSpec>>;
  readonly vars: Readonly<Record<string, VarSpec>>;
  readonly events: Readonly<Record<string, EventSpec>>;
  readonly looks: { readonly auras: readonly string[]; readonly trails: readonly string[] };
  readonly elements: Readonly<Record<string, ElementSpec>>;
  readonly limits: Limits;
  /** Old stat, event or look names, and what they're called now. */
  readonly renames?: Readonly<Record<string, string>>;
}
export const defineContract = (c: Contract): Contract => c;

export type ModOp = "add" | "mul" | "set";
export interface Mod { readonly stat: string; readonly op: ModOp; readonly value: Expr; /** In a trigger: seconds it lasts (0 or none: a pool's is added now). */ readonly for?: number }
export interface Trigger { readonly on: string; readonly every?: number; readonly do: readonly Mod[] }
export interface Look { readonly hue?: number; readonly chroma?: number; readonly aura?: string; readonly trail?: string; readonly size?: number }
export interface Program { readonly name: string; readonly text: string; readonly mods: readonly Mod[]; readonly triggers: readonly Trigger[]; readonly look: Look }

/** What a program's reading came to: the program as it now stands, its price, its budget, and what was changed. */
export interface Reading { readonly program: Program; readonly cost: number; readonly budget: number; readonly notes: readonly string[] }

/** A program's size by its tier (how deep it is in the matrix) and its leaves (base elements in it). */
export function limitsFor(c: Contract, tier: number, leaves: number) {
  const L = c.limits;
  return {
    budget: tidy(L.budget.base + L.budget.perLeaf * leaves + L.budget.perTier * tier),
    mods: Math.floor(L.mods.base + L.mods.perTier * tier),
    triggers: Math.floor(L.triggers.base + L.triggers.perTier * tier),
    nodes: Math.floor(L.nodes.base + L.nodes.perTier * tier),
    reach: 1 + L.reachPerTier * tier,
  };
}

const neutralOf = (c: Contract, m: Mod): number => (m.op === "add" ? 0 : m.op === "mul" ? 1 : c.stats[m.stat]!.base);
/** How much a mod moves its stat, at the variables' nominal values. */
function deltaOf(c: Contract, m: Mod, nominal: Readonly<Record<string, number>>): number {
  const s = c.stats[m.stat]!;
  const v = evalExpr(m.value, nominal);
  return m.op === "add" ? v : m.op === "mul" ? (v - 1) * s.base : v - s.base;
}
/** A mod's price: what it moves its stat by, times what that's worth (a trigger's by how often it can fire, and for how long). */
function priceOf(c: Contract, m: Mod, nominal: Readonly<Record<string, number>>, perSecond = 0): number {
  const s = c.stats[m.stat]!;
  const p = deltaOf(c, m, nominal) * s.worth;
  if (!perSecond) return p;
  // (A pool's gift: priced as if over ten seconds of firing; a buff: by the share of the time it's on.)
  return s.pool ? p * perSecond * 10 : p * Math.min(1, perSecond * (m.for ?? 0));
}

/**
 * Reads a program through a contract: keeps what's in it, drops what isn't, clamps, prices -- and, if it costs more
 * than its budget, pulls its good parts back toward nothing (never its bad parts) until it fits. Deterministic: the
 * same raw program, contract, tier and leaves always read the same, so its hash is its identity.
 */
export function readProgram(c: Contract, raw: unknown, tier: number, leaves: number): Reading {
  const lim = limitsFor(c, tier, leaves);
  const notes: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rename = (n: string): string => c.renames?.[n] ?? n;
  const nominal: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.vars)) nominal[k] = v.nominal;
  const buildVars = new Set(Object.entries(c.vars).filter(([, v]) => !v.live).map(([k]) => k));
  const allVars = new Set(Object.keys(c.vars));
  let nodes = 0;
  const readMod = (x: unknown, inTrigger: boolean): Mod | null => {
    const m = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const stat = rename(String(m["stat"] ?? ""));
    const spec = c.stats[stat];
    if (!spec) { notes.push(`no stat ${stat}`); return null; }
    const op: ModOp = m["op"] === "mul" || m["op"] === "set" ? (m["op"] as ModOp) : "add";
    if (spec.pool && !inTrigger) { notes.push(`${stat} is a pool: only a trigger adds to it`); return null; }
    if (spec.pool && op !== "add") { notes.push(`${stat}: pools are only added to`); return null; }
    const check = checkExpr(m["value"] ?? 0, inTrigger ? allVars : buildVars, Math.max(1, lim.nodes - nodes));
    nodes += check.nodes;
    for (const p of check.problems) notes.push(`${stat}: ${p}`);
    let value = check.expr;
    // (Each mod reaches only so far: past it, it's pulled back.)
    const mod0: Mod = { stat, op, value };
    const d = deltaOf(c, mod0, nominal);
    const most = spec.reach * lim.reach;
    if (Math.abs(d) > most) { value = scaleToward(value, neutralOf(c, mod0), most / Math.abs(d)); notes.push(`${stat}: reaches too far, pulled back`); }
    const out: Mod = inTrigger ? { stat, op, value, for: tidy(Math.max(0, Math.min(30, Number(m["for"] ?? 0) || 0))) } : { stat, op, value };
    return out;
  };
  const asArray = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const mods = asArray(r["mods"]).map((x) => readMod(x, false)).filter((m): m is Mod => m !== null).slice(0, lim.mods);
  const triggers: Trigger[] = [];
  for (const t of asArray(r["triggers"]).slice(0, lim.triggers)) {
    const tt = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const on = rename(String(tt["on"] ?? ""));
    if (!c.events[on]) { notes.push(`no event ${on}`); continue; }
    const act = asArray(tt["do"]).map((x) => readMod(x, true)).filter((m): m is Mod => m !== null).slice(0, 3);
    if (!act.length) continue;
    const every = tidy(Math.max(0, Math.min(60, Number(tt["every"] ?? 0) || 0)));
    triggers.push(every ? { on, every, do: act } : { on, do: act });
  }
  const lk = (r["look"] && typeof r["look"] === "object" ? r["look"] : {}) as Record<string, unknown>;
  const look: Look = {
    ...(Number.isFinite(Number(lk["hue"])) && lk["hue"] !== undefined ? { hue: tidy(((Number(lk["hue"]) % 360) + 360) % 360) } : {}),
    ...(Number.isFinite(Number(lk["chroma"])) && lk["chroma"] !== undefined ? { chroma: tidy(Math.max(0, Math.min(0.2, Number(lk["chroma"])))) } : {}),
    ...(c.looks.auras.includes(rename(String(lk["aura"] ?? ""))) ? { aura: rename(String(lk["aura"])) } : {}),
    ...(c.looks.trails.includes(rename(String(lk["trail"] ?? ""))) ? { trail: rename(String(lk["trail"])) } : {}),
    ...(Number.isFinite(Number(lk["size"])) && lk["size"] !== undefined ? { size: tidy(Math.max(0.5, Math.min(2, Number(lk["size"])))) } : {}),
  };

  // Price it, and pull the good parts back until it fits.
  const rateOf = (t: Trigger): number => { const r0 = c.events[t.on]!.rate; return t.every ? Math.min(r0, 1 / t.every) : r0; };
  const parts: Array<{ mod: Mod; price: number; where: number; at: number }> = [];
  mods.forEach((m, i) => parts.push({ mod: m, price: priceOf(c, m, nominal), where: -1, at: i }));
  triggers.forEach((t, ti) => t.do.forEach((m, i) => parts.push({ mod: m, price: priceOf(c, m, nominal, rateOf(t)), where: ti, at: i })));
  const good = parts.reduce((p, q) => p + (q.price > 0 ? q.price : 0), 0);
  const bad = parts.reduce((p, q) => p + (q.price < 0 ? q.price : 0), 0);
  let cost = good + bad;
  if (cost > lim.budget && good > 0) {
    const k = Math.max(0, (lim.budget - bad) / good);
    notes.push(`over budget (${tidy(cost)} of ${lim.budget}): its good parts pulled back to ${Math.round(k * 100)}%`);
    for (const p of parts) if (p.price > 0) {
      const m = p.mod;
      const scaled: Mod = { ...m, value: scaleToward(m.value, neutralOf(c, m), k) };
      if (p.where < 0) (mods as Mod[])[p.at] = scaled;
      else { const t = triggers[p.where]!; triggers[p.where] = { ...t, do: t.do.map((x, i) => (i === p.at ? scaled : x)) }; }
    }
    cost = lim.budget;
  }
  // (Whole stats: 0.83 of a pierce is none -- round the plain ones, then round down whatever breaks the budget.)
  const wholes = parts.filter((q) => c.stats[q.mod.stat]?.whole);
  if (wholes.length) {
    const at = (q: (typeof parts)[number]): Mod => (q.where < 0 ? mods[q.at]! : triggers[q.where]!.do[q.at]!);
    const put = (q: (typeof parts)[number], m: Mod): void => { if (q.where < 0) (mods as Mod[])[q.at] = m; else { const t = triggers[q.where]!; triggers[q.where] = { ...t, do: t.do.map((x, i) => (i === q.at ? m : x)) }; } };
    const total = (): number => parts.reduce((sum, q) => { const m = at(q); const tr = q.where >= 0 ? triggers[q.where]! : null; return sum + priceOf(c, m, nominal, tr ? rateOf(tr) : 0); }, 0);
    for (const q of wholes) { const m = at(q); if (typeof m.value === "number") put(q, { ...m, value: Math.round(m.value) }); }
    if (total() > lim.budget + 1e-9) for (const q of wholes) { const m = at(q); if (typeof m.value === "number") put(q, { ...m, value: m.value < 0 ? Math.ceil(m.value) : Math.floor(m.value) }); }
    for (const q of wholes) { const m = at(q); if (typeof m.value === "number" && q.price > 0 && total() > lim.budget + 1e-9) put(q, { ...m, value: neutralOf(c, m) }); }
    cost = Math.min(total(), Math.max(cost, total()));
  }
  const name = String(r["name"] ?? "").replace(/[^\p{L}\p{N} '\-]/gu, "").trim().slice(0, 40) || "Nameless";
  const text = String(r["text"] ?? "").replace(/[<>]/g, "").trim().slice(0, 200);
  void exprVars;
  return { program: { name, text, mods, triggers, look }, cost: tidy(cost), budget: lim.budget, notes };
}

/** A program's identity: the hash of its canonical JSON (with the contract it was read through). */
export function programHash(c: Contract, p: Program): string {
  return toHex(sha256(new TextEncoder().encode(canonicalJson({ contract: `${c.id}@${c.version}`, program: p as never }))));
}
