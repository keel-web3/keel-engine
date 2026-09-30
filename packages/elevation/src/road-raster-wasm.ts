// Optional, import-free browser WASM for the nearest-cell reduction. Everything
// here finishes before gradeCorridor writes terrain, so any failure can use JS.
import type { HeightGrid } from "./grid.ts";
import { NEAREST_RASTER_BYTES } from "./nearest-raster-bytes.ts";

const MAX_CELLS = 1 << 18;
const MAX_POINTS = 1 << 16;
const PAGE_BYTES = 65536;
const MAX_LINEAR_BYTES = 152 * PAGE_BYTES; // Matches the module's declared maximum.

interface RasterModule {
  readonly memory: { readonly buffer: ArrayBuffer; grow(pages: number): number };
  readonly raster: (...args: number[]) => number;
}
export interface RasterBorrow {
  readonly count: number;
  readonly d: Float64Array;
  readonly y: Float64Array;
  readonly local: Int32Array;
  readonly global: Float64Array;
  release(): void;
}

const browserModule = (): RasterModule => {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(NEAREST_RASTER_BYTES));
  return instance.exports as unknown as RasterModule;
};

/** A factory makes absence, compilation, growth and kernel failure testable without changing the game API. */
export function createRoadRasterAccelerator(instantiate: (() => RasterModule) | null =
  typeof WebAssembly === "undefined" ? null : browserModule) {
  let module: RasterModule | null = null;
  let disabled = false, busy = false, epoch = 0, previousCells = 0;
  let attempts = 0, wasmCalls = 0, failures = 0;
  return {
    mayUse(): boolean { return instantiate !== null && !disabled; },
    snapshot() {
      return { available: instantiate !== null, disabled, initialized: module !== null,
        busy, attempts, wasmCalls, failures, linearBytes: module?.memory.buffer.byteLength ?? 0 };
    },
    borrow(g: HeightGrid, px: ArrayLike<number>, pz: ArrayLike<number>, profile: ArrayLike<number>,
      reach: number, wi0: number, wj0: number, ww: number, wh: number): RasterBorrow | null {
      const cells = ww * wh, m = px.length;
      if (busy || disabled || !instantiate || !Number.isSafeInteger(cells) || cells < 1 || cells > MAX_CELLS ||
          !Number.isSafeInteger(m) || m < 1 || m > MAX_POINTS || pz.length !== m || profile.length !== m ||
          !Number.isInteger(g.w) || !Number.isInteger(g.h) || g.w < 1 || g.h < 1 ||
          g.w > 0x7fffffff || g.h > 0x7fffffff || !Number.isSafeInteger(g.w * g.h) ||
          !Number.isFinite(g.x0) || !Number.isFinite(g.z0) || !Number.isFinite(g.cell) || g.cell <= 0 ||
          !Number.isFinite(reach) || reach < 0 ||
          Math.abs(g.x0) > 1e6 || Math.abs(g.z0) > 1e6 || g.cell < 0.01 || g.cell > 1e6 || reach > 1e6 ||
          !Number.isInteger(wi0) || !Number.isInteger(wj0) || !Number.isInteger(ww) || !Number.isInteger(wh) ||
          wi0 < 0 || wj0 < 0 || ww < 1 || wh < 1 || wi0 + ww > g.w || wj0 + wh > g.h) return null;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let n = 0; n < m; n += 1) {
        if (!Number.isFinite(px[n]) || !Number.isFinite(pz[n]) || !Number.isFinite(profile[n]) ||
            Math.abs(px[n]!) > 1e6 || Math.abs(pz[n]!) > 1e6 ||
            Math.abs(profile[n]!) > Number.MAX_VALUE / 4) return null;
        minX = Math.min(minX, px[n]!); maxX = Math.max(maxX, px[n]!);
        minZ = Math.min(minZ, pz[n]!); maxZ = Math.max(maxZ, pz[n]!);
      }
      // The trusted kernel's per-segment scan must fit the caller's all-point
      // window. Validate this once before any WASM work; every segment bound
      // is then a subset, so its local slot and global grid index are valid.
      const i0 = Math.max(0, Math.floor((minX - reach - g.x0) / g.cell));
      const i1 = Math.min(g.w - 1, Math.ceil((maxX + reach - g.x0) / g.cell));
      const j0 = Math.max(0, Math.floor((minZ - reach - g.z0) / g.cell));
      const j1 = Math.min(g.h - 1, Math.ceil((maxZ + reach - g.z0) / g.cell));
      if (wi0 > i0 || wi0 + ww - 1 < i1 || wj0 > j0 || wj0 + wh - 1 < j1) return null;
      busy = true;
      attempts += 1;
      try {
        module ??= instantiate();
        const { memory, raster } = module;
        if (!memory || typeof raster !== "function") throw Error("Missing road raster exports");
        const seenAt = 0, dAt = Math.ceil(cells * 4 / 8) * 8, yAt = dAt + cells * 8;
        const localAt = yAt + cells * 8, globalAt = Math.ceil((localAt + cells * 4) / 8) * 8;
        const pxAt = globalAt + cells * 8, pzAt = pxAt + m * 8, profileAt = pzAt + m * 8;
        const bytes = profileAt + m * 8;
        if (bytes > MAX_LINEAR_BYTES) { busy = false; return null; }
        if (memory.buffer.byteLength < bytes) memory.grow(Math.ceil((bytes - memory.buffer.byteLength) / PAGE_BYTES));
        const buffer = memory.buffer;
        if (buffer.byteLength < bytes || buffer.byteLength > MAX_LINEAR_BYTES) throw Error("Road raster memory outside cap");
        const seen = new Uint32Array(buffer, seenAt, cells);
        epoch = (epoch + 1) >>> 0;
        // Changing layout moves d/y/local/global across the old seen region.
        if (previousCells !== cells || epoch === 0) { seen.fill(0); epoch = 1; }
        previousCells = cells;
        new Float64Array(buffer, pxAt, m).set(px);
        new Float64Array(buffer, pzAt, m).set(pz);
        new Float64Array(buffer, profileAt, m).set(profile);
        const count = raster(m, pxAt, pzAt, profileAt, g.x0, g.z0, g.cell, g.w, g.h, reach,
          wi0, wj0, ww, cells, seenAt, dAt, yAt, localAt, globalAt, epoch);
        if (!Number.isInteger(count) || count < 0 || count > cells) throw Error("Invalid road raster count");
        const d = new Float64Array(buffer, dAt, cells), y = new Float64Array(buffer, yAt, cells);
        const local = new Int32Array(buffer, localAt, cells), global = new Float64Array(buffer, globalAt, cells);
        wasmCalls += 1;
        let released = false;
        return { count, d, y, local, global, release() { if (!released) { busy = false; released = true; } } };
      } catch {
        // A failed optional accelerator must not repeatedly compile or trap.
        failures += 1;
        disabled = true;
        module = null;
        return null;
      } finally {
        // A successful borrow stays exclusive until release by gradeCorridor.
        if (disabled || !module) busy = false;
      }
    },
  };
}

export const roadRasterAccelerator = createRoadRasterAccelerator();
