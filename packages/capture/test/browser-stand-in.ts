// Just enough browser for capture in Node: canvases (2D copies, captureStream,
// toBlob), MediaRecorder, requestAnimationFrame, OffscreenCanvas, fetch, <a>
// downloads and object URLs -- each recording what it's asked to do, so the
// TypeScript and the JavaScript capture can be driven the same way and their
// logs compared. install() puts them on globalThis; the returned restore()
// takes them off again.

export type Log = unknown[][];

export interface FakeCanvas {
  width: number;
  height: number;
  /** The picture: RGBA, top row first (what a 2D copy reads). */
  rgba: Uint8ClampedArray;
  name: string;
  getContext(kind: string): unknown;
  toBlob(cb: (b: Blob | null) => void, type?: string): void;
  captureStream(fps?: number): unknown;
}

export function install(log: Log, { supported = ["video/webm;codecs=vp8", "video/webm"] as readonly string[], putOk = (path: string) => path.startsWith("out/") } = {}): { canvas: (name: string, w: number, h: number) => FakeCanvas; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map(["document", "MediaRecorder", "requestAnimationFrame", "OffscreenCanvas", "fetch"].map((k) => [k, g[k]]));
  const savedUrl = URL.createObjectURL;
  let n = 0;
  let urls = 0;

  function canvas(name: string, w: number, h: number): FakeCanvas {
    const c: FakeCanvas = {
      width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4), name,
      getContext(kind) {
        log.push(["getContext", name, kind]);
        const ctx = {
          set imageSmoothingEnabled(v: boolean) { log.push(["imageSmoothingEnabled", name, v]); },
          drawImage(src: FakeCanvas, x: number, y: number, dw?: number, dh?: number) { log.push(["drawImage", name, src.name, x, y, dw, dh, [c.width, c.height]]); },
          getImageData(x: number, y: number, dw: number, dh: number) { log.push(["getImageData", name, x, y, dw, dh]); return { data: c.rgba }; },
        };
        return ctx;
      },
      toBlob(cb, type) { log.push(["toBlob", name, type]); cb(new Blob([`${name} ${c.width}x${c.height}`], { type: type ?? "" })); },
      captureStream(fps) {
        log.push(["captureStream", name, fps]);
        const track = { requestFrame: () => log.push(["requestFrame", name]) };
        return { id: `stream${(n += 1)}`, getVideoTracks: () => [track] };
      },
    };
    return c;
  }

  class MediaRecorder {
    static isTypeSupported(t: string): boolean { log.push(["isTypeSupported", t]); return supported.includes(t); }
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(stream: { id: string }, opts: Record<string, unknown>) { log.push(["MediaRecorder", stream.id, { ...opts }, Object.keys(opts)]); }
    start(ms?: number): void { log.push(["start", ms]); }
    stop(): void {
      log.push(["stop"]);
      this.ondataavailable?.({ data: new Blob([]) });
      this.ondataavailable?.({ data: new Blob(["clip"]) });
      this.onstop?.();
    }
  }
  class OffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) { this.width = width; this.height = height; log.push(["OffscreenCanvas", width, height]); }
    getContext(kind: string) {
      log.push(["offscreen getContext", kind]);
      let src: FakeCanvas | null = null;
      return {
        drawImage(s: FakeCanvas, x: number, y: number) { src = s; log.push(["offscreen drawImage", s.name, x, y]); },
        getImageData(x: number, y: number, w: number, h: number) { log.push(["offscreen getImageData", x, y, w, h]); return { data: src ? src.rgba.slice() : new Uint8ClampedArray(w * h * 4) }; },
      };
    }
  }
  g["document"] = {
    createElement(tag: string) {
      log.push(["createElement", tag]);
      if (tag === "canvas") return canvas(`big${(n += 1)}`, 0, 0);
      return { tag, href: "", download: "", click() { log.push(["click", this.href, this.download]); } };
    },
  };
  g["MediaRecorder"] = MediaRecorder;
  g["requestAnimationFrame"] = (f: () => void) => { log.push(["requestAnimationFrame"]); return setTimeout(f, 4); };
  g["OffscreenCanvas"] = OffscreenCanvas;
  g["fetch"] = async (path: string, init: { method: string; body: Blob }) => {
    log.push(["fetch", path, init.method, init.body.size]);
    if (path.startsWith("offline/")) throw new TypeError("fetch failed");
    return { ok: putOk(path) };
  };
  URL.createObjectURL = (b: Blob) => `blob:${(urls += 1)}:${b.size}`;
  return {
    canvas,
    restore() {
      for (const [k, v] of saved) { if (v === undefined) delete g[k]; else g[k] = v; }
      URL.createObjectURL = savedUrl;
    },
  };
}
