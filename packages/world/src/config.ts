// Layered settings with locks -- ported from the proof of concept's
// src/scene/config.js (the one piece of it the world runtime stands on).
//
// Settings resolve through an ordered list of LAYERS, least specific first.
// Each layer is a flat map of dotted keys ("render.palette",
// "system.physics.gravity"). A value is plain JSON, or an ENTRY
// { value, lock?, note? }. Resolution of a key:
//
//   1. walk the layers from least to most specific;
//   2. the first layer that LOCKS the key wins, and nothing below it counts;
//   3. otherwise the most specific layer that sets the key wins.
//
// A lock is a promise to everything more specific: lower layers cannot
// override it (their values are kept but shadowed; `set` on them is refused)
// and neither can generators. Everything is plain data.

/** A setting's value: plain JSON. */
export type SettingValue = null | boolean | number | string | readonly SettingValue[] | { readonly [key: string]: SettingValue };
/** A value with a lock and a note. */
export interface Entry {
  readonly value: SettingValue;
  readonly lock?: boolean;
  readonly note?: string;
}
/** What a layer holds per key: a plain value or an entry. */
export type Raw = SettingValue | Entry;
/** A layer's values: { key: raw }. */
export type LayerValues = Record<string, Raw>;
export interface Layer {
  readonly name: string;
  values: LayerValues;
}

/** One scope that sets a key, as explain() lists it. */
export interface ChainLink {
  readonly layer: string;
  readonly value: SettingValue;
  readonly locked: boolean;
  readonly note?: string;
  /** A lock above it overrides it. */
  readonly shadowed: boolean;
}
/** Why a key resolves as it does. */
export interface Explanation {
  readonly key: string;
  readonly value: SettingValue | undefined;
  /** The layer that set the winning value (null: nothing sets it). */
  readonly layer: string | null;
  readonly locked: boolean;
  readonly lockedAt: string | null;
  readonly chain: ChainLink[];
}

/** A write a lock refused. */
export interface Refusal {
  readonly ok: false;
  readonly key: string;
  readonly layer: string;
  readonly lockedAt: string;
  readonly value: SettingValue | undefined;
  readonly lockedValue: SettingValue;
}
export interface Accepted {
  readonly ok: true;
  readonly key: string;
  readonly layer: string;
  readonly changed?: boolean;
}
export type WriteResult = Accepted | Refusal;

export interface SetOptions {
  /** Lock the key at this layer too. */
  readonly lock?: boolean | undefined;
  readonly note?: string | undefined;
  /** The lock is at THIS layer: its owner may replace the value. */
  readonly force?: boolean | undefined;
}

export interface Config {
  readonly names: string[];
  readonly refusals: Refusal[];
  get(key: string, fallback?: SettingValue): SettingValue | undefined;
  has(key: string): boolean;
  locked(key: string): boolean;
  explain(key: string): Explanation;
  set(layer: string, key: string, value: SettingValue, opts?: SetOptions): WriteResult;
  lock(layer: string, key: string, value?: SettingValue, opts?: SetOptions): WriteResult;
  unlock(layer: string, key: string): WriteResult;
  unset(layer: string, key: string, opts?: SetOptions): WriteResult;
  keys(): string[];
  resolved(): Record<string, SettingValue | undefined>;
  section(prefix: string): Record<string, SettingValue | undefined>;
  toJSON(): { layers: { name: string; values: LayerValues }[] };
}

const ENTRY_KEYS = new Set(["value", "lock", "note"]);
const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Is `v` an entry ({ value, lock?, note? }) rather than a plain value? */
export function isEntry(v: unknown): v is Entry {
  return isPlain(v) && Object.hasOwn(v, "value") && Object.keys(v).every((k) => ENTRY_KEYS.has(k));
}

interface Resolved { value: SettingValue; lock: boolean; note: string | undefined }
const entryOf = (raw: Raw): Resolved => (isEntry(raw) ? { value: raw.value, lock: Boolean(raw.lock), note: raw.note } : { value: raw, lock: false, note: undefined });

function checkJson(key: string, value: unknown): void {
  const bad = (v: unknown): boolean => v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint" || (typeof v === "number" && !Number.isFinite(v));
  const walk = (v: unknown): void => {
    if (bad(v)) throw new TypeError(`Config ${key}: values must be JSON (got ${typeof v}).`);
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
}

function normaliseLayers(list: readonly Layer[]): Layer[] {
  const out = list.map((l) => {
    if (!isPlain(l.values)) throw new TypeError(`Layer ${l.name}: values must be a plain object.`);
    for (const [k, v] of Object.entries(l.values)) checkJson(k, isEntry(v) ? v.value : v);
    return { name: l.name, values: { ...l.values } };
  });
  const seen = new Set<string>();
  for (const l of out) {
    if (seen.has(l.name)) throw new Error(`Two layers are named ${l.name}.`);
    seen.add(l.name);
  }
  return out;
}

/** layers([{ name, values }, ...]) -> config, least specific first. (The layers' values are copied.) */
export function layers(list: readonly Layer[] = []): Config {
  return makeConfig(normaliseLayers(list), []);
}

function makeConfig(list: Layer[], refusals: Refusal[]): Config {
  const indexOf = (name: string): number => {
    const i = list.findIndex((l) => l.name === name);
    if (i < 0) throw new RangeError(`No layer named ${name}.`);
    return i;
  };
  const rawAt = (i: number, key: string): Raw | undefined => list[i]!.values[key];

  // Where `key` is locked at or above layer index `upto` (least specific first), or -1.
  const lockAbove = (key: string, upto: number): number => {
    for (let i = 0; i <= upto && i < list.length; i += 1) {
      const raw = rawAt(i, key);
      if (raw !== undefined && entryOf(raw).lock) return i;
    }
    return -1;
  };

  function resolve(key: string): { at: number; locked: boolean } {
    let winner = -1;
    for (let i = 0; i < list.length; i += 1) {
      const raw = rawAt(i, key);
      if (raw === undefined) continue;
      winner = i;
      if (entryOf(raw).lock) return { at: i, locked: true };
    }
    return { at: winner, locked: false };
  }
  const valueAt = (i: number, key: string): SettingValue => entryOf(rawAt(i, key)!).value;

  const refuse = (key: string, layer: string, lockAt: number, value: SettingValue | undefined): Refusal => {
    const refusal: Refusal = { ok: false, key, layer, lockedAt: list[lockAt]!.name, value, lockedValue: valueAt(lockAt, key) };
    refusals.push(refusal);
    return refusal;
  };

  const cfg: Config = {
    get names() { return list.map((l) => l.name); },
    get refusals() { return refusals.slice(); },
    get(key, fallback) {
      const r = resolve(key);
      return r.at < 0 ? fallback : valueAt(r.at, key);
    },
    has: (key) => resolve(key).at >= 0,
    locked: (key) => resolve(key).locked,
    explain(key) {
      const r = resolve(key);
      const chain: ChainLink[] = [];
      list.forEach((l, i) => {
        const raw = l.values[key];
        if (raw === undefined) return;
        const e = entryOf(raw);
        chain.push({ layer: l.name, value: e.value, locked: e.lock, ...(e.note ? { note: e.note } : {}), shadowed: r.locked && i > r.at });
      });
      return {
        key,
        value: r.at < 0 ? undefined : valueAt(r.at, key),
        layer: r.at < 0 ? null : list[r.at]!.name,
        locked: r.locked,
        lockedAt: r.locked ? list[r.at]!.name : null,
        chain,
      };
    },
    set(layerName, key, value, opts = {}) {
      checkJson(key, value);
      const at = indexOf(layerName);
      const lockAt = lockAbove(key, at);
      if (lockAt >= 0 && !(lockAt === at && opts.force)) return refuse(key, layerName, lockAt, value);
      const keepLock = lockAt === at; // (forced by its owner: stays locked)
      const lock = Boolean(opts.lock) || keepLock;
      list[at]!.values[key] = lock || opts.note ? { value, ...(lock ? { lock: true } : {}), ...(opts.note ? { note: opts.note } : {}) } : value;
      return { ok: true, key, layer: layerName };
    },
    lock(layerName, key, value, opts = {}) {
      const at = indexOf(layerName);
      let v = value;
      if (v === undefined) {
        v = makeConfig(list.slice(0, at + 1), []).get(key);
        if (v === undefined) throw new RangeError(`Nothing to lock: ${key} is unset at ${layerName}.`);
      }
      const lockAt = lockAbove(key, at - 1);
      if (lockAt >= 0) return cfg.set(layerName, key, v, { ...opts, lock: true });
      return cfg.set(layerName, key, v, { ...opts, lock: true, force: true });
    },
    unlock(layerName, key) {
      const l = list[indexOf(layerName)]!;
      const raw = l.values[key];
      if (raw === undefined || !entryOf(raw).lock) return { ok: true, key, layer: layerName, changed: false };
      const e = entryOf(raw);
      l.values[key] = e.note ? { value: e.value, note: e.note } : e.value;
      return { ok: true, key, layer: layerName, changed: true };
    },
    unset(layerName, key, opts = {}) {
      const at = indexOf(layerName);
      const lockAt = lockAbove(key, at);
      if (lockAt >= 0 && !(lockAt === at && opts.force)) return refuse(key, layerName, lockAt, undefined);
      delete list[at]!.values[key];
      return { ok: true, key, layer: layerName };
    },
    keys() {
      const all = new Set<string>();
      for (const l of list) for (const k of Object.keys(l.values)) all.add(k);
      return [...all].sort();
    },
    resolved() {
      const out: Record<string, SettingValue | undefined> = {};
      for (const k of cfg.keys()) out[k] = cfg.get(k);
      return out;
    },
    section(prefix) {
      const out: Record<string, SettingValue | undefined> = {};
      const p = `${prefix}.`;
      for (const k of cfg.keys()) if (k.startsWith(p)) out[k.slice(p.length)] = cfg.get(k);
      return out;
    },
    toJSON() {
      return { layers: list.map((l) => ({ name: l.name, values: Object.fromEntries(Object.keys(l.values).sort().map((k) => [k, l.values[k]!])) })) };
    },
  };
  return cfg;
}
