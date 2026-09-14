// A WebGL2 stand-in that records what it's asked to do -- for the renderer's
// bookkeeping without a GPU, and for the equality test: the TypeScript and the
// JavaScript renderers, driven the same way, must make the same GL calls with
// the same arguments, in the same order. (Same calls + the same shaders = the
// same pixels; the pixels themselves are checked in the browser: tools/parity.html.)
//
// It knows enough GL to be honest about uniforms: it reads each shader's
// `uniform` declarations, so a program reports them as active and every
// uniform call names the uniform it sets.

/** One recorded call: its name and a snapshot of its arguments (typed arrays copied, GL objects by id). */
export type Call = [string, unknown[]];

export interface StandIn {
  canvas: { getContext: (id: string, opts?: unknown) => unknown; width: number; height: number };
  calls: Call[];
  gl: Record<string, unknown>;
}

interface Obj { readonly id: string }

// (A snapshot, so later writes into a reused buffer don't rewrite history.)
function snap(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) return { [v.constructor.name]: Array.from(v as unknown as ArrayLike<number>) };
  if (Array.isArray(v)) return v.map(snap);
  if (v && typeof v === "object") return "id" in v ? `#${String((v as Obj).id)}` : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snap(x)]));
  return v;
}

/** The plain uniforms a shader declares, as GL reports them (arrays as "name[0]"). */
function declaredUniforms(src: string): string[] {
  const out: string[] = [];
  const body = src.replace(/layout\(std140\) uniform \w+ \{[^}]*\};/g, "");
  for (const m of body.matchAll(/^uniform\s+\w+\s+([^;]+);/gm)) {
    for (const part of (m[1] ?? "").split(",")) {
      const name = part.trim().replace(/\s*\[\d+\]$/, "");
      out.push(/\[\d+\]$/.test(part.trim()) ? `${name}[0]` : name);
    }
  }
  return out;
}

export function standIn({ timer = false, width = 0, height = 0 } = {}): StandIn {
  const calls: Call[] = [];
  let next = 0;
  const make = (kind: string): Obj => ({ id: `${kind}${(next += 1)}` });
  const sources = new Map<string, string>();
  const attached = new Map<string, string[]>();
  const uniformsOf = (p: Obj): string[] => (attached.get(p.id) ?? []).flatMap((s) => declaredUniforms(sources.get(s) ?? ""));
  const own: Record<string, unknown> = {
    createShader: (type: unknown) => { const o = make("shader"); calls.push(["createShader", [type]]); return o; },
    shaderSource: (s: Obj, src: string) => { sources.set(s.id, src); calls.push(["shaderSource", [`#${s.id}`, src.length]]); },
    createProgram: () => { const o = make("program"); calls.push(["createProgram", []]); return o; },
    attachShader: (p: Obj, s: Obj) => { attached.set(p.id, [...(attached.get(p.id) ?? []), s.id]); calls.push(["attachShader", [`#${p.id}`, `#${s.id}`]]); },
    getShaderParameter: () => true,
    getProgramParameter: (p: Obj, k: string) => (k === "ACTIVE_UNIFORMS" ? uniformsOf(p).length : true),
    getActiveUniform: (p: Obj, i: number) => ({ name: uniformsOf(p)[i] }),
    getUniformLocation: (p: Obj, name: string) => ({ id: `${p.id}:${name}` }),
    getExtension: (name: string) => (timer && name === "EXT_disjoint_timer_query_webgl2" ? { TIME_ELAPSED_EXT: "TIME_ELAPSED_EXT", GPU_DISJOINT_EXT: "GPU_DISJOINT_EXT" } : null),
    getParameter: (k: string) => ({ MAX_FRAGMENT_UNIFORM_VECTORS: 224, MAX_TEXTURE_SIZE: 4096, GPU_DISJOINT_EXT: false } as Record<string, unknown>)[k] ?? 0,
    getQueryParameter: (_q: Obj, k: string) => (k === "QUERY_RESULT_AVAILABLE" ? true : 4.25e6),
    getUniformBlockIndex: (_p: Obj, name: string) => `block:${name}`,
    getAttribLocation: (_p: Obj, name: string) => (name === "aLook" ? 1 : 0),
    readPixels: (x: number, y: number, w: number, h: number, _f: unknown, _t: unknown, out: Uint8Array) => {
      calls.push(["readPixels", [x, y, w, h]]);
      for (let i = 0; i < out.length; i += 1) out[i] = (i * 37 + (i >> 2)) & 255;
    },
  };
  const gl = new Proxy(own, {
    get(t, k) {
      if (typeof k !== "string") return undefined;
      if (k in t) {
        const f = t[k];
        return typeof f === "function" ? (...args: unknown[]) => { const r = (f as (...a: unknown[]) => unknown)(...args); if (!["createShader", "shaderSource", "createProgram", "attachShader", "readPixels"].includes(k)) calls.push([k, snap(args) as unknown[]]); return r; } : f;
      }
      if (/^[A-Z][A-Z0-9_]+$/.test(k)) return k; // (constants by name: the log reads as GL)
      // Anything else is a command: recorded, and a create* hands back a fresh object.
      return (...args: unknown[]) => { calls.push([k, snap(args) as unknown[]]); return k.startsWith("create") ? make(k.slice(6).toLowerCase()) : undefined; };
    },
  });
  const canvas = { getContext: (id: string, opts?: unknown) => { calls.push(["getContext", [id, snap(opts)]]); return gl; }, width, height };
  return { canvas, calls, gl };
}
