/** Optional public feed transport. Without a configured source the renderer uses its house ads offline. */
export type AdPlacement = "truck" | "building" | "billboard";
export interface FeedAd {
  id: string; advertiserId?: string; advertiser: string; label: string;
  kind: "image" | "video"; src: string; poster?: string; href?: string;
  placements: AdPlacement[]; durationMs: number;
}
export interface AdFeed { version: 1; items: FeedAd[]; nextCursor: string | null }
export type AdFeedSource = { endpoint: string } | { rpcUrl: string; chainId: number; registry: string };
const MAX_BYTES = 1024 * 1024;
const EMPTY: AdFeed = { version: 1, items: [], nextCursor: null };
const placements = new Set(["truck", "building", "billboard"]);

/** External media is HTTPS; relative media may use the manifest's origin, including local development. */
export function feedUrl(value: unknown, base: string, sameOrigin = true): string | undefined {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)) return undefined;
  try {
    const url = new URL(value, base), origin = new URL(base);
    if (url.username || url.password || url.hash) return undefined;
    if (url.protocol !== "https:" && !(sameOrigin && url.protocol === "http:" && url.origin === origin.origin)) return undefined;
    return url.href;
  } catch { return undefined; }
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function short(value: unknown, max = 200): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }
export function parseAdFeed(value: unknown, base: string): AdFeed {
  const root = record(value);
  if (root?.version !== 1 || !Array.isArray(root.items) || root.items.length > 100) throw new Error("Unsupported ad feed");
  const items: FeedAd[] = [], seen = new Set<string>();
  for (const item of root.items) {
    const ad = record(item);
    if (!ad || !short(ad.id) || seen.has(ad.id) || !short(ad.advertiser) || !short(ad.label) || (ad.kind !== "image" && ad.kind !== "video")) continue;
    const src = feedUrl(ad.src, base), poster = feedUrl(ad.poster, base), href = feedUrl(ad.href, base, false);
    const slots = Array.isArray(ad.placements) ? [...new Set(ad.placements.filter((p): p is AdPlacement => typeof p === "string" && placements.has(p)))] : [];
    if (!src || slots.length === 0 || typeof ad.durationMs !== "number" || !Number.isInteger(ad.durationMs) || ad.durationMs < 1000 || ad.durationMs > 120_000) continue;
    seen.add(ad.id);
    items.push({ id: ad.id, ...(short(ad.advertiserId) ? { advertiserId: ad.advertiserId } : {}), advertiser: ad.advertiser, label: ad.label, kind: ad.kind, src, ...(poster ? { poster } : {}), ...(href ? { href } : {}), placements: slots, durationMs: ad.durationMs });
  }
  return { version: 1, items, nextCursor: typeof root.nextCursor === "string" && /^[A-Za-z0-9_-]{1,256}$/u.test(root.nextCursor) ? root.nextCursor : null };
}
async function json(url: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: "omit", redirect: "error", cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Ad source unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Ad source too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally { await reader.cancel().catch(() => undefined); }
}
async function rpc(url: string, method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
  const reply = record(await json(url, signal, { jsonrpc: "2.0", id: 1, method, params }));
  if (!reply || reply.error || reply.jsonrpc !== "2.0" || reply.id !== 1) throw new Error("Invalid ad RPC response");
  return reply.result;
}
/** Decode the deliberately small, versioned AdFeedRegistry ABI without adding a wallet library to the engine. */
export function decodeAdRegistry(result: unknown): { uri: string; revision: string; enabled: boolean } {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/u.test(result) || result.length < 322 || result.length > 2370 || (result.length - 2) % 64 !== 0) throw new Error("Invalid ad registry data");
  const hex = result.slice(2), word = (i: number): bigint => BigInt(`0x${hex.slice(i * 64, i * 64 + 64)}`);
  if (word(0) !== 1n || word(1) !== 128n || word(2) > 0xffffffffffffffffn || word(3) > 1n || word(4) > 1024n) throw new Error("Unsupported ad registry");
  const length = Number(word(4));
  if (hex.length !== (5 + Math.ceil(length / 32)) * 64) throw new Error("Truncated ad registry");
  const bytes = Uint8Array.from({ length }, (_, i) => parseInt(hex.slice(320 + i * 2, 322 + i * 2), 16));
  return { uri: new TextDecoder("utf-8", { fatal: true }).decode(bytes), revision: word(2).toString(), enabled: word(3) === 1n };
}
export async function resolveAdFeed(source: AdFeedSource, base: string, signal: AbortSignal): Promise<{ endpoint: string; identity: string } | null> {
  if ("endpoint" in source) {
    const endpoint = feedUrl(source.endpoint, base);
    if (!endpoint) throw new Error("Invalid ad endpoint");
    return { endpoint, identity: endpoint };
  }
  const rpcUrl = feedUrl(source.rpcUrl, base);
  if (!rpcUrl || !Number.isSafeInteger(source.chainId) || source.chainId <= 0 || !/^0x[0-9a-fA-F]{40}$/u.test(source.registry) || /^0x0{40}$/u.test(source.registry)) throw new Error("Invalid ad RPC configuration");
  const chain = await rpc(rpcUrl, "eth_chainId", [], signal);
  if (typeof chain !== "string" || !/^0x[0-9a-fA-F]+$/u.test(chain) || BigInt(chain) !== BigInt(source.chainId)) throw new Error("Wrong ad registry chain");
  const entry = decodeAdRegistry(await rpc(rpcUrl, "eth_call", [{ to: source.registry, data: "0x27e4c195" }, "latest"], signal));
  if (!entry.enabled) return null;
  const endpoint = feedUrl(entry.uri, base, false);
  if (!endpoint) throw new Error("Invalid registered ad endpoint");
  return { endpoint, identity: `${source.chainId}:${source.registry.toLowerCase()}:${entry.revision}:${endpoint}` };
}
/** One bounded page per refresh, cycling through all advertisers; errors immediately restore offline house ads. */
export function watchAdFeed(source: AdFeedSource | undefined, onFeed: (feed: AdFeed) => void, base = globalThis.location?.href ?? "https://localhost/"): () => void {
  if (!source) return () => undefined;
  let stopped = false, cursor: string | null = null, identity = "", timer: ReturnType<typeof setTimeout> | undefined;
  let current: AbortController | undefined;
  const refresh = async (): Promise<void> => {
    const controller = new AbortController(); current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const resolved = await resolveAdFeed(source, base, controller.signal);
      if (!resolved) { cursor = null; identity = ""; if (!stopped) onFeed(EMPTY); }
      else {
        if (identity !== resolved.identity) { cursor = null; identity = resolved.identity; }
        const url = new URL(resolved.endpoint); url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor); else url.searchParams.delete("cursor");
        const feed = parseAdFeed(await json(url.href, controller.signal), resolved.endpoint);
        cursor = feed.nextCursor;
        if (!stopped) onFeed(feed);
      }
    } catch { cursor = null; identity = ""; if (!stopped) onFeed(EMPTY); }
    finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(() => void refresh(), 30_000); }
  };
  void refresh();
  return () => { stopped = true; clearTimeout(timer); current?.abort(); };
}
