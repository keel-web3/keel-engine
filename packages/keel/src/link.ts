// An engine module as the KEEL module pipeline builds it.
//
// Every package is a KEEL verified module: `keel module build` (the SDK's
// @keel/builder) compiles its readable TypeScript into the exact on-chain bytes
// and a receipt binding the two. For that, each package carries four small
// files the pipeline reads, all written here and all committed:
//
//   keel.module.json   keel-module-manifest@1: the pipeline's name for it, the
//                      license, where the source lives, and how it links --
//                      build.format "iife" (a classic script, as KEEL's module
//                      slots run) and build.external (every other engine module
//                      it imports, left as imports instead of copied in)
//   tsconfig.json      the strict flags the pipeline insists on
//   keel/entry.ts      the entry the pipeline compiles (the same in every package)
//   keel/link.json     keel-engine-link@1: the package's keel-engine-module@1
//                      manifest (with its codec schemas), and which module id
//                      each linked import reaches
//
// The entry defines the package on KEEL_ENGINE and evaluates it inside its
// factory: the bundler's own lazy init for the package, with each linked import
// answered by the module's context -- ctx.use(id) -- while it evaluates. So a
// module still reaches only what its manifest needs, each package's code is
// stored once on chain, and the bytes on chain are the bytes the pipeline
// verified: nothing is wrapped around them afterwards.

import { build } from "esbuild";
import { join } from "node:path";
import { splitRef } from "@keel-engine/runtime";
import type { ModuleManifest } from "@keel-engine/runtime";
import { moduleForImport } from "./workspace.ts";
import type { WorkspaceModule } from "./workspace.ts";

export const LINK_SCHEMA = "keel-engine-link@1";
export const RUNTIME_ID = "keel/runtime";
/** Where the engine's readable source is published: every receipt and catalog entry points here. */
export const ENGINE_REPOSITORY = "https://github.com/keel-web3/keel-engine";
/** The pipeline's own "not pinned yet" revision: a committed file can't name the commit it's in, so the catalog pins it at release. */
export const UNPINNED_REVISION = "replace-with-a-commit-hash";

export interface LinkRecord {
  readonly schema: typeof LINK_SCHEMA;
  /** The keel-engine-module@1 manifest, exactly what define() receives. */
  readonly manifest: ModuleManifest;
  /** Linked import specifier -> the module id it reaches ("@keel-engine/core" -> "keel/core"). */
  readonly imports: Readonly<Record<string, string>>;
  /** "<package>/module" imports: another module's manifest, carried as data. */
  readonly manifests: Readonly<Record<string, ModuleManifest>>;
}

/** The pipeline's name for a module (its on-chain object is dist/<name>.min.js). */
export function pipelineName(mod: Pick<WorkspaceModule, "manifest" | "origin">): string {
  const id = mod.manifest.id;
  const slug = (mod.origin === "engine" ? `keel-engine-${id.replace(/^keel\//, "")}` : id).replace(/\//g, "-");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(slug)) throw new Error(`${id} has no valid pipeline name (${slug}).`);
  return slug;
}

const sorted = <T>(record: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k] as T]));

/**
 * What a package links to: every import of another module (by the id it
 * reaches) and every other module's manifest it reads -- each one checked
 * against the package's needs, so a module can't reach what it didn't declare.
 */
export async function linkRecord(mod: WorkspaceModule, workspace: readonly WorkspaceModule[]): Promise<LinkRecord> {
  const { manifest } = mod;
  const needed = new Set(manifest.needs.filter((n) => !n.startsWith("contract:")).map((n) => splitRef(n).name));
  const others = workspace.filter((w) => w !== mod).map((w) => w.packageName);
  const result = await build({
    entryPoints: [join(mod.dir, "src", "index.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    metafile: true,
    // (Every other module's package -- the engine's, the SDK's names for them, a project's own -- is a link, never a copy.)
    external: ["@keel-engine/*", "@keel/game-engine", "@keel/game-engine/*", ...others],
    logLevel: "silent",
  });
  const specifiers = new Set<string>();
  for (const out of Object.values(result.metafile.outputs)) for (const i of out.imports) if (i.external) specifiers.add(i.path);
  const imports: Record<string, string> = {};
  const manifests: Record<string, ModuleManifest> = {};
  for (const name of specifiers) {
    // (Another module's manifest -- "<its package>/module", what a game reads its packs' versions from -- is data.)
    if (name.endsWith("/module")) {
      const of = moduleForImport(name.slice(0, -"/module".length), workspace);
      if (!of) throw new Error(`${manifest.id} imports ${name}, which isn't a module's manifest in this workspace.`);
      if (!needed.has(of)) throw new Error(`${manifest.id} imports ${name} but doesn't need ${of}: add "${of}@<range>" to its manifest's needs.`);
      manifests[name] = workspace.find((w) => w.manifest.id === of)!.manifest;
      continue;
    }
    const id = moduleForImport(name, workspace);
    if (!id) throw new Error(`${manifest.id} imports ${name}, which isn't a module in this workspace.`);
    if (!needed.has(id)) throw new Error(`${manifest.id} imports ${name} but doesn't need ${id}: add "${id}@<range>" to its manifest's needs.`);
    imports[name] = id;
  }
  return { schema: LINK_SCHEMA, manifest, imports: sorted(imports), manifests: sorted(manifests) };
}

/** The specifiers the pipeline leaves as imports: exactly the ones the package links to. */
export const linkedSpecifiers = (link: LinkRecord): string[] => [...Object.keys(link.imports), ...Object.keys(link.manifests)].sort();

// ---------------------------------------------------------------- the entries

/** The entry every package but the registry builds from (identical everywhere). */
export const MODULE_ENTRY = `"use strict";
// The KEEL entry of an engine module: what \`keel module build\` compiles into
// its on-chain bytes. (The same file in every package: @keel-engine/keel writes
// it, and link.json beside it, and its tests check both are current.)
//
// The page's KEEL_ENGINE (keel/runtime, always the first module) gets this
// module's manifest now and its factory for later, in dependency order. The
// factory evaluates the package: its own code is bundled in, and every other
// module it imports is linked -- each such import is answered by this module's
// context, ctx.use(id), while the package evaluates. Nothing else is shared.
import link from "./link.json" with { type: "json" };

interface Context {
  use(id: string): unknown;
}
interface Api {
  readonly setup?: (ctx: Context) => unknown;
}
interface Engine {
  define(manifest: unknown, factory: (ctx: Context) => Promise<Api>): void;
}
type Lookup = (specifier: string) => unknown;

// The bundler's require: the literal call below becomes the package's own lazy
// init, so the package runs inside the factory rather than when the script loads.
// (Outside any try block: a bundler takes a require inside one as optional.)
declare const require: (path: string) => Api;
const evaluate = (): Api => require("../src/index.ts");

const page = globalThis as { KEEL_ENGINE?: Engine; require?: Lookup };
const engine = page.KEEL_ENGINE;
if (engine === undefined) throw new Error("KEEL_ENGINE isn't on the page: keel/runtime loads first.");
const imports: Readonly<Record<string, string>> = link.imports;
const manifests: Readonly<Record<string, unknown>> = link.manifests;

engine.define(link.manifest, async (ctx) => {
  // Linked imports resolve through the bundler's require; for the synchronous
  // moment the package evaluates, that is this module's context.
  const lookup: Lookup = (specifier) => {
    const manifest = manifests[specifier];
    if (manifest !== undefined) return { manifest };
    const id = imports[specifier];
    if (id === undefined) throw new Error(link.manifest.id + " can't load " + specifier);
    return ctx.use(id);
  };
  const had = Object.hasOwn(page, "require");
  const before = page.require;
  page.require = lookup;
  let api: Api;
  try {
    api = evaluate();
  } finally {
    if (had && before !== undefined) page.require = before;
    else delete page.require;
  }
  if (typeof api.setup === "function") await api.setup(ctx);
  return api;
});
`;

/** The registry's entry: it puts KEEL_ENGINE on the page, then stands in it like any other module. */
export const RUNTIME_ENTRY = `"use strict";
// The KEEL entry of keel/runtime, the registry: what \`keel module build\`
// compiles into its on-chain bytes. It makes the page's one global,
// KEEL_ENGINE, and defines itself there like every other module.
import link from "./link.json" with { type: "json" };
import * as runtime from "../src/index.ts";
import type { Engine, ModuleManifest } from "../src/index.ts";

const page = globalThis as { KEEL_ENGINE?: Engine };
const engine = page.KEEL_ENGINE ?? (page.KEEL_ENGINE = runtime.createEngine());
engine.define(link.manifest as unknown as ModuleManifest, () => runtime);
`;

export const entryFor = (mod: WorkspaceModule): string => (mod.manifest.id === RUNTIME_ID ? RUNTIME_ENTRY : MODULE_ENTRY);

// --------------------------------------------------------- the pipeline's files

/** The strict compiler settings the pipeline checks, for a package in the engine (extends the engine's base). */
export const ENGINE_TSCONFIG = {
  extends: "../../tsconfig.base.json",
  compilerOptions: { noEmit: true, resolveJsonModule: true, types: [] as string[] },
  include: ["src/**/*.ts", "keel/**/*.ts"],
};

export interface ModuleFiles {
  /** Module-directory-relative path -> exact contents. */
  readonly [path: string]: string;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export interface PipelineManifestInput {
  readonly name: string;
  readonly link: LinkRecord;
  /** Repo-relative path of the package ("packages/core"). */
  readonly sourcePath: string;
  readonly repository?: string;
}

/** keel-module-manifest@1 for a package: identity, license, source location, and linkage. */
export function pipelineManifest({ name, link, sourcePath, repository = ENGINE_REPOSITORY }: PipelineManifestInput) {
  const m = link.manifest;
  const description = (m.description ?? m.title ?? m.id).replace(/\s+/g, " ").trim();
  const external = linkedSpecifiers(link);
  return {
    protocol: "keel-module-manifest@1",
    name,
    version: m.version,
    description: description.length > 512 ? `${description.slice(0, 509)}...` : description,
    entry: "keel/entry.ts",
    license: "MIT",
    sourceRepository: { url: repository, revision: UNPINNED_REVISION, path: sourcePath },
    build: external.length ? { format: "iife", external } : { format: "iife" },
  };
}

/** Every file the pipeline reads for an engine package, as it should be committed. */
export function engineModuleFiles(mod: WorkspaceModule, link: LinkRecord, sourcePath: string, tsconfig: object = ENGINE_TSCONFIG): ModuleFiles {
  return {
    "keel.module.json": json(pipelineManifest({ name: pipelineName(mod), link, sourcePath })),
    "tsconfig.json": json(tsconfig),
    "keel/entry.ts": entryFor(mod),
    "keel/link.json": json(link),
  };
}
