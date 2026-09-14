// A world's settings: config layers (./config.ts) laid out as SCOPES so
// anything can be set -- or LOCKED -- for the whole engine, a project, a
// scene, the things with a tag, one thing by id, or at runtime. Ported from
// the proof of concept's src/world/settings.js.
//
//   global key:     engine -> project -> scene -> seed -> runtime
//   a thing's key:  engine -> project -> scene -> seed -> seed:<id> -> tag:<t>... -> id:<id> -> runtime
//
// Resolution is config's: walk least specific first; the first scope that
// LOCKS a key wins and everything after it is shadowed; otherwise the most
// specific scope that sets it wins. So a lock at the project beats a scene, a
// tag, an id and the runtime; a lock on "tag:bench" beats one bench's own
// setting and the runtime, for benches only.
//
// The two SEED scopes are where generation writes what the seed chose ("seed"
// for world-wide choices, "seed:<id>" for one thing's). They sit under every
// scope that names things, so a tag's or an id's setting beats a roll -- and a
// lock anywhere beats it too: the generator is handed the locked value
// (propose), and still draws its roll, so nothing after it moves.

import { layers } from "./config.ts";
import type { Config, Explanation, LayerValues, Refusal, SetOptions, SettingValue, WriteResult } from "./config.ts";

export const GLOBAL_SCOPES = ["engine", "project", "scene", "seed", "runtime"] as const;
export type GlobalScope = (typeof GLOBAL_SCOPES)[number];
/** A scope: a global one, or "tag:<tag>", "id:<id>", "seed:<id>". */
export type Scope = GlobalScope | `tag:${string}` | `id:${string}` | `seed:${string}`;
const THING_SCOPE = /^(tag|id|seed):(.+)$/;
const isGlobal = (name: string): name is GlobalScope => (GLOBAL_SCOPES as readonly string[]).includes(name);

/** Is `name` a scope a value can live in? */
export function isScope(name: string): name is Scope {
  return isGlobal(name) || THING_SCOPE.test(name);
}

/** A thing settings are resolved for: its id, or { id, tags }. */
export type Thing = string | { readonly id: string; readonly tags?: readonly string[] | undefined };

// (A thing is an id, or anything with { id, tags }.)
const idOf = (thing: Thing | null | undefined): string | null => (thing == null ? null : typeof thing === "string" ? thing : thing.id ?? null);

/** Settings as plain data: { scopes: { name: { key: raw } } }. */
export interface SettingsJSON {
  readonly scopes: Readonly<Record<string, LayerValues>>;
}

export interface SettingsOptions {
  readonly engine?: LayerValues;
  readonly project?: LayerValues;
  readonly scene?: LayerValues;
  readonly runtime?: LayerValues;
  /** Thing scopes to start with: { "tag:bench": {...}, "id:bench-1": {...} }. */
  readonly scopes?: Readonly<Record<string, LayerValues>>;
  /** How to find a thing's tags when only its id is given. */
  readonly tagsOf?: (id: string) => readonly string[] | undefined;
}

export interface Settings {
  /** Goes up by one on every change (systems cache on it). */
  readonly version: number;
  /** Every write a lock refused. */
  readonly refusals: Refusal[];
  /** The scopes that hold anything. */
  scopes(): string[];
  /** Swap how ids are looked up for their tags (the world does this). */
  useTags(fn: (id: string) => readonly string[] | undefined): void;
  /** The resolved value of `key` (for a thing: through its tags and id), or `fallback`. */
  get(key: string, thing?: Thing | null, fallback?: SettingValue): SettingValue | undefined;
  has(key: string, thing?: Thing | null): boolean;
  locked(key: string, thing?: Thing | null): boolean;
  /** Every key under `prefix.` resolved for a thing, prefix stripped. */
  section(prefix: string, thing?: Thing | null): Record<string, SettingValue | undefined>;
  resolved(thing?: Thing | null): Record<string, SettingValue | undefined>;
  /** Who set `key` and who locked it, and what the lock shadows. */
  explain(key: string, thing?: Thing | null): Explanation;
  /** Write a value into a scope (refused under a lock at or above it). `thing` tells an id scope its tags. */
  set(scope: string, key: string, value: SettingValue, opts?: SetOptions, thing?: Thing | null): WriteResult;
  /** Lock `key` at a scope (with `value`, or the value it resolves to there). */
  lock(scope: string, key: string, value?: SettingValue, opts?: SetOptions, thing?: Thing | null): WriteResult;
  /** Remove a scope's own lock (its value stays). */
  unlock(scope: string, key: string): WriteResult;
  /** Remove a key from a scope (refused under a higher lock; the scope's own lock needs force). */
  unset(scope: string, key: string, opts?: SetOptions): WriteResult;
  /**
   * What a generator gets to use: its `rolled` value is recorded in the seed
   * scope ("seed" or "seed:<id>") unless a lock shadows it, and the value the
   * key then RESOLVES to comes back.
   */
  propose(key: string, rolled: SettingValue, thing?: Thing | null): SettingValue | undefined;
  /** Forget everything the seed chose (before generating again). */
  clearSeed(): void;
  toJSON(): SettingsJSON;
  /** Replace everything with toJSON() output. */
  load(json: SettingsJSON | string): Settings;
  /** The raw values one scope holds (a copy). */
  scope(name: string): LayerValues;
}

export function createSettings({ engine = {}, project = {}, scene = {}, runtime = {}, scopes = {}, tagsOf = () => [] }: SettingsOptions = {}): Settings {
  const store = new Map<string, LayerValues>(); // scope name -> { key: raw }
  for (const [name, values] of [["engine", engine], ["project", project], ["scene", scene], ["runtime", runtime]] as const) store.set(name, { ...values });
  store.set("seed", {});
  for (const [name, values] of Object.entries(scopes)) {
    if (!THING_SCOPE.test(name)) throw new RangeError(`"${name}" is not a thing scope (tag:<tag>, id:<id>).`);
    store.set(name, { ...values });
  }
  const refusals: Refusal[] = [];
  let version = 0;
  let lookupTags = tagsOf;
  const cache = new Map<string, Config>(); // chain signature -> config

  const tagsFor = (thing: Thing | null | undefined): string[] => {
    if (thing == null) return [];
    if (typeof thing === "object" && Array.isArray(thing.tags)) return [...new Set(thing.tags)].sort();
    return [...new Set(lookupTags(idOf(thing)!) ?? [])].sort();
  };

  // The scope names a key is resolved through, least specific first.
  function chainOf(thing: Thing | null | undefined): readonly string[] {
    const id = idOf(thing);
    if (id === null) return GLOBAL_SCOPES;
    return ["engine", "project", "scene", "seed", `seed:${id}`, ...tagsFor(thing).map((t) => `tag:${t}`), `id:${id}`, "runtime"];
  }
  // The chain a WRITE into `scope` is checked against: every scope up to it (and itself).
  function chainUpTo(scope: string, thing: Thing | null | undefined): readonly string[] {
    if (isGlobal(scope)) return GLOBAL_SCOPES.slice(0, GLOBAL_SCOPES.indexOf(scope) + 1);
    const [, kind, rest] = scope.match(THING_SCOPE)!;
    if (kind === "tag") return ["engine", "project", "scene", "seed", scope];
    const full = chainOf(thing ?? rest!);
    return full.slice(0, full.indexOf(scope) + 1);
  }

  const build = (chain: readonly string[]): Config => layers(chain.map((name) => ({ name, values: store.get(name) ?? {} })));
  function configOf(chain: readonly string[]): Config {
    const sig = chain.join("\u0001");
    let cfg = cache.get(sig);
    if (!cfg) {
      cfg = build(chain);
      cache.set(sig, cfg);
    }
    return cfg;
  }
  const touched = (): void => { version += 1; cache.clear(); };

  function write(scope: string, key: string, fn: (cfg: Config) => WriteResult, thing?: Thing | null): WriteResult {
    if (!isScope(scope)) throw new RangeError(`No scope "${scope}" (scopes: ${GLOBAL_SCOPES.join(", ")}, tag:<tag>, id:<id>, seed:<id>).`);
    const cfg = build(chainUpTo(scope, thing));
    const r = fn(cfg);
    if (!r.ok) { refusals.push(r); return r; }
    const values = cfg.toJSON().layers.find((l) => l.name === scope)!.values;
    if (Object.keys(values).length) store.set(scope, values);
    else if (!isGlobal(scope)) store.delete(scope);
    else store.set(scope, {});
    touched();
    return r;
  }

  const s: Settings = {
    get version() { return version; },
    get refusals() { return refusals.slice(); },
    scopes: () => [...store.keys()],
    useTags(fn) { lookupTags = fn; cache.clear(); },
    get: (key, thing = null, fallback) => configOf(chainOf(thing)).get(key, fallback),
    has: (key, thing = null) => configOf(chainOf(thing)).has(key),
    locked: (key, thing = null) => configOf(chainOf(thing)).locked(key),
    section: (prefix, thing = null) => configOf(chainOf(thing)).section(prefix),
    resolved: (thing = null) => configOf(chainOf(thing)).resolved(),
    explain: (key, thing = null) => configOf(chainOf(thing)).explain(key),
    set: (scope, key, value, opts = {}, thing = null) => write(scope, key, (cfg) => cfg.set(scope, key, value, opts), thing),
    lock: (scope, key, value, opts = {}, thing = null) => write(scope, key, (cfg) => cfg.lock(scope, key, value, opts), thing),
    unlock: (scope, key) => write(scope, key, (cfg) => cfg.unlock(scope, key)),
    unset: (scope, key, opts = {}) => write(scope, key, (cfg) => cfg.unset(scope, key, opts)),
    propose(key, rolled, thing = null) {
      const id = idOf(thing);
      const scope = id === null ? "seed" : `seed:${id}`;
      const chain = chainOf(thing);
      const ex = configOf(chain).explain(key);
      // (Locked above the seed scope: the roll isn't written, so explain still names the lock.)
      const seedAt = chain.indexOf(scope);
      const lockAt = ex.locked ? chain.indexOf(ex.lockedAt!) : -1;
      if (!(ex.locked && lockAt <= seedAt)) {
        store.set(scope, { ...(store.get(scope) ?? {}), [key]: rolled });
        touched();
      }
      return s.get(key, thing);
    },
    clearSeed() {
      for (const name of [...store.keys()]) if (name === "seed" || name.startsWith("seed:")) store.delete(name);
      store.set("seed", {});
      touched();
    },
    toJSON() {
      const out: Record<string, LayerValues> = {};
      for (const name of [...store.keys()].sort()) {
        const v = store.get(name)!;
        out[name] = Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]!]));
      }
      return { scopes: out };
    },
    load(json) {
      const data = (typeof json === "string" ? JSON.parse(json) : json) as SettingsJSON;
      store.clear();
      for (const name of GLOBAL_SCOPES) store.set(name, {});
      for (const [name, values] of Object.entries(data.scopes ?? {})) {
        if (!isScope(name)) throw new RangeError(`No scope "${name}".`);
        store.set(name, { ...values });
      }
      touched();
      return s;
    },
    scope: (name) => ({ ...(store.get(name) ?? {}) }),
  };
  return s;
}

/** A lock (or a plain setting) written as text: "scope/key=value". */
export interface LockText {
  readonly scope: string;
  readonly key: string;
  readonly value: SettingValue;
  /** false: set without locking ("~" before the value). */
  readonly lock?: boolean;
}

/**
 * Parse locks written for a URL or a panel: "scope/key=value;scope/key=value".
 *   "scene/render.palette=dusk;tag:animal/species=cat;id:bench-1/material=oak"
 * Values are JSON when they parse ("4", "true", "[\"fog\"]"), else strings.
 * A "~" before the value sets without locking ("scene/render.palette=~dusk").
 */
export function parseLocks(text: string | null | undefined): Required<LockText>[] {
  const out: Required<LockText>[] = [];
  for (const item of String(text ?? "").split(";").map((x) => x.trim()).filter(Boolean)) {
    const m = item.match(/^([^/]+)\/([^=]+)=(.*)$/);
    if (!m) throw new SyntaxError(`A lock is scope/key=value (got "${item}").`);
    let raw = m[3]!;
    const lock = !raw.startsWith("~");
    if (!lock) raw = raw.slice(1);
    let value: SettingValue;
    try { value = JSON.parse(raw) as SettingValue; } catch { value = raw; }
    out.push({ scope: m[1]!, key: m[2]!, value, lock });
  }
  return out;
}

/** The inverse of parseLocks. */
export function formatLocks(list: readonly LockText[]): string {
  return list.map(({ scope, key, value, lock = true }) => `${scope}/${key}=${lock ? "" : "~"}${typeof value === "string" ? value : JSON.stringify(value)}`).join(";");
}
