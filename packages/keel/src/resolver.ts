// Resolving the engine by version: which bytes a game or the editor runs, and
// how it knows they're the verified ones. Browser-safe (no Node imports): the
// desktop editor and @keel/game-engine call it with their own chain reader.
//
//   (a) default -- from chain. A version is pinned by one record: the release
//       object (this version's catalog, with every module's deployment filled
//       in) at a KeelHold address and object id, with its sha256. The resolver
//       reads it, checks the digest, then reads each module's object and checks
//       its sha256 against the catalog's output digest -- the digest the
//       module's receipt binds to its readable source.
//   (b) a local checkout (or a clone of keel-web3/keel-engine at a tag) builds
//       through the same pipeline; its digests are compared with the release's:
//       every module is "match" or "mismatch", never silently preferred.
//   (c) the readable source of any module comes from GitHub at the release's
//       commit and the module's path, each file checked against the sha256 the
//       recipe pinned -- and the exact `keel module verify` command that
//       rebuilds the published bytes from it.
//
// Nothing here trusts a label: "verified" is always a digest this code
// computed and compared, against a digest the pin (and so the caller) chose.

import type { EngineCatalog, EngineCatalogEntry } from "./catalog.ts";

export const ENGINE_RELEASE_SCHEMA = "keel-engine-module-catalog@1";

/** One engine version on one chain: where its release record lives, and what it must hash to. */
export interface EngineReleasePin {
  readonly version: string;
  readonly chainId: number;
  /** The KeelHold instance and the object id of the release record (the catalog). */
  readonly hold: string;
  readonly objectId: string;
  /** sha256 of the release record's bytes, 0x-prefixed. */
  readonly digest: string;
}

export interface ObjectRef {
  readonly chainId: number;
  readonly hold: string;
  readonly objectId: string;
}

/**
 * Reads one KeelHold object's decoded bytes. The SDK's readKeelManagedObject
 * (with the caller's RPC ports) is one; a Studio gateway is another. The
 * resolver checks every digest itself, so a reader is trusted for nothing.
 */
export type ObjectReader = (ref: ObjectRef) => Promise<Uint8Array>;

/** A locally built module: from a checkout through the pipeline (packages/keel's buildVerifiedModule). */
export interface LocalModule {
  readonly id: string;
  readonly version: string;
  readonly outputDigest: string;
  readonly bytes?: Uint8Array;
}

export type OnchainStatus = "verified" | "not-deployed" | "mismatch" | "unread";
export type LocalStatus = "match" | "mismatch" | "absent";

export interface ResolvedModule {
  readonly id: string;
  readonly version: string;
  /** The bytes to run: the chain's when they verified, else the local build's when it matched the release. */
  readonly bytes: Uint8Array | null;
  readonly from: "chain" | "local" | "none";
  readonly digest: string;
  readonly onchain: OnchainStatus;
  readonly local: LocalStatus;
  readonly entry: EngineCatalogEntry;
  /** Why a status isn't the good one, in words. */
  readonly notes: readonly string[];
}

export interface ReadableSource {
  readonly repository: string;
  readonly commit: string | null;
  readonly path: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly url: string | null; readonly sha256: string }>;
  /** Rebuilds the published bytes from GitHub and compares (`keel module verify`, @keel/builder). */
  readonly verifyCommand: string | null;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(bytes: Uint8Array): Promise<string> {
  return `0x${hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)))}`;
}

/** Parse and check a release record (a catalog): its schema, and that every entry says what verified means. */
export function parseEngineRelease(value: unknown): EngineCatalog {
  const c = value as EngineCatalog;
  if (c === null || typeof c !== "object" || c.schema !== ENGINE_RELEASE_SCHEMA || typeof c.version !== "string" || !Array.isArray(c.modules) || !Array.isArray(c.order)) {
    throw new TypeError(`Not a KEEL engine release (${ENGINE_RELEASE_SCHEMA}).`);
  }
  for (const m of c.modules) {
    if (typeof m.id !== "string" || typeof m.version !== "string" || !/^0x[0-9a-f]{64}$/.test(m.output?.digest ?? "")) throw new TypeError(`Release entry ${String(m.id)} is malformed.`);
    // (The site's rule: a row claiming verified without a byte-proof disposition is dropped, not believed.)
    if (m.verified && m.disposition !== "reproducible-build" && m.disposition !== "exact-source-output") throw new TypeError(`${m.id} claims verified with disposition ${m.disposition}.`);
  }
  return c;
}

/** (a) The release record for a pinned version, read from chain and checked against the pin's digest. */
export async function loadEngineRelease(pin: EngineReleasePin, read: ObjectReader): Promise<EngineCatalog> {
  const bytes = await read({ chainId: pin.chainId, hold: pin.hold, objectId: pin.objectId });
  const digest = await sha256(bytes);
  if (digest !== pin.digest.toLowerCase()) throw new Error(`Engine release ${pin.version}: the record on chain hashes to ${digest}, not the pinned ${pin.digest}.`);
  const release = parseEngineRelease(JSON.parse(new TextDecoder().decode(bytes)));
  if (release.version !== pin.version) throw new Error(`Engine release pin says ${pin.version}, but the record is ${release.version}.`);
  return release;
}

const refName = (ref: string) => { const i = ref.indexOf("@", 1); return i < 0 ? ref : ref.slice(0, i); };

/** The modules a set of ids needs, all the way down (by id, and every provider of a needed contract), in the release's start order. */
export function releaseClosure(release: EngineCatalog, ids: readonly string[]): EngineCatalogEntry[] {
  const byId = new Map(release.modules.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    const m = byId.get(id);
    if (!m) throw new Error(`The release has no module ${id}.`);
    seen.add(id);
    for (const need of m.needs) {
      if (need.startsWith("contract:")) {
        const c = refName(need.slice("contract:".length));
        for (const p of release.modules) if (p.provides.some((x) => refName(x) === c)) visit(p.id);
      } else visit(refName(need));
    }
  };
  for (const id of ids) visit(id);
  if (byId.has("keel/runtime")) visit("keel/runtime");
  return release.order.filter((id) => seen.has(id)).map((id) => byId.get(id)!);
}

export interface ResolveOptions {
  readonly chainId: number;
  /** Reads module objects from chain; omit to resolve from a local build alone. */
  readonly read?: ObjectReader;
  /**
   * (b) A local build (a checkout or a clone at a tag) to compare against the
   * release. Where the chain's bytes can't be had, a local build whose digest
   * matches the release is used instead: equal digests are the same bytes.
   */
  readonly local?: readonly LocalModule[];
}

/** Resolve modules of a release: bytes from chain (verified), local builds compared, every status spelled out. */
export async function resolveEngineModules(release: EngineCatalog, ids: readonly string[] | "all", options: ResolveOptions): Promise<ResolvedModule[]> {
  const entries = ids === "all" ? release.order.map((id) => release.modules.find((m) => m.id === id)!) : releaseClosure(release, ids);
  const locals = new Map((options.local ?? []).map((l) => [l.id, l]));
  const out: ResolvedModule[] = [];
  for (const entry of entries) {
    const notes: string[] = [];
    const want = entry.output.digest;
    let bytes: Uint8Array | null = null;
    let onchain: OnchainStatus = "not-deployed";
    const deployment = entry.deployments.find((d) => d.chainId === options.chainId && d.version === entry.version && d.status === "current")
      ?? entry.deployments.find((d) => d.chainId === options.chainId && d.version === entry.version);
    if (deployment) {
      if (deployment.outputDigest !== want) { onchain = "mismatch"; notes.push(`deployment record names ${deployment.outputDigest}, the release ${want}`); }
      else if (!options.read) { onchain = "unread"; notes.push("no chain reader given"); }
      else {
        try {
          const got = await options.read({ chainId: options.chainId, hold: deployment.hold.address, objectId: deployment.hold.objectId });
          const digest = await sha256(got);
          if (digest === want) { bytes = got; onchain = "verified"; } else { onchain = "mismatch"; notes.push(`object ${deployment.hold.objectId} hashes to ${digest}`); }
        } catch (e) { onchain = "unread"; notes.push(`read failed: ${e instanceof Error ? e.message : String(e)}`); }
      }
    } else notes.push(`not deployed on chain ${options.chainId}`);
    const l = locals.get(entry.id);
    const local: LocalStatus = !l ? "absent" : l.version === entry.version && l.outputDigest === want ? "match" : "mismatch";
    if (local === "mismatch") notes.push(`local build ${l!.id}@${l!.version} is ${l!.outputDigest}, the release ${want}`);
    let from: ResolvedModule["from"] = bytes ? "chain" : "none";
    // (A local build's bytes are hashed here, not taken on the build's word.)
    if (!bytes && local === "match" && l?.bytes) {
      if ((await sha256(l.bytes)) === want) { bytes = l.bytes; from = "local"; }
      else notes.push(`local bytes for ${entry.id} don't hash to the digest they claim`);
    }
    out.push({ id: entry.id, version: entry.version, bytes, from, digest: want, onchain, local, entry, notes });
  }
  return out;
}

/** (b) Compare a local build with a release, module by module. */
export interface ReleaseComparison {
  readonly id: string;
  readonly version: string;
  readonly release: string | null;
  readonly local: string | null;
  readonly status: LocalStatus | "not-in-release";
}

export function compareToRelease(release: EngineCatalog, local: readonly LocalModule[]): ReleaseComparison[] {
  const byId = new Map(release.modules.map((m) => [m.id, m]));
  const rows: ReleaseComparison[] = local.map((l) => {
    const r = byId.get(l.id);
    return { id: l.id, version: l.version, release: r?.output.digest ?? null, local: l.outputDigest, status: !r ? "not-in-release" : r.version === l.version && r.output.digest === l.outputDigest ? "match" : "mismatch" };
  });
  for (const r of release.modules) if (!local.some((l) => l.id === r.id)) rows.push({ id: r.id, version: r.version, release: r.output.digest, local: null, status: "absent" });
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** "https://github.com/keel-web3/keel-engine" -> ["keel-web3", "keel-engine"]. */
function githubRepo(url: string): [string, string] | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? [m[1]!, m[2]!] : null;
}

/** (c) Where a module's readable source is, file by file, and the command that rebuilds its published bytes from it. */
export function readableSource(release: EngineCatalog, id: string): ReadableSource {
  const entry = release.modules.find((m) => m.id === id);
  if (!entry) throw new Error(`The release has no module ${id}.`);
  const commit = entry.sourceRepository.revision ?? release.revision;
  const gh = githubRepo(entry.sourceRepository.url);
  const files = entry.sourceFiles.map((f) => ({ path: f.path, sha256: f.sha256, url: gh && commit ? `https://raw.githubusercontent.com/${gh[0]}/${gh[1]}/${commit}/${f.path}` : null }));
  const verifyCommand = gh && commit
    ? `keel module verify --repo ${gh[0]}/${gh[1]} --commit ${commit} --path ${entry.sourceRepository.path} --entry keel/entry.ts --format ${entry.build.format}${entry.build.external.length ? ` --external ${entry.build.external.join(",")}` : ""} --expect ${entry.output.digest}`
    : null;
  return { repository: entry.sourceRepository.url, commit, path: entry.sourceRepository.path, files, verifyCommand };
}

/** (c) Fetch a module's readable source from GitHub at the release commit, every file checked against its pinned digest. */
export async function fetchReadableSource(release: EngineCatalog, id: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const src = readableSource(release, id);
  if (!src.commit) throw new Error(`${id}: the release pins no commit, so there is no exact source to fetch.`);
  const out = new Map<string, string>();
  for (const f of src.files) {
    const response = await fetchImpl(f.url!, { redirect: "follow", credentials: "omit" });
    if (!response.ok) throw new Error(`${f.path}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await sha256(bytes);
    if (digest !== f.sha256) throw new Error(`${f.path} at ${src.commit} hashes to ${digest}, not the pinned ${f.sha256}.`);
    out.set(f.path, new TextDecoder().decode(bytes));
  }
  return out;
}
