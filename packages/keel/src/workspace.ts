// The modules a build can see: the engine's own (every package, pack, ai and
// system with a src/module file) and any number of PROJECTS outside it -- an
// example, a creator's game, someone's pack -- which reach the engine the way
// a third party does, through the KEEL SDK. (Node runs the TypeScript
// directly, so reading a manifest is just importing it.)
//
//   readWorkspace(engineRoot)                         the engine alone
//   readWorkspace(engineRoot, { projects: [dir] })   the engine and a project
//
// A project directory is one module (it has a src/module file), or a folder of
// them (any child -- or grandchild, one group deep like packs/x -- with one).
//
// TypeScript is the default, never a requirement: every src/<name>.ts this
// reads may be plain JavaScript instead (src/module.js, src/index.js, ...),
// and builds, links and verifies the same way (source.ts).
//
// Schemas: a package with a src/schemas file gets every named codec schema it
// exports (named("packs/tiles/tile", struct({...}))) listed in its manifest's
// contents.schemas, bytes embedded (codec schemaEntry) -- so the bundled
// module's manifest carries them and keel/codec registers them on the page
// before anything starts. Entries the manifest lists itself win (by id).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KINDS, schemaEntry, schemaName } from "@keel-engine/codec";
import type { SchemaEntryLike, Type } from "@keel-engine/codec";
import { defineManifest } from "@keel-engine/runtime";
import type { ModuleManifest, SchemaEntry } from "@keel-engine/runtime";
import { sourceFile } from "./source.ts";

export interface WorkspaceModule {
  readonly manifest: ModuleManifest;
  /** "@keel-engine/core", "@example/garden" -- how other code imports it. */
  readonly packageName: string;
  readonly dir: string;
  /** Where it came from: the engine, or a project directory. */
  readonly origin: "engine" | "project";
}

/** The engine checkout this package is part of (packages/keel/src -> the root). */
export const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// (The engine: its parts, its standard packs, and behaviour -- ai and systems are their own modules.)
export const GROUPS = ["packages", "packs", "ai", "systems"] as const;

/** How the KEEL SDK exposes the engine: `@keel/game-engine/<pkg>` is `@keel-engine/<pkg>`. */
export const SDK_PREFIX = "@keel/game-engine/";
export const ENGINE_PREFIX = "@keel-engine/";

async function moduleAt(dir: string, origin: WorkspaceModule["origin"]): Promise<WorkspaceModule | null> {
  const file = sourceFile(dir, "module");
  if (!file) return null;
  const pkgFile = join(dir, "package.json");
  if (!existsSync(pkgFile)) throw new Error(`${dir} has a ${relative(dir, file)} but no package.json: its package name is how code imports it.`);
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { name: string };
  const mod = (await import(pathToFileURL(file).href)) as { manifest?: ModuleManifest };
  if (!mod.manifest) throw new Error(`${file} doesn't export a manifest.`);
  return { manifest: await withSchemas(mod.manifest, dir), packageName: pkg.name, dir, origin };
}

// (A codec schema is a frozen node with a kind the codec knows; a named one has a name to list it by.)
const isNamedSchema = (v: unknown): v is Type<unknown> =>
  typeof v === "object" && v !== null && (KINDS as readonly string[]).includes((v as { kind?: string }).kind ?? "") && schemaName(v as Type<unknown>) !== null;

/** The named codec schemas a package's src/schemas file exports, as manifest entries (bytes embedded), by id. */
export async function schemasOf(dir: string): Promise<SchemaEntryLike[]> {
  const file = sourceFile(dir, "schemas");
  if (!file) return [];
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const out = new Map<string, SchemaEntryLike>();
  for (const [name, v] of Object.entries(mod)) {
    if (!isNamedSchema(v)) continue;
    const e = schemaEntry(v);
    const had = out.get(e.id);
    if (had && had.hash !== e.hash) throw new Error(`${file}: ${name} and another export are both ${e.id}, as different schemas (bump one's version).`);
    out.set(e.id, e);
  }
  return [...out.values()];
}

/** The manifest with its package's src/schemas schemas in contents.schemas (its own entries win). */
export async function withSchemas(manifest: ModuleManifest, dir: string): Promise<ModuleManifest> {
  const found = await schemasOf(dir);
  if (!found.length) return manifest;
  const own = manifest.contents?.schemas ?? [];
  const schemas: SchemaEntry[] = [...own, ...found.filter((e) => !own.some((o) => o.id === e.id))];
  const { schema: _schema, ...input } = manifest;
  return defineManifest({ ...input, contents: { ...manifest.contents, schemas } });
}

const children = (dir: string) => readdirSync(dir).sort().map((n) => resolve(dir, n)).filter((d) => !d.endsWith("node_modules") && statSync(d).isDirectory());

/** Every module in a project directory: itself, its children, or its groups' children. */
export async function readProject(dir: string): Promise<WorkspaceModule[]> {
  const self = await moduleAt(dir, "project");
  if (self) return [self];
  const out: WorkspaceModule[] = [];
  for (const child of children(dir)) {
    const m = await moduleAt(child, "project");
    if (m) { out.push(m); continue; }
    for (const grand of children(child)) { const g = await moduleAt(grand, "project"); if (g) out.push(g); }
  }
  return out;
}

export async function readWorkspace(engineRoot: string, { projects = [] }: { projects?: readonly string[] } = {}): Promise<WorkspaceModule[]> {
  const out: WorkspaceModule[] = [];
  for (const group of GROUPS) {
    const base = join(engineRoot, group);
    if (!existsSync(base)) continue;
    for (const dir of children(base)) { const m = await moduleAt(dir, "engine"); if (m) out.push(m); }
  }
  for (const p of projects) out.push(...await readProject(resolve(p)));
  const seen = new Map<string, string>();
  for (const m of out) {
    const had = seen.get(m.manifest.id);
    if (had) throw new Error(`Two packages claim ${m.manifest.id}: ${had} and ${m.dir}.`);
    seen.set(m.manifest.id, m.dir);
  }
  return out;
}

/** The SDK's own name: its root is the authoring API -- the engine's runtime. */
export const SDK_ROOT = "@keel/game-engine";

/** The module id an import name reaches, or undefined (SDK names map to the engine's). */
export function moduleForImport(name: string, workspace: readonly WorkspaceModule[]): string | undefined {
  if (name === `${SDK_PREFIX}build`) return undefined; // (the build is Node's, never a page's)
  const pkg = name === SDK_ROOT ? `${ENGINE_PREFIX}runtime` : name.startsWith(SDK_PREFIX) ? ENGINE_PREFIX + name.slice(SDK_PREFIX.length) : name;
  return workspace.find((w) => w.packageName === pkg)?.manifest.id;
}
