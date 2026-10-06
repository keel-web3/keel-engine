import { createEngine, satisfies, splitRef } from "@keel-engine/runtime";
import type { ModuleManifest } from "@keel-engine/runtime";

export const PIPELINE_SCHEMA = "keel-pipeline@1";
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export interface Artifact { readonly bytes: Uint8Array; readonly mediaType: string; readonly sha256: string }
export interface Stage {
  readonly id: string;
  /** KEEL module reference, resolved against the supplied exact version and digest. */
  readonly module: string;
  readonly inputs: readonly string[];
  readonly options: Json;
}
export interface Recipe {
  readonly schema: typeof PIPELINE_SCHEMA;
  readonly sources: Readonly<Record<string, Artifact>>;
  readonly stages: readonly Stage[];
}
export interface PipelineModule {
  readonly manifest: ModuleManifest;
  /** Exact implementation digest; receipt authentication belongs to the host's SDK resolver. */
  readonly sha256: string;
  readonly run?: (inputs: readonly Artifact[], options: Json) => Artifact | Promise<Artifact>;
}
export interface ArtifactCache {
  get(key: string): Artifact | undefined | Promise<Artifact | undefined>;
  set(key: string, artifact: Artifact): void | Promise<void>;
}
export interface Host {
  /** SHA-256 of exact bytes; injectable so this module needs no Node or browser globals. */
  readonly digest: (bytes: Uint8Array) => string | Promise<string>;
  readonly cache?: ArtifactCache;
}
export interface PipelineResult {
  readonly artifacts: Readonly<Record<string, Artifact>>;
  readonly stages: ReadonlyArray<{ readonly id: string; readonly key: string; readonly reused: boolean; readonly bytes: number }>;
}
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:[./-][a-z0-9]+)*$/;
/** Canonical JSON for recipe identity. Undefined, non-finite numbers and class instances are refused. */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite recipe number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${Array.from(value, (v) => canonicalJson(v)).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("recipe options must be JSON data");
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, Json>)[k]!)}`).join(",")}}`;
}
function copy(a: Artifact): Artifact { return { bytes: a.bytes.slice(), mediaType: a.mediaType, sha256: a.sha256 }; }
async function checked(a: Artifact, host: Host, where: string): Promise<Artifact> {
  if (!a || !(a.bytes instanceof Uint8Array) || typeof a.mediaType !== "string" || !a.mediaType || !HEX.test(a.sha256)) throw new Error(`${where}: invalid artifact`);
  const owned = copy(a);
  if (await host.digest(owned.bytes) !== owned.sha256) throw new Error(`${where}: artifact digest mismatch`);
  return owned;
}
interface PlannedStage { readonly stage: Stage; readonly module: PipelineModule; readonly closure: readonly PipelineModule[] }
/** Validate the entire graph, including KEEL's real module/contract/version resolver, before any generation. */
function plan(recipe: Recipe, modules: readonly PipelineModule[]): PlannedStage[] {
  if (recipe.schema !== PIPELINE_SCHEMA) throw new Error(`expected ${PIPELINE_SCHEMA}`);
  const byModule = new Map<string, PipelineModule>();
  for (const m of modules) {
    if (!HEX.test(m.sha256)) throw new Error(`${m.manifest.id}: invalid implementation digest`);
    if (byModule.has(m.manifest.id)) throw new Error(`duplicate module ${m.manifest.id}`);
    byModule.set(m.manifest.id, m);
  }
  const sourceIds = new Set(Object.keys(recipe.sources));
  const byStage = new Map<string, Stage>();
  for (const id of sourceIds) if (!ID.test(id)) throw new Error(`invalid source id ${id}`);
  for (const s of recipe.stages) {
    if (!ID.test(s.id) || sourceIds.has(s.id) || byStage.has(s.id)) throw new Error(`invalid or duplicate stage ${s.id}`);
    if (!Array.isArray(s.inputs)) throw new Error(`${s.id}: inputs must be an array`);
    canonicalJson(s.options);
    byStage.set(s.id, s);
  }
  const closure = (root: PipelineModule): PipelineModule[] => {
    const selected = new Map<string, PipelineModule>();
    const visit = (m: PipelineModule): void => {
      if (selected.has(m.manifest.id)) return;
      selected.set(m.manifest.id, m);
      for (const need of m.manifest.needs) {
        if (need.startsWith("contract:")) {
          const ref = splitRef(need.slice(9));
          for (const other of modules) if (other.manifest.provides.some((p) => {
            const provided = splitRef(p); return provided.name === ref.name && satisfies(provided.range, ref.range);
          })) visit(other);
        } else {
          const dep = byModule.get(splitRef(need).name);
          if (dep) visit(dep);
        }
      }
    };
    visit(root);
    const engine = createEngine();
    for (const m of selected.values()) engine.define(m.manifest, () => ({}));
    const resolution = engine.resolve();
    if (!resolution.ok) throw new Error(resolution.problems.map((p) => `${p.module}: ${p.detail}`).join("; "));
    return resolution.order.map((id) => selected.get(id)!);
  };
  const out: PlannedStage[] = [], state = new Map<string, 1 | 2>();
  const visit = (id: string): void => {
    if (sourceIds.has(id) || state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`pipeline cycle at ${id}`);
    const s = byStage.get(id);
    if (!s) throw new Error(`unknown pipeline input ${id}`);
    state.set(id, 1);
    for (const input of s.inputs) visit(input);
    const ref = splitRef(s.module), m = byModule.get(ref.name);
    if (!m?.run || !satisfies(m.manifest.version, ref.range)) throw new Error(`${id}: no compatible compiler module ${s.module}`);
    out.push({ stage: s, module: m, closure: closure(m) });
    state.set(id, 2);
  };
  for (const id of [...byStage.keys()].sort()) visit(id);
  return out;
}
/** Sources and generation are shared; only changed downstream compilers, options or inputs rebuild. */
export async function runPipeline(recipe: Recipe, modules: readonly PipelineModule[], host: Host): Promise<PipelineResult> {
  const planned = plan(recipe, modules);
  const artifacts: Record<string, Artifact> = Object.create(null) as Record<string, Artifact>;
  for (const id of Object.keys(recipe.sources).sort()) artifacts[id] = await checked(recipe.sources[id]!, host, id);
  const records: Array<{ id: string; key: string; reused: boolean; bytes: number }> = [];
  const local = new Map<string, Artifact>();
  for (const { stage, module, closure } of planned) {
    const inputs = stage.inputs.map((id) => artifacts[id]!);
    const identity = canonicalJson({
      schema: PIPELINE_SCHEMA,
      modules: closure.map((m) => ({ id: m.manifest.id, version: m.manifest.version, sha256: m.sha256 })),
      inputs: inputs.map((a) => ({ sha256: a.sha256, mediaType: a.mediaType })), options: stage.options,
    });
    const key = await host.digest(new TextEncoder().encode(identity));
    if (!HEX.test(key)) throw new Error("host did not return SHA-256");
    const hit = local.get(key) ?? await host.cache?.get(key);
    const artifact = hit ? await checked(hit, host, `${stage.id} cache`) : await checked(
      await module.run!(inputs.map(copy), JSON.parse(canonicalJson(stage.options)) as Json), host, stage.id,
    );
    if (!hit) await host.cache?.set(key, copy(artifact));
    local.set(key, copy(artifact)); artifacts[stage.id] = artifact;
    records.push({ id: stage.id, key, reused: !!hit, bytes: artifact.bytes.length });
  }
  return { artifacts, stages: records };
}
