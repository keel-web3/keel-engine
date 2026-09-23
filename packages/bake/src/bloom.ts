// Bloom: light that comes OFF a part. A part that burns (MeshDraw.bloom: a
// brake light under braking, a headlight at night, a neon tube) spills its
// colour onto the pixels around it -- screen space, from the G-buffer the mesh
// pass just wrote, so the glow has exactly the shape of the part that makes it
// (a light bar blooms as a bar, twin rounds as two rounds) and a lamp the body
// hides makes none. The part itself burns white-hot at its heart; round it its
// colour is ADDED as light, falling off with distance, its faint tail dithered.

import { createSizeCache } from "./size-cache.ts";
import { SLOTS } from "./indexed.ts";

const BLOOM_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;

/** The widest a bloom reaches, in picture pixels (the shader's loop bound). */
export const BLOOM_REACH = 6;

const BURN_AT = `vec4 burnAt(ivec2 p) {
  uvec4 gb = texelFetch(uGB, p, 0);
  if (gb.x == 0u) return vec4(0.0);
  int slot = int(texelFetch(uGA, p, 0).x * 255.0 + 0.5) - 1;
  int draw = int(gb.y >> 16u);
  if (slot < 0 || draw >= uRows) return vec4(0.0);
  return texelFetch(uBloom, ivec2(slot, draw), 0);
}`;

const BAYER4 = `float bayer4(ivec2 p) {
  int i = (p.x & 3) + (p.y & 3) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}`;

const BLOOM_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uGA;            // slot + 1 in x (pass 1's G-buffer)
uniform highp usampler2D uGB;     // look + 1 in x, the draw in y's high half
uniform sampler2D uBloom;         // per draw (row) and slot (column): the part's colour, and how hard it burns (a)
uniform int uReach;               // picture pixels
uniform int uRows;
out vec4 outColor;
${BAYER4}
${BURN_AT}
void main() {
  ivec2 fp = ivec2(gl_FragCoord.xy), size = textureSize(uGA, 0);
  vec3 colour = vec3(0.0); float best = 0.0, glow = 0.0, inside = 0.0; bool core = false;
  for (int dy = -${BLOOM_REACH}; dy <= ${BLOOM_REACH}; dy++) for (int dx = -${BLOOM_REACH}; dx <= ${BLOOM_REACH}; dx++) {
    if (abs(dx) > uReach || abs(dy) > uReach) continue;
    ivec2 q = fp + ivec2(dx, dy);
    if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
    vec4 b = burnAt(q);
    if (b.a <= 0.0) continue;
    float d = length(vec2(dx, dy)) / float(uReach + 1);
    float w = b.a * (1.0 - d) * (1.0 - d);
    glow += w * 0.22;   // (every burning pixel near adds: a big lamp glows more than a dot)
    if (max(abs(dx), abs(dy)) <= 1 && (dx != 0 || dy != 0)) inside += 1.0 / 8.0;   // (how deep in its own lamp this is)
    if (w > best) { best = w; colour = b.rgb; core = dx == 0 && dy == 0; }
  }
  if (best <= 0.0) discard;
  // The lamp itself burns: its own colour, brighter than any paint, at its rim -- and white-hot where it's deepest in
  // (a lit lamp is a light source, shaded from within, not a tint laid over the lens). It replaces what's there.
  if (core) {
    vec3 rim = min(vec3(1.0), colour * 1.25 + 0.05);
    float heart = inside * inside * best;
    outColor = vec4(mix(rim, vec3(1.0, 0.93, 0.86), 0.7 * heart), 1.0);
    return;
  }
  // Round it, light ADDED in its colour, strongest near the lamp and falling away; the faint tail dithered off.
  float k = min(1.0, max(best, glow));
  if (k < bayer4(fp) * 0.35) discard;
  outColor = vec4(colour * k * 0.85, 0.0);
}`;

// Resolve each source pixel once; the neighbourhood filter reuses its contiguous RGBA8 value.
const EMISSION_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uGA;
uniform highp usampler2D uGB;
uniform sampler2D uBloom;
uniform int uRows;
out vec4 outColor;
${BURN_AT}
void main() { outColor = burnAt(ivec2(gl_FragCoord.xy)); }
`;
const TILE = 16;
// A tile is empty only when no source within its full kernel halo emits. This is a conservative
// broad phase: illuminated tiles still evaluate the original filter, in the original tap order.
const REDUCE = 4;
// Boolean max reduction keeps even a single alpha=1/255 source. Averaged mipmaps cannot.
const REDUCE_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uEmission;
out vec4 outColor;
void main() {
  ivec2 lo = ivec2(gl_FragCoord.xy) * ${REDUCE}, size = textureSize(uEmission, 0);
  for (int y=0; y<${REDUCE}; y++) for (int x=0; x<${REDUCE}; x++) {
    ivec2 q=lo+ivec2(x,y);
    if (q.x<size.x && q.y<size.y && texelFetch(uEmission,q,0).a>0.0) { outColor=vec4(1.0); return; }
  }
  outColor=vec4(0.0);
}`;
const MASK_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uEmission;
uniform int uReach;
out vec4 outColor;
void main() {
  ivec2 tile=ivec2(gl_FragCoord.xy)*${TILE};
  ivec2 lo=max(ivec2(0),tile-ivec2(uReach))/${REDUCE};
  ivec2 hi=min(textureSize(uEmission,0),(tile+ivec2(${TILE}+uReach+${REDUCE-1}))/${REDUCE});
  for (int y=0; y<${TILE / REDUCE + 2 * Math.ceil(BLOOM_REACH / REDUCE)}; y++) for (int x=0; x<${TILE / REDUCE + 2 * Math.ceil(BLOOM_REACH / REDUCE)}; x++) {
    ivec2 q=lo+ivec2(x,y);
    if(q.x<hi.x && q.y<hi.y && texelFetch(uEmission,q,0).r>0.0) { outColor=vec4(1.0); return; }
  }
  outColor=vec4(0.0);
}`;
const CACHED_FS = BLOOM_FS.replace("uniform int uRows;", "uniform int uRows;\nuniform sampler2D uEmission;\nuniform sampler2D uMask;")
  .replace(BURN_AT, "vec4 burnAt(ivec2 p) { return texelFetch(uEmission, p, 0); }")
  .replace("void main() {", `void main() { if (texelFetch(uMask, ivec2(gl_FragCoord.xy) / ${TILE}, 0).r < 0.5) discard;`);

// Separable squared-tent glow: strongest-source colour and accumulated energy travel separately.
// The exact radial filter remains available for visual/performance comparisons.
const HORIZONTAL_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uEmission;
uniform int uReach;
layout(location=0) out vec4 outBest;
layout(location=1) out vec4 outEnergy;
void main() {
  ivec2 fp=ivec2(gl_FragCoord.xy), size=textureSize(uEmission,0);
  vec3 colour=vec3(0.0); float best=0.0, energy=0.0, norm=0.0;
  for(int dx=-${BLOOM_REACH};dx<=${BLOOM_REACH};dx++) {
    if(abs(dx)>uReach)continue;
    float w=1.0-float(abs(dx))/float(uReach+1);w*=w;norm+=w;
    ivec2 q=fp+ivec2(dx,0);if(q.x<0||q.x>=size.x)continue;
    vec4 b=texelFetch(uEmission,q,0);float k=b.a*w;energy+=k;
    if(k>best){best=k;colour=b.rgb;}
  }
  outBest=vec4(colour,best);outEnergy=vec4(energy/norm,0.0,0.0,1.0);
}`;
const VERTICAL_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uEmission;
uniform sampler2D uHorizontal;
uniform sampler2D uEnergy;
uniform int uReach;
out vec4 outColor;
${BAYER4}
void main(){
  ivec2 fp=ivec2(gl_FragCoord.xy),size=textureSize(uEmission,0);
  vec3 colour=vec3(0.0);float best=0.0,energy=0.0,norm=0.0;
  for(int dy=-${BLOOM_REACH};dy<=${BLOOM_REACH};dy++){
    if(abs(dy)>uReach)continue;
    float w=1.0-float(abs(dy))/float(uReach+1);w*=w;norm+=w;
    ivec2 q=fp+ivec2(0,dy);if(q.y<0||q.y>=size.y)continue;
    vec4 b=texelFetch(uHorizontal,q,0);float k=b.a*w;
    energy+=texelFetch(uEnergy,q,0).r*w;
    if(k>best){best=k;colour=b.rgb;}
  }
  if(best<=0.0)discard;
  vec4 centre=texelFetch(uEmission,fp,0);
  if(centre.a>0.0 && centre.a>=best){
    float inside=0.0;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      if(x==0&&y==0)continue;ivec2 q=fp+ivec2(x,y);
      if(q.x>=0&&q.y>=0&&q.x<size.x&&q.y<size.y&&texelFetch(uEmission,q,0).a>0.0)inside+=0.125;
    }
    vec3 rim=min(vec3(1.0),centre.rgb*1.25+0.05);
    outColor=vec4(mix(rim,vec3(1.0,0.93,0.86),0.7*inside*inside*centre.a),1.0);return;
  }
  float k=min(1.0,max(best,energy*norm*0.22));
  if(k<bayer4(fp)*0.35)discard;
  outColor=vec4(colour*k*0.85,0.0);
}`;

/** Test the same quantized alpha the shader reads; zero arrays should cost no raster pass. */
export function hasBloom(row: ArrayLike<number> | undefined): boolean {
  if (row) for (let i = 3; i < Math.min(row.length, SLOTS * 4); i += 4) if (Math.round(row[i]! * 255) > 0) return true;
  return false;
}

export interface BloomPass {
  /**
   * Add the bloom of what was just drawn into the G-buffer (textures ga, gb) to the bound framebuffer. `rows` is each
   * draw's per-slot bloom (MeshDraw.bloom: r, g, b, strength per slot), in draw order; `reach` in picture pixels.
   */
  draw(ga: WebGLTexture, gb: WebGLTexture, rows: readonly (ArrayLike<number> | undefined)[], width: number, height: number, reach: number, rect?: readonly [number, number, number, number], cache?: boolean, separable?: boolean): void;
}

export function createBloomPass(gl: WebGL2RenderingContext, link: (vs: string, fs: string, what: string) => WebGLProgram): BloomPass {
  let tex: WebGLTexture | null = null, vao: WebGLVertexArrayObject | null = null;
  type Program = { prog: WebGLProgram; u: Record<"ga" | "gb" | "bloom" | "reach" | "rows" | "emission" | "mask" | "horizontal" | "energy", WebGLUniformLocation | null> };
  const programs = new Map<string, Program>();
  const program = (key: string, source: string): Program => {
    let p = programs.get(key);
    if (!p) {
      const prog = link(BLOOM_VS, source, key);
      p = { prog, u: { ga: gl.getUniformLocation(prog, "uGA"), gb: gl.getUniformLocation(prog, "uGB"), bloom: gl.getUniformLocation(prog, "uBloom"), reach: gl.getUniformLocation(prog, "uReach"), rows: gl.getUniformLocation(prog, "uRows"), emission: gl.getUniformLocation(prog, "uEmission"), mask: gl.getUniformLocation(prog, "uMask"), horizontal: gl.getUniformLocation(prog, "uHorizontal"), energy: gl.getUniformLocation(prog, "uEnergy") } };
      programs.set(key, p);
    }
    return p;
  };
  const make = (w: number, h: number, internal: number, format: number) => {
    const texture = gl.createTexture()!, framebuffer = gl.createFramebuffer()!;
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer };
  };
  const targets = createSizeCache(2, (width, height) => {
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const emission = make(width, height, gl.RGBA8, gl.RGBA);
    const mw = Math.ceil(width / TILE), mh = Math.ceil(height / TILE);
    const mask = make(mw, mh, gl.R8, gl.RED);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    return { emission: emission.texture, target: emission.framebuffer, mask: mask.texture, maskTarget: mask.framebuffer, mw, mh };
  }, t => {
    gl.deleteTexture(t.emission); gl.deleteTexture(t.mask);
    gl.deleteFramebuffer(t.target); gl.deleteFramebuffer(t.maskTarget);
  });
  // Only radial filtering needs the reduced occupancy texture; keep its two-size cache bounded.
  const reducedTargets = createSizeCache(2, (width, height) => {
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const rw = Math.ceil(width / REDUCE), rh = Math.ceil(height / REDUCE);
    const target = make(rw, rh, gl.R8, gl.RED);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    return { ...target, rw, rh };
  }, t => { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer); });
  // Allocate the extra intermediate only for callers using the separable filter.
  const horizontalTargets = createSizeCache(2, (width, height) => {
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const best = make(width, height, gl.RGBA8, gl.RGBA), energy = make(width, height, gl.R8, gl.RED);
    gl.bindFramebuffer(gl.FRAMEBUFFER, best.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, energy.texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.deleteFramebuffer(energy.framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    return { best: best.texture, energy: energy.texture, target: best.framebuffer };
  }, t => {
    gl.deleteTexture(t.best); gl.deleteTexture(t.energy); gl.deleteFramebuffer(t.target);
  });
  let data = new Uint8Array(0);
  return {
    draw(ga, gb, rows, width, height, reach, rect, cache = true, separable = false) {
      // A zero reach means off, including the source core. Empty/quantized-zero emission needs no GPU pass.
      if (!(reach > 0) || !rows.some(hasBloom) || (rect && (!rect[2] || !rect[3]))) return;
      if (!tex) {
        tex = gl.createTexture();
        vao = gl.createVertexArray();
      }
      // The table: a row a draw, a texel a slot -- its colour (0..255) and its strength (0..255 for 0..1).
      const n = rows.length;
      if (data.length < n * SLOTS * 4) data = new Uint8Array(n * SLOTS * 4);
      data.fill(0, 0, n * SLOTS * 4);
      rows.forEach((row, i) => {
        if (!row) return;
        for (let s = 0; s < SLOTS && s * 4 + 3 < row.length; s += 1) {
          for (let c = 0; c < 4; c += 1) data[(i * SLOTS + s) * 4 + c] = Math.max(0, Math.min(255, Math.round(row[s * 4 + c]! * 255)));
        }
      });
      gl.activeTexture(gl.TEXTURE15);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SLOTS, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.subarray(0, n * SLOTS * 4));
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, ga);
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, gb);
      gl.activeTexture(gl.TEXTURE0);
      gl.viewport(0, 0, width, height);
      const clipped = gl.isEnabled(gl.SCISSOR_TEST);
      const clip = clipped ? gl.getParameter(gl.SCISSOR_BOX) as Int32Array : null;
      const r = rect ?? [0, 0, width, height], c = clip ?? [0, 0, width, height];
      const x = Math.max(r[0]!, c[0]!), y = Math.max(r[1]!, c[1]!);
      const w = Math.max(0, Math.min(r[0]! + r[2]!, c[0]! + c[2]!) - x), h = Math.max(0, Math.min(r[1]! + r[3]!, c[1]! + c[3]!) - y);
      if (!w || !h) return;
      const radius = Math.max(0, Math.min(BLOOM_REACH, Math.round(reach)));
      // A tiny light already has a cheap direct filter; avoid two extra passes for it.
      separable = separable && cache && radius > 1 && w * h >= 4096;
      cache = cache && radius > 1 && w * h >= 4096;
      const bind = (p: Program): void => {
        gl.useProgram(p.prog); gl.uniform1i(p.u.bloom, 15); gl.uniform1i(p.u.ga, 7); gl.uniform1i(p.u.gb, 8); gl.uniform1i(p.u.rows, n);
      };
      if (cache) {
        const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        const { emission, target, mask, maskTarget, mw, mh } = targets(width, height);
        const horizontal = separable ? horizontalTargets(width, height) : null;
        gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, emission);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.activeTexture(gl.TEXTURE0);
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), tr = Math.ceil((x + w) / TILE), tt = Math.ceil((y + h) / TILE);
        const step = separable ? 1 : REDUCE;
        const sx = Math.max(0, Math.floor((tx * TILE - radius) / step) * step), sy = Math.max(0, Math.floor((ty * TILE - radius) / step) * step);
        const ex = Math.min(width, Math.ceil((tr * TILE + radius) / step) * step), ey = Math.min(height, Math.ceil((tt * TILE + radius) / step) * step);
        gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.enable(gl.SCISSOR_TEST);
        // Populate only the tiles the result can touch, plus their complete filter halo. Values outside
        // this region may be stale; neither the active tile mask nor its output pixels can sample them.
        gl.scissor(sx, sy, ex - sx, ey - sy);
        bind(program("Bloom emission", EMISSION_FS)); gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (separable) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, horizontal!.target); gl.viewport(0, 0, width, height);
          gl.scissor(x, sy, w, Math.min(height, y + h + radius) - sy);
          const horizontalPass = program("Bloom horizontal", HORIZONTAL_FS); bind(horizontalPass);
          gl.uniform1i(horizontalPass.u.emission, 9); gl.uniform1i(horizontalPass.u.reach, radius);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, horizontal!.best);
          gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, horizontal!.energy);
        } else {
          const reduced = reducedTargets(width, height);
          // Allocation can bind texture 9; restore emission before the reduction samples it.
          gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, emission);
          gl.bindFramebuffer(gl.FRAMEBUFFER, reduced.framebuffer); gl.viewport(0, 0, reduced.rw, reduced.rh);
          gl.scissor(sx / REDUCE, sy / REDUCE, Math.ceil(ex / REDUCE) - sx / REDUCE, Math.ceil(ey / REDUCE) - sy / REDUCE);
          const reduction = program("Bloom occupancy reduction", REDUCE_FS); bind(reduction);
          gl.uniform1i(reduction.u.emission, 9); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindTexture(gl.TEXTURE_2D, reduced.texture);
          gl.bindFramebuffer(gl.FRAMEBUFFER, maskTarget); gl.viewport(0, 0, mw, mh);
          gl.scissor(tx, ty, tr - tx, tt - ty);
          const m = program("Bloom tile mask", MASK_FS); bind(m);
          gl.uniform1i(m.u.emission, 9); gl.uniform1i(m.u.reach, radius);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindTexture(gl.TEXTURE_2D, emission);
          gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, mask);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
        gl.viewport(0, 0, width, height); gl.activeTexture(gl.TEXTURE0);
      }
      const p = program(separable ? "Bloom vertical" : cache ? "Bloom cached" : "Bloom direct", separable ? VERTICAL_FS : cache ? CACHED_FS : BLOOM_FS);
      bind(p); gl.uniform1i(p.u.horizontal, 10); gl.uniform1i(p.u.energy, 11); gl.uniform1i(p.u.emission, 9); gl.uniform1i(p.u.mask, 13); gl.uniform1i(p.u.reach, radius);
      // (Premultiplied: a lamp's own pixel (alpha 1) replaces what's there, its glow (alpha 0) is purely added. No depth:
      // the G-buffer already knows what is in front.)
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (rect || clip) {
        gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, w, h);
      } else gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      if (clip) { gl.enable(gl.SCISSOR_TEST); gl.scissor(clip[0]!, clip[1]!, clip[2]!, clip[3]!); } else gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    },
  };
}
