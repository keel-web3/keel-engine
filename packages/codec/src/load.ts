// Schemas registered at load. The KEEL bundle calls a module's exported
// setup(ctx) once, before its api is handed out; the codec's registers the
// engine's own schemas and every schema a defined module's manifest embeds
// (contents.schemas, as the KEEL build attaches them from a package's
// src/schemas.ts) into defaultRegistry -- so on a page, readDocument and
// decode resolve any pack's documents before that pack has even started.
//
// A manifest entry without its bytes can't be registered from the manifest
// alone: it stays pending (pendingSchemas()) until its module registers it
// itself (registerEntries(entries, registry, { [id]: schema })). Running setup
// again only picks up modules it hasn't seen.
//
// (No import of @keel-engine/runtime: the codec needs nothing on the page, so
// the context is described by shape.)

import { defaultRegistry, registerEntries } from "./document.ts";
import type { Registry, SchemaEntryLike } from "./document.ts";
import { registerEngineSchemas } from "./schemas/index.ts";

/** What setup reads of a module's manifest (runtime's ModuleManifest). */
export interface ManifestLike {
  readonly id: string;
  readonly version: string;
  readonly contents?: { readonly schemas?: readonly SchemaEntryLike[] };
}
/** What setup reads of its context (runtime's ModuleContext). */
export interface SetupContext {
  /** Every module defined in the engine, started or not. */
  modules(): readonly ManifestLike[];
}

export interface SchemaLoadReport {
  /** "name@version" of every schema registered from a manifest so far. */
  readonly registered: readonly string[];
  /** Declared without their bytes, and not in the registry (yet): the module registers them itself. */
  readonly pending: ReadonlyArray<{ readonly module: string; readonly entry: SchemaEntryLike }>;
  /** Entries that couldn't be registered (bytes that don't match their hash, a short-id clash), and why. */
  readonly problems: ReadonlyArray<{ readonly module: string; readonly id: string; readonly detail: string }>;
}

// (What has been loaded, per registry: setup uses the default one, a test or a tool may use its own.)
interface Loaded {
  readonly seen: Set<string>;
  readonly registered: string[];
  readonly pending: Array<{ module: string; entry: SchemaEntryLike }>;
  readonly problems: Array<{ module: string; id: string; detail: string }>;
}
const loaded = new WeakMap<Registry, Loaded>();
function loadedIn(registry: Registry): Loaded {
  let l = loaded.get(registry);
  if (!l) {
    l = { seen: new Set(), registered: [], pending: [], problems: [] };
    loaded.set(registry, l);
    registerEngineSchemas(registry);
  }
  return l;
}

/** The engine's schemas (once), then what the given manifests embed, skipping modules already seen. */
export function registerManifests(manifests: readonly ManifestLike[], registry: Registry = defaultRegistry): SchemaLoadReport {
  const l = loadedIn(registry);
  for (const m of manifests) {
    const key = `${m.id}@${m.version}`;
    if (l.seen.has(key)) continue;
    l.seen.add(key);
    for (const entry of m.contents?.schemas ?? []) {
      if (entry.schema === undefined) { l.pending.push({ module: m.id, entry }); continue; }
      // (One entry at a time: a bad one is reported, the rest still load.)
      try {
        registerEntries([entry], registry);
        l.registered.push(entry.id);
      } catch (e) {
        l.problems.push({ module: m.id, id: entry.id, detail: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return schemaLoadReport(registry);
}

/** The KEEL bundle's hook: the engine's schemas, then every defined module's embedded ones. Safe to call again. */
export function setup(ctx: SetupContext): SchemaLoadReport {
  return registerManifests(ctx.modules());
}

/** Declared schemas still missing from the registry (their bytes weren't in the manifest, and no one has registered them). */
export function pendingSchemas(registry: Registry = defaultRegistry): ReadonlyArray<{ readonly module: string; readonly entry: SchemaEntryLike }> {
  return (loaded.get(registry)?.pending ?? []).filter((p) => !registry.has(p.entry.id));
}

/** What setup has done so far. */
export function schemaLoadReport(registry: Registry = defaultRegistry): SchemaLoadReport {
  const l = loaded.get(registry);
  return { registered: [...new Set(l?.registered)], pending: pendingSchemas(registry), problems: [...(l?.problems ?? [])] };
}
