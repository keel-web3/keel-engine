// Baking off the main thread. A game's own code is started again in a Web
// Worker, with an OffscreenCanvas and the pixel renderer of its own; the page
// sends it jobs a batch at a time and gets baked sprites back (their texels in
// one transferred buffer a batch), and uploads them into its atlas a few at a
// time between frames. Where workers can't start (no OffscreenCanvas, no
// WebGL2 in a worker, a page that forbids them), there are none, and the game
// bakes on the main thread in slices of its spare frame time.
//
// How the game's code gets into a worker, with nothing for the game to write:
//   - in a KEEL document every engine module is a classic <script> the shell
//     put in the page (textContent: its code); the worker gets those scripts,
//     then starts KEEL_ENGINE and calls the game module's worker entry. (As
//     NOCTURNES does: the same bundle, started again as a worker from a blob.)
//   - on a plain page, the game's ES module (its import.meta.url) is imported
//     by a module worker, and its worker entry called.
//
//   // the game's module:
//   export function bakeWorker() { serveBakes({ renderer: (c) => createPixelRenderer(c), sources: (p) => sourcesFor(p) }); }
//   // the page:
//   const pool = createBakeWorkers({ entry: { module: "examples/army", run: "bakeWorker", url: import.meta.url }, payload: { seed } });

import { renderSprites } from "./bake.ts";
import type { BakedSprite, BakeSources, BakeSpriteOptions } from "./bake.ts";
import { renderIndexedSprites } from "./indexed.ts";
import type { IndexedBakeRenderer, IndexedSources } from "./indexed.ts";
import type { SpriteJob } from "./plan.ts";

/** What a slice of jobs is drawn from: indexed designs (shapes), and plain ones (colours baked in). */
export interface SliceSources {
  readonly indexed?: IndexedSources;
  readonly plain?: BakeSources;
}

const now = (): number => (globalThis.performance ? performance.now() : Date.now());
const has = (src: IndexedSources | BakeSources | undefined, key: string): boolean => !!src && (typeof src === "function" ? src(key) !== undefined : src.has(key));

/**
 * Bake a slice of jobs, whichever kind each is: indexed designs through renderIndexedSprites, plain ones through
 * renderSprites (a plain job's style string, when it's JSON, is its renderer style). What the main thread and a
 * worker both do.
 */
export function bakeSlice(renderer: IndexedBakeRenderer, jobs: readonly SpriteJob[], sources: SliceSources, options: { readonly staging?: number; readonly heights?: boolean } = {}): { baked: BakedSprite[]; ms: number } {
  const t0 = now();
  const baked: BakedSprite[] = [];
  const indexed = jobs.filter((j) => has(sources.indexed, j.design));
  const plain = jobs.filter((j) => !has(sources.indexed, j.design) && has(sources.plain, j.design));
  // (A big slice gathers into a big staging texture: fewer read-backs, each a wait for the GPU.)
  const staging = options.staging ?? (jobs.length > 200 ? 2048 : 1024);
  // (Depth sprites: indexed designs carry a height plane when asked -- indexed.ts.)
  if (indexed.length) baked.push(...renderIndexedSprites(renderer, indexed, sources.indexed!, { staging, heights: !!options.heights }).baked);
  // (Plain jobs by style: each style is its own renderer setup.)
  const byStyle = new Map<string, SpriteJob[]>();
  for (const j of plain) (byStyle.get(j.style) ?? byStyle.set(j.style, []).get(j.style)!).push(j);
  for (const [style, list] of byStyle) {
    let parsed: BakeSpriteOptions["style"];
    if (style.startsWith("{")) { try { parsed = JSON.parse(style) as BakeSpriteOptions["style"]; } catch { /* a key, not a style */ } }
    baked.push(...renderSprites(renderer, list, sources.plain!, { staging, heights: !!options.heights, ...(parsed ? { style: parsed } : {}) }).baked);
  }
  return { baked, ms: now() - t0 };
}

// ---------------------------------------------------------------- the worker's side

/** A canvas the worker's renderer draws on (an OffscreenCanvas). */
export type WorkerCanvas = OffscreenCanvas;

export interface ServeBakesOptions {
  /** The worker's renderer, on the canvas given (createPixelRenderer from @keel-engine/render). */
  readonly renderer: (canvas: WorkerCanvas) => IndexedBakeRenderer;
  /** The designs, from what the page sent (the same seed makes the same designs, key for key). */
  readonly sources: (payload: unknown) => SliceSources | Promise<SliceSources>;
  /** Depth sprites: bake indexed designs with their height planes (indexed.ts). */
  readonly heights?: boolean;
}

const bootCanvas = (): OffscreenCanvas | undefined => (globalThis as { __KEEL_BAKE_CANVAS__?: OffscreenCanvas }).__KEEL_BAKE_CANVAS__;

interface WorkerScope { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null }

/** In a worker: bake what the page sends. (Call it from the game module's worker entry.) */
export function serveBakes({ renderer, sources, heights = false }: ServeBakesOptions): void {
  const scope = globalThis as unknown as WorkerScope;
  let px: IndexedBakeRenderer | null = null;
  let src: SliceSources | null = null;
  const queue: Array<{ id: number; jobs: SpriteJob[] }> = [];
  let pumping = false;
  const channel = new MessageChannel();
  // (A batch at a time, a message hop between them: a cancel that arrives meanwhile is read before the next batch.)
  const pump = () => {
    const b = queue.shift();
    if (!b) { pumping = false; return; }
    try {
      if (!src) throw new Error("A bake before init.");
      px ??= renderer(bootCanvas() ?? new OffscreenCanvas(64, 64));
      const { baked, ms } = bakeSlice(px, b.jobs, src, { heights });
      const total = baked.reduce((n, s) => n + s.rgba.byteLength + (s.heights?.byteLength ?? 0), 0);
      const buffer = new ArrayBuffer(total);
      const bytes = new Uint8Array(buffer);
      // ([key, w, h, ax, ay, texels at, heights at (-1: none)].)
      const table: Array<[string, number, number, number, number, number, number]> = [];
      let o = 0;
      for (const s of baked) {
        bytes.set(s.rgba, o);
        const at = o;
        o += s.rgba.byteLength;
        let ht = -1;
        if (s.heights) { bytes.set(s.heights, o); ht = o; o += s.heights.byteLength; }
        table.push([s.key, s.w, s.h, s.ax, s.ay, at, ht]);
      }
      scope.postMessage({ type: "baked", id: b.id, table, buffer, ms }, [buffer]);
    } catch (e) {
      scope.postMessage({ type: "error", id: b.id, message: String((e as Error)?.stack ?? e) });
    }
    channel.port2.postMessage(0);
  };
  channel.port1.onmessage = pump;
  const kick = () => { if (!pumping) { pumping = true; channel.port2.postMessage(0); } };
  const handle = (data: unknown) => {
    const m = data as { type?: string; id?: number; payload?: unknown; jobs?: SpriteJob[]; ids?: number[] } | null;
    if (!m) return;
    if (m.type === "ping") { scope.postMessage({ type: "pong" }); return; }
    if (m.type === "init") {
      const t0 = now();
      // (The renderer first -- its programs compile in the GPU process while the designs are built here.)
      px ??= renderer(bootCanvas() ?? new OffscreenCanvas(64, 64));
      const tc = now();
      // (And its bake programs, with an empty picture: the first real batch doesn't wait for a compile.)
      px.setTarget(16, 16); px.setWorld({}); px.renderIndexed({ eye: [0, 1, 8], target: [0, 1, 0], fov: 0.5 });
      const t1 = now();
      (globalThis as { __KEEL_BAKE_CTX__?: number }).__KEEL_BAKE_CTX__ = tc - t0;
      Promise.resolve(sources(m.payload)).then((s) => {
        src = s;
        scope.postMessage({ type: "ready", id: m.id, ms: now() - t0, rendererMs: t1 - t0, contextMs: (globalThis as { __KEEL_BAKE_CTX__?: number }).__KEEL_BAKE_CTX__, sourcesMs: now() - t1, since: now() - (globalThis as { __KEEL_BAKE_T0__?: number }).__KEEL_BAKE_T0__! });
      }, (err: unknown) => scope.postMessage({ type: "error", id: m.id, message: String((err as Error)?.stack ?? err) }));
      return;
    }
    if (m.type === "bake" && m.jobs && m.id !== undefined) { queue.push({ id: m.id, jobs: m.jobs }); kick(); return; }
    if (m.type === "cancel" && m.ids) {
      for (const id of m.ids) { const i = queue.findIndex((b) => b.id === id); if (i >= 0) { queue.splice(i, 1); scope.postMessage({ type: "cancelled", id }); } }
    }
  };
  scope.onmessage = (e: MessageEvent) => handle(e.data);
  scope.postMessage({ type: "boot" }); // (the game's code is in: the page can get on with its own)
  // (What arrived while the game's code was still loading: the bootstrap kept it.)
  const early = (globalThis as { __KEEL_BAKE_QUEUE__?: unknown[] }).__KEEL_BAKE_QUEUE__;
  if (early) for (const m of early.splice(0)) handle(m);
}

// (The worker's first lines: keep messages that arrive before the game's code has loaded and served.)
// (And its GL context, made at once. A worker's context -- and on a plain page its module import -- need a word with
// the page's main thread, which a game's loading can keep busy for a while: serveBakes says "boot" once both are done,
// and the page can hold its heavy work until then.)
const BOOT = "self.__KEEL_BAKE_T0__=performance.now();self.__KEEL_BAKE_QUEUE__=[];self.onmessage=function(e){self.__KEEL_BAKE_QUEUE__.push(e.data);};"
  + "try{self.__KEEL_BAKE_CANVAS__=new OffscreenCanvas(64,64);self.__KEEL_BAKE_CANVAS__.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});}catch(e){}"
  + "\n";

// ---------------------------------------------------------------- the page's side

/** Where the game's worker entry is: its KEEL module id and export (in a KEEL document), its ES module URL (a plain page). */
export interface BakeWorkerEntry {
  readonly module: string;
  readonly run: string;
  readonly url?: string | undefined;
}

/**
 * The source that starts a game's worker entry in a worker, and how to start it: in a KEEL document, every engine
 * module's script from the page, then the engine started and the entry called (a classic worker); on a plain page
 * an import of the game's module (a module worker). Null where neither is there.
 */
export function bakeWorkerSource(entry: BakeWorkerEntry): { source: string; type: "classic" | "module"; mode: "keel" | "module" } | null {
  const doc = (globalThis as { document?: Document }).document;
  const engine = (globalThis as { KEEL_ENGINE?: unknown }).KEEL_ENGINE;
  if (doc && engine) {
    // (Only the engine's module scripts -- each is one wrapper function that defines itself on KEEL_ENGINE -- never the
    // shell's loader, which carries every module's source as text and a page to put it in.)
    const scripts = Array.from(doc.scripts).map((s) => s.textContent ?? "").filter((t) => t.trimStart().startsWith('(function(){"use strict";') && t.includes("KEEL_ENGINE") && (t.includes("__keelRuntime") || t.includes("__keel.define(")));
    if (scripts.length) {
      const start = `;(async function(){var E=globalThis.KEEL_ENGINE;await E.start();var m=E.get(${JSON.stringify(entry.module)});if(!m||typeof m[${JSON.stringify(entry.run)}]!=="function")throw new Error(${JSON.stringify(`${entry.module} has no ${entry.run}`)});m[${JSON.stringify(entry.run)}]();})().catch(function(e){postMessage({type:"error",message:String(e&&e.stack||e)});});\n`;
      return { source: `${BOOT}${scripts.join("\n;\n")}\n${start}`, type: "classic", mode: "keel" };
    }
  }
  if (entry.url && /^(https?|file|blob):/.test(entry.url)) {
    return { source: `${BOOT}import(${JSON.stringify(entry.url)}).then(function(m){m[${JSON.stringify(entry.run)}]();}).catch(function(e){postMessage({type:"error",message:String(e&&e.stack||e)});});\n`, type: "module", mode: "module" };
  }
  return null;
}

export interface BakeWorkersOptions {
  readonly entry: BakeWorkerEntry;
  /** What the worker's sources are built from (serveBakes' `sources` gets it). */
  readonly payload: unknown;
  /** Workers (default 1: baking is GPU-bound -- a second worker's context competes for the same GPU; 0: none). */
  readonly count?: number;
  /** How long a worker may take to be ready before it's given up on (ms; default 15000). */
  readonly timeout?: number;
  /** Batches a worker holds at once (default 2: one baking, one waiting -- the order stays fresh). */
  readonly depth?: number;
}

export interface WorkerBatch<J extends SpriteJob = SpriteJob> { readonly id: number; readonly jobs: readonly J[]; readonly worker: number; readonly sent: number }

export interface BakeWorkers<J extends SpriteJob = SpriteJob> {
  /** "keel": started from the KEEL document's module scripts; "module": from the game's ES module; "none". */
  readonly mode: "keel" | "module" | "none";
  /** Workers started, and ready to bake. */
  readonly size: number;
  readonly ready: number;
  /** Why the workers aren't there, if they aren't. */
  readonly failure: string | null;
  /** When each worker was ready (ms after it was spawned), and what its own setup took (designs + renderer, ms). */
  readonly readyMs: readonly number[];
  readonly setupMs: readonly number[];
  /** Each worker's setup, in parts: its renderer, its designs, and all of it since the worker's first line (ms). */
  readonly setupParts: ReadonlyArray<{ readonly context: number; readonly renderer: number; readonly sources: number; readonly sinceBoot: number }>;
  /** Settles when every worker has started and made its GL context (or given up): start heavy page work after it. */
  readonly booted: Promise<void>;
  /** Settles when the first worker is ready to bake (or none can be). */
  readonly whenReady: Promise<void>;
  /** Room for another batch (a ready worker holding fewer than `depth`)? */
  free(): number;
  /** Send a batch to the least busy ready worker; false if none has room (`force`: past its depth -- a head start while the page is busy). */
  send(jobs: readonly J[], force?: boolean): boolean;
  /** Batches out now. */
  readonly batches: readonly WorkerBatch<J>[];
  /** Ask the workers to drop batches not started yet (those whose jobs `drop` says so). */
  cancel(drop: (batch: WorkerBatch<J>) => boolean): void;
  /** A batch came back: its jobs and their sprites (by key). */
  onBaked: ((jobs: readonly J[], sprites: readonly BakedSprite[], ms: number) => void) | null;
  /** Jobs that came back unbaked (cancelled, or the worker failed). */
  onReturned: ((jobs: readonly J[]) => void) | null;
  /** A new payload (a new population): every worker rebuilds its designs. */
  reinit(payload: unknown): void;
  /** Worker ms a sprite (smoothed). */
  readonly msPerSprite: number;
  terminate(): void;
}

/** Start the game's code as bake workers (see the top of this file). Never throws: no workers is a mode. */
export function createBakeWorkers<J extends SpriteJob = SpriteJob>(options: BakeWorkersOptions): BakeWorkers<J> {
  const { entry, timeout = 15000, depth = 2 } = options;
  const cores = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 4;
  // (One by default: baking is GPU-bound, and two contexts on one GPU bake slower than one -- measured on the army.)
  const count = options.count ?? (cores >= 2 ? 1 : 0);
  interface W { w: Worker; ready: boolean; dead: boolean; out: Map<number, WorkerBatch<J>>; spawned: number; initId: number }
  const workers: W[] = [];
  let mode: "keel" | "module" | "none" = "none";
  let failure: string | null = null;
  let nextId = 1;
  let msPerSprite = 0.3;
  const readyMs: number[] = [], setupMs: number[] = [], setupParts: Array<{ context: number; renderer: number; sources: number; sinceBoot: number }> = [];
  let payload = options.payload;
  let boots = 0, bootDone: () => void = () => {};
  const booted = new Promise<void>((r) => { bootDone = r; });
  const booting = () => { boots += 1; if (boots >= workers.length) bootDone(); };
  let readyDone: () => void = () => {};
  const whenReady = new Promise<void>((r) => { readyDone = r; });
  void booted.then(() => { if (!workers.some((w) => !w.dead)) readyDone(); });
  const api: BakeWorkers<J> = {
    booted, whenReady,
    get mode() { return mode; },
    get size() { return workers.filter((w) => !w.dead).length; },
    get ready() { return workers.filter((w) => w.ready && !w.dead).length; },
    get failure() { return failure; },
    readyMs, setupMs, setupParts,
    free() { return workers.reduce((n, w) => n + (w.ready && !w.dead ? Math.max(0, depth - w.out.size) : 0), 0); },
    send(jobs, force = false) {
      let best: W | null = null;
      for (const w of workers) if (w.ready && !w.dead && (force || w.out.size < depth) && (!best || w.out.size < best.out.size)) best = w;
      if (!best || !jobs.length) return false;
      const b: WorkerBatch<J> = { id: nextId++, jobs, worker: workers.indexOf(best), sent: now() };
      best.out.set(b.id, b);
      best.w.postMessage({ type: "bake", id: b.id, jobs: jobs.map(plainJob) });
      return true;
    },
    get batches() { return workers.flatMap((w) => [...w.out.values()]); },
    cancel(drop) {
      for (const w of workers) {
        // (The oldest batch is likely baking already: only the ones waiting behind it can go.)
        const waiting = [...w.out.values()].slice(1).filter(drop).map((b) => b.id);
        if (waiting.length) w.w.postMessage({ type: "cancel", ids: waiting });
      }
    },
    onBaked: null,
    onReturned: null,
    reinit(p) {
      payload = p;
      for (const w of workers) if (!w.dead) { w.ready = false; w.initId = nextId++; w.w.postMessage({ type: "init", id: w.initId, payload }); }
    },
    get msPerSprite() { return msPerSprite; },
    terminate() { for (const w of workers) { w.w.terminate(); w.dead = true; } },
  };
  const fail = (w: W, why: string) => {
    if (w.dead) return;
    w.dead = true; w.ready = false;
    try { w.w.terminate(); } catch { /* gone */ }
    const lost = [...w.out.values()].flatMap((b) => b.jobs);
    w.out.clear();
    if (lost.length) api.onReturned?.(lost);
    if (!workers.some((x) => !x.dead)) { failure = why; mode = "none"; readyDone(); }
    booting();
  };
  if (count <= 0) { failure = "no workers asked for"; bootDone(); return api; }
  const src = typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" ? null : bakeWorkerSource(entry);
  if (!src) { bootDone(); failure = typeof Worker === "undefined" ? "no Worker here" : typeof OffscreenCanvas === "undefined" ? "no OffscreenCanvas here" : "no worker entry found"; return api; }
  let url: string;
  try { url = URL.createObjectURL(new Blob([src.source], { type: "text/javascript" })); } catch (e) { failure = `no blob URLs: ${String(e)}`; bootDone(); return api; }
  mode = src.mode;
  for (let i = 0; i < count; i += 1) {
    let w: Worker;
    try { w = new Worker(url, { type: src.type }); } catch (e) { failure = `a worker wouldn't start: ${String(e)}`; break; }
    const rec: W = { w, ready: false, dead: false, out: new Map(), spawned: now(), initId: nextId++ };
    workers.push(rec);
    const timer = setTimeout(() => { if (!rec.ready) fail(rec, "a worker didn't get ready in time"); }, timeout);
    w.onerror = (e) => { e.preventDefault?.(); fail(rec, `worker error: ${e.message}`); };
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id?: number; ms?: number; table?: Array<[string, number, number, number, number, number, number?]>; buffer?: ArrayBuffer; message?: string };
      if (m.type === "pong") return;
      if (m.type === "boot") { booting(); return; }
      if (m.type === "ready") { if (m.id === rec.initId) { rec.ready = true; readyDone(); readyMs.push(now() - rec.spawned); setupMs.push(m.ms ?? 0); setupParts.push({ context: Math.round((m as { contextMs?: number }).contextMs ?? 0), renderer: Math.round((m as { rendererMs?: number }).rendererMs ?? 0), sources: Math.round((m as { sourcesMs?: number }).sourcesMs ?? 0), sinceBoot: Math.round((m as { since?: number }).since ?? 0) }); clearTimeout(timer); } return; }
      const b = m.id !== undefined ? rec.out.get(m.id) : undefined;
      if (m.type === "baked" && b && m.table && m.buffer) {
        rec.out.delete(b.id);
        const buf = m.buffer;
        const sprites: BakedSprite[] = m.table.map(([key, bw, bh, ax, ay, o, ht]) => (ht !== undefined && ht >= 0 ? { key, w: bw, h: bh, ax, ay, rgba: new Uint8Array(buf, o, bw * bh * 4), heights: new Uint8Array(buf, ht, bw * bh * 2) } : { key, w: bw, h: bh, ax, ay, rgba: new Uint8Array(buf, o, bw * bh * 4) }));
        if (b.jobs.length) msPerSprite = msPerSprite * 0.7 + ((m.ms ?? 0) / b.jobs.length) * 0.3;
        api.onBaked?.(b.jobs, sprites, m.ms ?? 0);
        return;
      }
      if (m.type === "cancelled" && b) { rec.out.delete(b.id); api.onReturned?.(b.jobs); return; }
      if (m.type === "error") {
        if (b) { rec.out.delete(b.id); api.onReturned?.(b.jobs); }
        if (!rec.ready) fail(rec, `worker error: ${m.message ?? "?"}`);
        else failure = `worker error: ${m.message ?? "?"}`;
      }
    };
    w.postMessage({ type: "init", id: rec.initId, payload });
  }
  if (!workers.length) { mode = "none"; bootDone(); }
  return api;
}

// (A job as plain data for postMessage: a stream job's own fields ride along.)
const plainJob = (j: SpriteJob): SpriteJob => ({ ...j });
