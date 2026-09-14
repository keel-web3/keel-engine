// The engine's module catalog: one entry per verified module, in the style of
// the keel-modules catalog (keel-module-catalog@3), plus what the engine's
// registry needs to know without fetching anything (kind, needs, provides,
// phase, weight). It is what the resolver reads to find a version's bytes on
// chain and its readable source on GitHub.
//
// Like keel-modules' catalog, every field comes from a committed file or from
// dist/ bytes the pipeline just verified -- never a clock or an mtime -- so
// indexing a clean checkout twice is a byte-identical file, and a stranger can
// check the published catalog by regenerating it and running `diff`.
//
// `verified` comes only from the receipt's disposition; `deployments` only from
// the committed deployments/<chainId>.json records. Neither implies the other:
// a module is verified the moment its source rebuilds to its bytes, and
// deployed only once somebody has published those bytes.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENGINE_REPOSITORY } from "./link.ts";
import { builder } from "./pipeline.ts";
import type { VerifiedModule } from "./pipeline.ts";

export const ENGINE_CATALOG_SCHEMA = "keel-engine-module-catalog@1";
export const ENGINE_CATALOG_FILE = "catalog/catalog.json";

export interface EngineDeployment {
  readonly chainId: number;
  readonly hold: { readonly address: string; readonly objectId: string };
  readonly version: string;
  readonly outputDigest: string;
  readonly receiptDigest: string;
  readonly block: string | null;
  readonly txHash: string | null;
  readonly publishedAt: string;
  readonly status: "current" | "superseded";
}

export interface EngineCatalogEntry {
  /** The engine's id ("keel/core") and exact version. */
  readonly id: string;
  readonly version: string;
  readonly kind: string;
  readonly phase: string;
  readonly weight: number;
  readonly needs: readonly string[];
  readonly provides: readonly string[];
  readonly compatible: readonly string[];
  /** The pipeline's name: the on-chain object is <name>.min.js. */
  readonly name: string;
  readonly license: string;
  readonly summary: string;
  /** Where the readable source is: the repository, the commit (once pinned at release), and the package's path. */
  readonly sourceRepository: { readonly url: string; readonly revision: string | null; readonly path: string };
  /** Repo-relative path of the entry the pipeline compiles. */
  readonly githubPath: string;
  /** The READABLE files the recipe pinned, repo-relative, each by sha256. */
  readonly sourceFiles: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
  /** How it links: the classic-script format and the imports left to its neighbours. */
  readonly build: { readonly format: string; readonly external: readonly string[] };
  readonly output: { readonly digest: string; readonly byteLength: number };
  readonly sourceDigest: string;
  readonly recipeDigest: string;
  readonly receiptDigest: string;
  readonly disposition: string;
  /** True only for the byte-proof dispositions (exact-source-output, reproducible-build). */
  readonly verified: boolean;
  /** The vectors `keel module test` runs, pinned by digest (null: none). */
  readonly vectors: { readonly path: string; readonly sha256: string } | null;
  readonly deployments: readonly EngineDeployment[];
  readonly deployed: boolean;
}

export interface EngineCatalog {
  readonly schema: typeof ENGINE_CATALOG_SCHEMA;
  /** The engine's version (its root package.json): what a release pin names. */
  readonly version: string;
  readonly repository: string;
  /** The commit every sourceRepository.revision names, or null before a release pins one. */
  readonly revision: string | null;
  /** Module ids in the order the registry starts them (dependencies first): the publish order. */
  readonly order: readonly string[];
  readonly modules: readonly EngineCatalogEntry[];
}

const VERIFIED = new Set(["exact-source-output", "reproducible-build"]);
const sha256 = (bytes: Uint8Array | string) => `0x${createHash("sha256").update(bytes).digest("hex")}`;

export interface IndexOptions {
  /** The engine version this catalog is (default "0.0.0"; the CLI reads the root package.json). */
  readonly version?: string;
  /** The commit the modules were built from, when this is a release. */
  readonly revision?: string | null;
  readonly repository?: string;
}

export async function catalogEntry(v: VerifiedModule, { revision = null, repository = ENGINE_REPOSITORY }: IndexOptions = {}): Promise<EngineCatalogEntry> {
  const { readKeelModuleRevisions } = await builder();
  const pipeline = JSON.parse(readFileSync(join(v.dir, "keel.module.json"), "utf8")) as { license: string; description: string };
  const vectorsFile = join(v.dir, "test", "vectors.mjs");
  const deployments = (await readKeelModuleRevisions(v.dir)).map((d) => ({ ...d })) as EngineDeployment[];
  const m = v.manifest;
  return {
    id: m.id, version: m.version, kind: m.kind, phase: m.phase, weight: m.weight,
    needs: [...m.needs], provides: [...m.provides], compatible: [...m.compatible],
    name: v.name, license: pipeline.license, summary: pipeline.description,
    sourceRepository: { url: repository, revision, path: v.sourcePath },
    githubPath: `${v.sourcePath}/keel/entry.ts`,
    sourceFiles: v.inputs.map((i) => ({ path: `${v.sourcePath}/${i.path}`, sha256: i.sha256 })),
    build: { format: v.format, external: [...v.external] },
    output: { digest: v.outputDigest, byteLength: v.bytes.byteLength },
    sourceDigest: v.sourceDigest, recipeDigest: v.recipeDigest, receiptDigest: v.receiptDigest,
    disposition: v.disposition, verified: VERIFIED.has(v.disposition),
    vectors: existsSync(vectorsFile) ? { path: `${v.sourcePath}/test/vectors.mjs`, sha256: sha256(readFileSync(vectorsFile)) } : null,
    deployments, deployed: deployments.length > 0,
  };
}

export async function buildCatalog(verified: readonly VerifiedModule[], options: IndexOptions = {}): Promise<EngineCatalog> {
  const entries: EngineCatalogEntry[] = [];
  for (const v of verified) entries.push(await catalogEntry(v, options));
  return {
    schema: ENGINE_CATALOG_SCHEMA,
    version: options.version ?? "0.0.0",
    repository: options.repository ?? ENGINE_REPOSITORY,
    revision: options.revision ?? null,
    order: verified.map((v) => v.id),
    modules: [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export const catalogText = (catalog: EngineCatalog): string => `${JSON.stringify(catalog, null, 2)}\n`;

export function writeCatalog(engineRoot: string, catalog: EngineCatalog): string {
  const file = join(engineRoot, ENGINE_CATALOG_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, catalogText(catalog));
  return file;
}
