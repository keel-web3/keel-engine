// The publish dry run for the engine's verified modules: what publishing a
// version to a chain would write, how big it is, and roughly what it costs --
// computed from the verified bytes alone. No key, no RPC, no transaction:
// every number here is a model (the SDK's own chunker and calldata model, and
// the KeelHold storage cost measured in docs/STORAGE.md), not a gas quote.
//
// Each module is one KeelHold object: its bytes, gzip'd (so a browser reads
// them back with DecompressionStream, no decoder module needed), cut into
// carriers of at most 23,000 bytes, cast three per `castSlugs` transaction,
// then welded into one object by `weldObject`. The catalog of a version (the
// release record the resolver starts from) is one more object, written last.

import { gzipSync } from "node:zlib";
import type { VerifiedModule } from "./pipeline.ts";

/** KeelHold's carrier limit (castSlug accepts at most this many bytes). */
export const CARRIER_BYTES = 23_000;
/** castSlugs publishes at most this many carriers per transaction. */
export const CARRIERS_PER_CAST = 3;
/**
 * Storage gas per carrier byte: docs/STORAGE.md measures the full-size worst
 * case, three 23,000-byte carriers in one castSlugs, at 14,181,827 gas.
 */
export const GAS_PER_CARRIER_BYTE = 14_181_827 / (3 * 23_000);
/** Intrinsic gas of any transaction. */
export const TX_BASE_GAS = 21_000;
/** A modelled allowance for weldObject: one record write plus the slug-id list (an estimate, not a measurement). */
export const WELD_BASE_GAS = 90_000;
export const WELD_GAS_PER_CARRIER = 25_000;

export interface ModulePublication {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly outputDigest: string;
  readonly receiptDigest: string;
  readonly bytes: number;
  /** gzip -9 of the bytes: what KeelHold stores. */
  readonly stored: number;
  readonly carriers: number;
  readonly castTransactions: number;
  readonly transactions: number;
  /** Modelled gas: castSlugs storage + intrinsic costs + weldObject. */
  readonly gas: number;
}

export interface PublishPlan {
  readonly schema: "keel-engine-publish-plan@1";
  readonly status: "dry-run";
  readonly signing: "not-performed";
  readonly submission: "not-performed";
  readonly chainId: number;
  readonly modules: readonly ModulePublication[];
  readonly totals: { readonly bytes: number; readonly stored: number; readonly carriers: number; readonly transactions: number; readonly gas: number };
  /** Cost at a few gas prices, in ETH (Sepolia ETH on Sepolia). */
  readonly costAt: ReadonlyArray<{ readonly gwei: number; readonly eth: number }>;
  readonly caveat: string;
}

export function publicationOf(id: string, version: string, name: string, outputDigest: string, receiptDigest: string, bytes: Uint8Array): ModulePublication {
  const stored = gzipSync(bytes, { level: 9 }).byteLength;
  const carriers = Math.max(1, Math.ceil(stored / CARRIER_BYTES));
  const castTransactions = Math.ceil(carriers / CARRIERS_PER_CAST);
  const gas = Math.round(stored * GAS_PER_CARRIER_BYTE + castTransactions * TX_BASE_GAS + TX_BASE_GAS + WELD_BASE_GAS + carriers * WELD_GAS_PER_CARRIER);
  return { id, version, name, outputDigest, receiptDigest, bytes: bytes.byteLength, stored, carriers, castTransactions, transactions: castTransactions + 1, gas };
}

export async function publishPlan(verified: readonly VerifiedModule[], { chainId = 11155111, catalog }: { chainId?: number; catalog?: Uint8Array } = {}): Promise<PublishPlan> {
  const modules = verified.map((v) => publicationOf(v.id, v.version, v.name, v.outputDigest, v.receiptDigest, v.bytes));
  if (catalog) modules.push(publicationOf("catalog", "release", "catalog.json", "", "", catalog));
  const sum = (k: "bytes" | "stored" | "carriers" | "transactions" | "gas") => modules.reduce((s, m) => s + m[k], 0);
  const gas = sum("gas");
  return {
    schema: "keel-engine-publish-plan@1",
    status: "dry-run",
    signing: "not-performed",
    submission: "not-performed",
    chainId,
    modules,
    totals: { bytes: sum("bytes"), stored: sum("stored"), carriers: sum("carriers"), transactions: sum("transactions"), gas },
    costAt: [0.5, 2, 10].map((gwei) => ({ gwei, eth: Number(((gas * gwei) / 1e9).toFixed(6)) })),
    caveat: "Modelled from the verified bytes: gzip -9 stored size, 23,000-byte carriers, three per castSlugs, one weldObject per module, and the KeelHold storage cost measured in keel-sdk docs/STORAGE.md. Not a gas quote; `keel module plan` writes the reviewable operations and a wallet-approved adapter simulates them.",
  };
}

export function publishPlanText(plan: PublishPlan): string {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const rows = plan.modules.map((m) => `  ${m.id.padEnd(18)} ${kb(m.bytes).padStart(9)} ${kb(m.stored).padStart(9)} ${String(m.carriers).padStart(3)} carriers ${String(m.transactions).padStart(3)} tx ${(m.gas / 1e6).toFixed(2).padStart(7)} Mgas`);
  const t = plan.totals;
  return [
    `Publish dry run, chain ${plan.chainId} (${plan.status}; signing ${plan.signing}; submission ${plan.submission}):`,
    ...rows,
    `  ${"total".padEnd(18)} ${kb(t.bytes).padStart(9)} ${kb(t.stored).padStart(9)} ${String(t.carriers).padStart(3)} carriers ${String(t.transactions).padStart(3)} tx ${(t.gas / 1e6).toFixed(2).padStart(7)} Mgas`,
    `  cost: ${plan.costAt.map((c) => `${c.eth} ETH at ${c.gwei} gwei`).join(", ")}`,
  ].join("\n");
}
