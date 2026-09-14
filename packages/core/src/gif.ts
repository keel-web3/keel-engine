// GIF89a writer -- ported from the proof of concept's src/core/gif.js
// (NOCTURNES' gif.js, plus the engine's opt-in colour tables past 32);
// test/*-equality.test.ts proves the bytes identical. An optional export: the
// engine's pictures are palette indices, and nothing a game uses is held to a
// GIF's limits -- this is for when a piece is exported as a GIF.
//
// Two decisions here are the whole reason an animated GIF is affordable
// on chain:
//
//   1. ONE GLOBAL COLOUR TABLE of 32 entries (5-bit codes). Index 31 is
//      reserved and never painted -- it is the transparent index. (A palette
//      of more than 32 colours gets a bigger table, up to 256, with its last
//      slot kept free as the transparent index.)
//   2. DELTA FRAMES. Every frame after the first is clipped to the bounding
//      box of the pixels that actually changed, and pixels inside that box
//      that did NOT change are written as the transparent index with disposal
//      method 1 (leave the canvas alone). A typewriter frame that adds one 5x7
//      glyph therefore costs a ~7x9 image, not a 128x128 one.
//
// Consecutive identical frames are merged into one frame with a longer delay,
// so a held pose is free. The Solidity twin walks this exact byte order.

export const PALETTE_SIZE = 32;
export const TRANSPARENT = 31;
const GCT_BITS = 5; // 2^5 = 32 entries
const MIN_CODE_SIZE = GCT_BITS; // 5

/** One frame: palette indices over the whole canvas, and how long it shows (centiseconds, min 2). */
export interface GifFrame {
  readonly pixels: ArrayLike<number>;
  readonly delay: number;
}

export interface GifSpec {
  readonly width: number;
  readonly height: number;
  /** [r, g, b] bytes per index; 32 entries (or fewer) as ever, up to 256 when asked for. */
  readonly palette: ReadonlyArray<ArrayLike<number> | null | undefined>;
  /** Any iterable: frames are consumed one at a time. */
  readonly frames: Iterable<GifFrame>;
  /** NETSCAPE loop count (0 = forever). */
  readonly loop?: number;
  /** Drop the loop block: play once. */
  readonly once?: boolean;
}

class Sink {
  bytes: number[] = [];
  u8(value: number): void { this.bytes.push(value & 0xff); }
  u16(value: number): void { this.bytes.push(value & 0xff, (value >> 8) & 0xff); } // GIF is little-endian
  ascii(text: string): void { for (let at = 0; at < text.length; at += 1) this.bytes.push(text.charCodeAt(at) & 0xff); }
  raw(list: Iterable<number>): void { for (const value of list) this.bytes.push(value & 0xff); }
  take(): Uint8Array { return Uint8Array.from(this.bytes); }
}

/**
 * LZW as GIF specifies it: variable-width codes packed least-significant-bit
 * first, a clear code at the start, a full-table reset at 4096.
 */
// The dictionary as a flat table rather than a Map. A key is
// (prefix << 5) | pixel: prefixes run to 4095 and pixels to 31 with a five-bit
// minimum code size, so the whole key space is 17 bits and fits one 512 KB
// Int32Array that is allocated once for the process and cleared per reset.
// This is also the shape the Solidity twin wants -- a fixed array, not a
// mapping with a hashed slot per entry.
const DICT = new Int32Array(1 << 17).fill(-1);
const DICT_TOUCHED = new Int32Array(1 << 12);
// (A bigger colour table -- the engine's palettes run past 32 -- takes a wider key and its own table, made when first asked for.)
const WIDE = new Map<number, Int32Array>();
const dictFor = (bits: number): Int32Array => {
  if (bits === MIN_CODE_SIZE) return DICT;
  let d = WIDE.get(bits);
  if (!d) { d = new Int32Array(1 << (12 + bits)).fill(-1); WIDE.set(bits, d); }
  return d;
};

function lzw(indices: ArrayLike<number>, sink: Sink, minCodeSize = GCT_BITS): void {
  const dict = dictFor(minCodeSize);
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const packed: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  // Only the keys actually written are cleared, so a reset costs the size of
  // the dictionary rather than the size of the key space.
  let touched = 0;
  const forget = (): void => {
    for (let at = 0; at < touched; at += 1) dict[DICT_TOUCHED[at]!] = -1;
    touched = 0;
  };

  const emit = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      packed.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  let run = indices[0]!;
  for (let at = 1; at < indices.length; at += 1) {
    const next = indices[at]!;
    const key = (run << minCodeSize) | next;
    const found = dict[key]!;
    if (found >= 0) { run = found; continue; }
    emit(run);
    if (nextCode === 4096) {
      emit(clearCode);
      forget();
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (nextCode >= (1 << codeSize)) codeSize += 1;
      dict[key] = nextCode;
      DICT_TOUCHED[touched++] = key;
      nextCode += 1;
    }
    run = next;
  }
  emit(run);
  emit(eoiCode);
  if (bitCount > 0) packed.push(bitBuffer & 0xff);
  forget();

  sink.u8(minCodeSize);
  for (let at = 0; at < packed.length; at += 255) {
    const block = packed.slice(at, at + 255);
    sink.u8(block.length);
    sink.raw(block);
  }
  sink.u8(0x00); // block terminator
}

interface Box { left: number; top: number; width: number; height: number }

/** Bounding box of the pixels that differ between two full-canvas buffers. */
function changedBox(previous: ArrayLike<number>, current: ArrayLike<number>, width: number, height: number): Box | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (previous[row + x] === current[row + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function writeFrame(sink: Sink, { pixels, box, delay, transparent }: { pixels: ArrayLike<number>; box: Box; delay: number; transparent: boolean }, bits = GCT_BITS): void {
  sink.u8(0x21); sink.u8(0xf9); sink.u8(0x04);            // graphic control extension
  sink.u8((1 << 2) | (transparent ? 1 : 0));              // disposal 1 = leave in place
  sink.u16(delay);                                        // centiseconds
  sink.u8(transparent ? (1 << bits) - 1 : 0);
  sink.u8(0x00);
  sink.u8(0x2c);                                          // image descriptor
  sink.u16(box.left); sink.u16(box.top);
  sink.u16(box.width); sink.u16(box.height);
  sink.u8(0x00);                                          // no local table, no interlace
  lzw(pixels, sink, bits);
}

/** A complete GIF89a file. */
export function encodeGif(spec: GifSpec): Uint8Array {
  const steps = encodeGifSteps(spec);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The same encoder as a generator: it yields once per written frame (the
 * count so far) and returns the bytes, so a page can encode between
 * animation frames without a stall. `frames` may be any iterable -- frames
 * are consumed one at a time. The bytes are identical to encodeGif's.
 */
export function* encodeGifSteps({ width, height, palette, frames, loop = 0, once = false }: GifSpec): Generator<number, Uint8Array, void> {
  // (32 entries, five bits, as NOCTURNES has always written -- more only when the palette needs them, up to 256.)
  const bits = Math.max(GCT_BITS, Math.ceil(Math.log2(Math.max(2, palette.length + (palette.length > PALETTE_SIZE ? 1 : 0)))));
  if (bits > 8) throw new RangeError("The colour table holds 256 entries at most.");
  const size = 1 << bits;
  const clear = size - 1; // (the see-through index: 31 at 32 entries, as ever; past that, the one slot left free)

  // Frames are written as soon as the next one differs (identical neighbours
  // become one frame with a longer delay), into a body that follows the
  // header; the header's loop block depends on whether more than one frame
  // survived, which is known only at the end.
  const body = new Sink();
  const full: Box = { left: 0, top: 0, width, height };
  let canvas: ArrayLike<number> | null = null;
  let written = 0;
  let pending: { pixels: ArrayLike<number>; delay: number } | null = null;
  const flush = (p: { pixels: ArrayLike<number>; delay: number }): void => {
    if (!canvas) {
      // Frame one is the whole canvas and fully opaque: it is also what the
      // loop restarts into, so it has to be able to overwrite the final frame.
      writeFrame(body, { pixels: p.pixels, box: full, delay: Math.max(2, p.delay), transparent: false }, bits);
    } else {
      const box = changedBox(canvas, p.pixels, width, height) ?? full;
      const patch = new Uint8Array(box.width * box.height);
      for (let y = 0; y < box.height; y += 1) {
        const source = (box.top + y) * width + box.left;
        const target = y * box.width;
        for (let x = 0; x < box.width; x += 1) {
          const value = p.pixels[source + x]!;
          patch[target + x] = value === canvas[source + x] ? clear : value;
        }
      }
      writeFrame(body, { pixels: patch, box, delay: Math.max(2, p.delay), transparent: true }, bits);
    }
    canvas = p.pixels;
    written += 1;
  };
  for (const frame of frames) {
    if (pending && sameCanvas(pending.pixels, frame.pixels)) { pending.delay += frame.delay; continue; }
    if (pending) { flush(pending); yield written; }
    pending = { pixels: frame.pixels, delay: frame.delay };
  }
  if (!pending) throw new RangeError("A GIF needs at least one frame.");
  flush(pending);

  const sink = new Sink();
  sink.ascii("GIF89a");
  sink.u16(width); sink.u16(height);
  sink.u8(0x80 | ((bits - 1) << 4) | (bits - 1)); // global table present, 2^bits entries
  sink.u8(0x00); // background index
  sink.u8(0x00); // pixel aspect ratio
  for (let slot = 0; slot < size; slot += 1) {
    const colour = palette[slot] ?? [0, 0, 0];
    sink.raw([colour[0]!, colour[1]!, colour[2]!]);
  }
  if (written > 1 && !once) {
    sink.u8(0x21); sink.u8(0xff); sink.u8(0x0b);
    sink.ascii("NETSCAPE2.0");
    sink.u8(0x03); sink.u8(0x01); sink.u16(loop); sink.u8(0x00);
  }
  const head = sink.take();
  const tail = body.take();
  const out = new Uint8Array(head.length + tail.length + 1);
  out.set(head, 0);
  out.set(tail, head.length);
  out[out.length - 1] = 0x3b; // trailer
  return out;
}

function sameCanvas(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let at = 0; at < a.length; at += 1) if (a[at] !== b[at]) return false;
  return true;
}
