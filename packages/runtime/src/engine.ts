// The engine registry -- KEEL_ENGINE on a page. Every engine module (a
// runtime part, a pack, a system, an AI, a game) defines itself here with
// its manifest and a factory; the registry resolves what each one needs --
// modules by "id@range", contracts by "contract:name@range" -- starts them
// in dependency order, and hands each factory only what it declared it needs.
// It is the one global the engine puts on a page: nothing else is shared.
//
//   const engine = createEngine();
//   engine.define(manifest, (ctx) => api);    // each module's script does this
//   const report = engine.resolve();          // missing, incompatible, cycles -- all at once
//   await engine.start();                     // factories run, in order
//   engine.get("packs/animals")               // a started module's api

import type { ModuleManifest } from "./manifest.ts";
import { parseVersion, satisfies, splitRef, compare } from "./semver.ts";

export interface ModuleContext {
  readonly manifest: ModuleManifest;
  /** A module this one declared in `needs` ("keel/entity" -- the id, without the range). */
  use<T = unknown>(id: string): T;
  /** Every started module providing a contract this one declared ("body/quadruped"). */
  providers<T = unknown>(contract: string): Array<{ manifest: ModuleManifest; api: T }>;
  /**
   * Every module defined in this engine, started or not (by id): so a data-phase module reads the others'
   * manifests -- their schemas, their contents -- before they start. Manifests only, never an api.
   */
  modules(): readonly ModuleManifest[];
}

export type Factory<T = unknown> = (ctx: ModuleContext) => T | Promise<T>;

export interface Problem {
  readonly module: string;
  readonly kind: "missing" | "version" | "contract" | "cycle" | "duplicate";
  readonly detail: string;
}

export interface Resolution {
  readonly ok: boolean;
  /** Start order: every module after everything it needs. */
  readonly order: readonly string[];
  readonly problems: readonly Problem[];
  /** For the editor and agents: each module's needs, and what satisfied them. */
  readonly edges: ReadonlyArray<{ from: string; need: string; to: readonly string[] }>;
}

interface Entry { manifest: ModuleManifest; factory: Factory; api?: unknown; started: boolean }

export function createEngine() {
  const entries = new Map<string, Entry>();
  let resolution: Resolution | null = null;

  const contractName = (need: string) => splitRef(need.slice("contract:".length));
  const providersOf = (name: string, range: string): Entry[] =>
    [...entries.values()].filter((e) => e.manifest.provides.some((p) => { const c = splitRef(p); return c.name === name && satisfies(c.range, range); }));

  function define<T>(manifest: ModuleManifest, factory: Factory<T>): void {
    const had = entries.get(manifest.id);
    if (had) {
      // (One version of a module per document: two would be two globals' worth of trouble.)
      throw new Error(had.manifest.version === manifest.version
        ? `${manifest.id}@${manifest.version} is defined twice.`
        : `${manifest.id} is defined at ${had.manifest.version} and ${manifest.version}: one version per document.`);
    }
    entries.set(manifest.id, { manifest, factory: factory as Factory, started: false });
    resolution = null;
  }

  function resolve(): Resolution {
    const problems: Problem[] = [];
    const edges: Array<{ from: string; need: string; to: string[] }> = [];
    const deps = new Map<string, string[]>();
    for (const { manifest: m } of entries.values()) {
      const mine: string[] = [];
      for (const need of m.needs) {
        if (need.startsWith("contract:")) {
          const { name, range } = contractName(need);
          const found = providersOf(name, range).filter((e) => e.manifest.id !== m.id);
          if (!found.length) problems.push({ module: m.id, kind: "contract", detail: `needs a module providing ${name}@${range}, and none does.` });
          edges.push({ from: m.id, need, to: found.map((e) => e.manifest.id) });
          mine.push(...found.map((e) => e.manifest.id));
        } else {
          const { name, range } = splitRef(need);
          const e = entries.get(name);
          if (!e) problems.push({ module: m.id, kind: "missing", detail: `needs ${need}, which isn't loaded.` });
          else if (!satisfies(e.manifest.version, range)) problems.push({ module: m.id, kind: "version", detail: `needs ${name}@${range}, but ${e.manifest.version} is loaded.` });
          else mine.push(name);
          edges.push({ from: m.id, need, to: e ? [name] : [] });
        }
      }
      deps.set(m.id, [...new Set(mine)]);
    }
    // Start order: depth-first, dependencies first; KEEL's phase and weight break ties so the order matches the slots.
    const PHASES = { data: 0, runtime: 1, render: 2 } as const;
    const ids = [...entries.keys()].sort((a, b) => {
      const A = entries.get(a)!.manifest;
      const B = entries.get(b)!.manifest;
      return PHASES[A.phase] - PHASES[B.phase] || A.weight - B.weight || (a < b ? -1 : a > b ? 1 : 0);
    });
    const order: string[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (id: string, path: string[]) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) { problems.push({ module: id, kind: "cycle", detail: `needs itself through ${[...path, id].join(" -> ")}.` }); return; }
      state.set(id, 1);
      for (const d of deps.get(id) ?? []) visit(d, [...path, id]);
      state.set(id, 2);
      order.push(id);
    };
    for (const id of ids) visit(id, []);
    resolution = Object.freeze({ ok: problems.length === 0, order: Object.freeze(order), problems: Object.freeze(problems), edges: Object.freeze(edges) });
    return resolution;
  }

  function contextFor(e: Entry): ModuleContext {
    const m = e.manifest;
    const declared = new Set(m.needs.filter((n) => !n.startsWith("contract:")).map((n) => splitRef(n).name));
    const contracts = new Map(m.needs.filter((n) => n.startsWith("contract:")).map((n) => { const c = contractName(n); return [c.name, c.range] as const; }));
    return {
      manifest: m,
      use<T>(id: string): T {
        if (!declared.has(id)) throw new Error(`${m.id} uses ${id} without needing it: add "${id}@<range>" to its needs.`);
        const dep = entries.get(id);
        if (!dep?.started) throw new Error(`${m.id} uses ${id}, which hasn't started.`);
        return dep.api as T;
      },
      providers<T>(contract: string) {
        const range = contracts.get(contract);
        if (range === undefined) throw new Error(`${m.id} asks for providers of ${contract} without needing it: add "contract:${contract}@<range>".`);
        return providersOf(contract, range).filter((p) => p.started && p.manifest.id !== m.id).map((p) => ({ manifest: p.manifest, api: p.api as T }));
      },
      modules: () => Object.freeze(listManifests()),
    };
  }

  const listManifests = (): ModuleManifest[] =>
    [...entries.values()].map((e) => e.manifest).sort((a, b) => (a.id < b.id ? -1 : 1) || compare(parseVersion(b.version), parseVersion(a.version)));

  async function start(): Promise<Resolution> {
    const r = resolution ?? resolve();
    if (!r.ok) throw new Error(`The modules don't fit together:\n${r.problems.map((p) => `  ${p.module}: ${p.detail}`).join("\n")}`);
    for (const id of r.order) {
      const e = entries.get(id)!;
      if (e.started) continue;
      e.api = await e.factory(contextFor(e));
      e.started = true;
    }
    return r;
  }

  return {
    define,
    resolve,
    start,
    /** A started module's api. */
    get<T = unknown>(id: string): T {
      const e = entries.get(id);
      if (!e?.started) throw new Error(`${id} ${e ? "hasn't started" : "isn't loaded"}.`);
      return e.api as T;
    },
    has: (id: string) => entries.has(id),
    /** Every module defined, newest version first within an id (there is only one). */
    list: (): ModuleManifest[] => listManifests(),
    /** Modules providing a contract (started or not), for tools. */
    providing: (contract: string, range = "*"): ModuleManifest[] => providersOf(contract, range).map((e) => e.manifest),
  };
}

export type Engine = ReturnType<typeof createEngine>;

/**
 * The page's engine: `globalThis.KEEL_ENGINE`, made once. Every module
 * script on a KEEL document registers through this -- the only global the
 * engine uses.
 */
export function pageEngine(): Engine {
  const g = globalThis as { KEEL_ENGINE?: Engine };
  g.KEEL_ENGINE ??= createEngine();
  return g.KEEL_ENGINE;
}
