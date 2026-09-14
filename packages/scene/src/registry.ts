// Asset catalogues: realms of seeded builders, the NOCTURNES way -- ported
// from the proof of concept's src/scene/registry.js.
//
// A REALM is a weighted list of builders ({ key, weight, role, build }).
// `realm.pick(S, role)` draws one from the stream S -- exactly the shape of
// NOCTURNES' kit.js pickBuilder: the weighted draw ALWAYS happens (so a
// builder chosen by key leaves every later roll where it would be), roles
// filter the pool, and whatever the builder makes is stamped with its key.
// `makeAsset(seed, { realm, key })` mirrors NOCTURNES' makeObject: fixed seed
// slots for the realm draw and the build stream, so adding a realm or a
// builder never reshuffles the draws an existing seed already makes.

import { createRoll, stream } from "@keel-engine/core";
import type { Roll, Seed, Stream } from "@keel-engine/core";

/** Seed slots makeAsset reads (NOCTURNES' OSLOT.REALM and OSLOT.BUILD). */
export const ASSET_SLOTS = { REALM: 0, BUILD: 1 } as const;

/** The roles a builder serves: one ("hero", "small", "both", "any", your own) or a list. */
export type Role = string | readonly string[];

/** What a builder is told besides its stream. */
export interface BuildInfo {
  readonly seed: Seed;
  readonly role: string;
  /** The state it is built in (a turned cube, an open lid). */
  readonly state: unknown;
  readonly realm: string;
  readonly roll: Roll;
}

/** Whatever the caller hands builders (makeAsset's `ctx`). */
export type BuildContext = Readonly<Record<string, unknown>>;

/** A builder: draws from S and makes an asset (an object, which gets stamped with its key). */
export type Builder = (S: Stream, ctx: BuildContext, info: BuildInfo) => unknown;

export interface BuilderSpec {
  readonly key: string;
  readonly weight?: number;
  readonly role?: Role;
  readonly build: Builder;
  /** Never drawn at random, only asked for by key (NOCTURNES' peripherals: a keyboard is plugged into something). */
  readonly keyOnly?: boolean;
  /** Anything else is kept as the entry's meta. */
  readonly [meta: string]: unknown;
}

export interface BuilderEntry {
  readonly key: string;
  readonly weight: number;
  readonly role: Role;
  readonly build: Builder;
  readonly keyOnly: boolean;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** A drawn builder: call it as the builder would be called; it stamps `key` on what it makes. */
export interface PickedBuilder {
  (S: Stream, ctx?: BuildContext, info?: BuildInfo): unknown;
  key: string;
}

export interface Realm {
  readonly name: string;
  readonly weight: number;
  /** Add a builder (chainable). */
  add(spec: BuilderSpec): Realm;
  /** The builders, in the order added. */
  entries(): BuilderEntry[];
  keys(): string[];
  get(key: string): BuilderEntry | null;
  /** The pool a role draws from (in order added). */
  pool(role?: string | null): BuilderEntry[];
  /**
   * Draw a builder from stream S for `role`. `opts.key` forces a builder by
   * key -- the draw still happens first, so the stream advances the same either way.
   */
  pick(S: Stream, role?: string | null, opts?: { readonly key?: string | null }): PickedBuilder;
}

/** What makeAsset makes: the builder's object, stamped with its key, realm and seed. */
export interface Asset {
  key?: unknown;
  realm: string;
  seed: unknown;
  [field: string]: unknown;
}

export interface MakeAssetOptions {
  /** Realm name (drawn from the seed's REALM slot when absent; the draw happens either way, as in NOCTURNES). */
  readonly realm?: string | null;
  /** Builder key (forced; the builder draw still happens). */
  readonly key?: string | null;
  /** "any" | "hero" | "small" | your own. */
  readonly role?: string;
  readonly ctx?: BuildContext;
  readonly state?: unknown;
}

export interface Registry {
  /** Define (or fetch, when it exists) a realm. `weight` is its share when makeAsset draws a realm. */
  defineRealm(name: string, opts?: { readonly weight?: number }): Realm;
  realm(name: string): Realm | null;
  realms(): Realm[];
  /** Draw a realm from stream S by weight (in the order defined). */
  pickRealm(S: Stream): Realm;
  /**
   * The built asset, stamped with key, realm and seed -- or null if its
   * builder made none. (A builder that returns a primitive gets it back as it
   * is, unstamped: builders make objects.)
   */
  makeAsset(seed: unknown, opts?: MakeAssetOptions): Asset | null;
}

/**
 * Does an entry's role serve the role asked for? "any" (or null) asks for
 * everything; an entry with role "both" or "any" serves every ask; an array
 * serves each role it lists. (NOCTURNES: "hero" takes hero|both, "small"
 * takes small|both.)
 */
export function roleMatches(entryRole: Role | undefined, wanted: string | null | undefined): boolean {
  if (wanted === null || wanted === undefined || wanted === "any") return true;
  if (entryRole === "both" || entryRole === "any" || entryRole === undefined) return true;
  return Array.isArray(entryRole) ? (entryRole as readonly string[]).includes(wanted) : entryRole === wanted;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function makeRealm(name: string, weight: number): Realm {
  const entries: BuilderEntry[] = [];
  const realm: Realm = {
    name,
    weight,
    add({ key, weight: w = 1, role = "both", build, keyOnly = false, ...meta }) {
      if (typeof key !== "string" || !key) throw new TypeError("A builder needs a string key.");
      if (typeof build !== "function") throw new TypeError(`Builder ${key} needs build(S, ctx).`);
      if (!(w > 0)) throw new RangeError(`Builder ${key} needs a positive weight.`);
      if (entries.some((e) => e.key === key)) throw new Error(`${name} already has ${key}.`);
      entries.push({ key, weight: w, role, build, keyOnly, meta });
      return realm;
    },
    entries: () => entries.slice(),
    keys: () => entries.map((e) => e.key),
    get: (key) => entries.find((e) => e.key === key) ?? null,
    pool: (role = "any") => entries.filter((e) => !e.keyOnly && roleMatches(e.role, role)),
    pick(S, role = "any", opts = {}) {
      const pool = realm.pool(role);
      let chosen: BuilderEntry | null = null;
      if (pool.length) chosen = S.weighted(pool.map((e) => [e, e.weight] as const));
      if (opts.key) chosen = realm.get(opts.key) ?? chosen;
      if (!chosen) throw new RangeError(`${name} has nothing for role ${role}.`);
      const { key, build } = chosen;
      const fn = ((...a: [Stream, BuildContext?, BuildInfo?]) => {
        const obj = (build as (...args: unknown[]) => unknown)(...a);
        if (isObject(obj) && obj["key"] === undefined) obj["key"] = key;
        return obj;
      }) as PickedBuilder;
      fn.key = key;
      return fn;
    },
  };
  return realm;
}

/** A registry: a set of realms (catalogues). Independent registries never share state. */
export function createRegistry(): Registry {
  const realms: Realm[] = [];
  const registry: Registry = {
    defineRealm(name, { weight = 1 } = {}) {
      const have = realms.find((r) => r.name === name);
      if (have) return have;
      if (!(weight > 0)) throw new RangeError(`Realm ${name} needs a positive weight.`);
      const r = makeRealm(name, weight);
      realms.push(r);
      return r;
    },
    realm: (name) => realms.find((r) => r.name === name) ?? null,
    realms: () => realms.slice(),
    pickRealm(S) {
      if (!realms.length) throw new RangeError("The registry has no realms.");
      return S.weighted(realms.map((r) => [r, r.weight] as const));
    },
    makeAsset(seed, { realm: realmName = null, key = null, role = "any", ctx = {}, state = null } = {}) {
      const roll = createRoll(seed);
      const rr = stream(roll, ASSET_SLOTS.REALM);
      let realm = registry.pickRealm(rr);
      if (realmName) {
        const named = registry.realm(realmName);
        if (!named) throw new RangeError(`No realm named ${realmName}.`);
        realm = named;
      }
      const S = stream(roll, ASSET_SLOTS.BUILD);
      const build = realm.pick(S, role, { key });
      const obj = build(S, ctx, { seed: roll.seed, role, state, realm: realm.name, roll });
      if (!isObject(obj)) return (obj ?? null) as Asset | null;
      obj["realm"] = realm.name;
      if (obj["seed"] === undefined) obj["seed"] = roll.seed;
      return obj as Asset;
    },
  };
  return registry;
}

// A default registry for projects that want one global catalogue.
const DEFAULT = createRegistry();
export const defineRealm = (name: string, opts?: { readonly weight?: number }): Realm => DEFAULT.defineRealm(name, opts);
export const makeAsset = (seed: unknown, opts?: MakeAssetOptions): Asset | null => DEFAULT.makeAsset(seed, opts);
export const defaultRegistry: Registry = DEFAULT;
