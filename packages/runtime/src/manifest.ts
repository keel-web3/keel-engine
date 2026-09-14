// Engine manifests: what a module is, what it needs and what it provides.
// KEEL stores the bytes and orders the slots; this is the engine's own
// contract on top (KEEL's `kind` is only a label and it namespaces nothing but
// descriptor ids), carried beside every module as `keel-engine-module@1`.

import { parseVersion, splitRef } from "./semver.ts";

export const MANIFEST_SCHEMA = "keel-engine-module@1";

/** runtime: an engine part · pack: entities, attributes, props, fx, sounds · system / ai: behaviour · game / map: what's played. */
export type ModuleKind = "runtime" | "pack" | "system" | "ai" | "game" | "map";
export const MODULE_KINDS: readonly ModuleKind[] = ["runtime", "pack", "system", "ai", "game", "map"];

/** KEEL's slot phases, in the order they run. */
export type Phase = "data" | "runtime" | "render";

/** A pack's table of contents: what's inside, readable without running it. */
export interface Contents {
  readonly entities?: readonly ContentEntry[];
  readonly attributes?: readonly ContentEntry[];
  readonly objects?: readonly ContentEntry[];
  readonly fx?: readonly ContentEntry[];
  readonly sounds?: readonly ContentEntry[];
  /** The bit-codec schemas its data is written with (@keel-engine/codec), so a tool reads its documents without running it. */
  readonly schemas?: readonly SchemaEntry[];
}
/** A schema a module declares: its name, its id, and (optionally) the schema itself. */
export interface SchemaEntry {
  /** "name@version" ("keel/object@1"). */
  readonly id: string;
  /** The schema id: SHA-256 of its canonical bytes, 64 hex digits (a document's header carries the first 8). */
  readonly hash: string;
  /** The schema's own bytes (codec encodeSchema), base64url: present, a tool needs nothing else to decode its documents. */
  readonly schema?: string;
}
export interface ContentEntry {
  readonly id: string;
  /** Entities: the body contract they provide ("quadruped@1"). Attributes: their slot ("head"). */
  readonly body?: string;
  readonly slot?: string;
  readonly tags?: readonly string[];
}

export interface ModuleManifest {
  readonly schema: typeof MANIFEST_SCHEMA;
  /** Namespaced: "keel/render", "packs/animals", "ai/herd", "games/rts". */
  readonly id: string;
  /** Exact semver: KEEL pins every module to one version. */
  readonly version: string;
  readonly kind: ModuleKind;
  /**
   * What it needs: other modules by "id@range" ("keel/entity@^1"), and
   * contracts by "contract:name@range" ("contract:body/quadruped@1") -- any
   * module providing that contract will do.
   */
  readonly needs: readonly string[];
  /** Contracts it provides ("body/quadruped@1.2.0", "ai/animal@1.0.0"). Always exact versions. */
  readonly provides: readonly string[];
  /** Other packs whose entities its attributes may fit (and vice versa), "id@range". */
  readonly compatible: readonly string[];
  readonly phase: Phase;
  /** Order within a phase: lower first (KEEL's slot weight). */
  readonly weight: number;
  readonly contents?: Contents;
  readonly title?: string;
  readonly description?: string;
}

export type ManifestInput = Omit<ModuleManifest, "schema" | "needs" | "provides" | "compatible" | "phase" | "weight"> &
  Partial<Pick<ModuleManifest, "needs" | "provides" | "compatible" | "phase" | "weight">>;

const ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/;
const DEFAULT_PHASE: Record<ModuleKind, Phase> = { runtime: "runtime", pack: "runtime", system: "runtime", ai: "runtime", game: "render", map: "data" };
// (Engine parts before packs before behaviour before games: dependencies sit lower.)
const DEFAULT_WEIGHT: Record<ModuleKind, number> = { runtime: -1000, pack: -500, system: -300, ai: -300, map: -100, game: 0 };

/** A manifest with its defaults filled in and every field checked; throws with the reason. */
export function defineManifest(input: ManifestInput): ModuleManifest {
  const bad = (why: string): never => { throw new TypeError(`Module ${input.id ?? "(no id)"}: ${why}`); };
  if (!ID.test(input.id)) bad(`id must be namespaced, lower-case: "packs/animals", "keel/render" (got "${input.id}").`);
  try { parseVersion(input.version); } catch { bad(`version must be exact semver (got "${input.version}").`); }
  if (input.version.split(".").length !== 3) bad(`version must be exact semver major.minor.patch (got "${input.version}").`);
  if (!MODULE_KINDS.includes(input.kind)) bad(`kind must be one of ${MODULE_KINDS.join(", ")}.`);
  const needs = [...(input.needs ?? [])];
  for (const n of needs) { const { name } = splitRef(n.replace(/^contract:/, "")); if (!name) bad(`need "${n}" names nothing.`); }
  const provides = [...(input.provides ?? [])];
  for (const p of provides) {
    const { name, range } = splitRef(p);
    if (!name.includes("/")) bad(`contract "${p}" must be namespaced ("body/quadruped@1.0.0").`);
    try { if (range.split(".").length !== 3) throw new Error(); parseVersion(range); } catch { bad(`contract "${p}" must carry an exact version.`); }
  }
  if (input.id === undefined) bad("no id.");
  return Object.freeze({
    schema: MANIFEST_SCHEMA,
    ...input,
    needs: Object.freeze(needs),
    provides: Object.freeze(provides),
    compatible: Object.freeze([...(input.compatible ?? [])]),
    phase: input.phase ?? DEFAULT_PHASE[input.kind],
    weight: input.weight ?? DEFAULT_WEIGHT[input.kind],
  });
}
