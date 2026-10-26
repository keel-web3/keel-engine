// The GL resource layer's parity scripts: what to drive r180's WebGLState,
// Attributes, BindingStates, Geometries, Objects, buffer renderers, Info,
// Extensions, Capabilities, Utils, Properties and Animation with, and keel/lit's
// ports of them. Each script runs against a recording WebGL2 stand-in
// (gl-stand-in.ts); the fixture generator (outside this repo, where Three
// lives) runs them on r180's modules and records the call logs into
// fixtures/gl-resources.json, and gl-resources.test.ts runs them on ours and
// wants the same logs, call for call.
//
// A script's own readings (return values, counters, fields) go into the same
// log as ["@what", value] entries, in order with the GL calls around them.
//
// Constants cross between the two through `lib.k` (a KEEL string in, the
// lib's own value out: the string here, r180's number there).

import type { Call, StandInOptions } from "./gl-stand-in.ts";

export type Rng = () => number;

// (the libs differ in their types: the scripts drive both through the same names)
type Any = any;

/** The modules and classes under test: ours, or r180's under the same names. */
export interface GLLib {
  createExtensions: Any; createCapabilities: Any; createUtils: Any; createInfo: Any; createProperties: Any;
  createState: Any; createAttributes: Any; createBindingStates: Any; createGeometries: Any; createObjects: Any;
  createBufferRenderer: Any; createIndexedBufferRenderer: Any; createAnimation: Any;
  Geometry: Any; Attribute: Any; InstanceAttribute: Any; Mesh: Any; Instances: Any;
  FlatMaterial: Any; LitMaterial: Any; CustomMaterial: Any; Color: Any; Vector4: Any; Matrix4: Any; Vector3: Any; Quaternion: Any;
  /** A KEEL constant, in this lib's terms. */
  k(table: string, value: string): Any;
}

/** Notes a reading into the log. */
export type Note = (what: string, value: unknown) => void;

export interface GLCase {
  /** The stand-in this script runs against. */
  options?: StandInOptions;
  run(lib: GLLib, gl: WebGL2RenderingContext, r: Rng, note: Note): void;
}

// ---- helpers

const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const chance = (r: Rng, p: number): boolean => r() < p;
// (values on a 1/64 grid: exact in float32, so a snapshot never rounds differently)
const grid = (r: Rng, s = 4): number => Math.round((r() * 2 - 1) * s * 64) / 64;

const SIDES = ["front", "back", "both"] as const;
const BLENDINGS = ["none", "normal", "add", "subtract", "multiply", "custom"] as const;
const EQUATIONS = ["add", "subtract", "reverse-subtract", "min", "max"] as const;
const FACTORS = [
  "zero", "one", "src-color", "one-minus-src-color", "src-alpha", "one-minus-src-alpha", "dst-alpha", "one-minus-dst-alpha",
  "dst-color", "one-minus-dst-color", "src-alpha-saturate", "constant-color", "one-minus-constant-color", "constant-alpha", "one-minus-constant-alpha",
] as const;
const DEPTH_FUNCS = ["never", "always", "less", "less-equal", "equal", "greater-equal", "greater", "not-equal"] as const;
const STENCIL_OPS = ["zero", "keep", "replace", "increment", "decrement", "increment-wrap", "decrement-wrap", "invert"] as const;
const CULL_FACES = ["none", "back", "front", "front-back"] as const;
const TEXTURE_TYPES = ["u8", "i8", "i16", "u16", "int", "uint", "float", "half", "u4444", "u5551", "depth24-stencil8", "u5999", "u101111"] as const;
const PIXEL_FORMATS = ["alpha", "rgb", "rgba", "depth", "depth-stencil", "red", "red-integer", "rg", "rg-integer", "rgb-integer", "rgba-integer"] as const;
const USAGES = ["static", "dynamic", "stream", "static-read", "dynamic-read", "stream-read", "static-copy", "dynamic-copy", "stream-copy"] as const;

/** The modules a renderer builds, in r180's WebGLRenderer.initGLContext order. */
function context(lib: GLLib, gl: WebGL2RenderingContext, parameters: Record<string, unknown> = {}) {
  const extensions = lib.createExtensions(gl);
  extensions.init();
  const utils = lib.createUtils(gl, extensions);
  const capabilities = lib.createCapabilities(gl, extensions, parameters, utils);
  const state = lib.createState(gl, extensions);
  const info = lib.createInfo(gl);
  const properties = lib.createProperties();
  const attributes = lib.createAttributes(gl);
  const bindingStates = lib.createBindingStates(gl, attributes);
  const geometries = lib.createGeometries(gl, attributes, info, bindingStates);
  const objects = lib.createObjects(gl, geometries, attributes, info);
  const bufferRenderer = lib.createBufferRenderer(gl, extensions, info);
  const indexedBufferRenderer = lib.createIndexedBufferRenderer(gl, extensions, info);
  return { extensions, utils, capabilities, state, info, properties, attributes, bindingStates, geometries, objects, bufferRenderer, indexedBufferRenderer };
}

/** A material with every field the state reads drawn at random. */
function material(lib: GLLib, r: Rng, kind = pick(r, ["FlatMaterial", "LitMaterial", "CustomMaterial"] as const)): Any {
  const m = new lib[kind]();
  m.side = lib.k("side", pick(r, SIDES));
  m.blending = lib.k("blending", chance(r, 0.5) ? pick(r, ["normal", "none"] as const) : pick(r, BLENDINGS));
  m.transparent = chance(r, 0.5);
  m.premultipliedAlpha = chance(r, 0.4);
  if (chance(r, 0.6)) {
    m.blendEquation = lib.k("blendEquation", pick(r, EQUATIONS));
    m.blendSrc = lib.k("blendFactor", pick(r, FACTORS));
    m.blendDst = lib.k("blendFactor", pick(r, FACTORS));
    m.blendEquationAlpha = chance(r, 0.5) ? null : lib.k("blendEquation", pick(r, EQUATIONS));
    m.blendSrcAlpha = chance(r, 0.5) ? null : lib.k("blendFactor", pick(r, FACTORS));
    m.blendDstAlpha = chance(r, 0.5) ? null : lib.k("blendFactor", pick(r, FACTORS));
    if (chance(r, 0.5)) m.blendColor.set(int(r, 0, 4) / 4, int(r, 0, 4) / 4, int(r, 0, 4) / 4);
    m.blendAlpha = int(r, 0, 4) / 4;
  }
  m.depthFunc = lib.k("depthFunc", chance(r, 0.6) ? "less-equal" : pick(r, DEPTH_FUNCS));
  m.depthTest = chance(r, 0.8);
  m.depthWrite = chance(r, 0.7);
  m.colorWrite = chance(r, 0.9);
  m.stencilWrite = chance(r, 0.25);
  if (chance(r, 0.5)) {
    m.stencilWriteMask = pick(r, [0xff, 0x0f, 1]);
    m.stencilFunc = lib.k("compareFunc", pick(r, DEPTH_FUNCS));
    m.stencilRef = int(r, 0, 3);
    m.stencilFuncMask = pick(r, [0xff, 0x0f]);
    m.stencilFail = lib.k("stencilOp", pick(r, STENCIL_OPS));
    m.stencilZFail = lib.k("stencilOp", pick(r, STENCIL_OPS));
    m.stencilZPass = lib.k("stencilOp", pick(r, STENCIL_OPS));
  }
  m.polygonOffset = chance(r, 0.3);
  m.polygonOffsetFactor = pick(r, [0, 1, -1, 2]);
  m.polygonOffsetUnits = pick(r, [0, 1, -1, 4]);
  m.alphaToCoverage = chance(r, 0.2);
  if (m.wireframe !== undefined) m.wireframe = chance(r, 0.15);
  return m;
}

const ARRAYS = { Float32Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Int8Array, Uint8Array } as const;

function values(r: Rng, type: keyof typeof ARRAYS, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (type === "Float32Array") out.push(grid(r));
    else if (type === "Int8Array" || type === "Int16Array" || type === "Int32Array") out.push(int(r, -100, 100));
    else out.push(int(r, 0, 200));
  }
  return out;
}

function attribute(lib: GLLib, r: Rng, itemSize: number, count: number, type: keyof typeof ARRAYS = "Float32Array", instanced = false): Any {
  const array = new ARRAYS[type](values(r, type, itemSize * count));
  const a = instanced ? new lib.InstanceAttribute(array, itemSize, false, int(r, 1, 2)) : new lib.Attribute(array, itemSize, type !== "Float32Array" && chance(r, 0.5));
  if (chance(r, 0.4)) a.setUsage(lib.k("usage", pick(r, USAGES)));
  if (type !== "Float32Array" && chance(r, 0.3)) a.gpuType = lib.k("textureType", "int");
  return a;
}

/** Edits an attribute: a few values, then (sometimes) ranges, then a version bump. */
function edit(r: Rng, a: Any): void {
  const n = a.array.length;
  const ranges = chance(r, 0.7) ? int(r, 1, 4) : 0;
  for (let i = 0; i < ranges; i++) {
    const start = int(r, 0, n - 1);
    const count = int(r, 1, Math.max(1, Math.min(n - start, 12)));
    for (let j = start; j < start + count; j++) a.array[j] = a.array instanceof Float32Array ? grid(r) : int(r, 0, 100);
    a.addUpdateRange(start, count);
  }
  if (ranges === 0) for (let j = 0; j < Math.min(n, 3); j++) a.array[int(r, 0, n - 1)] = a.array instanceof Float32Array ? grid(r) : int(r, 0, 100);
  a.needsUpdate = true;
}

/** A program as binding states see it (r180's WebGLProgram.getAttributes()). */
function program(gl: WebGL2RenderingContext, id: number, names: readonly string[]): Any {
  const types: Record<string, [number, number]> = {
    position: [gl.FLOAT_VEC3, 1], normal: [gl.FLOAT_VEC3, 1], uv: [gl.FLOAT_VEC2, 1], color: [gl.FLOAT_VEC4, 1],
    tint: [gl.FLOAT_VEC4, 1], index8: [gl.INT, 1], weight: [gl.FLOAT, 1], offset: [gl.FLOAT_VEC3, 1],
    instanceMatrix: [gl.FLOAT_MAT4, 4], instanceColor: [gl.FLOAT_VEC3, 1], missing: [gl.FLOAT_VEC2, 1],
  };
  const attributes: Record<string, { type: number; location: number; locationSize: number }> = {};
  let location = 0;
  for (const name of names) {
    const [type, size] = types[name] ?? [gl.FLOAT, 1];
    attributes[name] = { type, location: name === "missing" ? -1 : location, locationSize: size };
    if (name !== "missing") location += size;
  }
  return { id, getAttributes: () => attributes };
}

// (quarter turns about y, from exact square roots: no transcendental maths, so the matrices hold on every CPU)
const TURNS = [[0, 1], [Math.SQRT1_2, Math.SQRT1_2], [1, 0], [Math.SQRT1_2, -Math.SQRT1_2]] as const;
const mat = (lib: GLLib, r: Rng): Any => {
  const [s, c] = pick(r, TURNS);
  return new lib.Matrix4().compose(
    new lib.Vector3(grid(r, 8), grid(r, 8), grid(r, 8)),
    new lib.Quaternion(0, s, 0, c),
    new lib.Vector3(pick(r, [1, 0.5, 2]), 1, pick(r, [1, 0.25])),
  );
};

// ---- the scripts

export const cases: Record<string, GLCase> = {
  /** The context as r180's renderer sets it up: extensions, utils, capabilities, state's initial calls. */
  "context.init": {
    run(lib, gl, _r, note) {
      const c = context(lib, gl, { precision: "highp" });
      const caps = { ...c.capabilities };
      delete caps.getMaxAnisotropy; delete caps.getMaxPrecision; delete caps.textureFormatReadable; delete caps.textureTypeReadable;
      note("capabilities", caps);
      note("anisotropy", c.capabilities.getMaxAnisotropy());
      note("anisotropy again", c.capabilities.getMaxAnisotropy());
      for (const p of ["highp", "mediump", "lowp"]) note(`maxPrecision ${p}`, c.capabilities.getMaxPrecision(p));
      for (const f of PIXEL_FORMATS) note(`formatReadable ${f}`, c.capabilities.textureFormatReadable(lib.k("pixelFormat", f)));
      for (const t of TEXTURE_TYPES) note(`typeReadable ${t}`, c.capabilities.textureTypeReadable(lib.k("textureType", t)));
      for (const t of TEXTURE_TYPES) note(`convert ${t}`, c.utils.convert(lib.k("textureType", t)));
      for (const f of PIXEL_FORMATS) note(`convert ${f}`, c.utils.convert(lib.k("pixelFormat", f)));
      note("convert SRGB8_ALPHA8", c.utils.convert("SRGB8_ALPHA8"));
      note("convert nonsense", c.utils.convert("not-a-constant"));
      for (const e of ["EXT_clip_control", "WEBGL_depth_texture", "EXT_texture_filter_anisotropic", "WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_pvrtc", "WEBGL_multi_draw", "OES_texture_float_linear", "EXT_color_buffer_float"]) {
        note(`has ${e}`, c.extensions.has(e));
      }
      note("get EXT_clip_control", c.extensions.get("EXT_clip_control") !== null);
    },
  },

  /** A context with less: no anisotropy, no clip control, no float colour buffers, mediump-only, a reversed depth buffer asked for. */
  "context.lesser": {
    options: { extensions: ["WEBGL_multi_draw", "EXT_color_buffer_half_float"], precision: { high: 0, medium: 10 }, parameters: { 0x8b9a: 0x1406, 0x8b9b: 0x1907 } /* IMPLEMENTATION_COLOR_READ_TYPE FLOAT, _FORMAT RGB */ },
    run(lib, gl, _r, note) {
      const warn = console.warn;
      console.warn = () => {};
      try {
        const extensions = lib.createExtensions(gl);
        extensions.init();
        const utils = lib.createUtils(gl, extensions);
        const capabilities = lib.createCapabilities(gl, extensions, { reversedDepthBuffer: true, logarithmicDepthBuffer: true }, utils);
        note("precision", capabilities.precision);
        note("reversedDepthBuffer", capabilities.reversedDepthBuffer);
        note("logarithmicDepthBuffer", capabilities.logarithmicDepthBuffer);
        note("anisotropy", capabilities.getMaxAnisotropy());
        for (const f of PIXEL_FORMATS) note(`formatReadable ${f}`, capabilities.textureFormatReadable(lib.k("pixelFormat", f)));
        for (const t of TEXTURE_TYPES) note(`typeReadable ${t}`, capabilities.textureTypeReadable(lib.k("textureType", t)));
        note("get missing", extensions.get("EXT_texture_filter_anisotropic"));
        const lowp = lib.createCapabilities(gl, extensions, { precision: "lowp" }, utils);
        note("lowp", lowp.precision);
      } finally {
        console.warn = warn;
      }
    },
  },

  /** State: every toggle, buffer, binding and wrapper, in a random walk, with reset in between. */
  "state.walk": {
    options: { width: 64, height: 32 },
    run(lib, gl, r, note) {
      const c = context(lib, gl);
      const s = c.state;
      const fbs = [null, gl.createFramebuffer(), gl.createFramebuffer()];
      const texs = [null, gl.createTexture(), gl.createTexture(), gl.createTexture()];
      const progs = [null, gl.createProgram(), gl.createProgram()];
      const groups = [{ name: "A", __bindingPointIndex: 0 }, { name: "B", __bindingPointIndex: 3 }];
      const caps = [gl.BLEND, gl.CULL_FACE, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.POLYGON_OFFSET_FILL, gl.SAMPLE_ALPHA_TO_COVERAGE];
      const targets = [gl.FRAMEBUFFER, gl.DRAW_FRAMEBUFFER, gl.READ_FRAMEBUFFER];
      const textureTypes = [gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP, gl.TEXTURE_2D_ARRAY, gl.TEXTURE_3D];
      const steps: (() => void)[] = [
        () => s.enable(pick(r, caps)),
        () => s.disable(pick(r, caps)),
        () => note("bindFramebuffer", s.bindFramebuffer(pick(r, targets), pick(r, fbs))),
        // (a render target always comes with its framebuffer: r180 keys a WeakMap by it)
        () => (chance(r, 0.6) ? s.drawBuffers({ textures: new Array(int(r, 1, 3)).fill(0) }, fbs[int(r, 1, 2)]) : s.drawBuffers(null, pick(r, fbs))),
        () => note("useProgram", s.useProgram(pick(r, progs))),
        () => s.setFlipSided(chance(r, 0.5)),
        () => s.setCullFace(lib.k("cullFace", pick(r, CULL_FACES))),
        () => s.setLineWidth(pick(r, [1, 1, 2, 3])),
        () => s.setPolygonOffset(chance(r, 0.5), pick(r, [0, 1, 2]), pick(r, [0, 1, 4])),
        () => s.setScissorTest(chance(r, 0.5)),
        () => (chance(r, 0.3) ? s.activeTexture() : s.activeTexture(gl.TEXTURE0 + int(r, 0, 4))),
        () => (chance(r, 0.3) ? s.bindTexture(pick(r, textureTypes), pick(r, texs)) : s.bindTexture(pick(r, textureTypes), pick(r, texs), gl.TEXTURE0 + int(r, 0, 4))),
        () => s.unbindTexture(),
        () => s.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
        () => s.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(8)),
        () => s.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([9, 8, 7, 6])),
        () => s.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)),
        () => s.texStorage2D(gl.TEXTURE_2D, int(r, 1, 3), gl.RGBA8, 4, 4),
        () => s.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 4, 4, 2),
        () => s.compressedTexImage2D(gl.TEXTURE_2D, 0, 0x83f0, 4, 4, 0, new Uint8Array(8)),
        () => s.compressedTexImage3D(gl.TEXTURE_2D_ARRAY, 0, 0x83f0, 4, 4, 1, 0, new Uint8Array(8)),
        () => s.compressedTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 4, 0x83f0, new Uint8Array(8)),
        () => s.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 4, 4, 1, 0x83f0, new Uint8Array(8)),
        () => s.scissor(new lib.Vector4(int(r, 0, 2), int(r, 0, 2), pick(r, [64, 32, 16]), pick(r, [32, 16]))),
        () => s.viewport(new lib.Vector4(int(r, 0, 2), int(r, 0, 2), pick(r, [64, 32, 16]), pick(r, [32, 16]))),
        () => { const g = pick(r, groups), p = progs[int(r, 1, 2)]; s.updateUBOMapping(g, p); s.uniformBlockBinding(g, p); },
        () => s.buffers.color.setMask(chance(r, 0.7)),
        () => s.buffers.color.setLocked(chance(r, 0.2)),
        () => s.buffers.color.setClear(int(r, 0, 4) / 4, int(r, 0, 4) / 4, int(r, 0, 4) / 4, int(r, 0, 4) / 4, chance(r, 0.5)),
        () => s.buffers.depth.setTest(chance(r, 0.6)),
        () => s.buffers.depth.setMask(chance(r, 0.6)),
        () => s.buffers.depth.setFunc(lib.k("depthFunc", pick(r, DEPTH_FUNCS))),
        () => s.buffers.depth.setLocked(chance(r, 0.2)),
        () => s.buffers.depth.setClear(pick(r, [0, 1, 0.5])),
        () => { s.buffers.depth.setReversed(chance(r, 0.5)); note("reversed", s.buffers.depth.getReversed()); },
        () => s.buffers.stencil.setTest(chance(r, 0.5)),
        () => s.buffers.stencil.setMask(pick(r, [0xff, 0x0f, 0])),
        () => s.buffers.stencil.setFunc(lib.k("compareFunc", pick(r, DEPTH_FUNCS)), int(r, 0, 2), pick(r, [0xff, 1])),
        () => s.buffers.stencil.setOp(lib.k("stencilOp", pick(r, STENCIL_OPS)), lib.k("stencilOp", pick(r, STENCIL_OPS)), lib.k("stencilOp", pick(r, STENCIL_OPS))),
        () => s.buffers.stencil.setLocked(chance(r, 0.2)),
        () => s.buffers.stencil.setClear(int(r, 0, 2)),
        () => { if (chance(r, 0.15)) s.reset(); },
        () => { if (chance(r, 0.1)) { s.buffers.color.reset(); s.buffers.depth.reset(); s.buffers.stencil.reset(); } },
      ];
      for (let i = 0; i < 700; i++) pick(r, steps)();
    },
  },

  /** setBlending: every mode, premultiplied or not, and custom blending with every equation and factor. */
  "state.blending": {
    run(lib, gl, r, note) {
      const s = context(lib, gl).state;
      const error = console.error;
      let errors = 0;
      console.error = () => { errors++; };
      try {
        for (const b of BLENDINGS) for (const p of [false, true, false]) s.setBlending(lib.k("blending", b), lib.k("blendEquation", "add"), lib.k("blendFactor", "src-alpha"), lib.k("blendFactor", "one-minus-src-alpha"), null, null, null, new lib.Color(0, 0, 0), 0, p);
        for (const e of EQUATIONS) for (const f of FACTORS) {
          s.setBlending(lib.k("blending", "custom"), lib.k("blendEquation", e), lib.k("blendFactor", f), lib.k("blendFactor", pick(r, FACTORS)), null, null, null, new lib.Color(0, 0, 0), 0, false);
        }
        for (let i = 0; i < 300; i++) {
          const b = pick(r, BLENDINGS);
          const color = new lib.Color(int(r, 0, 2) / 2, int(r, 0, 2) / 2, int(r, 0, 2) / 2);
          s.setBlending(
            lib.k("blending", b),
            lib.k("blendEquation", pick(r, EQUATIONS)), lib.k("blendFactor", pick(r, FACTORS)), lib.k("blendFactor", pick(r, FACTORS)),
            chance(r, 0.5) ? null : lib.k("blendEquation", pick(r, EQUATIONS)),
            chance(r, 0.5) ? null : lib.k("blendFactor", pick(r, FACTORS)),
            chance(r, 0.5) ? null : lib.k("blendFactor", pick(r, FACTORS)),
            color, int(r, 0, 2) / 2, chance(r, 0.5),
          );
          if (chance(r, 0.05)) s.setBlending(lib.k("blending", pick(r, ["normal", "add"] as const)));
        }
      } finally {
        console.error = error;
      }
      note("errors", errors);
    },
  },

  /** setMaterial over random materials (every side, blending, depth, stencil, offset, coverage), front faces either way. */
  "state.materials": {
    run(lib, gl, r) {
      const s = context(lib, gl).state;
      const error = console.error;
      console.error = () => {};
      try {
        const pool = Array.from({ length: 40 }, () => material(lib, r));
        for (let i = 0; i < 400; i++) {
          s.setMaterial(pick(r, pool), chance(r, 0.2));
          if (chance(r, 0.03)) s.reset();
        }
      } finally {
        console.error = error;
      }
    },
  },

  /** Geometry uploads and updates: every array type and usage, update ranges merged, index buffers, through Objects once a frame. */
  "buffers.updates": {
    run(lib, gl, r, note) {
      const c = context(lib, gl);
      const types = Object.keys(ARRAYS) as (keyof typeof ARRAYS)[];
      const meshes = Array.from({ length: 6 }, (_, i) => {
        const g = new lib.Geometry();
        const count = int(r, 3, 24);
        g.setAttribute("position", attribute(lib, r, 3, count));
        if (chance(r, 0.7)) g.setAttribute("uv", attribute(lib, r, 2, count));
        g.setAttribute("tint", attribute(lib, r, 4, count, pick(r, types)));
        if (i % 2 === 0) {
          const index = new lib.Attribute(chance(r, 0.5) ? new Uint16Array(values(r, "Uint16Array", count * 2).map((v) => v % count)) : new Uint32Array(values(r, "Uint32Array", count * 2).map((v) => v % count)), 1);
          g.setIndex(index);
        }
        return new lib.Mesh(g, material(lib, r, "FlatMaterial"));
      });
      for (let frame = 0; frame < 30; frame++) {
        c.info.render.frame++;
        for (const m of meshes) {
          if (chance(r, 0.8)) {
            const g = c.objects.update(m);
            if (g.index !== null) c.attributes.update(g.index, gl.ELEMENT_ARRAY_BUFFER);
          }
          if (chance(r, 0.4)) {
            const names = Object.keys(m.geometry.attributes);
            edit(r, m.geometry.attributes[pick(r, names)]);
          }
          if (m.geometry.index !== null && chance(r, 0.2)) edit(r, m.geometry.index);
          if (chance(r, 0.05)) c.objects.update(m); // (again within the frame: nothing)
        }
        if (chance(r, 0.1)) c.objects.dispose();
      }
      note("memory", { ...c.info.memory });
      const g0 = meshes[0]!.geometry;
      note("buffer", c.attributes.get(g0.attributes.position) !== undefined);
      // (resizing is refused, as r180 refuses it)
      const p = g0.attributes.position;
      p.array = new Float32Array(p.array.length + 3);
      p.needsUpdate = true;
      try { c.attributes.update(p, gl.ARRAY_BUFFER); note("resize", "ok"); } catch { note("resize", "refused"); }
      for (const m of meshes) m.geometry.dispatchEvent({ type: "dispose" });
      note("memory after dispose", { ...c.info.memory });
      for (const m of meshes) note("buffer after dispose", c.attributes.get(m.geometry.attributes.tint) === undefined);
    },
  },

  /** Draws: meshes and instances through binding states and both buffer renderers, programs and geometries swapped, VAOs released. */
  "draws.scene": {
    run(lib, gl, r, note) {
      const c = context(lib, gl);
      const programs = [
        program(gl, 1, ["position", "normal", "uv"]),
        program(gl, 2, ["position", "uv", "missing", "color"]),
        program(gl, 3, ["position", "normal", "instanceMatrix", "instanceColor"]),
        program(gl, 4, ["position", "tint", "index8", "instanceMatrix"]),
        program(gl, 5, ["position", "offset", "weight"]),
      ];
      // (custom materials' default values fill the attributes a geometry lacks: vertexAttrib1fv..4fv)
      const customs = Array.from({ length: 3 }, () => {
        const custom = material(lib, r, "CustomMaterial");
        custom.defaultAttributeValues = { color: [1, 0.5, 0.25, 1], uv: [0.5, 0.5], normal: [0, 0, 1], weight: [0.75], tint: [0.25, 0.5, 0.75], index8: [2] };
        return custom;
      });
      const materials = [...Array.from({ length: 8 }, () => material(lib, r)), ...customs];
      const geometry = (indexed: boolean, extras: boolean): Any => {
        const g = new lib.Geometry();
        const count = int(r, 3, 12);
        g.setAttribute("position", attribute(lib, r, 3, count));
        if (chance(r, 0.8)) g.setAttribute("normal", attribute(lib, r, 3, count));
        if (chance(r, 0.6)) g.setAttribute("uv", attribute(lib, r, 2, count));
        if (extras) {
          g.setAttribute("tint", attribute(lib, r, 4, count, pick(r, ["Uint8Array", "Float32Array", "Int16Array"] as const)));
          g.setAttribute("index8", attribute(lib, r, 1, count, pick(r, ["Int32Array", "Uint32Array", "Uint8Array"] as const)));
          // (an instanced attribute on a plain mesh: r180 notes _maxInstanceCount on the geometry)
          if (chance(r, 0.5)) g.setAttribute("offset", attribute(lib, r, 3, int(r, 2, 5), "Float32Array", true));
        }
        if (indexed) g.setIndex(new lib.Attribute(new Uint16Array(values(r, "Uint16Array", count * 3).map((v) => v % count)), 1));
        if (chance(r, 0.3)) g.setDrawRange(int(r, 0, 2), int(r, 3, 9));
        return g;
      };
      const objects: Any[] = [];
      for (let i = 0; i < 6; i++) objects.push(new lib.Mesh(geometry(i % 2 === 0, i % 3 === 0), pick(r, materials)));
      for (let i = 0; i < 4; i++) {
        const n = int(r, 0, 4);
        const inst = new lib.Instances(geometry(i % 2 === 1, i === 3), pick(r, materials), n);
        for (let j = 0; j < n; j++) inst.setMatrixAt(j, mat(lib, r));
        if (i % 2 === 0 && n > 0) for (let j = 0; j < n; j++) inst.setColorAt(j, new lib.Color(int(r, 0, 4) / 4, int(r, 0, 4) / 4, int(r, 0, 4) / 4));
        objects.push(inst);
      }
      const modes = [gl.TRIANGLES, gl.TRIANGLES, gl.LINES, gl.LINE_STRIP, gl.LINE_LOOP, gl.POINTS];
      const error = console.error;
      console.error = () => {};
      try {
        for (let frame = 0; frame < 25; frame++) {
          c.info.render.frame++;
          if (c.info.autoReset) c.info.reset();
          for (const object of objects) {
            if (chance(r, 0.15)) continue;
            const mtl = object.material;
            const prog = object.isInstancedMesh ? pick(r, [programs[2], programs[3], programs[0]]) : pick(r, programs);
            c.state.setMaterial(mtl, chance(r, 0.1));
            const g = c.objects.update(object);
            let index = g.index;
            const wire = mtl.wireframe === true;
            if (wire) index = c.geometries.getWireframeAttribute(g);
            c.bindingStates.setup(object, mtl, prog, g, index);
            const renderer = index !== null && index !== undefined ? c.indexedBufferRenderer : c.bufferRenderer;
            if (index !== null && index !== undefined) renderer.setIndex(c.attributes.get(index));
            renderer.setMode(wire ? gl.LINES : pick(r, modes));
            const start = g.drawRange.start, count = Math.min(g.drawRange.count, index ? index.count : g.attributes.position.count) - start;
            if (object.isInstancedMesh) renderer.renderInstances(start, count, object.count);
            else if (g._maxInstanceCount !== undefined) renderer.renderInstances(start, count, g._maxInstanceCount);
            else renderer.render(start, count);
          }
          // (between frames: edits, instance updates, swaps, releases)
          for (const object of objects) {
            if (chance(r, 0.2)) edit(r, pick(r, Object.values(object.geometry.attributes)));
            if (object.isInstancedMesh && object.count > 0 && chance(r, 0.4)) {
              const j = int(r, 0, object.count - 1);
              object.setMatrixAt(j, mat(lib, r));
              if (chance(r, 0.5)) object.instanceMatrix.addUpdateRange(j * 16, 16);
              object.instanceMatrix.needsUpdate = true;
              if (object.instanceColor !== null && chance(r, 0.5)) { object.setColorAt(j, new lib.Color(1, 0, 0)); object.instanceColor.needsUpdate = true; }
            }
            if (object.isInstancedMesh && chance(r, 0.1)) object.count = int(r, 0, object.instanceMatrix.count);
            if (object.geometry.index !== null && chance(r, 0.05)) edit(r, object.geometry.index);
          }
          if (chance(r, 0.2)) { const o = pick(r, objects); o.material = pick(r, materials); }
          if (chance(r, 0.1)) { const o = pick(r, objects.filter((x) => !x.isInstancedMesh)); o.geometry.dispatchEvent({ type: "dispose" }); o.geometry = geometry(chance(r, 0.5), chance(r, 0.3)); }
          if (chance(r, 0.08)) { const o = pick(r, objects.filter((x) => x.isInstancedMesh)); o.dispose(); }
          if (chance(r, 0.08)) c.bindingStates.releaseStatesOfProgram(pick(r, programs));
          if (chance(r, 0.1)) c.bindingStates.reset();
          if (chance(r, 0.05)) c.bindingStates.resetDefaultState();
          if (chance(r, 0.05)) { c.bindingStates.initAttributes(); c.bindingStates.enableAttribute(int(r, 0, 3)); c.bindingStates.disableUnusedAttributes(); }
          note("render", { ...c.info.render });
        }
      } finally {
        console.error = error;
      }
      note("memory", { ...c.info.memory });
      c.bindingStates.dispose();
      note("unknown mode", (() => { const e = console.error; let n = 0; console.error = () => { n++; }; c.info.update(3, 12345, 1); console.error = e; return n; })());
    },
  },

  /** Properties and the animation loop (no GL: their readings are the log). */
  "properties.animation": {
    run(lib, _gl, r, note) {
      const p = lib.createProperties();
      const a = {}, b = {};
      note("has a", p.has(a));
      const pa = p.get(a);
      pa.x = 1;
      note("get a again", p.get(a) === pa);
      note("has a", p.has(a));
      p.update(a, "y", 2);
      note("a", { ...p.get(a) });
      p.remove(a);
      note("has a after remove", p.has(a));
      p.get(b).z = 3;
      p.dispose();
      note("has b after dispose", p.has(b));

      const anim = lib.createAnimation();
      let next = 0;
      const pending = new Map<number, (t: number, f?: unknown) => void>();
      const host = {
        requestAnimationFrame(cb: (t: number) => void) { next++; pending.set(next, cb); note("raf", next); return next; },
        cancelAnimationFrame(id: number) { pending.delete(id); note("cancel", id); },
      };
      anim.setContext(host);
      anim.start(); // (no loop yet: nothing)
      anim.setAnimationLoop((t: number, f: unknown) => note("loop", [t, f ?? null]));
      anim.start();
      anim.start(); // (already running: nothing)
      for (let i = 0; i < 5; i++) {
        const [id, cb] = [...pending.entries()][0]!;
        pending.delete(id);
        cb(i * 16 + int(r, 0, 3), i === 2 ? "frame" : undefined);
      }
      anim.stop();
      anim.setAnimationLoop(null);
      anim.start();
      note("pending", pending.size);
    },
  },
};

/** Runs one script against a fresh stand-in and gives back its log. */
export function runCase(name: string, c: GLCase, lib: GLLib, makeStandIn: (o?: StandInOptions) => { canvas: { getContext(id: string, a?: unknown): unknown }; calls: Call[] }, rng: (seed: number) => Rng): Call[] {
  const s = makeStandIn(c.options);
  const gl = s.canvas.getContext("webgl2") as WebGL2RenderingContext;
  s.calls.length = 0;
  const seed = [...name].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
  c.run(lib, gl, rng(seed), (what, value) => { s.calls.push([`@${what}`, structuredClone(value)]); });
  return s.calls;
}
