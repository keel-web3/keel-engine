// The textures / shadow-map parity scripts: what to do to r180's WebGLTextures
// and WebGLShadowMap and to keel/lit's createTextures and createShadowMap, and
// what to record. The fixture generator (outside this repo, where Three lives:
// make-gl-textures-fixtures.mjs) runs each script on r180 under KEEL's names
// and keeps the log; gl-textures.test.ts runs the same script on ours and wants
// the same log.
//
// The log is one list, in call order: the GL calls (test/gl-stand-in.ts, real
// enum values), and the calls these modules make into their neighbours, which
// a recording stand-in takes here ("state.bindTexture", "renderer.setRenderTarget",
// "objects.update"...): WebGLState and the renderer are other modules' parity,
// so the boundary is what's held to r180. Extensions, capabilities, utils,
// properties and info are the real ones on both sides (r180's there, src/gl's here).
//
// Constants cross through `lib.k` (a KEEL string in, the lib's own value out)
// and `lib.n` (a lib value out, as r180's number).

import { standIn } from "./gl-stand-in.ts";
import type { Call, StandIn } from "./gl-stand-in.ts";

import type * as K from "../src/index.ts";
import type { R180Table } from "../src/index.ts";

type Any = any;

/** The classes and factories under test: ours, or r180's under the same names. */
export type Lib = typeof K & {
  k(table: R180Table | "colorSpace", value: string): never;
  n(table: R180Table | "colorSpace", value: unknown): unknown;
  createExtensions(gl: WebGL2RenderingContext): Any;
  createUtils(gl: WebGL2RenderingContext, extensions: Any): Any;
  createCapabilities(gl: WebGL2RenderingContext, extensions: Any, parameters: Any, utils: Any): Any;
  createProperties(): Any;
  createInfo(gl: WebGL2RenderingContext): Any;
  createTextures(gl: WebGL2RenderingContext, extensions: Any, state: Any, properties: Any, capabilities: Any, utils: Any, info: Any): Any;
  createShadowMap(renderer: Any, objects: Any, capabilities: Any): Any;
};

// ---- the log

let _calls: Call[] = [];

// (as the stand-in snapshots: typed arrays copied, GL objects -- and the fake
// images, which carry an id -- by id, undefined spelled out)
function snap(v: unknown): unknown {
  if (v === undefined) return "<undefined>";
  if (typeof v === "function") return "<function>";
  if (v === null || typeof v !== "object") return v;
  if (ArrayBuffer.isView(v)) return { [v.constructor.name]: Array.from(v as unknown as ArrayLike<number>) };
  if (Array.isArray(v)) return v.map(snap);
  const id = (v as { id?: unknown }).id;
  if (typeof id === "string") return `#${id}`;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snap(x)]));
}

function rec(name: string, ...args: unknown[]): void {
  _calls.push([name, ...args.map(snap)]);
}

// ---- fake images (Node has no DOM): r180 and ours branch on these by instanceof

let _images = 0;

class FakeImageBitmap {
  id: string;
  width: number;
  height: number;
  constructor(name: string, width: number, height: number) {
    this.id = `bitmap:${name}`;
    this.width = width;
    this.height = height;
  }
}

class FakeHTMLImageElement {
  id: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  complete: boolean;
  constructor(name: string, width: number, height: number, natural: [number, number], complete: boolean) {
    this.id = `img:${name}`;
    this.width = width;
    this.height = height;
    this.naturalWidth = natural[0];
    this.naturalHeight = natural[1];
    this.complete = complete;
  }
}

class FakeHTMLCanvasElement {
  id: string;
  width: number;
  height: number;
  constructor(name: string, width: number, height: number) {
    this.id = `canvas:${name}`;
    this.width = width;
    this.height = height;
  }
  getContext(): unknown {
    return null;
  }
}

class FakeOffscreenCanvas {
  id: string;
  _w: number;
  _h: number;
  constructor(width: number, height: number) {
    this.id = `offscreen${(_images += 1)}`;
    this._w = width;
    this._h = height;
    rec("new OffscreenCanvas", width, height);
  }
  get width(): number { return this._w; }
  set width(v: number) { this._w = v; rec(`${this.id}.width=`, v); }
  get height(): number { return this._h; }
  set height(v: number) { this._h = v; rec(`${this.id}.height=`, v); }
  getContext(kind: string): unknown {
    const id = this.id;
    return kind === "2d" ? { drawImage: (...a: unknown[]) => rec(`${id}.drawImage`, ...a) } : null;
  }
}

/** Puts the fake DOM classes on globalThis (once; both sides call it before anything runs). */
export function installFakeDom(): void {
  const g = globalThis as Record<string, unknown>;
  g["ImageBitmap"] = FakeImageBitmap;
  g["HTMLImageElement"] = FakeHTMLImageElement;
  g["HTMLCanvasElement"] = FakeHTMLCanvasElement;
  g["OffscreenCanvas"] = FakeOffscreenCanvas;
  // (r180's Source.getSize tests `instanceof VideoFrame`: a class nothing is an instance of)
  if (typeof g["VideoFrame"] === "undefined") g["VideoFrame"] = class VideoFrame {};
}

// ---- the neighbours, recording

function fakeState(lib: Lib, reversedDepth = false): Any {
  return {
    bindTexture: (...a: unknown[]) => rec("state.bindTexture", ...a),
    unbindTexture: (...a: unknown[]) => rec("state.unbindTexture", ...a),
    activeTexture: (...a: unknown[]) => rec("state.activeTexture", ...a),
    bindFramebuffer: (...a: unknown[]) => { rec("state.bindFramebuffer", ...a); return true; },
    texImage2D: (...a: unknown[]) => rec("state.texImage2D", ...a),
    texSubImage2D: (...a: unknown[]) => rec("state.texSubImage2D", ...a),
    texStorage2D: (...a: unknown[]) => rec("state.texStorage2D", ...a),
    setBlending: (b: unknown) => rec("state.setBlending", lib.n("blending", b)),
    setScissorTest: (t: unknown) => rec("state.setScissorTest", t),
    viewport: (v: Any) => rec("state.viewport", [v.x, v.y, v.z, v.w]),
    buffers: {
      color: { setClear: (...a: unknown[]) => rec("state.buffers.color.setClear", ...a) },
      depth: { setTest: (t: unknown) => rec("state.buffers.depth.setTest", t), getReversed: () => reversedDepth },
    },
  };
}

export interface TexturesHarness {
  stand: StandIn;
  textures: Any;
  info: Any;
  properties: Any;
}

/** A context and r180's renderer's init order (extensions.init, utils, capabilities, info, properties), then the textures. */
function texturesHarness(lib: Lib, options: { extensions?: readonly string[]; parameters?: Record<number, unknown> } = {}): TexturesHarness {
  const stand = standIn({ ...(options.extensions ? { extensions: options.extensions } : {}), ...(options.parameters ? { parameters: options.parameters } : {}) });
  _calls = stand.calls;
  _images = 0;
  const gl = stand.gl;
  const extensions = lib.createExtensions(gl);
  extensions.init();
  const utils = lib.createUtils(gl, extensions);
  const capabilities = lib.createCapabilities(gl, extensions, {}, utils);
  const state = fakeState(lib);
  const info = lib.createInfo(gl);
  const properties = lib.createProperties();
  // (from here on is the textures' own)
  stand.calls.length = 0;
  const textures = lib.createTextures(gl, extensions, state, properties, capabilities, utils, info);
  return { stand, textures, info, properties };
}

// ---- builders

const k = (lib: Lib, table: R180Table | "colorSpace", v: string): never => lib.k(table, v);

function rgba(n: number, seed: number): Uint8Array {
  const a = new Uint8Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = (i * 29 + seed * 7) & 255;
  return a;
}

function floats(n: number, seed: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < a.length; i++) a[i] = ((i * 13 + seed) % 17) / 16;
  return a;
}

function halves(n: number, seed: number): Uint16Array {
  const a = new Uint16Array(n);
  for (let i = 0; i < a.length; i++) a[i] = 0x3c00 + ((i * 97 + seed) & 0x3ff);
  return a;
}

const memory = (h: TexturesHarness): void => rec("info.memory.textures", h.info.memory.textures);

// ---- the textures scripts

export const textureCases: Record<string, (lib: Lib) => Call[]> = {
  "data rgba u8: upload, bind, update, dispose"(lib) {
    const h = texturesHarness(lib);
    const t = new lib.DataTexture(rgba(4, 1), 2, 2);
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 0);
    h.textures.setTexture2D(t, 1);
    (t.image.data as Uint8Array)[0] = 7;
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 2);
    memory(h);
    t.dispose();
    memory(h);
    t.dispose();
    return h.stand.calls;
  },

  "data red u8, nearest, alignment 1"(lib) {
    const h = texturesHarness(lib);
    const t = new lib.DataTexture(new Uint8Array([1, 2, 3, 4, 5, 6]), 3, 2, k(lib, "pixelFormat", "red"), k(lib, "textureType", "u8"));
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 3);
    memory(h);
    return h.stand.calls;
  },

  "data rgba float, linear, with and without float linear"(lib) {
    const out: Call[] = [];
    for (const extensions of [undefined, ["EXT_color_buffer_float", "EXT_texture_filter_anisotropic"]]) {
      const h = texturesHarness(lib, extensions ? { extensions } : {});
      const t = new lib.DataTexture(floats(16, 2), 2, 2, k(lib, "pixelFormat", "rgba"), k(lib, "textureType", "float"));
      t.magFilter = k(lib, "filter", "linear");
      t.minFilter = k(lib, "filter", "linear-mipmap-linear");
      t.anisotropy = 4;
      t.needsUpdate = true;
      h.textures.setTexture2D(t, 0);
      out.push(...h.stand.calls, ["--"]);
    }
    return out;
  },

  "data red half and rgba half, generated mipmaps"(lib) {
    const h = texturesHarness(lib);
    const a = new lib.DataTexture(halves(16, 3), 4, 4, k(lib, "pixelFormat", "red"), k(lib, "textureType", "half"));
    a.needsUpdate = true;
    h.textures.setTexture2D(a, 0);
    const b = new lib.DataTexture(halves(64, 4), 4, 4, k(lib, "pixelFormat", "rgba"), k(lib, "textureType", "half"), undefined,
      k(lib, "wrapping", "repeat"), k(lib, "wrapping", "mirror"), k(lib, "filter", "linear"), k(lib, "filter", "linear-mipmap-nearest"));
    b.generateMipmaps = true;
    b.needsUpdate = true;
    h.textures.setTexture2D(b, 1);
    memory(h);
    return h.stand.calls;
  },

  "data update ranges"(lib) {
    const h = texturesHarness(lib);
    const t = new lib.DataTexture(rgba(16, 5), 4, 4);
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 0);
    t.addUpdateRange(20, 4);
    t.addUpdateRange(0, 8);
    t.addUpdateRange(8, 4);
    t.addUpdateRange(12, 8); // (spills into the next row: not merged)
    t.addUpdateRange(40, 8);
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 0);
    rec("updateRanges", t.updateRanges.length);
    return h.stand.calls;
  },

  "data user mipmaps"(lib) {
    const h = texturesHarness(lib);
    const t = new lib.DataTexture(rgba(16, 6), 4, 4);
    t.mipmaps = [{ data: rgba(16, 6), width: 4, height: 4 }, { data: rgba(4, 7), width: 2, height: 2 }, { data: rgba(1, 8), width: 1, height: 1 }] as Any;
    t.minFilter = k(lib, "filter", "nearest-mipmap-nearest");
    t.generateMipmaps = true;
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 0);
    rec("generateMipmaps", t.generateMipmaps);
    return h.stand.calls;
  },

  "canvas texture: srgb, mipmaps, anisotropy"(lib) {
    const h = texturesHarness(lib);
    const canvas = new FakeHTMLCanvasElement("leaf", 8, 8);
    const t = new lib.CanvasTexture(canvas as Any);
    t.colorSpace = k(lib, "colorSpace", "srgb");
    t.anisotropy = 8;
    t.premultiplyAlpha = true;
    h.textures.setTexture2D(t, 0);
    h.textures.setTexture2D(t, 0);
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 4);
    // (a magFilter of nearest skips anisotropy)
    const u = new lib.CanvasTexture(new FakeHTMLCanvasElement("bark", 6, 3) as Any, undefined, k(lib, "wrapping", "repeat"), k(lib, "wrapping", "repeat"), k(lib, "filter", "nearest"));
    u.anisotropy = 8;
    h.textures.setTexture2D(u, 5);
    memory(h);
    return h.stand.calls;
  },

  "canvas texture: no mipmaps, linear colour space, unpack flip off"(lib) {
    const h = texturesHarness(lib);
    const t = new lib.CanvasTexture(new FakeHTMLCanvasElement("sky", 5, 7) as Any);
    t.generateMipmaps = false;
    t.minFilter = k(lib, "filter", "linear");
    t.flipY = false;
    t.colorSpace = k(lib, "colorSpace", "linear");
    t.unpackAlignment = 2;
    h.textures.setTexture2D(t, 0);
    return h.stand.calls;
  },

  "image bitmap and image element; incomplete image waits"(lib) {
    const h = texturesHarness(lib);
    const bitmap = new FakeImageBitmap("petal", 16, 8);
    const a = new lib.Texture(bitmap as Any);
    a.needsUpdate = true;
    h.textures.setTexture2D(a, 0);
    const img = new FakeHTMLImageElement("moss", 0, 0, [32, 16], false);
    const b = new lib.Texture(img as Any);
    b.needsUpdate = true;
    h.textures.setTexture2D(b, 1);
    img.complete = true;
    h.textures.setTexture2D(b, 1);
    const empty = new lib.Texture();
    empty.needsUpdate = true;
    h.textures.setTexture2D(empty, 2);
    memory(h);
    return h.stand.calls;
  },

  "too big: resized through a canvas"(lib) {
    const h = texturesHarness(lib, { parameters: { 0x0d33: 64 } }); // (MAX_TEXTURE_SIZE)
    const a = new lib.Texture(new FakeImageBitmap("huge", 256, 128) as Any);
    a.needsUpdate = true;
    h.textures.setTexture2D(a, 0);
    const b = new lib.Texture(new FakeHTMLCanvasElement("tall", 50, 200) as Any);
    b.needsUpdate = true;
    h.textures.setTexture2D(b, 1);
    const c = new lib.DataTexture(rgba(100 * 2, 9), 100, 2);
    c.needsUpdate = true;
    h.textures.setTexture2D(c, 2);
    return h.stand.calls;
  },

  "shared sources and changed parameters"(lib) {
    const h = texturesHarness(lib);
    const a = new lib.Texture(new FakeImageBitmap("shared", 4, 4) as Any);
    a.needsUpdate = true;
    const b = a.clone();
    h.textures.setTexture2D(a, 0);
    h.textures.setTexture2D(b, 1);
    memory(h);
    const c = a.clone();
    c.magFilter = k(lib, "filter", "nearest");
    h.textures.setTexture2D(c, 2);
    memory(h);
    // (a's parameters change: a new WebGLTexture, the old one still b's)
    a.wrapS = k(lib, "wrapping", "repeat");
    a.needsUpdate = true;
    h.textures.setTexture2D(a, 0);
    memory(h);
    b.dispose();
    memory(h);
    // (and again: a's old key is unused now, so deleted)
    a.wrapT = k(lib, "wrapping", "mirror");
    a.needsUpdate = true;
    h.textures.setTexture2D(a, 0);
    memory(h);
    a.dispose();
    c.dispose();
    memory(h);
    return h.stand.calls;
  },

  "formats and types: every internal format branch"(lib) {
    const h = texturesHarness(lib);
    const combos: [string, string, ArrayBufferView][] = [
      ["red", "float", floats(4, 1)], ["rg", "u8", rgba(2, 2)], ["rg", "half", halves(8, 3)], ["rg", "float", floats(8, 4)],
      ["red-integer", "u8", rgba(1, 5)], ["red-integer", "u16", halves(4, 6)], ["red-integer", "uint", new Uint32Array(4)],
      ["red-integer", "i8", new Int8Array(4)], ["red-integer", "i16", new Int16Array(4)], ["red-integer", "int", new Int32Array(4)],
      ["rg-integer", "u8", rgba(2, 7)], ["rg-integer", "u16", halves(8, 8)], ["rg-integer", "uint", new Uint32Array(8)],
      ["rg-integer", "i8", new Int8Array(8)], ["rg-integer", "i16", new Int16Array(8)], ["rg-integer", "int", new Int32Array(8)],
      ["rgba-integer", "u8", rgba(4, 9)], ["rgba-integer", "u16", halves(16, 1)], ["rgba-integer", "uint", new Uint32Array(16)],
      ["rgba-integer", "i8", new Int8Array(16)], ["rgba-integer", "i16", new Int16Array(16)], ["rgba-integer", "int", new Int32Array(16)],
      ["rgb", "u5999", new Uint32Array(4)], ["rgb", "u101111", new Uint32Array(4)], ["rgb", "u8", rgba(3, 2)],
      ["rgba", "u4444", halves(4, 2)], ["rgba", "u5551", halves(4, 3)], ["alpha", "u8", rgba(1, 4)],
    ];
    combos.forEach(([format, type, data], i) => {
      const t = new lib.DataTexture(data, 2, 2, k(lib, "pixelFormat", format), k(lib, "textureType", type));
      t.needsUpdate = true;
      h.textures.setTexture2D(t, i % 16);
    });
    // (a named internal format, and one GL hasn't got)
    const named = new lib.DataTexture(rgba(4, 3), 2, 2);
    named.internalFormat = "RGBA8";
    named.needsUpdate = true;
    h.textures.setTexture2D(named, 0);
    const bogus = new lib.DataTexture(rgba(4, 3), 2, 2);
    bogus.internalFormat = "NOT_A_FORMAT";
    bogus.needsUpdate = true;
    h.textures.setTexture2D(bogus, 0);
    // (sRGB on a float texture: warned, uploaded anyway)
    const odd = new lib.DataTexture(floats(16, 3), 2, 2, k(lib, "pixelFormat", "rgba"), k(lib, "textureType", "float"));
    odd.colorSpace = k(lib, "colorSpace", "srgb");
    odd.needsUpdate = true;
    h.textures.setTexture2D(odd, 1);
    memory(h);
    return h.stand.calls;
  },

  "user mipmaps without generation, image mipmaps, onUpdate"(lib) {
    const h = texturesHarness(lib);
    const d = new lib.DataTexture(rgba(16, 6), 4, 4);
    d.mipmaps = [{ data: rgba(16, 6), width: 4, height: 4 }, { data: rgba(4, 7), width: 2, height: 2 }] as Any;
    d.needsUpdate = true;
    h.textures.setTexture2D(d, 0);
    d.needsUpdate = true;
    h.textures.setTexture2D(d, 0);
    const t = new lib.Texture(new FakeImageBitmap("base", 8, 8) as Any);
    t.mipmaps = [new FakeHTMLImageElement("m0", 8, 8, [8, 8], true), new FakeImageBitmap("m1", 4, 4), new FakeHTMLCanvasElement("m2", 2, 2)] as Any;
    t.onUpdate = (x: Any) => rec("onUpdate", x === t);
    t.needsUpdate = true;
    h.textures.setTexture2D(t, 1);
    rec("generateMipmaps", t.generateMipmaps);
    return h.stand.calls;
  },

  "texture units"(lib) {
    const h = texturesHarness(lib, { parameters: { 0x8872: 2 } }); // (MAX_TEXTURE_IMAGE_UNITS)
    const units = [h.textures.allocateTextureUnit(), h.textures.allocateTextureUnit(), h.textures.allocateTextureUnit()];
    h.textures.resetTextureUnits();
    units.push(h.textures.allocateTextureUnit());
    rec("units", units);
    // (an empty cube texture, as a sampler uniform falls back to: bound, nothing uploaded)
    const cube = new lib.Texture();
    h.textures.setTextureCube(cube, 1);
    h.textures.setTexture2DArray(cube, 2);
    h.textures.setTexture3D(cube, 3);
    return h.stand.calls;
  },

  "render target: half float colour, depth buffer, setSize, dispose"(lib) {
    const h = texturesHarness(lib);
    const rt = new lib.RenderTarget(16, 8, { type: k(lib, "textureType", "half") });
    h.textures.setupRenderTarget(rt);
    memory(h);
    rt.setSize(32, 16);
    memory(h);
    h.textures.setupRenderTarget(rt);
    h.textures.updateRenderTargetMipmap(rt);
    h.textures.updateMultisampleRenderTarget(rt);
    rt.dispose();
    memory(h);
    return h.stand.calls;
  },

  "render target: no depth, stencil, mipmaps, srgb, internal format"(lib) {
    const h = texturesHarness(lib);
    const a = new lib.RenderTarget(8, 8, { depthBuffer: false, generateMipmaps: true, minFilter: k(lib, "filter", "linear-mipmap-linear"), colorSpace: k(lib, "colorSpace", "srgb") });
    h.textures.setupRenderTarget(a);
    h.textures.updateRenderTargetMipmap(a);
    const b = new lib.RenderTarget(4, 4, { stencilBuffer: true, format: k(lib, "pixelFormat", "red"), type: k(lib, "textureType", "float"), internalFormat: "R16F" });
    h.textures.setupRenderTarget(b);
    // (depth already made: attached again)
    h.textures.setupDepthRenderbuffer(b);
    memory(h);
    a.dispose();
    b.dispose();
    memory(h);
    return h.stand.calls;
  },

  "render target: depth textures (uint, float, u16, depth-stencil)"(lib) {
    const h = texturesHarness(lib);
    const types: [string, string, boolean][] = [["uint", "depth", false], ["float", "depth", false], ["u16", "depth", false], ["depth24-stencil8", "depth-stencil", true], ["float", "depth-stencil", true]];
    const targets: Any[] = [];
    for (const [type, format, stencil] of types) {
      const depthTexture = new lib.DepthTexture(undefined, undefined, k(lib, "textureType", type), undefined, undefined, undefined, undefined, undefined, undefined, k(lib, "pixelFormat", format));
      const rt = new lib.RenderTarget(12, 6, { depthTexture, stencilBuffer: stencil, type: k(lib, "textureType", "half") });
      h.textures.setupRenderTarget(rt);
      targets.push(rt);
      _calls.push(["--"]);
    }
    // (a compare function, sampled as a shadow)
    const d = new lib.DepthTexture(4, 4);
    d.compareFunction = k(lib, "compareFunc", "less-equal");
    const rt = new lib.RenderTarget(4, 4, { depthTexture: d });
    h.textures.setupRenderTarget(rt);
    h.textures.setTexture2D(d, 3);
    // (resized: the depth texture follows)
    rt.setSize(8, 8);
    h.textures.setupRenderTarget(rt);
    memory(h);
    // (the depth texture swapped: the old one's listener goes, the new one's comes)
    const e = new lib.DepthTexture(8, 8, k(lib, "textureType", "float"));
    rt.depthTexture = e;
    h.textures.setupDepthRenderbuffer(rt);
    d.dispose();
    e.dispose();
    for (const t of targets) t.dispose();
    rt.dispose();
    memory(h);
    return h.stand.calls;
  },

  "render target: rebinding, re-attaching, a resized depth texture"(lib) {
    const h = texturesHarness(lib);
    const rt = new lib.RenderTarget(8, 8);
    h.textures.setupRenderTarget(rt);
    h.textures.rebindTextures(rt, undefined, undefined);
    h.textures.rebindTextures(rt, {}, {});
    const d = new lib.RenderTarget(8, 8, { depthTexture: new lib.DepthTexture(8, 8) });
    h.textures.setupRenderTarget(d);
    // (the target grows without setSize: the depth texture is made again at the new size)
    d.width = 16;
    d.height = 4;
    h.textures.setupDepthRenderbuffer(d);
    // (u16 depth with stencil: 24 bits, warned)
    const w = new lib.RenderTarget(4, 4, { stencilBuffer: true, depthTexture: new lib.DepthTexture(4, 4, k(lib, "textureType", "u16"), undefined, undefined, undefined, undefined, undefined, undefined, k(lib, "pixelFormat", "depth-stencil")) });
    h.textures.setupRenderTarget(w);
    // (the renderer's own depth buffer flag: a depth texture, but a renderbuffer anyway)
    const a = new lib.RenderTarget(4, 4, { depthTexture: new lib.DepthTexture(4, 4) });
    h.stand.calls.push(["--"]);
    h.properties.get(a).__autoAllocateDepthBuffer = true;
    h.textures.setupRenderTarget(a);
    h.textures.setupDepthRenderbuffer(a);
    // (external textures: no storage made)
    const x = new lib.RenderTarget(4, 4, { depthBuffer: false });
    h.properties.get(x).__hasExternalTextures = true;
    h.textures.setupRenderTarget(x);
    memory(h);
    return h.stand.calls;
  },

  "render target: msaa resolve"(lib) {
    const h = texturesHarness(lib);
    const rt = new lib.RenderTarget(16, 16, { samples: 8, type: k(lib, "textureType", "half") });
    h.textures.setupRenderTarget(rt);
    h.textures.updateMultisampleRenderTarget(rt);
    rt.resolveDepthBuffer = false;
    h.textures.updateMultisampleRenderTarget(rt);
    const s = new lib.RenderTarget(8, 8, { samples: 4, stencilBuffer: true, depthTexture: new lib.DepthTexture(8, 8, k(lib, "textureType", "depth24-stencil8"), undefined, undefined, undefined, undefined, undefined, undefined, k(lib, "pixelFormat", "depth-stencil")) });
    h.textures.setupRenderTarget(s);
    h.textures.updateMultisampleRenderTarget(s);
    rec("useMultisampledRTT", h.textures.useMultisampledRTT(rt));
    memory(h);
    rt.dispose();
    s.dispose();
    memory(h);
    return h.stand.calls;
  },

  "render target: msaa through WEBGL_multisampled_render_to_texture"(lib) {
    const h = texturesHarness(lib, { extensions: ["EXT_color_buffer_float", "WEBGL_multisampled_render_to_texture"] });
    const rt = new lib.RenderTarget(16, 16, { samples: 4 });
    h.textures.setupRenderTarget(rt);
    h.textures.updateMultisampleRenderTarget(rt);
    const d = new lib.RenderTarget(8, 8, { samples: 4, depthTexture: new lib.DepthTexture(8, 8) });
    h.textures.setupRenderTarget(d);
    const s = new lib.RenderTarget(8, 8, { samples: 4, stencilBuffer: true, depthTexture: new lib.DepthTexture(8, 8, k(lib, "textureType", "depth24-stencil8"), undefined, undefined, undefined, undefined, undefined, undefined, k(lib, "pixelFormat", "depth-stencil")) });
    h.textures.setupRenderTarget(s);
    // (the renderer turns render-to-texture off for some targets)
    const off = new lib.RenderTarget(8, 8, { samples: 4 });
    h.properties.get(off).__useRenderToTexture = false;
    h.textures.setupRenderTarget(off);
    h.textures.updateMultisampleRenderTarget(off);
    rec("useMultisampledRTT", h.textures.useMultisampledRTT(rt), h.textures.useMultisampledRTT(off));
    return h.stand.calls;
  },

  "render target: two colour textures (MRT), with msaa"(lib) {
    const h = texturesHarness(lib);
    const rt = new lib.RenderTarget(8, 4, { count: 2, type: k(lib, "textureType", "half") });
    h.textures.setupRenderTarget(rt);
    const ms = new lib.RenderTarget(8, 4, { count: 2, samples: 4 });
    ms.textures[1]!.generateMipmaps = true;
    h.textures.setupRenderTarget(ms);
    h.textures.updateMultisampleRenderTarget(ms);
    h.textures.updateRenderTargetMipmap(ms);
    memory(h);
    rt.dispose();
    ms.dispose();
    memory(h);
    return h.stand.calls;
  },

  "render target: user mipmaps (a framebuffer per level)"(lib) {
    const h = texturesHarness(lib);
    const rt = new lib.RenderTarget(8, 8);
    rt.texture.mipmaps = [{ width: 8, height: 8 }, { width: 4, height: 4 }, { width: 2, height: 2 }] as Any;
    rt.depthTexture = new lib.DepthTexture(8, 8);
    h.textures.setupRenderTarget(rt);
    const ms = new lib.RenderTarget(8, 8, { samples: 2 });
    ms.texture.mipmaps = [{ width: 8, height: 8 }, { width: 4, height: 4 }] as Any;
    h.textures.setupRenderTarget(ms);
    h.textures.updateMultisampleRenderTarget(ms);
    rt.dispose();
    ms.dispose();
    return h.stand.calls;
  },
};

// ---- the shadow map scripts

interface ShadowHarness {
  calls: Call[];
  renderer: Any;
  shadowMap: Any;
  label(o: object, name: string): void;
}

function shadowHarness(lib: Lib, options: { reversedDepth?: boolean; maxTextureSize?: number; localClipping?: boolean } = {}): ShadowHarness {
  const calls: Call[] = [];
  _calls = calls;
  const labels = new WeakMap<object, string>();
  let next = 0;
  const label = (o: object, name: string): void => { labels.set(o, name); };
  const textureLabel = (t: Any): unknown => (t === undefined ? "<undefined>" : t === null ? null : t.name);

  const targetOf = (rt: Any): unknown => {
    if (rt === null || rt === undefined) return rt;
    const known = labels.get(rt);
    if (known !== undefined) return known;
    const name = `rt${(next += 1)}`;
    labels.set(rt, name);
    const t = rt.texture;
    return {
      label: name, width: rt.width, height: rt.height, depthBuffer: rt.depthBuffer, stencilBuffer: rt.stencilBuffer, samples: rt.samples,
      name: t.name, minFilter: lib.n("filter", t.minFilter), magFilter: lib.n("filter", t.magFilter), type: lib.n("textureType", t.type),
      format: lib.n("pixelFormat", t.format), generateMipmaps: t.generateMipmaps, wrapS: lib.n("wrapping", t.wrapS),
    };
  };

  const materialOf = (m: Any): unknown => {
    let name = labels.get(m);
    const first = name === undefined;
    if (name === undefined) {
      name = m.name ? `${m.name}` : `m${(next += 1)}`;
      labels.set(m, name);
    }
    return {
      label: name, first, depth: m.isMeshDepthMaterial === true, packing: m.depthPacking === undefined ? "<undefined>" : lib.n("depthPacking", m.depthPacking),
      side: lib.n("side", m.side), visible: m.visible, wireframe: m.wireframe, alphaTest: m.alphaTest, version: m.version,
      map: textureLabel(m.map), alphaMap: textureLabel(m.alphaMap), displacementMap: textureLabel(m.displacementMap),
      displacementScale: m.displacementScale, displacementBias: m.displacementBias,
      clipShadows: m.clipShadows, clippingPlanes: m.clippingPlanes === null ? null : m.clippingPlanes.length, clipIntersection: m.clipIntersection,
      wireframeLinewidth: m.wireframeLinewidth, linewidth: m.linewidth === undefined ? "<undefined>" : m.linewidth,
    };
  };

  let current: Any = null;
  const state = fakeState(lib, options.reversedDepth === true);
  const renderer = {
    state,
    properties: lib.createProperties(),
    localClippingEnabled: options.localClipping === true,
    getRenderTarget: () => current,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget(rt: Any, face?: number, level?: number) {
      calls.push(["renderer.setRenderTarget", targetOf(rt), snap(face), snap(level)]);
      current = rt;
    },
    clear: (...a: unknown[]) => rec("renderer.clear", ...a),
    renderBufferDirect(camera: Any, scene: unknown, geometry: Any, material: Any, object: Any, group: Any) {
      calls.push(["renderer.renderBufferDirect", labels.get(camera) ?? "?", snap(scene), labels.get(geometry) ?? "?", materialOf(material), object.name,
        group === null ? null : [group.start, group.count, group.materialIndex], Array.from(object.modelViewMatrix.elements as number[])]);
    },
  };
  const objects = {
    update(object: Any) {
      rec("objects.update", object.name);
      return object.geometry;
    },
  };
  const shadowMap = lib.createShadowMap(renderer, objects, { maxTextureSize: options.maxTextureSize ?? 4096 });
  return { calls, renderer, shadowMap, label };
}

const V3 = (lib: Lib, x: number, y: number, z: number): Any => new lib.Vector3(x, y, z);

// (a unit quaternion without trigonometry: the fixture holds on every CPU)
function quat(lib: Lib, x: number, y: number, z: number, w: number): Any {
  const l = Math.sqrt(x * x + y * y + z * z + w * w);
  return new lib.Quaternion(x / l, y / l, z / l, w / l);
}

function boxGeometry(lib: Lib, h: ShadowHarness, name: string, size: number, groups = false): Any {
  const s = size / 2;
  const corners = [[-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s], [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]];
  const tris = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4];
  const positions = new Float32Array(tris.length * 3);
  tris.forEach((c, i) => positions.set(corners[c]!, i * 3));
  const g = new lib.Geometry();
  g.setAttribute("position", new lib.Attribute(positions, 3));
  if (groups) {
    g.addGroup(0, 12, 0);
    g.addGroup(12, 12, 1);
    g.addGroup(24, 12, 2);
  }
  h.label(g, name);
  return g;
}

interface Grove {
  stage: Any;
  light: Any;
  camera: Any;
  materials: Record<string, Any>;
  meshes: Record<string, Any>;
}

/** A sun over a ground, with casters of every kind getDepthMaterial and renderObject tell apart. */
function grove(lib: Lib, h: ShadowHarness): Grove {
  const stage = new lib.Stage();
  const camera = new lib.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 3, 12);
  stage.add(camera);

  const light = new lib.SunLight(0xffffff, 2);
  light.name = "sun";
  light.position.set(6, 12, 4);
  light.castShadow = true;
  light.shadow.mapSize.set(256, 128);
  const sc = light.shadow.camera;
  sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 0.5; sc.far = 40;
  h.label(sc, "shadowCamera");
  stage.add(light);
  stage.add(light.target);
  light.target.position.set(0, 0, -1);

  const tex = (name: string): Any => { const t = new lib.Texture(); t.name = name; return t; };

  const materials: Record<string, Any> = {
    lit: new lib.LitMaterial({ name: "lit" }),
    leaf: new lib.LitMaterial({ name: "leaf", map: tex("leafMap"), alphaTest: 0.5, side: k(lib, "side", "both") }),
    bark: new lib.ToonMaterial({ name: "bark", shadowSide: k(lib, "side", "front") }),
    back: new lib.FlatMaterial({ name: "back", side: k(lib, "side", "back") }),
    hidden: new lib.LitMaterial({ name: "hidden", visible: false }),
    cover: new lib.LitMaterial({ name: "cover", alphaToCoverage: true }),
    alphaMapped: new lib.LitMaterial({ name: "alphaMapped", alphaMap: tex("alphaMask"), alphaTest: 0.25, wireframe: true }),
    displaced: new lib.LitMaterial({ name: "displaced", displacementMap: tex("height"), displacementScale: 0.5, displacementBias: 0.1 }),
    custom: new lib.CustomMaterial({ name: "custom" }),
  };

  const meshes: Record<string, Any> = {};
  const mesh = (name: string, geometry: Any, material: Any, x: number, y: number, z: number, parent: Any = stage): Any => {
    const m = new lib.Mesh(geometry, material);
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    meshes[name] = m;
    return m;
  };

  const box = boxGeometry(lib, h, "box", 1);
  const ground = mesh("ground", boxGeometry(lib, h, "ground", 10), materials["lit"], 0, -5.5, 0);
  ground.castShadow = false;
  ground.receiveShadow = true;
  mesh("trunk", box, materials["bark"], 0, 0.5, 0).quaternion.copy(quat(lib, 0.1, 0.3, 0, 1));
  mesh("canopy", box, materials["leaf"], 0.5, 2, 0.25).scale.set(2, 1, 1.5);
  mesh("lantern", box, materials["back"], -2, 0.5, 1);
  mesh("ghost", box, materials["hidden"], 2, 0.5, 1);
  mesh("glass", box, materials["cover"], 1, 0.5, -2);
  mesh("fern", box, materials["alphaMapped"], -1, 0.25, -2);
  mesh("rock", box, materials["displaced"], 3, 0.25, -1);
  mesh("shader", box, materials["custom"], -3, 0.25, -1);
  mesh("far", box, materials["lit"], 60, 0, 0);
  mesh("far-uncull", box, materials["lit"], 60, 0, 0).frustumCulled = false;
  const layered = mesh("layered", box, materials["lit"], 0, 1, 3);
  layered.layers.set(1);
  mesh("under-layered", box, materials["lit"], 0, 1, 0, layered);
  const hidden = mesh("invisible", box, materials["lit"], 0, 1, -3);
  hidden.visible = false;
  mesh("under-invisible", box, materials["lit"], 0, 1, 0, hidden);
  mesh("no-cast", box, materials["lit"], 1, 1, 1).castShadow = false;
  const multi = mesh("multi", boxGeometry(lib, h, "multi", 1, true), [materials["lit"], materials["hidden"], materials["leaf"]], -2, 1, -1);
  void multi;
  const custom = mesh("custom-depth", box, materials["lit"], 2, 1, 2);
  custom.customDepthMaterial = new lib.DepthMaterial({ name: "customDepth" });
  const hooked = mesh("hooked", box, materials["lit"], -1, 2, 2);
  hooked.onBeforeShadow = (_r: unknown, o: Any, _c: unknown, _sc: unknown, g: Any, dm: Any, group: unknown) => rec("onBeforeShadow", o.name, g === o.geometry, dm.isMeshDepthMaterial === true, group);
  hooked.onAfterShadow = (_r: unknown, o: Any) => rec("onAfterShadow", o.name);

  const group = new lib.Group();
  group.position.set(1, 0, 1);
  stage.add(group);
  mesh("in-group", box, materials["lit"], 0, 1, 0, group);

  const blossoms = new lib.Instances(box, materials["leaf"], 3);
  blossoms.name = "blossoms";
  blossoms.castShadow = true;
  const m4 = new lib.Matrix4();
  blossoms.setMatrixAt(0, m4.compose(V3(lib, 0, 3, 0), quat(lib, 0, 0, 0, 1), V3(lib, 0.5, 0.5, 0.5)));
  blossoms.setMatrixAt(1, m4.compose(V3(lib, 1, 3.5, -0.5), quat(lib, 0.2, 0, 0.1, 1), V3(lib, 0.4, 0.4, 0.4)));
  blossoms.setMatrixAt(2, m4.compose(V3(lib, -1, 2.5, 0.5), quat(lib, 0, 0.5, 0, 1), V3(lib, 0.6, 0.6, 0.6)));
  stage.add(blossoms);
  meshes["blossoms"] = blossoms;

  // (instances all far outside the shadow camera: culled by their own bounding sphere)
  const strays = new lib.Instances(box, materials["lit"], 2);
  strays.name = "strays";
  strays.castShadow = true;
  strays.setMatrixAt(0, m4.compose(V3(lib, 80, 0, 0), quat(lib, 0, 0, 0, 1), V3(lib, 1, 1, 1)));
  strays.setMatrixAt(1, m4.compose(V3(lib, 90, 0, 0), quat(lib, 0, 0, 0, 1), V3(lib, 1, 1, 1)));
  stage.add(strays);

  stage.updateMatrixWorld();
  return { stage, light, camera, materials, meshes };
}

function shadowState(lib: Lib, g: Grove): void {
  const s = g.light.shadow;
  rec("shadow", {
    mapSize: [s.mapSize.x, s.mapSize.y], needsUpdate: s.needsUpdate,
    matrix: Array.from(s.matrix.elements as number[]),
    view: Array.from(s.camera.matrixWorldInverse.elements as number[]),
    projection: Array.from(s.camera.projectionMatrix.elements as number[]),
    map: s.map === null ? null : [s.map.width, s.map.height, s.map.texture.name, lib.n("filter", s.map.texture.minFilter)],
  });
}

export const shadowCases: Record<string, (lib: Lib) => Call[]> = {
  "pcf soft: a grove of casters, twice"(lib) {
    const h = shadowHarness(lib);
    const g = grove(lib, h);
    h.shadowMap.enabled = true;
    h.shadowMap.type = k(lib, "shadowMapType", "pcf-soft");
    h.shadowMap.render([g.light], g.stage, g.camera);
    shadowState(lib, g);
    g.meshes["trunk"].position.x = 0.75;
    g.stage.updateMatrixWorld();
    h.shadowMap.render([g.light], g.stage, g.camera);
    shadowState(lib, g);
    rec("needsUpdate", h.shadowMap.needsUpdate);
    return h.calls;
  },

  "updates: enabled, autoUpdate, needsUpdate, per light"(lib) {
    const h = shadowHarness(lib);
    const g = grove(lib, h);
    h.shadowMap.type = k(lib, "shadowMapType", "pcf-soft");
    h.shadowMap.render([g.light], g.stage, g.camera); // (disabled)
    h.shadowMap.enabled = true;
    h.shadowMap.render([], g.stage, g.camera); // (no lights)
    h.shadowMap.autoUpdate = false;
    h.shadowMap.render([g.light], g.stage, g.camera); // (no update asked)
    h.shadowMap.needsUpdate = true;
    h.shadowMap.render([g.light], g.stage, g.camera);
    rec("needsUpdate", h.shadowMap.needsUpdate);
    h.shadowMap.autoUpdate = true;
    g.light.shadow.autoUpdate = false;
    h.shadowMap.render([g.light], g.stage, g.camera); // (the light skips)
    g.light.shadow.needsUpdate = true;
    const sky = new lib.SkyLight(0xffffff, 0x223344, 1);
    h.shadowMap.render([sky, g.light], g.stage, g.camera); // (a light without a shadow is passed over)
    shadowState(lib, g);
    return h.calls;
  },

  "map size over the texture limit; reversed depth"(lib) {
    const h = shadowHarness(lib, { reversedDepth: true, maxTextureSize: 1000, localClipping: true });
    const g = grove(lib, h);
    g.light.shadow.mapSize.set(4096, 1536);
    // (clipped shadows: a variant of their own, with local clipping on)
    g.materials["bark"].clippingPlanes = [new lib.Plane(new lib.Vector3(0, -1, 0), 1)];
    g.materials["bark"].clipShadows = true;
    g.materials["back"].clippingPlanes = [];
    g.materials["back"].clipShadows = true;
    h.shadowMap.enabled = true;
    h.shadowMap.type = k(lib, "shadowMapType", "pcf-soft");
    h.shadowMap.render([g.light], g.stage, g.camera);
    shadowState(lib, g);
    return h.calls;
  },

  "variant materials: cached, and dropped with their material"(lib) {
    const h = shadowHarness(lib);
    const g = grove(lib, h);
    h.shadowMap.enabled = true;
    h.shadowMap.type = k(lib, "shadowMapType", "pcf-soft");
    h.shadowMap.render([g.light], g.stage, g.camera);
    g.materials["leaf"].dispose();
    g.materials["cover"].dispose();
    g.materials["leaf"].alphaTest = 0;
    g.materials["lit"].side = k(lib, "side", "both");
    g.materials["lit"].shadowSide = k(lib, "side", "back");
    h.shadowMap.render([g.light], g.stage, g.camera);
    // (an existing map, disposed and remade when the light's map is cleared)
    g.light.shadow.map.dispose();
    g.light.shadow.map = null;
    g.light.shadow.mapSize.set(64, 64);
    h.shadowMap.render([g.light], g.stage, g.camera);
    shadowState(lib, g);
    return h.calls;
  },
};
