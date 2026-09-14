// Capture -- ported from the proof of concept's src/capture/capture.js:
// getting pictures out of a running project -- a still, a video, a GIF. All
// of it is optional: a game never needs any of it, and nothing here is loaded
// unless a page asks for it (a KEEL bundle only carries what its entry
// imports). The GIF encoder in particular is loaded on first use, and only
// for GIFs.
//
//   const cap = createCapture(canvas, { renderer: px, step: (dt) => sim.simulate(dt), draw });
//   await cap.png()                                  // the canvas as it is, full colour
//   await cap.video({ seconds: 20 })                 // WebM of whatever plays, as it plays (blown up, crisp)
//   await cap.film({ seconds: 20, fps: 30 })         // WebM stepped frame by frame: the same every time
//   await cap.gif({ seconds: 8, fps: 25 })           // a GIF (up to 255 colours -- pixel art fits)
//   await cap.save(blob, "out/clip.webm")            // PUT to the dev server (scripts/serve.mjs), or a download
//
// Video keeps every colour and every frame the game draws; a GIF is the
// art-piece format (NOCTURNES' loops), handy for sharing a pixel-art clip, and
// refuses a picture with more colours than a GIF table holds rather than
// quietly posterising it.

import type { RGB } from "@keel-engine/core";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Something that hands over the frame's exact pixels: RGBA, bottom row first (@keel-engine/render's read()). */
export interface PixelSource {
  read(): Uint8Array;
}

export interface CaptureOptions {
  /** For exact pixels; without it the canvas is read through a 2D copy. */
  readonly renderer?: PixelSource | null | undefined;
  /** Advance the game by dt seconds without drawing (film and gif step the game themselves). */
  readonly step?: ((dt: number) => void) | null | undefined;
  /** Draw the game's current state. */
  readonly draw?: (() => void) | null | undefined;
}

export interface VideoOptions {
  readonly seconds?: number | undefined;
  readonly fps?: number | undefined;
  /** A MIME type to try first (else VP9, VP8, plain WebM: the first the browser records). */
  readonly type?: string | null | undefined;
  /** The nearest-neighbour blow-up (default: videoScale's; 1 records the canvas as it is). */
  readonly scale?: number | null | undefined;
}

export interface GifOptions {
  readonly seconds?: number | undefined;
  readonly fps?: number | undefined;
  /** The colour table to start from (the clip's own colours are added after it). */
  readonly palette?: readonly (Readonly<RGB> | ArrayLike<number>)[] | null | undefined;
  /** 0 loops forever. */
  readonly loop?: number | undefined;
}

export interface Capture {
  /** The canvas now, as a PNG (full colour, exact size -- scale it up with nearest-neighbour if you want it bigger). */
  png(): Promise<Blob | null>;
  /** Record what plays, as it plays (the game's own loop keeps running). */
  video(options?: VideoOptions): Promise<Blob>;
  /**
   * Film frame by frame at a fixed rate: step, draw, hand the frame over,
   * wait a frame's time (the recorder stamps real time). The same seed films
   * the same clip every time. Pause the game's own loop while it runs.
   */
  film(options?: VideoOptions): Promise<Blob>;
  /**
   * A GIF, stepped at a fixed rate. The colour table is the colours the clip
   * actually uses (or `palette`, if given): up to 255 -- a pixel-art palette
   * fits; a picture with more colours is refused (film it instead).
   */
  gif(options?: GifOptions): Promise<Blob>;
  /** Keep it: PUT to a dev server path (the dev server takes PUTs into out/), or offer it as a download. */
  save(blob: Blob, path: string, options?: { readonly put?: boolean | undefined }): Promise<string>;
}

// ---------------------------------------------------------------- pure helpers

/** A frame read bottom row first (GL's readPixels) as top row first (every image format's order). */
export function flipRows(from: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) out.set(from.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  return out;
}

/**
 * How much video blows a picture up (nearest-neighbour) before encoding.
 * (Video codecs halve colour resolution: at 128 px that smears pixel art. So
 * video records a copy blown up -- 4x for small pictures, never past ~1080 --
 * where every pixel is a crisp block.)
 */
export const videoScale = (width: number, height: number, scale: number | null = null): number => scale ?? Math.max(1, Math.min(8, Math.floor(1080 / Math.max(width, height))));

/** The recorder's MIME type: `type` if the browser records it, else VP9, VP8, plain WebM (undefined: none). */
export const pickMime = (type: string | null, supported: (t: string) => boolean): string | undefined =>
  [type, "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t): t is string => !!t && supported(t));

/** The GIF's colour table as it grows: frames of RGBA in, palette indices out; past 255 colours it throws. */
export interface GifIndexer {
  readonly colours: RGB[];
  index(rgba: ArrayLike<number>, pixels: number): Uint8Array;
}

export function gifIndexer(palette: GifOptions["palette"] = null): GifIndexer {
  const index = new Map<number, number>();
  const colours: RGB[] = [];
  if (palette) palette.forEach((c) => { const k = ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0); if (!index.has(k)) { index.set(k, colours.length); colours.push([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0]); } });
  return {
    colours,
    index(rgba, pixels) {
      const out = new Uint8Array(pixels);
      for (let i = 0; i < pixels; i += 1) {
        const r = rgba[i * 4] ?? 0;
        const g = rgba[i * 4 + 1] ?? 0;
        const b = rgba[i * 4 + 2] ?? 0;
        const k = (r << 16) | (g << 8) | b;
        let n = index.get(k);
        if (n === undefined) {
          if (colours.length >= 255) throw new RangeError("More colours than a GIF holds (255 and a see-through slot): film() it instead.");
          n = colours.length; index.set(k, n); colours.push([r, g, b]);
        }
        out[i] = n;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- capture

export function createCapture(canvas: HTMLCanvasElement, { renderer = null, step = null, draw = null }: CaptureOptions = {}): Capture {
  const needFixed = (what: string): { step: (dt: number) => void; draw: () => void } => {
    if (!step || !draw) throw new Error(`${what} steps the game itself: createCapture needs step(dt) and draw().`);
    return { step, draw };
  };

  // The picture's pixels, top row first, RGBA.
  function pixels(): { W: number; H: number; rgba: Uint8ClampedArray } {
    const W = canvas.width;
    const H = canvas.height;
    if (renderer?.read) return { W, H, rgba: flipRows(renderer.read(), W, H) };
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
    g.drawImage(canvas, 0, 0);
    return { W, H, rgba: g.getImageData(0, 0, W, H).data };
  }

  // A copy of the canvas blown up with nearest-neighbour (or the canvas itself at 1x), and how to refresh it.
  function blownUp(scale: number | null): { target: HTMLCanvasElement; copy: () => void } {
    const k = videoScale(canvas.width, canvas.height, scale);
    if (k === 1) return { target: canvas, copy: () => {} };
    const big = document.createElement("canvas");
    big.width = canvas.width * k;
    big.height = canvas.height * k;
    const g = big.getContext("2d") as CanvasRenderingContext2D;
    const copy = (): void => { g.imageSmoothingEnabled = false; g.drawImage(canvas, 0, 0, big.width, big.height); };
    copy();
    return { target: big, copy };
  }

  function recorder(stream: MediaStream, type: string | null): { rec: MediaRecorder; done: Promise<Blob> } {
    const mime = pickMime(type, (t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 } as MediaRecorderOptions);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((r) => { rec.onstop = () => r(new Blob(chunks, { type: mime } as BlobPropertyBag)); });
    return { rec, done };
  }

  return {
    async png() {
      draw?.();
      return new Promise((r) => canvas.toBlob(r, "image/png"));
    },

    async video({ seconds = 10, fps = 60, type = null, scale = null } = {}) {
      const { target, copy } = blownUp(scale);
      let on = true;
      const pump = (): void => { if (!on) return; copy(); requestAnimationFrame(pump); };
      pump();
      const { rec, done } = recorder(target.captureStream(fps), type);
      rec.start(250);
      await sleep(seconds * 1000);
      on = false;
      rec.stop();
      return done;
    },

    async film({ seconds = 10, fps = 30, type = null, scale = null } = {}) {
      const game = needFixed("film");
      const { target, copy } = blownUp(scale);
      const stream = target.captureStream(0);
      const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      const { rec, done } = recorder(stream, type);
      rec.start();
      for (let f = 0; f < Math.round(seconds * fps); f += 1) {
        game.step(1 / fps);
        game.draw();
        copy();
        track.requestFrame();
        await sleep(1000 / fps);
      }
      rec.stop();
      return done;
    },

    async gif({ seconds = 8, fps = 25, palette = null, loop = 0 } = {}) {
      const game = needFixed("gif");
      const { encodeGif } = await import("@keel-engine/core"); // (loaded on first use, and only for GIFs)
      const table = gifIndexer(palette);
      const frames: { pixels: Uint8Array; delay: number }[] = [];
      let W = 0;
      let H = 0;
      for (let f = 0; f < Math.round(seconds * fps); f += 1) {
        game.step(1 / fps);
        game.draw();
        const p = pixels();
        W = p.W; H = p.H;
        frames.push({ pixels: table.index(p.rgba, W * H), delay: Math.round(100 / fps) });
      }
      return new Blob([encodeGif({ width: W, height: H, palette: table.colours, frames, loop }) as Uint8Array<ArrayBuffer>], { type: "image/gif" });
    },

    async save(blob, path, { put = true } = {}) {
      if (put) {
        const r = await fetch(path, { method: "PUT", body: blob }).catch(() => null);
        if (r?.ok) return path;
      }
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: path.split("/").pop() ?? "" });
      a.click();
      return a.download;
    },
  };
}
