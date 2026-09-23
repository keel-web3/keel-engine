// Stores that outlive a session: the player's settings, their save (a
// profile: cash, progress, the cars they own). One shape for both -- defaults,
// a sanitiser that repairs whatever comes back from storage, a version, and a
// storage the game hands in (the browser's localStorage, a memory one for
// tests, a platform's cloud save). Every storage call is guarded: a private
// window, a full quota or a blocked cookie leaves the game running on its
// defaults, never throwing.
//
// A settings SCHEMA describes each setting once -- its tab, its label, what it
// is (a toggle, a choice, a range) -- and gives the defaults, the sanitiser
// and the menu entries (menu.ts) for a tab from that one description.

import type { MenuEntry } from "./menu.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** A storage in memory (tests; a fallback). */
export function memoryStorage(): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

/** The browser's localStorage when it can be used, else null. */
export function browserStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!s) return null;
    const probe = "__keel_probe__";
    s.setItem(probe, "1");
    s.removeItem?.(probe);
    return s;
  } catch { return null; }
}

export interface Store<T extends object> {
  get(): T;
  /** Change some fields (sanitised, saved, listeners told). */
  set(patch: Partial<T>): T;
  /** Change it by a function of what it is. */
  update(fn: (t: T) => T): T;
  /** Back to the defaults (saved). */
  reset(): T;
  subscribe(fn: (t: T) => void): () => void;
  /** Write it out now; false when the storage refused. */
  save(): boolean;
  /** Whether what's there came from storage (false: defaults, first run or unreadable). */
  readonly loaded: boolean;
}

export interface StoreOptions<T extends object> {
  readonly key: string;
  readonly storage?: StorageLike | null;
  /** Stored alongside; a stored version that differs goes through migrate (or is dropped for the defaults). */
  readonly version?: number;
  readonly migrate?: (old: unknown, version: number) => Partial<T> | null;
  /** Repair a value (clamp numbers, drop unknown choices); defaults fill what's missing. */
  readonly sanitize?: (t: T) => T;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Stored fields over the defaults, key by key, one level deep for nested objects; a field of the wrong type is dropped. */
export function mergeDefaults<T extends object>(defaults: T, stored: unknown): T {
  if (!isObject(stored)) return structuredCloneSafe(defaults);
  const out = structuredCloneSafe(defaults) as Record<string, unknown>;
  for (const [k, d] of Object.entries(defaults)) {
    const v = stored[k];
    if (v === undefined) continue;
    if (isObject(d) && isObject(v)) out[k] = { ...d, ...Object.fromEntries(Object.entries(v).filter(([kk, vv]) => !(kk in d) || typeof vv === typeof (d as Record<string, unknown>)[kk])) };
    else if (Array.isArray(d) ? Array.isArray(v) : typeof v === typeof d) out[k] = v;
  }
  return out as T;
}

const structuredCloneSafe = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createStore<T extends object>(defaults: T, o: StoreOptions<T>): Store<T> {
  const storage = o.storage === undefined ? browserStorage() : o.storage;
  const version = o.version ?? 1;
  const clean = (t: T): T => (o.sanitize ? o.sanitize(t) : t);
  let loaded = false;
  const read = (): T => {
    try {
      const raw = storage?.getItem(o.key);
      if (!raw) return clean(structuredCloneSafe(defaults));
      const doc = JSON.parse(raw) as { v?: number; data?: unknown };
      let data = doc.data;
      if (doc.v !== version) data = o.migrate ? o.migrate(doc.data, doc.v ?? 0) : null;
      if (!data) return clean(structuredCloneSafe(defaults));
      loaded = true;
      return clean(mergeDefaults(defaults, data));
    } catch { return clean(structuredCloneSafe(defaults)); }
  };
  let value = read();
  const listeners = new Set<(t: T) => void>();
  const store: Store<T> = {
    get: () => value,
    set(patch) { value = clean({ ...value, ...patch }); store.save(); for (const l of listeners) l(value); return value; },
    update(fn) { return store.set(fn(value)); },
    reset() { value = clean(structuredCloneSafe(defaults)); store.save(); for (const l of listeners) l(value); return value; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    save() {
      if (!storage) return false;
      try { storage.setItem(o.key, JSON.stringify({ v: version, data: value })); return true; } catch { return false; }
    },
    get loaded() { return loaded; },
  };
  return store;
}

// ------------------------------------------------------------------ settings schemas

export interface SettingSpec {
  readonly id: string;
  readonly tab: string;
  readonly label: string;
  readonly kind: "toggle" | "choice" | "range";
  /** A choice's options (stored as the option string). */
  readonly choices?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** The default: a boolean, one of the choices, or a number. */
  readonly initial: boolean | string | number;
  readonly hint?: string;
  /** How a range's number reads ("80%"). */
  readonly format?: (v: number) => string;
}

export type SettingValues = Record<string, boolean | string | number>;

export interface SettingsSchema {
  readonly specs: readonly SettingSpec[];
  readonly tabs: readonly string[];
  readonly defaults: SettingValues;
  /** Each value kept in bounds and to its kind (a stale choice falls back to its default). */
  sanitize(v: SettingValues): SettingValues;
  /** A tab's menu entries, reading the values. */
  items(tab: string, v: SettingValues): MenuEntry[];
  /** A menu entry's value back into a setting's (the index of a choice into its option, 0/1 into a boolean). */
  fromMenu(id: string, value: number): boolean | string | number;
  /** How a value reads on screen. */
  display(id: string, v: SettingValues): string;
}

export function settingsSchema(specs: readonly SettingSpec[]): SettingsSchema {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const tabs = [...new Set(specs.map((s) => s.tab))];
  const defaults: SettingValues = Object.fromEntries(specs.map((s) => [s.id, s.initial]));
  const fix = (s: SettingSpec, v: unknown): boolean | string | number => {
    if (s.kind === "toggle") return typeof v === "boolean" ? v : !!s.initial;
    if (s.kind === "choice") return typeof v === "string" && s.choices?.includes(v) ? v : s.initial;
    const n = typeof v === "number" && Number.isFinite(v) ? v : Number(s.initial);
    return Math.max(s.min ?? -Infinity, Math.min(s.max ?? Infinity, n));
  };
  return {
    specs, tabs, defaults,
    sanitize: (v) => Object.fromEntries(specs.map((s) => [s.id, fix(s, v[s.id])])),
    items: (tab, v) => specs.filter((s) => s.tab === tab).map((s): MenuEntry => {
      const val = fix(s, v[s.id]);
      const base = { id: s.id, label: s.label, ...(s.hint ? { hint: s.hint } : {}) };
      if (s.kind === "toggle") return { ...base, kind: "toggle", value: val ? 1 : 0 };
      if (s.kind === "choice") return { ...base, kind: "choice", choices: s.choices ?? [], value: Math.max(0, (s.choices ?? []).indexOf(String(val))) };
      return { ...base, kind: "range", value: Number(val), min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? 0.1 };
    }),
    fromMenu(id, value) {
      const s = byId.get(id);
      if (!s) return value;
      if (s.kind === "toggle") return value > 0;
      if (s.kind === "choice") return s.choices?.[value] ?? String(s.initial);
      return fix(s, value);
    },
    display(id, v) {
      const s = byId.get(id);
      if (!s) return "";
      const val = fix(s, v[id]);
      if (s.kind === "toggle") return val ? "ON" : "OFF";
      if (s.kind === "choice") return String(val);
      return s.format ? s.format(Number(val)) : String(val);
    },
  };
}
