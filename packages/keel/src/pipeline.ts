// The engine through the KEEL module pipeline: each package is prepared (its
// pipeline files written or checked), then built, tested and indexed by the
// SDK's own `keel module` implementation (@keel/builder), in dependency order.
// This layer adds no build of its own: the bytes a game document carries are
// the bytes `keel module build` wrote to dist/ and its receipt verified, and a
// stranger rebuilds them with `keel module verify --repo keel-web3/keel-engine
// --commit <sha> --path <package> --entry keel/entry.ts --format iife --external ...`.
//
// Engine packages are built in place (their pipeline files are committed). A
// project outside the engine (an example, a creator's game) is staged: its
// src/ is copied under <out>/keel-module/ beside the generated files, so the
// project's own tree is never written to.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ModuleManifest } from "@keel-engine/runtime";
import { resolveModules } from "./document.ts";
import { ENGINE_TSCONFIG, engineModuleFiles, linkRecord, pipelineName } from "./link.ts";
import type { LinkRecord, ModuleFiles } from "./link.ts";
import type { WorkspaceModule } from "./workspace.ts";

type Builder = typeof import("@keel/builder");
let builderModule: Promise<Builder> | undefined;
/** The SDK's module pipeline (loaded on first use: it's Node-only and heavy). */
export const builder = (): Promise<Builder> => (builderModule ??= import("@keel/builder"));

export interface PreparedModule {
  readonly module: WorkspaceModule;
  /** The pipeline's name: dist/<name>.min.js. */
  readonly name: string;
  /** The directory the pipeline builds in: the package itself, or a project's stage. */
  readonly dir: string;
  /** Repo-relative path of the readable source ("packages/core"); a project's own path for projects. */
  readonly sourcePath: string;
  readonly link: LinkRecord;
  readonly files: ModuleFiles;
  readonly staged: boolean;
}

export interface PrepareOptions {
  /** Where a project's module is staged; default <its dir>/out/keel-module. */
  readonly stage?: (mod: WorkspaceModule) => string;
}

const posix = (p: string) => p.split("\\").join("/");

/** Every module's pipeline files, as they should be: nothing written. */
export async function prepareModule(mod: WorkspaceModule, workspace: readonly WorkspaceModule[], engineRoot: string, options: PrepareOptions = {}): Promise<PreparedModule> {
  const link = await linkRecord(mod, workspace);
  const staged = mod.origin !== "engine";
  const dir = staged ? (options.stage?.(mod) ?? join(mod.dir, "out", "keel-module")) : mod.dir;
  const sourcePath = staged ? posix(mod.dir) : posix(relative(engineRoot, mod.dir));
  // (A staged project extends the engine's base config by path; the config is read by the typecheck, never a build input.
  // Its TypeScript is checked strictly; plain JavaScript it has, or that its TypeScript imports, isn't checked, just built.)
  const tsconfig = staged
    ? { ...ENGINE_TSCONFIG, extends: posix(relative(dir, join(engineRoot, "tsconfig.base.json"))), compilerOptions: { ...ENGINE_TSCONFIG.compilerOptions, allowJs: true, checkJs: false } }
    : ENGINE_TSCONFIG;
  return { module: mod, name: pipelineName(mod), dir, sourcePath, link, files: engineModuleFiles(mod, link, sourcePath, tsconfig), staged };
}

/** Files that differ from what's on disk (paths relative to the module's pipeline directory). */
export function staleFiles(prepared: PreparedModule): string[] {
  return Object.entries(prepared.files).filter(([file, text]) => {
    const at = join(prepared.dir, file);
    return !existsSync(at) || readFileSync(at, "utf8") !== text;
  }).map(([file]) => file);
}

/** Write a module's pipeline files (and, for a project, its staged source). Returns what changed. */
export function writeModuleFiles(prepared: PreparedModule): string[] {
  if (prepared.staged) {
    rmSync(join(prepared.dir, "src"), { recursive: true, force: true });
    mkdirSync(prepared.dir, { recursive: true });
    cpSync(join(prepared.module.dir, "src"), join(prepared.dir, "src"), { recursive: true });
  }
  const changed = staleFiles(prepared);
  for (const file of changed) {
    const at = join(prepared.dir, file);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, prepared.files[file]!);
  }
  return changed;
}

/** Modules in the order the pipeline takes them: dependencies first (the registry's own start order). */
export function dependencyOrder(workspace: readonly WorkspaceModule[]): WorkspaceModule[] {
  const r = resolveModules(workspace.map((w) => w.manifest));
  const byId = new Map(workspace.map((w) => [w.manifest.id, w]));
  const order = r.order.map((id) => byId.get(id)!).filter(Boolean);
  return [...order, ...workspace.filter((w) => !order.includes(w))];
}

export interface VerifiedModule {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly dir: string;
  readonly sourcePath: string;
  readonly manifest: ModuleManifest;
  readonly link: LinkRecord;
  /** The shipped bytes, exactly dist/<name>.min.js. */
  readonly bytes: Uint8Array;
  readonly outputDigest: `0x${string}`;
  readonly sourceDigest: `0x${string}`;
  readonly recipeDigest: `0x${string}`;
  readonly receiptDigest: `0x${string}`;
  readonly disposition: string;
  /** The readable files the recipe pinned, module-relative, each by digest. */
  readonly inputs: ReadonlyArray<{ readonly path: string; readonly sha256: `0x${string}` }>;
  readonly format: string;
  readonly external: readonly string[];
}

const cache = new Map<string, { key: string; result: VerifiedModule }>();

function treeKey(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p));
    }
  };
  if (existsSync(join(dir, "src"))) walk(join(dir, "src"));
  return h.digest("hex");
}

export interface BuildOptions extends PrepareOptions {
  /** Write stale pipeline files first (default true); false makes a stale file an error (CI). */
  readonly write?: boolean;
  /** Bypass the in-process cache. */
  readonly fresh?: boolean;
}

/**
 * One module through `keel module build`: strict typecheck, esbuild with the
 * recipe's options, the terser compact stage, the recipe, and a receipt that
 * only exists if a rebuild reproduced the bytes.
 */
export async function buildVerifiedModule(mod: WorkspaceModule, workspace: readonly WorkspaceModule[], engineRoot: string, options: BuildOptions = {}): Promise<VerifiedModule> {
  const prepared = await prepareModule(mod, workspace, engineRoot, options);
  if (options.write === false) {
    const stale = staleFiles(prepared);
    if (stale.length) throw new Error(`${mod.manifest.id}: ${stale.join(", ")} ${stale.length === 1 ? "is" : "are"} not current -- run \`node packages/keel/src/cli.ts prepare\`.`);
  } else writeModuleFiles(prepared);
  const key = `${JSON.stringify(prepared.files)}:${treeKey(prepared.dir)}`;
  const hit = cache.get(prepared.dir);
  if (!options.fresh && hit?.key === key) return hit.result;
  const { buildKeelModule } = await builder();
  // (No declaration output: an engine part's linked imports resolve outside its own directory, which the declaration step refuses.)
  const built = await buildKeelModule(prepared.dir, { types: false });
  const result: VerifiedModule = {
    id: mod.manifest.id,
    version: mod.manifest.version,
    name: prepared.name,
    dir: prepared.dir,
    sourcePath: prepared.sourcePath,
    manifest: mod.manifest,
    link: prepared.link,
    bytes: new Uint8Array(readFileSync(built.outputPath)),
    outputDigest: built.outputIntegrity.digest,
    sourceDigest: built.receipt.source.digest,
    recipeDigest: built.recipeDigest,
    receiptDigest: built.receiptDigest,
    disposition: built.receipt.disposition,
    inputs: built.recipe.inputs.map((i) => ({ path: i.path, sha256: i.integrity.digest })),
    format: built.recipe.options.format,
    external: built.recipe.options.external ?? [],
  };
  cache.set(prepared.dir, { key, result });
  return result;
}

/** A module's shipped bytes as the pipeline last built them, checked against its recipe and receipt (no rebuild). */
export async function readVerifiedModule(prepared: PreparedModule): Promise<VerifiedModule | null> {
  const dist = join(prepared.dir, "dist");
  const out = join(dist, `${prepared.name}.min.js`);
  if (!existsSync(out) || !existsSync(join(dist, "keel-build-recipe.json")) || !existsSync(join(dist, "keel-source-receipt.json"))) return null;
  const { createIntegrity, canonicalJson, keelBuildRecipeDigest, utf8ToBytes } = await import("@keel/protocol");
  const bytes = new Uint8Array(readFileSync(out));
  const recipe = JSON.parse(readFileSync(join(dist, "keel-build-recipe.json"), "utf8"));
  const receipt = JSON.parse(readFileSync(join(dist, "keel-source-receipt.json"), "utf8"));
  const output = await createIntegrity(bytes);
  if (output.digest !== recipe.output.integrity.digest || output.digest !== receipt.output.digest) return null;
  return {
    id: prepared.module.manifest.id, version: prepared.module.manifest.version, name: prepared.name, dir: prepared.dir, sourcePath: prepared.sourcePath,
    manifest: prepared.module.manifest, link: prepared.link, bytes,
    outputDigest: output.digest, sourceDigest: receipt.source.digest, recipeDigest: await keelBuildRecipeDigest(recipe),
    receiptDigest: (await createIntegrity(utf8ToBytes(canonicalJson(receipt)))).digest, disposition: receipt.disposition,
    inputs: recipe.inputs.map((i: { path: string; integrity: { digest: `0x${string}` } }) => ({ path: i.path, sha256: i.integrity.digest })),
    format: recipe.options.format, external: recipe.options.external ?? [],
  };
}

export interface ModuleTest {
  readonly id: string;
  readonly vectors: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/** `keel module test`: every vector against the readable build and the shipped bytes. A module with no vectors reports 0. */
export async function testVerifiedModule(verified: VerifiedModule): Promise<ModuleTest> {
  const { hasModuleVectors, testKeelModule } = await builder();
  if (!(await hasModuleVectors(verified.dir))) return { id: verified.id, vectors: 0, passed: true, failures: [] };
  const r = await testKeelModule(verified.dir);
  return { id: verified.id, vectors: r.vectors.length, passed: r.passed, failures: r.vectors.filter((v) => !v.matchesExpectation || !v.matchesSource).map((v) => v.name) };
}

/** (b) of the resolver: every engine module built from this checkout, as the resolver compares them with a release. */
export async function localEngineModules(workspace: readonly WorkspaceModule[], engineRoot: string, options: BuildOptions = {}): Promise<VerifiedModule[]> {
  const out: VerifiedModule[] = [];
  for (const m of dependencyOrder(workspace.filter((w) => w.origin === "engine"))) out.push(await buildVerifiedModule(m, workspace, engineRoot, options));
  return out;
}

export interface GitHubVerification {
  readonly id: string;
  readonly commit: string;
  readonly reproduced: boolean;
  readonly outputDigest: string;
  readonly expected: string;
  readonly matches: boolean;
}

/**
 * (b) without a checkout: `keel module verify` for one catalog entry -- fetch the
 * repository archive at the commit, rebuild the module at its path with the
 * format and externals its recipe recorded, compare with the published digest,
 * and keep nothing.
 */
export async function verifyFromGitHub(entry: { readonly id: string; readonly sourceRepository: { readonly url: string; readonly path: string }; readonly build: { readonly format: string; readonly external: readonly string[] }; readonly output: { readonly digest: string } }, commit: string, fetchImpl?: typeof fetch): Promise<GitHubVerification> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(entry.sourceRepository.url);
  if (!m) throw new Error(`${entry.id}: ${entry.sourceRepository.url} isn't a GitHub repository.`);
  const { KEEL_MODULE_BUILD_OPTIONS, verifyKeelModuleFromOrigin } = await builder();
  const verified = await verifyKeelModuleFromOrigin({
    origin: { protocol: "keel-source-origin@1", provider: "github", owner: m[1]!, repo: m[2]!, commit, visibility: "public" },
    identity: { namespace: "keel", name: entry.id, version: "0.0.0", entry: "keel/entry.ts" },
    entry: "keel/entry.ts",
    recipeRoot: entry.sourceRepository.path,
    options: { ...KEEL_MODULE_BUILD_OPTIONS, format: entry.build.format as "iife", ...(entry.build.external.length ? { external: [...entry.build.external] } : {}) },
    compact: { keepComments: false },
    mediaType: "text/javascript",
    ...(fetchImpl ? { fetchImpl } : {}),
  } as Parameters<typeof verifyKeelModuleFromOrigin>[0]);
  const outputDigest = verified.recipe.output.integrity.digest;
  return { id: entry.id, commit, reproduced: verified.verification.reproduced, outputDigest, expected: entry.output.digest, matches: outputDigest === entry.output.digest };
}
