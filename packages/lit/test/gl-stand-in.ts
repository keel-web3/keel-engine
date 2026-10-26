// A WebGL2 stand-in that records what it's asked to do: the renderer's
// bookkeeping without a GPU, and the parity tests' witness. r180's modules and
// keel/lit's, driven the same way through two stand-ins, must leave the same
// log: the same calls with the same arguments, in the same order. (Same calls
// + the same shaders = the same pixels; the pixels themselves are checked in
// the browser.)
//
// What it knows:
//   - every WebGL2 constant, by its real value (gl.TRIANGLES is 4), and every
//     WebGL2 method by name; anything else on `gl` is undefined, as on a real
//     context. Setting a property (drawingBufferColorSpace, unpackColorSpace)
//     is recorded as ["=name", value].
//   - each call is logged as [name, ...args], args snapshotted: typed arrays
//     copied ({ Float32Array: [...] }), GL objects as "#buffer3" (ids count up
//     per stand-in, so two stand-ins driven alike name alike), functions as
//     "<function>". Extension methods log as "EXT_name.method"; canvas
//     methods as "canvas.method".
//   - getParameter answers sensible desktop limits (16 vertex attributes, 16
//     texture units, 32 combined, 16384 textures, 4 samples...), the bound
//     objects it has seen (CURRENT_PROGRAM, ARRAY_BUFFER_BINDING, the
//     framebuffers, VERTEX_ARRAY_BINDING, ACTIVE_TEXTURE, TEXTURE_BINDING_*),
//     VIEWPORT / SCISSOR_BOX as last set, pixelStorei values; null for an
//     enum it doesn't know. Override any with `parameters`.
//   - getExtension answers the extensions r180 asks about with objects
//     carrying their real constants (EXT_clip_control, EXT_texture_filter_
//     anisotropic, KHR_parallel_shader_compile, WEBGL_multi_draw, the s3tc /
//     bptc / rgtc compressions, WEBGL_lose_context, WEBGL_debug_*, the colour
//     buffer float extensions...), the same object each time; null for the
//     WebGL1-only and prefixed names and for anything left out of
//     `extensions` (default: DEFAULT_EXTENSIONS, a desktop Chrome).
//   - shaders: shaderSource keeps the text; linkProgram reads both shaders
//     through a small GLSL preprocessor (#define, #ifdef / #ifndef / #if /
//     #elif / #else / #endif with defined() and integer arithmetic) and lists
//     the program's active uniforms (structs and arrays expanded the way GL
//     names them: "lights[0].color", "bones[0]") and attributes (with
//     bindAttribLocation honoured, matrices taking 2-4 locations). As a
//     compiler does, a declaration nobody reads is dropped (`prune: false`
//     keeps them all). getActiveUniform / getActiveAttrib give {name, size,
//     type} with real type enums; getUniformLocation gives a location object
//     ("#program3:name") or null; getUniformBlockIndex finds std140 blocks.
//   - everything compiles, links and completes; queries are available
//     (QUERY_RESULT 4.25e6 ns); syncs are signalled; readPixels fills a
//     deterministic pattern.

/** One recorded call: its name, then a snapshot of each argument. */
export type Call = [string, ...unknown[]];

export interface StandInOptions {
  width?: number;
  height?: number;
  /** The extensions getExtension answers (default DEFAULT_EXTENSIONS). */
  extensions?: readonly string[];
  /** Adds EXT_disjoint_timer_query_webgl2 to the extensions. */
  timer?: boolean;
  /** getParameter answers to override, by enum value. */
  parameters?: Readonly<Record<number, unknown>>;
  /** Drop uniforms and attributes the shader text never reads (default true). */
  prune?: boolean;
  /** getShaderPrecisionFormat's precision for HIGH_FLOAT / MEDIUM_FLOAT (default 23 / 23: desktop). */
  precision?: { high?: number; medium?: number };
}

export interface StandInCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  getContext(id: string, attributes?: unknown): WebGL2RenderingContext | null;
  addEventListener(type: string, listener: unknown, options?: unknown): void;
  removeEventListener(type: string, listener: unknown, options?: unknown): void;
}

export interface StandIn {
  canvas: StandInCanvas;
  /** The context (also canvas.getContext("webgl2")). */
  gl: WebGL2RenderingContext;
  calls: Call[];
  /** WebGL2's constants by name. */
  constants: Readonly<Record<string, number>>;
  /** The constant names with this value (for reading a log). */
  names(value: number): string[];
}

/** What a desktop Chrome answers (the WebGL1-only and vendor-prefixed names are null there). */
export const DEFAULT_EXTENSIONS: readonly string[] = Object.freeze([
  "EXT_clip_control", "EXT_color_buffer_float", "EXT_color_buffer_half_float", "EXT_conservative_depth",
  "EXT_depth_clamp", "EXT_float_blend", "EXT_polygon_offset_clamp", "EXT_render_snorm",
  "EXT_texture_compression_bptc", "EXT_texture_compression_rgtc", "EXT_texture_filter_anisotropic",
  "EXT_texture_mirror_clamp_to_edge", "EXT_texture_norm16", "KHR_parallel_shader_compile",
  "OES_draw_buffers_indexed", "OES_sample_variables", "OES_shader_multisample_interpolation",
  "OES_texture_float_linear", "OVR_multiview2", "WEBGL_blend_func_extended", "WEBGL_clip_cull_distance",
  "WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_s3tc_srgb", "WEBGL_debug_renderer_info",
  "WEBGL_debug_shaders", "WEBGL_lose_context", "WEBGL_multi_draw", "WEBGL_polygon_mode", "WEBGL_provoking_vertex",
]);

// (the extension objects: their constants, real values, and their methods, recorded)
const EXTENSIONS: Record<string, { constants?: Record<string, number>; methods?: readonly string[] }> = {
  EXT_clip_control: {
    constants: { LOWER_LEFT_EXT: 0x8ca1, UPPER_LEFT_EXT: 0x8ca2, NEGATIVE_ONE_TO_ONE_EXT: 0x935e, ZERO_TO_ONE_EXT: 0x935f, CLIP_ORIGIN_EXT: 0x935c, CLIP_DEPTH_MODE_EXT: 0x935d },
    methods: ["clipControlEXT"],
  },
  EXT_color_buffer_float: {},
  EXT_color_buffer_half_float: { constants: { RGBA16F_EXT: 0x881a, RGB16F_EXT: 0x881b, FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: 0x8211, UNSIGNED_NORMALIZED_EXT: 0x8c17 } },
  EXT_conservative_depth: {},
  EXT_depth_clamp: { constants: { DEPTH_CLAMP_EXT: 0x864f } },
  EXT_disjoint_timer_query_webgl2: {
    constants: { QUERY_COUNTER_BITS_EXT: 0x8864, TIME_ELAPSED_EXT: 0x88bf, TIMESTAMP_EXT: 0x8e28, GPU_DISJOINT_EXT: 0x8fbb },
    methods: ["queryCounterEXT"],
  },
  EXT_float_blend: {},
  EXT_polygon_offset_clamp: { constants: { POLYGON_OFFSET_CLAMP_EXT: 0x8e1b }, methods: ["polygonOffsetClampEXT"] },
  EXT_render_snorm: {},
  EXT_texture_compression_bptc: {
    constants: { COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c, COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT: 0x8e8d, COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT: 0x8e8e, COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT: 0x8e8f },
  },
  EXT_texture_compression_rgtc: {
    constants: { COMPRESSED_RED_RGTC1_EXT: 0x8dbb, COMPRESSED_SIGNED_RED_RGTC1_EXT: 0x8dbc, COMPRESSED_RED_GREEN_RGTC2_EXT: 0x8dbd, COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT: 0x8dbe },
  },
  EXT_texture_filter_anisotropic: { constants: { TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff } },
  EXT_texture_mirror_clamp_to_edge: { constants: { MIRROR_CLAMP_TO_EDGE_EXT: 0x8743 } },
  EXT_texture_norm16: {
    constants: { R16_EXT: 0x822a, RG16_EXT: 0x822c, RGB16_EXT: 0x8054, RGBA16_EXT: 0x805b, R16_SNORM_EXT: 0x8f98, RG16_SNORM_EXT: 0x8f99, RGB16_SNORM_EXT: 0x8f9a, RGBA16_SNORM_EXT: 0x8f9b },
  },
  KHR_parallel_shader_compile: { constants: { MAX_SHADER_COMPILER_THREADS_KHR: 0x91b0, COMPLETION_STATUS_KHR: 0x91b1 }, methods: ["maxShaderCompilerThreadsKHR"] },
  OES_draw_buffers_indexed: { methods: ["enableiOES", "disableiOES", "blendEquationiOES", "blendEquationSeparateiOES", "blendFunciOES", "blendFuncSeparateiOES", "colorMaskiOES"] },
  OES_sample_variables: {},
  OES_shader_multisample_interpolation: {},
  OES_texture_float_linear: {},
  OVR_multiview2: {
    constants: { FRAMEBUFFER_ATTACHMENT_TEXTURE_NUM_VIEWS_OVR: 0x9630, FRAMEBUFFER_ATTACHMENT_TEXTURE_BASE_VIEW_INDEX_OVR: 0x9632, MAX_VIEWS_OVR: 0x9631, FRAMEBUFFER_INCOMPLETE_VIEW_TARGETS_OVR: 0x9633 },
    methods: ["framebufferTextureMultiviewOVR"],
  },
  WEBGL_blend_func_extended: { constants: { SRC1_COLOR_WEBGL: 0x88f9, SRC1_ALPHA_WEBGL: 0x8589, ONE_MINUS_SRC1_COLOR_WEBGL: 0x88fa, ONE_MINUS_SRC1_ALPHA_WEBGL: 0x88fb, MAX_DUAL_SOURCE_DRAW_BUFFERS_WEBGL: 0x88fc } },
  WEBGL_clip_cull_distance: {
    constants: {
      MAX_CLIP_DISTANCES_WEBGL: 0x0d32, MAX_CULL_DISTANCES_WEBGL: 0x82f9, MAX_COMBINED_CLIP_AND_CULL_DISTANCES_WEBGL: 0x82fa,
      CLIP_DISTANCE0_WEBGL: 0x3000, CLIP_DISTANCE1_WEBGL: 0x3001, CLIP_DISTANCE2_WEBGL: 0x3002, CLIP_DISTANCE3_WEBGL: 0x3003,
      CLIP_DISTANCE4_WEBGL: 0x3004, CLIP_DISTANCE5_WEBGL: 0x3005, CLIP_DISTANCE6_WEBGL: 0x3006, CLIP_DISTANCE7_WEBGL: 0x3007,
    },
  },
  WEBGL_compressed_texture_astc: {
    constants: {
      COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93b0, COMPRESSED_RGBA_ASTC_5x4_KHR: 0x93b1, COMPRESSED_RGBA_ASTC_5x5_KHR: 0x93b2, COMPRESSED_RGBA_ASTC_6x5_KHR: 0x93b3,
      COMPRESSED_RGBA_ASTC_6x6_KHR: 0x93b4, COMPRESSED_RGBA_ASTC_8x5_KHR: 0x93b5, COMPRESSED_RGBA_ASTC_8x6_KHR: 0x93b6, COMPRESSED_RGBA_ASTC_8x8_KHR: 0x93b7,
      COMPRESSED_RGBA_ASTC_10x5_KHR: 0x93b8, COMPRESSED_RGBA_ASTC_10x6_KHR: 0x93b9, COMPRESSED_RGBA_ASTC_10x8_KHR: 0x93ba, COMPRESSED_RGBA_ASTC_10x10_KHR: 0x93bb,
      COMPRESSED_RGBA_ASTC_12x10_KHR: 0x93bc, COMPRESSED_RGBA_ASTC_12x12_KHR: 0x93bd,
      COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR: 0x93d0, COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR: 0x93d1, COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR: 0x93d2,
      COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR: 0x93d3, COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR: 0x93d4, COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR: 0x93d5,
      COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR: 0x93d6, COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR: 0x93d7, COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR: 0x93d8,
      COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR: 0x93d9, COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR: 0x93da, COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR: 0x93db,
      COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR: 0x93dc, COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR: 0x93dd,
    },
    methods: ["getSupportedProfiles"],
  },
  WEBGL_compressed_texture_etc: {
    constants: {
      COMPRESSED_R11_EAC: 0x9270, COMPRESSED_SIGNED_R11_EAC: 0x9271, COMPRESSED_RG11_EAC: 0x9272, COMPRESSED_SIGNED_RG11_EAC: 0x9273,
      COMPRESSED_RGB8_ETC2: 0x9274, COMPRESSED_SRGB8_ETC2: 0x9275, COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9276,
      COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9277, COMPRESSED_RGBA8_ETC2_EAC: 0x9278, COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 0x9279,
    },
  },
  WEBGL_compressed_texture_pvrtc: {
    constants: { COMPRESSED_RGB_PVRTC_4BPPV1_IMG: 0x8c00, COMPRESSED_RGB_PVRTC_2BPPV1_IMG: 0x8c01, COMPRESSED_RGBA_PVRTC_4BPPV1_IMG: 0x8c02, COMPRESSED_RGBA_PVRTC_2BPPV1_IMG: 0x8c03 },
  },
  WEBGL_compressed_texture_s3tc: {
    constants: { COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0, COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f1, COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f2, COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f3 },
  },
  WEBGL_compressed_texture_s3tc_srgb: {
    constants: { COMPRESSED_SRGB_S3TC_DXT1_EXT: 0x8c4c, COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT: 0x8c4d, COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT: 0x8c4e, COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT: 0x8c4f },
  },
  WEBGL_debug_renderer_info: { constants: { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 } },
  WEBGL_debug_shaders: { methods: ["getTranslatedShaderSource"] },
  WEBGL_lose_context: { methods: ["loseContext", "restoreContext"] },
  WEBGL_multi_draw: { methods: ["multiDrawArraysWEBGL", "multiDrawElementsWEBGL", "multiDrawArraysInstancedWEBGL", "multiDrawElementsInstancedWEBGL"] },
  WEBGL_multisampled_render_to_texture: { methods: ["renderbufferStorageMultisampleEXT", "framebufferTexture2DMultisampleEXT"] },
  WEBGL_polygon_mode: { constants: { POLYGON_MODE_WEBGL: 0x0b40, POLYGON_OFFSET_LINE_WEBGL: 0x2a02, LINE_WEBGL: 0x1b01, FILL_WEBGL: 0x1b02 }, methods: ["polygonModeWEBGL"] },
  WEBGL_provoking_vertex: { constants: { FIRST_VERTEX_CONVENTION_WEBGL: 0x8e4d, LAST_VERTEX_CONVENTION_WEBGL: 0x8e4e, PROVOKING_VERTEX_WEBGL: 0x8e4f }, methods: ["provokingVertexWEBGL"] },
  WEBGL_render_shared_exponent: {},
};

// ---- GLSL, as far as a stand-in needs it

const TYPE_ENUM: Record<string, number> = {
  float: 0x1406, vec2: 0x8b50, vec3: 0x8b51, vec4: 0x8b52, int: 0x1404, ivec2: 0x8b53, ivec3: 0x8b54, ivec4: 0x8b55,
  uint: 0x1405, uvec2: 0x8dc6, uvec3: 0x8dc7, uvec4: 0x8dc8, bool: 0x8b56, bvec2: 0x8b57, bvec3: 0x8b58, bvec4: 0x8b59,
  mat2: 0x8b5a, mat3: 0x8b5b, mat4: 0x8b5c, mat2x3: 0x8b65, mat2x4: 0x8b66, mat3x2: 0x8b67, mat3x4: 0x8b68, mat4x2: 0x8b69, mat4x3: 0x8b6a,
  sampler2D: 0x8b5e, sampler3D: 0x8b5f, samplerCube: 0x8b60, sampler2DShadow: 0x8b62, sampler2DArray: 0x8dc1,
  sampler2DArrayShadow: 0x8dc4, samplerCubeShadow: 0x8dc5, isampler2D: 0x8dca, isampler3D: 0x8dcb, isamplerCube: 0x8dcc,
  isampler2DArray: 0x8dcf, usampler2D: 0x8dd2, usampler3D: 0x8dd3, usamplerCube: 0x8dd4, usampler2DArray: 0x8dd7,
};
// (how many attribute locations a type takes)
const LOCATIONS: Record<string, number> = { mat2: 2, mat3: 3, mat4: 4, mat2x3: 2, mat2x4: 2, mat3x2: 3, mat3x4: 3, mat4x2: 4, mat4x3: 4 };

type Macros = Map<string, string | null>; // (null: a function-like macro, defined but not expanded)

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

function expand(text: string, macros: Macros, depth = 0): string {
  if (depth > 16) return text;
  let changed = false;
  const out = text.replace(/\b[A-Za-z_]\w*\b/g, (id) => {
    const v = macros.get(id);
    if (typeof v === "string") { changed = true; return v; }
    return id;
  });
  return changed ? expand(out, macros, depth + 1) : out;
}

/** #if's integer arithmetic: || && ! == != < > <= >= + - * / % ( ), identifiers left over are 0. */
function evaluate(expr: string, macros: Macros): number {
  const pre = expr.replace(/\bdefined\s*\(\s*(\w+)\s*\)|\bdefined\s+(\w+)/g, (_m, a: string | undefined, b: string | undefined) => (macros.has((a ?? b)!) ? "1" : "0"));
  const text = expand(pre, macros);
  const tokens = text.match(/\d+(?:\.\d+)?|\|\||&&|==|!=|<=|>=|[A-Za-z_]\w*|[()!<>+\-*/%]/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const take = (): string | undefined => tokens[i++];
  const primary = (): number => {
    const t = take();
    if (t === "(") { const v = or(); take(); return v; }
    if (t === "!") return primary() ? 0 : 1;
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (t !== undefined && /^\d/.test(t)) return Math.trunc(Number(t));
    return 0;
  };
  const binary = (next: () => number, ops: Record<string, (a: number, b: number) => number>) => (): number => {
    let v = next();
    for (let op = peek(); op !== undefined && op in ops; op = peek()) { take(); v = ops[op]!(v, next()); }
    return v;
  };
  const mul = binary(primary, { "*": (a, b) => a * b, "/": (a, b) => (b ? Math.trunc(a / b) : 0), "%": (a, b) => (b ? a % b : 0) });
  const add = binary(mul, { "+": (a, b) => a + b, "-": (a, b) => a - b });
  const rel = binary(add, { "<": (a, b) => +(a < b), ">": (a, b) => +(a > b), "<=": (a, b) => +(a <= b), ">=": (a, b) => +(a >= b) });
  const eq = binary(rel, { "==": (a, b) => +(a === b), "!=": (a, b) => +(a !== b) });
  const and = binary(eq, { "&&": (a, b) => +(a !== 0 && b !== 0) });
  const or = binary(and, { "||": (a, b) => +(a !== 0 || b !== 0) });
  return or();
}

/** The text a compiler would see: directives applied, comments gone, inactive lines blanked. */
function preprocess(src: string): { text: string; macros: Macros } {
  const macros: Macros = new Map();
  const lines = stripComments(src.replace(/\\\n/g, " ")).split("\n");
  const out: string[] = [];
  // (each open #if: is this branch live, has any branch been taken, was the parent live)
  const stack: { live: boolean; taken: boolean; parent: boolean }[] = [];
  const live = (): boolean => (stack.length === 0 ? true : stack[stack.length - 1]!.live);
  for (const raw of lines) {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(raw);
    if (!m) { out.push(live() ? raw : ""); continue; }
    const dir = m[1]!, rest = m[2]!.trim();
    out.push("");
    if (dir === "ifdef" || dir === "ifndef" || dir === "if") {
      const parent = live();
      const cond = dir === "if" ? evaluate(rest, macros) !== 0 : macros.has(rest.split(/\s/)[0]!) === (dir === "ifdef");
      stack.push({ live: parent && cond, taken: cond, parent });
    } else if (dir === "elif") {
      const top = stack[stack.length - 1];
      if (top) { const cond = !top.taken && evaluate(rest, macros) !== 0; top.live = top.parent && cond; top.taken ||= cond; }
    } else if (dir === "else") {
      const top = stack[stack.length - 1];
      if (top) { top.live = top.parent && !top.taken; top.taken = true; }
    } else if (dir === "endif") {
      stack.pop();
    } else if (!live()) {
      continue;
    } else if (dir === "define") {
      const d = /^(\w+)(\()?\s*(.*)$/.exec(rest);
      if (d) macros.set(d[1]!, d[2] ? null : d[3]!.trim());
    } else if (dir === "undef") {
      macros.delete(rest.split(/\s/)[0]!);
    }
  }
  return { text: out.join("\n"), macros };
}

interface Decl { name: string; type: string; size: number }
interface Active { name: string; size: number; type: number; base: string }
interface Parsed { uniforms: Active[]; attributes: (Decl & { locations: number })[]; blocks: string[]; text: string }

/** The global declarations of one shader: uniforms (struct and array expanded), attributes, uniform blocks. */
function parseShader(src: string, vertex: boolean): Parsed {
  const { text, macros } = preprocess(src);
  const structs = new Map<string, Decl[]>();
  const uniforms: Active[] = [];
  const attributes: (Decl & { locations: number })[] = [];
  const blocks: string[] = [];
  const arraySize = (s: string | undefined): number => (s === undefined ? 0 : evaluate(s, macros));
  const declarators = (list: string, type: string): Decl[] => list.split(",").map((part) => {
    const d = /^\s*(\w+)\s*(?:\[([^\]]*)\])?\s*$/.exec(part);
    return d ? { name: d[1]!, type, size: arraySize(d[2]) } : null;
  }).filter((d): d is Decl => d !== null);
  // (structs first: a uniform may name one)
  for (const m of text.matchAll(/\bstruct\s+(\w+)\s*\{([^}]*)\}/g)) {
    const members: Decl[] = [];
    for (const f of m[2]!.matchAll(/(?:\b(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g)) members.push(...declarators(f[2]!, f[1]!));
    structs.set(m[1]!, members);
  }
  const flatten = (prefix: string, d: Decl, base: string): void => {
    const struct = structs.get(d.type);
    if (struct === undefined) {
      const type = TYPE_ENUM[d.type];
      if (type === undefined) return;
      uniforms.push(d.size > 0 ? { name: `${prefix}${d.name}[0]`, size: d.size, type, base } : { name: `${prefix}${d.name}`, size: 1, type, base });
      return;
    }
    const count = d.size > 0 ? d.size : 1;
    for (let i = 0; i < count; i++) {
      const at = d.size > 0 ? `${prefix}${d.name}[${i}].` : `${prefix}${d.name}.`;
      for (const member of struct) flatten(at, member, base);
    }
  };
  // (global scope only: blank out every brace body but uniform blocks', reading those as blocks)
  let depth = 0;
  let global = "";
  for (const m of text.matchAll(/\b(?:layout\s*\([^)]*\)\s*)?uniform\s+(\w+)\s*\{|[{}]|[^{}]+/g)) {
    const t = m[0];
    if (m[1] !== undefined) { if (depth === 0) blocks.push(m[1]); depth++; continue; }
    if (t === "{") depth++;
    else if (t === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) global += t;
    else global += t.replace(/[^\n]/g, " ");
  }
  for (const m of global.matchAll(/(?<=^|[;\n])\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;{]+);/g)) {
    for (const d of declarators(m[2]!, m[1]!)) flatten("", d, d.name);
  }
  if (vertex) {
    for (const m of global.matchAll(/(?<=^|[;\n])\s*(?:layout\s*\([^)]*\)\s*)?(?:in|attribute)\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g)) {
      for (const d of declarators(m[2]!, m[1]!)) if (TYPE_ENUM[d.type] !== undefined) attributes.push({ ...d, locations: LOCATIONS[d.type] ?? 1 });
    }
  }
  return { uniforms, attributes, blocks, text };
}

/** Does `name` appear in the text more times than it is declared (i.e. does anything read it)? */
function used(name: string, texts: readonly string[], declarations: number): boolean {
  const re = new RegExp(`\\b${name}\\b`, "g");
  let n = 0;
  for (const t of texts) n += (t.match(re) ?? []).length;
  return n > declarations;
}

// ---- WebGL2's constants (real values, hex) and methods, from TypeScript's lib.dom.d.ts

const CONSTANT_TABLE = `
ACTIVE_ATTRIBUTES=8b89 ACTIVE_TEXTURE=84e0 ACTIVE_UNIFORMS=8b86 ACTIVE_UNIFORM_BLOCKS=8a36
ALIASED_LINE_WIDTH_RANGE=846e ALIASED_POINT_SIZE_RANGE=846d ALPHA=1906 ALPHA_BITS=d55 ALREADY_SIGNALED=911a
ALWAYS=207 ANY_SAMPLES_PASSED=8c2f ANY_SAMPLES_PASSED_CONSERVATIVE=8d6a ARRAY_BUFFER=8892
ARRAY_BUFFER_BINDING=8894 ATTACHED_SHADERS=8b85 BACK=405 BLEND=be2 BLEND_COLOR=8005 BLEND_DST_ALPHA=80ca
BLEND_DST_RGB=80c8 BLEND_EQUATION=8009 BLEND_EQUATION_ALPHA=883d BLEND_EQUATION_RGB=8009 BLEND_SRC_ALPHA=80cb
BLEND_SRC_RGB=80c9 BLUE_BITS=d54 BOOL=8b56 BOOL_VEC2=8b57 BOOL_VEC3=8b58 BOOL_VEC4=8b59
BROWSER_DEFAULT_WEBGL=9244 BUFFER_SIZE=8764 BUFFER_USAGE=8765 BYTE=1400 CCW=901 CLAMP_TO_EDGE=812f COLOR=1800
COLOR_ATTACHMENT0=8ce0 COLOR_ATTACHMENT1=8ce1 COLOR_ATTACHMENT10=8cea COLOR_ATTACHMENT11=8ceb
COLOR_ATTACHMENT12=8cec COLOR_ATTACHMENT13=8ced COLOR_ATTACHMENT14=8cee COLOR_ATTACHMENT15=8cef
COLOR_ATTACHMENT2=8ce2 COLOR_ATTACHMENT3=8ce3 COLOR_ATTACHMENT4=8ce4 COLOR_ATTACHMENT5=8ce5
COLOR_ATTACHMENT6=8ce6 COLOR_ATTACHMENT7=8ce7 COLOR_ATTACHMENT8=8ce8 COLOR_ATTACHMENT9=8ce9
COLOR_BUFFER_BIT=4000 COLOR_CLEAR_VALUE=c22 COLOR_WRITEMASK=c23 COMPARE_REF_TO_TEXTURE=884e
COMPILE_STATUS=8b81 COMPRESSED_TEXTURE_FORMATS=86a3 CONDITION_SATISFIED=911c CONSTANT_ALPHA=8003
CONSTANT_COLOR=8001 CONTEXT_LOST_WEBGL=9242 COPY_READ_BUFFER=8f36 COPY_READ_BUFFER_BINDING=8f36
COPY_WRITE_BUFFER=8f37 COPY_WRITE_BUFFER_BINDING=8f37 CULL_FACE=b44 CULL_FACE_MODE=b45 CURRENT_PROGRAM=8b8d
CURRENT_QUERY=8865 CURRENT_VERTEX_ATTRIB=8626 CW=900 DECR=1e03 DECR_WRAP=8508 DELETE_STATUS=8b80 DEPTH=1801
DEPTH24_STENCIL8=88f0 DEPTH32F_STENCIL8=8cad DEPTH_ATTACHMENT=8d00 DEPTH_BITS=d56 DEPTH_BUFFER_BIT=100
DEPTH_CLEAR_VALUE=b73 DEPTH_COMPONENT=1902 DEPTH_COMPONENT16=81a5 DEPTH_COMPONENT24=81a6
DEPTH_COMPONENT32F=8cac DEPTH_FUNC=b74 DEPTH_RANGE=b70 DEPTH_STENCIL=84f9 DEPTH_STENCIL_ATTACHMENT=821a
DEPTH_TEST=b71 DEPTH_WRITEMASK=b72 DITHER=bd0 DONT_CARE=1100 DRAW_BUFFER0=8825 DRAW_BUFFER1=8826
DRAW_BUFFER10=882f DRAW_BUFFER11=8830 DRAW_BUFFER12=8831 DRAW_BUFFER13=8832 DRAW_BUFFER14=8833
DRAW_BUFFER15=8834 DRAW_BUFFER2=8827 DRAW_BUFFER3=8828 DRAW_BUFFER4=8829 DRAW_BUFFER5=882a DRAW_BUFFER6=882b
DRAW_BUFFER7=882c DRAW_BUFFER8=882d DRAW_BUFFER9=882e DRAW_FRAMEBUFFER=8ca9 DRAW_FRAMEBUFFER_BINDING=8ca6
DST_ALPHA=304 DST_COLOR=306 DYNAMIC_COPY=88ea DYNAMIC_DRAW=88e8 DYNAMIC_READ=88e9 ELEMENT_ARRAY_BUFFER=8893
ELEMENT_ARRAY_BUFFER_BINDING=8895 EQUAL=202 FASTEST=1101 FLOAT=1406 FLOAT_32_UNSIGNED_INT_24_8_REV=8dad
FLOAT_MAT2=8b5a FLOAT_MAT3=8b5b FLOAT_MAT4=8b5c FLOAT_VEC2=8b50 FLOAT_VEC3=8b51 FLOAT_VEC4=8b52
FRAGMENT_SHADER=8b30 FRAGMENT_SHADER_DERIVATIVE_HINT=8b8b FRAMEBUFFER=8d40
FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE=8215 FRAMEBUFFER_ATTACHMENT_BLUE_SIZE=8214
FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING=8210 FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE=8211
FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE=8216 FRAMEBUFFER_ATTACHMENT_GREEN_SIZE=8213
FRAMEBUFFER_ATTACHMENT_OBJECT_NAME=8cd1 FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE=8cd0
FRAMEBUFFER_ATTACHMENT_RED_SIZE=8212 FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE=8217
FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE=8cd3 FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER=8cd4
FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL=8cd2 FRAMEBUFFER_BINDING=8ca6 FRAMEBUFFER_COMPLETE=8cd5
FRAMEBUFFER_DEFAULT=8218 FRAMEBUFFER_INCOMPLETE_ATTACHMENT=8cd6 FRAMEBUFFER_INCOMPLETE_DIMENSIONS=8cd9
FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT=8cd7 FRAMEBUFFER_INCOMPLETE_MULTISAMPLE=8d56
FRAMEBUFFER_UNSUPPORTED=8cdd FRONT=404 FRONT_AND_BACK=408 FRONT_FACE=b46 FUNC_ADD=8006
FUNC_REVERSE_SUBTRACT=800b FUNC_SUBTRACT=800a GENERATE_MIPMAP_HINT=8192 GEQUAL=206 GREATER=204 GREEN_BITS=d53
HALF_FLOAT=140b HIGH_FLOAT=8df2 HIGH_INT=8df5 IMPLEMENTATION_COLOR_READ_FORMAT=8b9b
IMPLEMENTATION_COLOR_READ_TYPE=8b9a INCR=1e02 INCR_WRAP=8507 INT=1404 INTERLEAVED_ATTRIBS=8c8c
INT_2_10_10_10_REV=8d9f INT_SAMPLER_2D=8dca INT_SAMPLER_2D_ARRAY=8dcf INT_SAMPLER_3D=8dcb
INT_SAMPLER_CUBE=8dcc INT_VEC2=8b53 INT_VEC3=8b54 INT_VEC4=8b55 INVALID_ENUM=500
INVALID_FRAMEBUFFER_OPERATION=506 INVALID_INDEX=ffffffff INVALID_OPERATION=502 INVALID_VALUE=501 INVERT=150a
KEEP=1e00 LEQUAL=203 LESS=201 LINEAR=2601 LINEAR_MIPMAP_LINEAR=2703 LINEAR_MIPMAP_NEAREST=2701 LINES=1
LINE_LOOP=2 LINE_STRIP=3 LINE_WIDTH=b21 LINK_STATUS=8b82 LOW_FLOAT=8df0 LOW_INT=8df3 LUMINANCE=1909
LUMINANCE_ALPHA=190a MAX=8008 MAX_3D_TEXTURE_SIZE=8073 MAX_ARRAY_TEXTURE_LAYERS=88ff
MAX_CLIENT_WAIT_TIMEOUT_WEBGL=9247 MAX_COLOR_ATTACHMENTS=8cdf MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS=8a33
MAX_COMBINED_TEXTURE_IMAGE_UNITS=8b4d MAX_COMBINED_UNIFORM_BLOCKS=8a2e
MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS=8a31 MAX_CUBE_MAP_TEXTURE_SIZE=851c MAX_DRAW_BUFFERS=8824
MAX_ELEMENTS_INDICES=80e9 MAX_ELEMENTS_VERTICES=80e8 MAX_ELEMENT_INDEX=8d6b MAX_FRAGMENT_INPUT_COMPONENTS=9125
MAX_FRAGMENT_UNIFORM_BLOCKS=8a2d MAX_FRAGMENT_UNIFORM_COMPONENTS=8b49 MAX_FRAGMENT_UNIFORM_VECTORS=8dfd
MAX_PROGRAM_TEXEL_OFFSET=8905 MAX_RENDERBUFFER_SIZE=84e8 MAX_SAMPLES=8d57 MAX_SERVER_WAIT_TIMEOUT=9111
MAX_TEXTURE_IMAGE_UNITS=8872 MAX_TEXTURE_LOD_BIAS=84fd MAX_TEXTURE_SIZE=d33
MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS=8c8a MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS=8c8b
MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS=8c80 MAX_UNIFORM_BLOCK_SIZE=8a30 MAX_UNIFORM_BUFFER_BINDINGS=8a2f
MAX_VARYING_COMPONENTS=8b4b MAX_VARYING_VECTORS=8dfc MAX_VERTEX_ATTRIBS=8869 MAX_VERTEX_OUTPUT_COMPONENTS=9122
MAX_VERTEX_TEXTURE_IMAGE_UNITS=8b4c MAX_VERTEX_UNIFORM_BLOCKS=8a2b MAX_VERTEX_UNIFORM_COMPONENTS=8b4a
MAX_VERTEX_UNIFORM_VECTORS=8dfb MAX_VIEWPORT_DIMS=d3a MEDIUM_FLOAT=8df1 MEDIUM_INT=8df4 MIN=8007
MIN_PROGRAM_TEXEL_OFFSET=8904 MIRRORED_REPEAT=8370 NEAREST=2600 NEAREST_MIPMAP_LINEAR=2702
NEAREST_MIPMAP_NEAREST=2700 NEVER=200 NICEST=1102 NOTEQUAL=205 OBJECT_TYPE=9112 ONE_MINUS_CONSTANT_ALPHA=8004
ONE_MINUS_CONSTANT_COLOR=8002 ONE_MINUS_DST_ALPHA=305 ONE_MINUS_DST_COLOR=307 ONE_MINUS_SRC_ALPHA=303
ONE_MINUS_SRC_COLOR=301 OUT_OF_MEMORY=505 PACK_ALIGNMENT=d05 PACK_ROW_LENGTH=d02 PACK_SKIP_PIXELS=d04
PACK_SKIP_ROWS=d03 PIXEL_PACK_BUFFER=88eb PIXEL_PACK_BUFFER_BINDING=88ed PIXEL_UNPACK_BUFFER=88ec
PIXEL_UNPACK_BUFFER_BINDING=88ef POINTS=0 POLYGON_OFFSET_FACTOR=8038 POLYGON_OFFSET_FILL=8037
POLYGON_OFFSET_UNITS=2a00 QUERY_RESULT=8866 QUERY_RESULT_AVAILABLE=8867 R11F_G11F_B10F=8c3a R16F=822d
R16I=8233 R16UI=8234 R32F=822e R32I=8235 R32UI=8236 R8=8229 R8I=8231 R8UI=8232 R8_SNORM=8f94
RASTERIZER_DISCARD=8c89 READ_BUFFER=c02 READ_FRAMEBUFFER=8ca8 READ_FRAMEBUFFER_BINDING=8caa RED=1903
RED_BITS=d52 RED_INTEGER=8d94 RENDERBUFFER=8d41 RENDERBUFFER_ALPHA_SIZE=8d53 RENDERBUFFER_BINDING=8ca7
RENDERBUFFER_BLUE_SIZE=8d52 RENDERBUFFER_DEPTH_SIZE=8d54 RENDERBUFFER_GREEN_SIZE=8d51 RENDERBUFFER_HEIGHT=8d43
RENDERBUFFER_INTERNAL_FORMAT=8d44 RENDERBUFFER_RED_SIZE=8d50 RENDERBUFFER_SAMPLES=8cab
RENDERBUFFER_STENCIL_SIZE=8d55 RENDERBUFFER_WIDTH=8d42 RENDERER=1f01 REPEAT=2901 REPLACE=1e01 RG=8227
RG16F=822f RG16I=8239 RG16UI=823a RG32F=8230 RG32I=823b RG32UI=823c RG8=822b RG8I=8237 RG8UI=8238
RG8_SNORM=8f95 RGB=1907 RGB10_A2=8059 RGB10_A2UI=906f RGB16F=881b RGB16I=8d89 RGB16UI=8d77 RGB32F=8815
RGB32I=8d83 RGB32UI=8d71 RGB565=8d62 RGB5_A1=8057 RGB8=8051 RGB8I=8d8f RGB8UI=8d7d RGB8_SNORM=8f96
RGB9_E5=8c3d RGBA=1908 RGBA16F=881a RGBA16I=8d88 RGBA16UI=8d76 RGBA32F=8814 RGBA32I=8d82 RGBA32UI=8d70
RGBA4=8056 RGBA8=8058 RGBA8I=8d8e RGBA8UI=8d7c RGBA8_SNORM=8f97 RGBA_INTEGER=8d99 RGB_INTEGER=8d98
RG_INTEGER=8228 SAMPLER_2D=8b5e SAMPLER_2D_ARRAY=8dc1 SAMPLER_2D_ARRAY_SHADOW=8dc4 SAMPLER_2D_SHADOW=8b62
SAMPLER_3D=8b5f SAMPLER_BINDING=8919 SAMPLER_CUBE=8b60 SAMPLER_CUBE_SHADOW=8dc5 SAMPLES=80a9
SAMPLE_ALPHA_TO_COVERAGE=809e SAMPLE_BUFFERS=80a8 SAMPLE_COVERAGE=80a0 SAMPLE_COVERAGE_INVERT=80ab
SAMPLE_COVERAGE_VALUE=80aa SCISSOR_BOX=c10 SCISSOR_TEST=c11 SEPARATE_ATTRIBS=8c8d SHADER_TYPE=8b4f
SHADING_LANGUAGE_VERSION=8b8c SHORT=1402 SIGNALED=9119 SIGNED_NORMALIZED=8f9c SRC_ALPHA=302
SRC_ALPHA_SATURATE=308 SRC_COLOR=300 SRGB=8c40 SRGB8=8c41 SRGB8_ALPHA8=8c43 STATIC_COPY=88e6 STATIC_DRAW=88e4
STATIC_READ=88e5 STENCIL=1802 STENCIL_ATTACHMENT=8d20 STENCIL_BACK_FAIL=8801 STENCIL_BACK_FUNC=8800
STENCIL_BACK_PASS_DEPTH_FAIL=8802 STENCIL_BACK_PASS_DEPTH_PASS=8803 STENCIL_BACK_REF=8ca3
STENCIL_BACK_VALUE_MASK=8ca4 STENCIL_BACK_WRITEMASK=8ca5 STENCIL_BITS=d57 STENCIL_BUFFER_BIT=400
STENCIL_CLEAR_VALUE=b91 STENCIL_FAIL=b94 STENCIL_FUNC=b92 STENCIL_INDEX8=8d48 STENCIL_PASS_DEPTH_FAIL=b95
STENCIL_PASS_DEPTH_PASS=b96 STENCIL_REF=b97 STENCIL_TEST=b90 STENCIL_VALUE_MASK=b93 STENCIL_WRITEMASK=b98
STREAM_COPY=88e2 STREAM_DRAW=88e0 STREAM_READ=88e1 SUBPIXEL_BITS=d50 SYNC_CONDITION=9113 SYNC_FENCE=9116
SYNC_FLAGS=9115 SYNC_FLUSH_COMMANDS_BIT=1 SYNC_GPU_COMMANDS_COMPLETE=9117 SYNC_STATUS=9114 TEXTURE=1702
TEXTURE0=84c0 TEXTURE1=84c1 TEXTURE10=84ca TEXTURE11=84cb TEXTURE12=84cc TEXTURE13=84cd TEXTURE14=84ce
TEXTURE15=84cf TEXTURE16=84d0 TEXTURE17=84d1 TEXTURE18=84d2 TEXTURE19=84d3 TEXTURE2=84c2 TEXTURE20=84d4
TEXTURE21=84d5 TEXTURE22=84d6 TEXTURE23=84d7 TEXTURE24=84d8 TEXTURE25=84d9 TEXTURE26=84da TEXTURE27=84db
TEXTURE28=84dc TEXTURE29=84dd TEXTURE3=84c3 TEXTURE30=84de TEXTURE31=84df TEXTURE4=84c4 TEXTURE5=84c5
TEXTURE6=84c6 TEXTURE7=84c7 TEXTURE8=84c8 TEXTURE9=84c9 TEXTURE_2D=de1 TEXTURE_2D_ARRAY=8c1a TEXTURE_3D=806f
TEXTURE_BASE_LEVEL=813c TEXTURE_BINDING_2D=8069 TEXTURE_BINDING_2D_ARRAY=8c1d TEXTURE_BINDING_3D=806a
TEXTURE_BINDING_CUBE_MAP=8514 TEXTURE_COMPARE_FUNC=884d TEXTURE_COMPARE_MODE=884c TEXTURE_CUBE_MAP=8513
TEXTURE_CUBE_MAP_NEGATIVE_X=8516 TEXTURE_CUBE_MAP_NEGATIVE_Y=8518 TEXTURE_CUBE_MAP_NEGATIVE_Z=851a
TEXTURE_CUBE_MAP_POSITIVE_X=8515 TEXTURE_CUBE_MAP_POSITIVE_Y=8517 TEXTURE_CUBE_MAP_POSITIVE_Z=8519
TEXTURE_IMMUTABLE_FORMAT=912f TEXTURE_IMMUTABLE_LEVELS=82df TEXTURE_MAG_FILTER=2800 TEXTURE_MAX_LEVEL=813d
TEXTURE_MAX_LOD=813b TEXTURE_MIN_FILTER=2801 TEXTURE_MIN_LOD=813a TEXTURE_WRAP_R=8072 TEXTURE_WRAP_S=2802
TEXTURE_WRAP_T=2803 TIMEOUT_EXPIRED=911b TRANSFORM_FEEDBACK=8e22 TRANSFORM_FEEDBACK_ACTIVE=8e24
TRANSFORM_FEEDBACK_BINDING=8e25 TRANSFORM_FEEDBACK_BUFFER=8c8e TRANSFORM_FEEDBACK_BUFFER_BINDING=8c8f
TRANSFORM_FEEDBACK_BUFFER_MODE=8c7f TRANSFORM_FEEDBACK_BUFFER_SIZE=8c85 TRANSFORM_FEEDBACK_BUFFER_START=8c84
TRANSFORM_FEEDBACK_PAUSED=8e23 TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN=8c88 TRANSFORM_FEEDBACK_VARYINGS=8c83
TRIANGLES=4 TRIANGLE_FAN=6 TRIANGLE_STRIP=5 UNIFORM_ARRAY_STRIDE=8a3c UNIFORM_BLOCK_ACTIVE_UNIFORMS=8a42
UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES=8a43 UNIFORM_BLOCK_BINDING=8a3f UNIFORM_BLOCK_DATA_SIZE=8a40
UNIFORM_BLOCK_INDEX=8a3a UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER=8a46
UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER=8a44 UNIFORM_BUFFER=8a11 UNIFORM_BUFFER_BINDING=8a28
UNIFORM_BUFFER_OFFSET_ALIGNMENT=8a34 UNIFORM_BUFFER_SIZE=8a2a UNIFORM_BUFFER_START=8a29
UNIFORM_IS_ROW_MAJOR=8a3e UNIFORM_MATRIX_STRIDE=8a3d UNIFORM_OFFSET=8a3b UNIFORM_SIZE=8a38 UNIFORM_TYPE=8a37
UNPACK_ALIGNMENT=cf5 UNPACK_COLORSPACE_CONVERSION_WEBGL=9243 UNPACK_FLIP_Y_WEBGL=9240 UNPACK_IMAGE_HEIGHT=806e
UNPACK_PREMULTIPLY_ALPHA_WEBGL=9241 UNPACK_ROW_LENGTH=cf2 UNPACK_SKIP_IMAGES=806d UNPACK_SKIP_PIXELS=cf4
UNPACK_SKIP_ROWS=cf3 UNSIGNALED=9118 UNSIGNED_BYTE=1401 UNSIGNED_INT=1405 UNSIGNED_INT_10F_11F_11F_REV=8c3b
UNSIGNED_INT_24_8=84fa UNSIGNED_INT_2_10_10_10_REV=8368 UNSIGNED_INT_5_9_9_9_REV=8c3e
UNSIGNED_INT_SAMPLER_2D=8dd2 UNSIGNED_INT_SAMPLER_2D_ARRAY=8dd7 UNSIGNED_INT_SAMPLER_3D=8dd3
UNSIGNED_INT_SAMPLER_CUBE=8dd4 UNSIGNED_INT_VEC2=8dc6 UNSIGNED_INT_VEC3=8dc7 UNSIGNED_INT_VEC4=8dc8
UNSIGNED_NORMALIZED=8c17 UNSIGNED_SHORT=1403 UNSIGNED_SHORT_4_4_4_4=8033 UNSIGNED_SHORT_5_5_5_1=8034
UNSIGNED_SHORT_5_6_5=8363 VALIDATE_STATUS=8b83 VENDOR=1f00 VERSION=1f02 VERTEX_ARRAY_BINDING=85b5
VERTEX_ATTRIB_ARRAY_BUFFER_BINDING=889f VERTEX_ATTRIB_ARRAY_DIVISOR=88fe VERTEX_ATTRIB_ARRAY_ENABLED=8622
VERTEX_ATTRIB_ARRAY_INTEGER=88fd VERTEX_ATTRIB_ARRAY_NORMALIZED=886a VERTEX_ATTRIB_ARRAY_POINTER=8645
VERTEX_ATTRIB_ARRAY_SIZE=8623 VERTEX_ATTRIB_ARRAY_STRIDE=8624 VERTEX_ATTRIB_ARRAY_TYPE=8625 VERTEX_SHADER=8b31
VIEWPORT=ba2 WAIT_FAILED=911d
`;

const METHOD_TABLE = `
activeTexture attachShader beginQuery beginTransformFeedback bindAttribLocation bindBuffer bindBufferBase
bindBufferRange bindFramebuffer bindRenderbuffer bindSampler bindTexture bindTransformFeedback bindVertexArray
blendColor blendEquation blendEquationSeparate blendFunc blendFuncSeparate blitFramebuffer bufferData
bufferSubData checkFramebufferStatus clear clearBufferfi clearBufferfv clearBufferiv clearBufferuiv clearColor
clearDepth clearStencil clientWaitSync colorMask compileShader compressedTexImage2D compressedTexImage3D
compressedTexSubImage2D compressedTexSubImage3D copyBufferSubData copyTexImage2D copyTexSubImage2D
copyTexSubImage3D createBuffer createFramebuffer createProgram createQuery createRenderbuffer createSampler
createShader createTexture createTransformFeedback createVertexArray cullFace deleteBuffer deleteFramebuffer
deleteProgram deleteQuery deleteRenderbuffer deleteSampler deleteShader deleteSync deleteTexture
deleteTransformFeedback deleteVertexArray depthFunc depthMask depthRange detachShader disable
disableVertexAttribArray drawArrays drawArraysInstanced drawBuffers drawElements drawElementsInstanced
drawRangeElements enable enableVertexAttribArray endQuery endTransformFeedback fenceSync finish flush
framebufferRenderbuffer framebufferTexture2D framebufferTextureLayer frontFace generateMipmap getActiveAttrib
getActiveUniform getActiveUniformBlockName getActiveUniformBlockParameter getActiveUniforms getAttachedShaders
getAttribLocation getBufferParameter getBufferSubData getContextAttributes getError getExtension
getFragDataLocation getFramebufferAttachmentParameter getIndexedParameter getInternalformatParameter
getParameter getProgramInfoLog getProgramParameter getQuery getQueryParameter getRenderbufferParameter
getSamplerParameter getShaderInfoLog getShaderParameter getShaderPrecisionFormat getShaderSource
getSupportedExtensions getSyncParameter getTexParameter getTransformFeedbackVarying getUniform
getUniformBlockIndex getUniformIndices getUniformLocation getVertexAttrib getVertexAttribOffset hint
invalidateFramebuffer invalidateSubFramebuffer isBuffer isContextLost isEnabled isFramebuffer isProgram
isQuery isRenderbuffer isSampler isShader isSync isTexture isTransformFeedback isVertexArray lineWidth
linkProgram pauseTransformFeedback pixelStorei polygonOffset readBuffer readPixels renderbufferStorage
renderbufferStorageMultisample resumeTransformFeedback sampleCoverage samplerParameterf samplerParameteri
scissor shaderSource stencilFunc stencilFuncSeparate stencilMask stencilMaskSeparate stencilOp
stencilOpSeparate texImage2D texImage3D texParameterf texParameteri texStorage2D texStorage3D texSubImage2D
texSubImage3D transformFeedbackVaryings uniform1f uniform1fv uniform1i uniform1iv uniform1ui uniform1uiv
uniform2f uniform2fv uniform2i uniform2iv uniform2ui uniform2uiv uniform3f uniform3fv uniform3i uniform3iv
uniform3ui uniform3uiv uniform4f uniform4fv uniform4i uniform4iv uniform4ui uniform4uiv uniformBlockBinding
uniformMatrix2fv uniformMatrix2x3fv uniformMatrix2x4fv uniformMatrix3fv uniformMatrix3x2fv uniformMatrix3x4fv
uniformMatrix4fv uniformMatrix4x2fv uniformMatrix4x3fv useProgram validateProgram vertexAttrib1f
vertexAttrib1fv vertexAttrib2f vertexAttrib2fv vertexAttrib3f vertexAttrib3fv vertexAttrib4f vertexAttrib4fv
vertexAttribDivisor vertexAttribI4i vertexAttribI4iv vertexAttribI4ui vertexAttribI4uiv vertexAttribIPointer
vertexAttribPointer viewport waitSync
`;

// ---- the stand-in

interface GLObject { readonly id: string }

const CONSTANTS: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(
  CONSTANT_TABLE.trim().split(/\s+/).map((pair) => { const [k, v] = pair.split("="); return [k!, parseInt(v!, 16)]; }),
));
const METHODS: ReadonlySet<string> = new Set(METHOD_TABLE.trim().split(/\s+/).concat(["makeXRCompatible"]));

export function standIn(options: StandInOptions = {}): StandIn {
  const { width = 300, height = 150, timer = false, prune = true } = options;
  const supported = new Set([...(options.extensions ?? DEFAULT_EXTENSIONS), ...(timer ? ["EXT_disjoint_timer_query_webgl2"] : [])]);
  const C = CONSTANTS;
  const calls: Call[] = [];
  const objects = new WeakSet<object>();
  const deleted = new WeakSet<object>();
  const counters = new Map<string, number>();
  const make = (kind: string, extra: Record<string, unknown> = {}): GLObject => {
    const n = (counters.get("") ?? 0) + 1;
    counters.set("", n);
    const o = { id: `${kind}${n}`, ...extra };
    objects.add(o);
    return o;
  };

  // (a snapshot, so later writes into a reused array don't rewrite history)
  const snap = (v: unknown): unknown => {
    if (typeof v === "function") return "<function>";
    if (v === null || typeof v !== "object") return v;
    if (objects.has(v)) return `#${(v as GLObject).id}`;
    if (ArrayBuffer.isView(v)) {
      if (v instanceof DataView) return { DataView: Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
      return { [v.constructor.name]: Array.from(v as unknown as ArrayLike<number>) };
    }
    if (v instanceof ArrayBuffer) return { ArrayBuffer: Array.from(new Uint8Array(v)) };
    if (Array.isArray(v)) return v.map(snap);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snap(x)]));
  };
  const record = (name: string, args: readonly unknown[]): void => { calls.push([name, ...args.map(snap)]); };

  // ---- what it remembers
  const params: Record<number, unknown> = {
    [C.VERSION!]: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
    [C.SHADING_LANGUAGE_VERSION!]: "WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)",
    [C.VENDOR!]: "WebKit", [C.RENDERER!]: "WebKit WebGL",
    [C.MAX_TEXTURE_SIZE!]: 16384, [C.MAX_CUBE_MAP_TEXTURE_SIZE!]: 16384, [C.MAX_RENDERBUFFER_SIZE!]: 16384,
    [C.MAX_3D_TEXTURE_SIZE!]: 2048, [C.MAX_ARRAY_TEXTURE_LAYERS!]: 2048,
    [C.MAX_TEXTURE_IMAGE_UNITS!]: 16, [C.MAX_VERTEX_TEXTURE_IMAGE_UNITS!]: 16, [C.MAX_COMBINED_TEXTURE_IMAGE_UNITS!]: 32,
    [C.MAX_VERTEX_ATTRIBS!]: 16, [C.MAX_VERTEX_UNIFORM_VECTORS!]: 1024, [C.MAX_FRAGMENT_UNIFORM_VECTORS!]: 1024,
    [C.MAX_VARYING_VECTORS!]: 30, [C.MAX_VARYING_COMPONENTS!]: 120, [C.MAX_VERTEX_UNIFORM_COMPONENTS!]: 4096,
    [C.MAX_FRAGMENT_UNIFORM_COMPONENTS!]: 4096, [C.MAX_VERTEX_OUTPUT_COMPONENTS!]: 64, [C.MAX_FRAGMENT_INPUT_COMPONENTS!]: 60,
    [C.MAX_SAMPLES!]: 4, [C.MAX_DRAW_BUFFERS!]: 8, [C.MAX_COLOR_ATTACHMENTS!]: 8,
    [C.MAX_UNIFORM_BUFFER_BINDINGS!]: 24, [C.MAX_UNIFORM_BLOCK_SIZE!]: 65536, [C.UNIFORM_BUFFER_OFFSET_ALIGNMENT!]: 256,
    [C.MAX_VERTEX_UNIFORM_BLOCKS!]: 12, [C.MAX_FRAGMENT_UNIFORM_BLOCKS!]: 12, [C.MAX_COMBINED_UNIFORM_BLOCKS!]: 24,
    [C.MAX_ELEMENT_INDEX!]: 4294967295, [C.MAX_ELEMENTS_VERTICES!]: 1048575, [C.MAX_ELEMENTS_INDICES!]: 1048575,
    [C.MAX_TEXTURE_LOD_BIAS!]: 2, [C.MAX_SERVER_WAIT_TIMEOUT!]: 0,
    [C.MAX_VIEWPORT_DIMS!]: new Int32Array([16384, 16384]),
    [C.ALIASED_LINE_WIDTH_RANGE!]: new Float32Array([1, 1]), [C.ALIASED_POINT_SIZE_RANGE!]: new Float32Array([1, 1024]),
    [C.IMPLEMENTATION_COLOR_READ_FORMAT!]: C.RGBA, [C.IMPLEMENTATION_COLOR_READ_TYPE!]: C.UNSIGNED_BYTE,
    [C.RED_BITS!]: 8, [C.GREEN_BITS!]: 8, [C.BLUE_BITS!]: 8, [C.ALPHA_BITS!]: 8, [C.DEPTH_BITS!]: 24, [C.STENCIL_BITS!]: 8,
    [C.SUBPIXEL_BITS!]: 4, [C.SAMPLES!]: 0, [C.SAMPLE_BUFFERS!]: 0,
    [C.PACK_ALIGNMENT!]: 4, [C.UNPACK_ALIGNMENT!]: 4, [C.UNPACK_FLIP_Y_WEBGL!]: false, [C.UNPACK_PREMULTIPLY_ALPHA_WEBGL!]: false,
    [C.UNPACK_COLORSPACE_CONVERSION_WEBGL!]: C.BROWSER_DEFAULT_WEBGL,
    [C.UNPACK_ROW_LENGTH!]: 0, [C.UNPACK_IMAGE_HEIGHT!]: 0, [C.UNPACK_SKIP_PIXELS!]: 0, [C.UNPACK_SKIP_ROWS!]: 0, [C.UNPACK_SKIP_IMAGES!]: 0,
    [C.PACK_ROW_LENGTH!]: 0, [C.PACK_SKIP_PIXELS!]: 0, [C.PACK_SKIP_ROWS!]: 0,
    [C.VIEWPORT!]: new Int32Array([0, 0, width, height]), [C.SCISSOR_BOX!]: new Int32Array([0, 0, width, height]),
    [C.ACTIVE_TEXTURE!]: C.TEXTURE0, [C.CURRENT_PROGRAM!]: null, [C.ARRAY_BUFFER_BINDING!]: null,
    [C.ELEMENT_ARRAY_BUFFER_BINDING!]: null, [C.FRAMEBUFFER_BINDING!]: null, [C.READ_FRAMEBUFFER_BINDING!]: null,
    [C.RENDERBUFFER_BINDING!]: null, [C.VERTEX_ARRAY_BINDING!]: null, [C.UNIFORM_BUFFER_BINDING!]: null,
    [C.TEXTURE_BINDING_2D!]: null, [C.TEXTURE_BINDING_CUBE_MAP!]: null, [C.TEXTURE_BINDING_3D!]: null, [C.TEXTURE_BINDING_2D_ARRAY!]: null,
    [0x84ff]: 16, // MAX_TEXTURE_MAX_ANISOTROPY_EXT
    [0x8fbb]: false, // GPU_DISJOINT_EXT
    [0x0d32]: 8, [0x82f9]: 8, [0x82fa]: 8, // the clip / cull distance limits
    [0x91b0]: 0, // MAX_SHADER_COMPILER_THREADS_KHR
    [0x9245]: "Stand-in", [0x9246]: "Stand-in WebGL2", // UNMASKED_VENDOR / RENDERER
    ...options.parameters,
  };
  const enabled = new Map<number, boolean>([[C.DITHER!, true]]);
  const textureBindings = new Map<number, Record<number, unknown>>(); // (unit -> target -> texture)
  const bindingParam: Record<number, number> = {
    [C.TEXTURE_2D!]: C.TEXTURE_BINDING_2D!, [C.TEXTURE_CUBE_MAP!]: C.TEXTURE_BINDING_CUBE_MAP!,
    [C.TEXTURE_3D!]: C.TEXTURE_BINDING_3D!, [C.TEXTURE_2D_ARRAY!]: C.TEXTURE_BINDING_2D_ARRAY!,
  };
  const bufferParam: Record<number, number> = {
    [C.ARRAY_BUFFER!]: C.ARRAY_BUFFER_BINDING!, [C.ELEMENT_ARRAY_BUFFER!]: C.ELEMENT_ARRAY_BUFFER_BINDING!,
    [C.UNIFORM_BUFFER!]: C.UNIFORM_BUFFER_BINDING!, [C.COPY_READ_BUFFER!]: C.COPY_READ_BUFFER_BINDING!,
    [C.COPY_WRITE_BUFFER!]: C.COPY_WRITE_BUFFER_BINDING!, [C.PIXEL_PACK_BUFFER!]: C.PIXEL_PACK_BUFFER_BINDING!,
    [C.PIXEL_UNPACK_BUFFER!]: C.PIXEL_UNPACK_BUFFER_BINDING!,
  };
  const sources = new Map<object, string>();
  const shaderTypes = new Map<object, number>();
  const attached = new Map<object, object[]>();
  const bound = new Map<object, Map<string, number>>(); // (bindAttribLocation)
  interface Linked { uniforms: Active[]; attributes: { name: string; size: number; type: number; location: number }[]; blocks: string[] }
  const linked = new Map<object, Linked>();
  const extensionObjects = new Map<string, object | null>();
  let contextAttributes: Record<string, unknown> = {};

  function link(p: object): Linked {
    const shaders = attached.get(p) ?? [];
    const parsed = shaders.map((s) => parseShader(sources.get(s) ?? "", shaderTypes.get(s) === C.VERTEX_SHADER));
    const texts = parsed.map((x) => x.text);
    const uniforms: Active[] = [];
    const seen = new Set<string>();
    // (each shader that declares a uniform names it once there: more mentions than that, and something reads it)
    const declaring = (base: string): number => parsed.filter((x) => x.uniforms.some((u) => u.base === base)).length;
    for (const x of parsed) {
      for (const u of x.uniforms) {
        if (seen.has(u.name)) continue;
        if (prune && !used(u.base, texts, declaring(u.base))) continue;
        seen.add(u.name);
        uniforms.push(u);
      }
    }
    const binds = bound.get(p) ?? new Map<string, number>();
    const attributes: Linked["attributes"] = [];
    const taken = new Set<number>();
    const decl = parsed.flatMap((x) => x.attributes).filter((a) => !prune || used(a.name, texts, 1));
    for (const a of decl) {
      const at = binds.get(a.name);
      if (at !== undefined) { for (let i = 0; i < a.locations; i++) taken.add(at + i); attributes.push({ name: a.name, size: Math.max(a.size, 1), type: TYPE_ENUM[a.type]!, location: at }); }
    }
    let next = 0;
    for (const a of decl) {
      if (binds.has(a.name)) continue;
      const fits = (at: number): boolean => { for (let i = 0; i < a.locations; i++) if (taken.has(at + i)) return false; return true; };
      while (!fits(next)) next++;
      for (let i = 0; i < a.locations; i++) taken.add(next + i);
      attributes.push({ name: a.name, size: Math.max(a.size, 1), type: TYPE_ENUM[a.type]!, location: next });
      next += a.locations;
    }
    const result = { uniforms, attributes, blocks: parsed.flatMap((x) => x.blocks).filter((b, i, all) => all.indexOf(b) === i) };
    linked.set(p, result);
    return result;
  }
  const linkedOf = (p: object): Linked => linked.get(p) ?? link(p);

  function extension(name: string): object | null {
    if (extensionObjects.has(name)) return extensionObjects.get(name)!;
    const def = EXTENSIONS[name];
    let ext: object | null = null;
    if (def !== undefined && supported.has(name)) {
      const o: Record<string, unknown> = { ...def.constants };
      for (const m of def.methods ?? []) {
        o[m] = (...args: unknown[]) => {
          record(`${name}.${m}`, args);
          if (m === "loseContext") lost = true;
          if (m === "restoreContext") lost = false;
          if (m === "getTranslatedShaderSource") return "";
          if (m === "getSupportedProfiles") return ["ldr"];
          return undefined;
        };
      }
      ext = o;
    } else if (def === undefined && supported.has(name)) {
      ext = {};
    }
    extensionObjects.set(name, ext);
    return ext;
  }
  let lost = false;

  const isObject = (v: unknown): v is object => v !== null && typeof v === "object" && objects.has(v);
  const alive = (v: unknown): boolean => isObject(v) && !deleted.has(v);

  // ---- the methods with answers (or side effects worth keeping); the rest just record
  const own: Record<string, (...a: any[]) => unknown> = {
    getParameter: (k: number) => {
      if (k in params) return params[k];
      return null;
    },
    getExtension: (name: string) => extension(name),
    getSupportedExtensions: () => [...supported].filter((n) => n in EXTENSIONS),
    getContextAttributes: () => ({ ...contextAttributes }),
    isContextLost: () => lost,
    getError: () => C.NO_ERROR,
    getShaderPrecisionFormat: (_shader: number, kind: number) => {
      const high = options.precision?.high ?? 23, medium = options.precision?.medium ?? 23;
      if (kind === C.HIGH_FLOAT) return { rangeMin: 127, rangeMax: 127, precision: high };
      if (kind === C.MEDIUM_FLOAT) return { rangeMin: 127, rangeMax: 127, precision: medium };
      if (kind === C.LOW_FLOAT) return { rangeMin: 127, rangeMax: 127, precision: 23 };
      return { rangeMin: 31, rangeMax: 30, precision: 0 };
    },
    enable: (cap: number) => { enabled.set(cap, true); },
    disable: (cap: number) => { enabled.set(cap, false); },
    isEnabled: (cap: number) => enabled.get(cap) === true,
    viewport: (x: number, y: number, w: number, h: number) => { params[C.VIEWPORT!] = new Int32Array([x, y, w, h]); },
    scissor: (x: number, y: number, w: number, h: number) => { params[C.SCISSOR_BOX!] = new Int32Array([x, y, w, h]); },
    pixelStorei: (k: number, v: unknown) => { params[k] = v; },
    useProgram: (p: unknown) => { params[C.CURRENT_PROGRAM!] = p ?? null; },
    bindBuffer: (target: number, b: unknown) => { const k = bufferParam[target]; if (k !== undefined) params[k] = b ?? null; },
    bindVertexArray: (v: unknown) => { params[C.VERTEX_ARRAY_BINDING!] = v ?? null; },
    bindRenderbuffer: (_t: number, r: unknown) => { params[C.RENDERBUFFER_BINDING!] = r ?? null; },
    bindFramebuffer: (target: number, f: unknown) => {
      if (target === C.FRAMEBUFFER || target === C.DRAW_FRAMEBUFFER) params[C.FRAMEBUFFER_BINDING!] = f ?? null;
      if (target === C.FRAMEBUFFER || target === C.READ_FRAMEBUFFER) params[C.READ_FRAMEBUFFER_BINDING!] = f ?? null;
    },
    activeTexture: (unit: number) => {
      params[C.ACTIVE_TEXTURE!] = unit;
      const b = textureBindings.get(unit) ?? {};
      for (const [target, k] of Object.entries(bindingParam)) params[k] = b[Number(target)] ?? null;
    },
    bindTexture: (target: number, t: unknown) => {
      const unit = params[C.ACTIVE_TEXTURE!] as number;
      const b = textureBindings.get(unit) ?? {};
      b[target] = t ?? null;
      textureBindings.set(unit, b);
      const k = bindingParam[target];
      if (k !== undefined) params[k] = t ?? null;
    },
    createShader: (type: number) => { const s = make("shader"); shaderTypes.set(s, type); return s; },
    shaderSource: (s: object, src: string) => { sources.set(s, src); },
    getShaderSource: (s: object) => sources.get(s) ?? null,
    getShaderParameter: (s: object, k: number) => {
      if (k === C.SHADER_TYPE) return shaderTypes.get(s);
      if (k === C.DELETE_STATUS) return deleted.has(s);
      if (k === 0x91b1) return true; // COMPLETION_STATUS_KHR
      return true;
    },
    getShaderInfoLog: () => "",
    attachShader: (p: object, s: object) => { attached.set(p, [...(attached.get(p) ?? []), s]); linked.delete(p); },
    detachShader: (p: object, s: object) => { attached.set(p, (attached.get(p) ?? []).filter((x) => x !== s)); },
    bindAttribLocation: (p: object, index: number, name: string) => {
      const m = bound.get(p) ?? new Map<string, number>();
      m.set(name, index);
      bound.set(p, m);
    },
    linkProgram: (p: object) => { link(p); },
    getProgramParameter: (p: object, k: number) => {
      if (k === C.ACTIVE_UNIFORMS) return linkedOf(p).uniforms.length;
      if (k === C.ACTIVE_ATTRIBUTES) return linkedOf(p).attributes.length;
      if (k === C.ACTIVE_UNIFORM_BLOCKS) return linkedOf(p).blocks.length;
      if (k === C.ATTACHED_SHADERS) return (attached.get(p) ?? []).length;
      if (k === C.DELETE_STATUS) return deleted.has(p);
      if (k === C.TRANSFORM_FEEDBACK_VARYINGS) return 0;
      return true; // (LINK_STATUS, VALIDATE_STATUS, COMPLETION_STATUS_KHR)
    },
    getProgramInfoLog: () => "",
    getAttachedShaders: (p: object) => [...(attached.get(p) ?? [])],
    getActiveUniform: (p: object, i: number) => {
      const u = linkedOf(p).uniforms[i];
      return u === undefined ? null : { name: u.name, size: u.size, type: u.type };
    },
    getActiveAttrib: (p: object, i: number) => {
      const a = linkedOf(p).attributes[i];
      return a === undefined ? null : { name: a.name, size: a.size, type: a.type };
    },
    getAttribLocation: (p: object, name: string) => linkedOf(p).attributes.find((a) => a.name === name)?.location ?? -1,
    getUniformLocation: (p: object, name: string) => {
      const list = linkedOf(p).uniforms;
      const base = name.replace(/\[(\d+)\]$/, "");
      const index = /\[(\d+)\]$/.exec(name);
      const hit = list.some((u) => u.name === name || (u.name === `${name}[0]`) || (index !== null && u.name === `${base}[0]` && Number(index[1]) < u.size));
      if (!hit) return null;
      const location = { id: `${(p as GLObject).id}:${name}` };
      objects.add(location);
      return location;
    },
    getUniformBlockIndex: (p: object, name: string) => {
      const i = linkedOf(p).blocks.indexOf(name);
      return i === -1 ? C.INVALID_INDEX : i;
    },
    getActiveUniformBlockName: (p: object, i: number) => linkedOf(p).blocks[i] ?? null,
    getActiveUniformBlockParameter: (_p: object, _i: number, k: number) => (k === C.UNIFORM_BLOCK_DATA_SIZE ? 0 : k === C.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES ? new Uint32Array(0) : 0),
    getUniformIndices: (_p: object, names: string[]) => names.map(() => C.INVALID_INDEX),
    getActiveUniforms: (_p: object, indices: number[]) => indices.map(() => 0),
    getFragDataLocation: () => 0,
    checkFramebufferStatus: () => C.FRAMEBUFFER_COMPLETE,
    getQueryParameter: (_q: object, k: number) => (k === C.QUERY_RESULT_AVAILABLE ? true : 4.25e6),
    getQuery: () => null,
    fenceSync: () => make("sync"),
    clientWaitSync: () => C.CONDITION_SATISFIED,
    getSyncParameter: (_s: object, k: number) => (k === C.SYNC_STATUS ? C.SIGNALED : 0),
    getBufferParameter: () => 0,
    getFramebufferAttachmentParameter: () => null,
    getRenderbufferParameter: () => 0,
    getTexParameter: () => null,
    getSamplerParameter: () => null,
    getVertexAttrib: () => null,
    getVertexAttribOffset: () => 0,
    getIndexedParameter: () => null,
    getInternalformatParameter: () => new Int32Array([4, 2, 1]),
    getUniform: () => null,
    getTransformFeedbackVarying: () => null,
    readPixels: (...a: unknown[]) => {
      const out = a[6];
      if (ArrayBuffer.isView(out)) {
        const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + (i >> 2)) & 255;
      }
    },
    makeXRCompatible: () => Promise.resolve(),
  };
  for (const kind of ["Buffer", "Framebuffer", "Program", "Query", "Renderbuffer", "Sampler", "Shader", "Texture", "TransformFeedback", "VertexArray"]) {
    if (!(`create${kind}` in own)) own[`create${kind}`] = () => make(kind[0]!.toLowerCase() + kind.slice(1));
    own[`delete${kind}`] = (o: unknown) => { if (isObject(o)) deleted.add(o); };
    own[`is${kind}`] = (o: unknown) => alive(o);
  }
  own.deleteSync = (o: unknown) => { if (isObject(o)) deleted.add(o); };
  own.isSync = (o: unknown) => alive(o);

  const fns = new Map<string, (...a: unknown[]) => unknown>();
  const store: Record<string, unknown> = { drawingBufferColorSpace: "srgb", unpackColorSpace: "srgb" };
  let canvas: StandInCanvas;
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_t, k) {
      if (typeof k !== "string") return undefined;
      if (k === "canvas") return canvas;
      if (k === "drawingBufferWidth") return canvas.width;
      if (k === "drawingBufferHeight") return canvas.height;
      if (k in store) return store[k];
      const c = C[k];
      if (c !== undefined) return c;
      if (!METHODS.has(k)) return undefined;
      let f = fns.get(k);
      if (f === undefined) {
        const impl = own[k];
        f = (...args: unknown[]) => {
          record(k, args);
          return impl === undefined ? undefined : impl(...args);
        };
        fns.set(k, f);
      }
      return f;
    },
    set(_t, k, v) {
      if (typeof k !== "string") return false;
      record(`=${k}`, [v]);
      store[k] = v;
      return true;
    },
    has(_t, k) {
      return typeof k === "string" && (k === "canvas" || k in store || C[k] !== undefined || METHODS.has(k));
    },
  }) as unknown as WebGL2RenderingContext;

  canvas = {
    width, height, style: {},
    getContext(id: string, attributes?: unknown) {
      record("canvas.getContext", [id, attributes]);
      if (id !== "webgl2") return null;
      contextAttributes = {
        alpha: true, antialias: true, depth: true, desynchronized: false, failIfMajorPerformanceCaveat: false,
        powerPreference: "default", premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false, xrCompatible: false,
        ...(attributes as Record<string, unknown> | undefined),
      };
      return gl;
    },
    addEventListener(type: string, listener: unknown, opts?: unknown) { record("canvas.addEventListener", opts === undefined ? [type, listener] : [type, listener, opts]); },
    removeEventListener(type: string, listener: unknown, opts?: unknown) { record("canvas.removeEventListener", opts === undefined ? [type, listener] : [type, listener, opts]); },
  };

  const names = (value: number): string[] => Object.keys(C).filter((k) => C[k] === value);
  return { canvas, gl, calls, constants: C, names };
}

