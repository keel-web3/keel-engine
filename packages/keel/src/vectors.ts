// Test vectors for an engine module, in the shape `keel module test` runs:
// a module's test/vectors.mjs default-exports `await engineVectors(import.meta.url, [...])`.
//
// The pipeline runs the vectors twice, each time in a clean process: once
// against the module's readable build, once against its shipped minified bytes,
// and fails on any difference (between the two, or from `expect`). Both builds
// are classic scripts that define the module on KEEL_ENGINE, so this sets up
// the page first, when the vectors file is imported (before the candidate is):
// a registry from keel/runtime's readable source, and every module the one
// under test needs -- by id, and a provider for each contract it needs --
// defined from its readable source, as the engine's own tests load them. Only
// the module under test runs from the candidate bytes. Each vector gets the
// module's started api (and the engine), and returns something JSON can carry.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Manifest {
  readonly id: string;
  readonly needs: readonly string[];
  readonly provides: readonly string[];
}
interface Link { readonly manifest: Manifest }
interface Ctx { use(id: string): unknown }
interface Engine {
  define(manifest: Manifest, factory: (ctx: Ctx) => unknown): void;
  start(): Promise<unknown>;
  get<T = unknown>(id: string): T;
  has(id: string): boolean;
}

export interface EngineVector<Api = Record<string, unknown>> {
  readonly name: string;
  readonly run: (api: Api, engine: Engine) => unknown;
  readonly expect: unknown;
}

/** What the pipeline's runner calls: run() takes the (unused) module namespace. */
export interface RunnerVector {
  readonly name: string;
  readonly run: () => Promise<unknown>;
  readonly expect: unknown;
}

const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GROUPS = ["packages", "packs", "ai", "systems"];
const name = (ref: string) => { const i = ref.indexOf("@", 1); return i < 0 ? ref : ref.slice(0, i); };

/** Every engine module the pipeline knows: its id -> its directory and link record. */
function engineModules(): Map<string, { dir: string; link: Link }> {
  const out = new Map<string, { dir: string; link: Link }>();
  for (const group of GROUPS) {
    const base = join(ENGINE_ROOT, group);
    if (!existsSync(base)) continue;
    for (const child of readdirSync(base).sort()) {
      const file = join(base, child, "keel", "link.json");
      if (!existsSync(file)) continue;
      const link = JSON.parse(readFileSync(file, "utf8")) as Link;
      out.set(link.manifest.id, { dir: join(base, child), link });
    }
  }
  return out;
}

export async function engineVectors<Api = Record<string, unknown>>(vectorsUrl: string, vectors: ReadonlyArray<EngineVector<Api>>): Promise<RunnerVector[]> {
  const moduleDir = resolve(dirname(fileURLToPath(vectorsUrl)), "..");
  const self = (JSON.parse(readFileSync(join(moduleDir, "keel", "link.json"), "utf8")) as Link).manifest;
  const page = globalThis as { KEEL_ENGINE?: Engine };
  if (self.id !== "keel/runtime") {
    const known = engineModules();
    const runtimeDir = known.get("keel/runtime")!.dir;
    const runtime = (await import(pathToFileURL(join(runtimeDir, "src", "index.ts")).href)) as { createEngine(): Engine };
    const engine = runtime.createEngine();
    page.KEEL_ENGINE = engine;
    const defined = new Set<string>([self.id]);
    const define = (id: string) => {
      if (defined.has(id)) return;
      const entry = known.get(id);
      if (!entry) throw new Error(`${self.id}'s vectors need ${id}, which isn't an engine module.`);
      defined.add(id);
      for (const need of entry.link.manifest.needs) needFrom(need);
      const src = pathToFileURL(join(entry.dir, "src", "index.ts")).href;
      engine.define(entry.link.manifest, id === "keel/runtime" ? () => runtime : async (ctx) => {
        const api = (await import(src)) as { setup?: (ctx: Ctx) => unknown };
        if (typeof api.setup === "function") await api.setup(ctx);
        return api;
      });
    };
    const needFrom = (need: string) => {
      if (!need.startsWith("contract:")) return define(name(need));
      const contract = name(need.slice("contract:".length));
      for (const [id, { link }] of known) if (link.manifest.provides.some((p) => name(p) === contract)) define(id);
    };
    define("keel/runtime");
    for (const need of self.needs) needFrom(need);
  }
  let started: Promise<unknown> | undefined;
  const ready = async () => {
    const engine = page.KEEL_ENGINE;
    if (!engine) throw new Error(`${self.id} didn't put KEEL_ENGINE on the page.`);
    await (started ??= engine.start());
    return engine;
  };
  return vectors.map((v) => ({
    name: v.name,
    expect: v.expect,
    run: async () => { const engine = await ready(); return v.run(engine.get<Api>(self.id), engine); },
  }));
}

// ------------------------------------------------------------ vector helpers

/** A module's export surface: every export's name and kind, sorted -- what a minifier must never move. */
export function surface(api: object): string[] {
  return Object.keys(api).sort().map((k) => `${k}:${typeof (api as Record<string, unknown>)[k]}`);
}

/** JSON with sorted keys, numbers as JSON writes them, typed arrays as arrays, functions and cycles named. */
export function canonical(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "function") return "[function]";
    if (typeof v === "bigint") return `${v}n`;
    if (v === null || typeof v !== "object") return typeof v === "number" && !Number.isFinite(v) ? String(v) : v;
    if (seen.has(v)) return "[cycle]";
    seen.add(v);
    try {
      if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
      if (Array.isArray(v)) return v.map(walk);
      if (v instanceof Map) return [...v.entries()].map(([k, x]) => [walk(k), walk(x)]);
      if (v instanceof Set) return [...v].map(walk);
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    } finally {
      seen.delete(v);
    }
  };
  return JSON.stringify(walk(value));
}

/** sha256 of a value's canonical JSON: a big value pinned by one short string. */
export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every export that isn't a function (the module's tables and constants), pinned by digest. */
export const dataDigest = (api: object): Promise<string> =>
  digest(Object.fromEntries(Object.entries(api).filter(([, v]) => typeof v !== "function")));

/** A small seeded stream in the engine's Stream shape, for building a pack's entities without keel/core. */
export function vectorStream(seed: number) {
  let a = seed >>> 0 || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    f,
    between: (x: number, y: number) => x + (y - x) * f(),
    int: (x: number, y: number) => x + Math.floor(f() * (y - x + 1)),
    pick: <T>(l: readonly T[]) => l[Math.floor(f() * l.length)] as T,
    chance: (p: number) => f() < p,
    weighted: <T>(l: readonly (readonly [T, number])[]) => { let r = f() * l.reduce((s, [, w]) => s + w, 0); for (const [v, w] of l) { if (r < w) return v; r -= w; } return l[l.length - 1]![0]; },
  };
}
