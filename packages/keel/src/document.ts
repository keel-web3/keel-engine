// A game as KEEL will assemble it: every module it needs (by id, and every
// module providing a contract it needs, transitively), each bundled and put in
// KEEL's own module slot (gzip'd, hash-checked, ordered by phase and weight),
// the game's entry last, all in the KEEL shell -- the exact local document
// KEEL's sandbox runs, so what runs here is what runs on chain.

import { gzipSync } from "node:zlib";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createEngine, splitRef } from "@keel-engine/runtime";
import type { ModuleManifest, Resolution } from "@keel-engine/runtime";
import { buildKeelInlineLocalDocument, buildKeelInlineModuleFragment, buildKeelInlineShellFragments } from "@keel/sdk/inline-viewer-graph";
import { bundleModule } from "./bundle.ts";
import type { BundledModule, BundleOptions } from "./bundle.ts";
import { buildVerifiedModule } from "./pipeline.ts";
import type { PrepareOptions, VerifiedModule } from "./pipeline.ts";
import { ENGINE_ROOT } from "./workspace.ts";
import type { WorkspaceModule } from "./workspace.ts";

export interface ModuleReport {
  readonly id: string;
  readonly version: string;
  readonly kind: string;
  readonly phase: string;
  readonly weight: number;
  readonly bytes: number;
  /** What KeelHold stores: every object is kept compressed. */
  readonly stored: number;
  /** sha256 of the module's bytes (for verified modules, the digest its receipt binds). */
  readonly digest?: string;
}

export interface GameDocument {
  readonly html: Uint8Array;
  /** The KEEL local document itself (its parts), for KEEL's own size and publication measurements. */
  readonly document: Awaited<ReturnType<typeof buildKeelInlineLocalDocument>>;
  readonly modules: readonly ModuleReport[];
  readonly resolution: Resolution;
  readonly bundles: readonly BundledModule[];
  /** The pipeline's results, one per module, when the document was built from verified bytes. */
  readonly verified: readonly VerifiedModule[];
}

/** The modules a module needs, all the way down: by id, and every provider of a contract it needs. */
export function closureOf(id: string, workspace: readonly WorkspaceModule[]): WorkspaceModule[] {
  const byId = new Map(workspace.map((w) => [w.manifest.id, w]));
  const seen = new Map<string, WorkspaceModule>();
  const visit = (m: WorkspaceModule) => {
    if (seen.has(m.manifest.id)) return;
    seen.set(m.manifest.id, m);
    for (const need of m.manifest.needs) {
      if (need.startsWith("contract:")) {
        const { name } = splitRef(need.slice("contract:".length));
        for (const w of workspace) if (w.manifest.provides.some((p) => splitRef(p).name === name)) visit(w);
      } else {
        const dep = byId.get(splitRef(need).name);
        if (dep) visit(dep);
      }
    }
  };
  const root = byId.get(id);
  if (!root) throw new Error(`No module ${id} in the workspace.`);
  visit(root);
  // (The registry is on every page.)
  const runtime = byId.get("keel/runtime");
  if (runtime) visit(runtime);
  return [...seen.values()];
}

/** Resolve with the real registry (stub factories): the same problems, the same order, before anything is bundled. */
export function resolveModules(manifests: readonly ModuleManifest[]): Resolution {
  const engine = createEngine();
  for (const m of manifests) engine.define(m, () => ({}));
  return engine.resolve();
}

// (…/keel-sdk/packages/sdk/dist/inline-viewer-graph.js -> …/keel-sdk: the shell reads its resources from there.)
const sdkRoot = () => join(dirname(realpathSync(fileURLToPath(import.meta.resolve("@keel/sdk/inline-viewer-graph")))), "..", "..", "..");

/**
 * A library the page needs as a global, put in as KEEL puts a piece's
 * `extends`: a classic script in its own runtime-phase slot, ordered by weight
 * (Tone at -200, then keel-audio at -100: KEEL_AUDIO_MODULE_WEIGHTS). The
 * engine never bundles them; @keel-engine/audio finds them on the page.
 */
export interface PageScript {
  readonly id: string;
  readonly version: string;
  readonly bytes: Uint8Array;
  readonly weight: number;
  readonly aliases?: readonly string[];
}

/** Tone and keel-audio from a vendor directory, as KEEL gives a piece that extends them (KEEL's own ids, versions and weights). */
export async function keelAudioScripts(vendorDir: string): Promise<PageScript[]> {
  const { KEEL_AUDIO_MODULE_WEIGHTS, KEEL_AUDIO_RUNTIME, KEEL_TONE_15 } = await import("@keel/sdk");
  const read = (name: string) => new Uint8Array(readFileSync(join(vendorDir, name)));
  return [
    { id: KEEL_TONE_15.id, version: KEEL_TONE_15.version, aliases: [KEEL_TONE_15.id, KEEL_TONE_15.alias], bytes: read(`tone-${KEEL_TONE_15.version}-native.js`), weight: KEEL_AUDIO_MODULE_WEIGHTS.tone },
    { id: KEEL_AUDIO_RUNTIME.id, version: KEEL_AUDIO_RUNTIME.version, aliases: [KEEL_AUDIO_RUNTIME.id], bytes: read(`keel-audio-${KEEL_AUDIO_RUNTIME.version}.min.js`), weight: KEEL_AUDIO_MODULE_WEIGHTS.audio },
  ];
}

export interface DocumentOptions extends BundleOptions, PrepareOptions {
  /** Export to start after the modules load (default: main). Another entry reuses the same verified module slots. */
  readonly entryExport?: string;
  /**
   * Where the modules' bytes come from. "verified" (the default): each module
   * through the KEEL module pipeline (`keel module build`), so the document
   * carries exactly the bytes a receipt binds and a chain would store. "dev":
   * esbuild alone, in memory (bundle.ts) -- fast, same behaviour, no receipt.
   */
  readonly modules?: "verified" | "dev";
  /** The engine checkout the pipeline builds in (default: the one this package is part of). */
  readonly engineRoot?: string;
  /**
   * Page globals the game needs (Tone and keel-audio: keelAudioScripts), each
   * a classic runtime-phase module fragment of its own, before the modules
   * that use them.
   */
  readonly pageScripts?: readonly PageScript[];
  readonly background?: string;
  /** A shell already built (the KEEL desktop app has its canonical one): skips rebuilding it. */
  readonly shell?: Awaited<ReturnType<typeof buildKeelInlineShellFragments>>;
}

/** Only the small entry changes between game and site documents; their verified module bytes stay shared. */
export function gameEntrySource(gameId: string, entryExport = "main"): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entryExport)) throw new Error(`Invalid game entry export: ${entryExport}`);
  if (entryExport === "main") return `(async function(){var E=globalThis.KEEL_ENGINE;await E.start();var g=E.get(${JSON.stringify(gameId)});if(g&&typeof g.main==="function")await g.main(document.body);})().catch(function(e){document.body.textContent=String(e&&e.stack||e);throw e;});\n`;
  return `(async function(){var E=globalThis.KEEL_ENGINE;await E.start();var g=E.get(${JSON.stringify(gameId)});var start=g&&g[${JSON.stringify(entryExport)}];if(typeof start!=="function")throw new Error(${JSON.stringify(`${gameId} has no ${entryExport} entry`)});await start(document.body);})().catch(function(e){document.body.textContent=String(e&&e.stack||e);throw e;});\n`;
}

export async function buildGameDocument(gameId: string, workspace: readonly WorkspaceModule[], options: DocumentOptions = {}): Promise<GameDocument> {
  const entryExport = options.entryExport ?? "main";
  const entry = gameEntrySource(gameId, entryExport);
  const mods = closureOf(gameId, workspace);
  const resolution = resolveModules(mods.map((m) => m.manifest));
  if (!resolution.ok) throw new Error(`${gameId}'s modules don't fit together:\n${resolution.problems.map((p) => `  ${p.module}: ${p.detail}`).join("\n")}`);
  const byId = new Map(mods.map((m) => [m.manifest.id, m]));
  const bundles: BundledModule[] = [];
  const verified: VerifiedModule[] = [];
  for (const id of resolution.order) {
    if (options.modules === "dev") { bundles.push(await bundleModule(byId.get(id)!, workspace, options)); continue; }
    const v = await buildVerifiedModule(byId.get(id)!, workspace, options.engineRoot ?? ENGINE_ROOT, options);
    verified.push(v);
    bundles.push({ manifest: v.manifest, code: new TextDecoder().decode(v.bytes), bytes: v.bytes });
  }
  const fragments = [];
  for (const p of options.pageScripts ?? []) {
    fragments.push(await buildKeelInlineModuleFragment({
      moduleId: p.id, version: p.version, mediaType: "text/javascript", ...(p.aliases ? { aliases: p.aliases } : {}),
      decodedBytes: p.bytes, compression: "gzip", execution: "classic", phase: "runtime", weight: p.weight,
    }));
  }
  for (const b of bundles) {
    fragments.push(await buildKeelInlineModuleFragment({
      moduleId: b.manifest.id, version: b.manifest.version, mediaType: "text/javascript",
      decodedBytes: b.bytes, compression: "gzip", execution: "classic", phase: b.manifest.phase, weight: b.manifest.weight,
    }));
  }
  // The entry: start every module, then hand the page to the game.
  const shell = options.shell ?? await buildKeelInlineShellFragments({ repositoryRoot: sdkRoot() });
  const doc = await buildKeelInlineLocalDocument({
    shell,
    modules: fragments,
    entry: { id: entryExport === "main" ? `${gameId}/entry` : `${gameId}/${entryExport}/entry`, mediaType: "text/javascript", source: new TextEncoder().encode(entry), compression: "none", ...(options.background ? { backgroundColor: options.background } : {}) },
  });
  const pages: ModuleReport[] = (options.pageScripts ?? []).map((p) => ({
    id: p.id, version: p.version, kind: "page-script", phase: "runtime", weight: p.weight, bytes: p.bytes.byteLength, stored: gzipSync(p.bytes, { level: 9 }).byteLength,
  }));
  const modules = [...pages, ...bundles.map((b, i) => ({
    id: b.manifest.id, version: b.manifest.version, kind: b.manifest.kind, phase: b.manifest.phase, weight: b.manifest.weight,
    bytes: b.bytes.byteLength, stored: gzipSync(b.bytes, { level: 9 }).byteLength,
    ...(verified[i] ? { digest: verified[i]!.outputDigest } : {}),
  }))];
  return { html: doc.rootBytes, document: doc, modules, resolution, bundles, verified };
}
