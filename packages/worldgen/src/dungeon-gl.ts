// The dungeon on the GPU, in pixel art: a dressed dungeon's scene
// (dungeon-scene.ts) drawn through the engine's pixel view (orthographic,
// pitched, whole-pixel snapped; the sprite renderer's depth convention, so
// keel/particles' particles and keel/bake's sprites share its depth buffer).
//
//   LIGHT      a world-space LIGHT MAP (4 texels a metre) redrawn every frame
//              on the GPU: each light a quad stamped additively from its
//              visibility mask (dungeon-light.ts: walls cast shadows),
//              falloff, colour and FLICKER (a hash of time and its seed --
//              nothing re-baked, nothing sent but the time). The hero's
//              light moves; its mask is re-cut on the CPU as he walks.
//   SURFACES   floors, walls, caps, pillars, lintels, doors, stairs as
//              instanced quads; every texel's pattern (ashlar, rock, basalt
//              with molten seams, broken brick; flagstones, earth, rugs,
//              grates, puddles, moss, cracks, stains, lava) is computed from
//              its world position and turned into a PALETTE entry: its ramp
//              (the act's, crawl-themes.ts), a shade walked down the ramp by
//              the light, a screen-anchored Bayer dither between entries, the
//              light's colour over it. Emissive texels (lava, seams, sigils)
//              ignore the light.
//   CUTAWAY    wall columns between the camera and the hero sink to stubs in
//              the vertex shader (their caps come down with them; the faces
//              between columns open to keep them solid) -- or dissolve
//              ("dither"), or stay ("off").
//   FOG        per cell: in sight, remembered (dimmed), never seen (black),
//              sampled soft and dithered at its edges.
//   SPRITES    indexed sprites (keel/bake's LayerInstances layout, its look
//              tables) lit per texel from the light map. DEPTH SPRITES
//              (keel/bake depth.ts): each texel at the depth of the point it
//              shows, from its baked height -- the floor never hides what
//              stands on it, a wall hides exactly the part of a prop behind
//              it. A sprite baked without heights stands as a card at its
//              anchor, as before.
//   LAYERS     (docs/ARCHITECTURE.md "Occlusion and layers") the abyss; the
//              surfaces (floors at the floor plane, walls and caps as their
//              cutaway state leaves them: stub moves the geometry, dither
//              drops fragments -- depth goes with the colour, never ghost
//              depth); contact shadows and the hero's ring (floor decals:
//              depth-tested, never written, never over a thing); sprites
//              (depth-tested, written); the hero's silhouette where walls
//              hide him (the one overlay drawn through walls); flames (tested,
//              not written). Fog is a colour pass inside each shader, never
//              depth.
//   FLAMES     procedural pixel flames (torch, brazier, candle, magic) and
//              moon shafts, flickering with their lights.
//   ABYSS      the void below: rubble far down, drifting mist, a forge's
//              molten glow, depth-shaded.

import { applyLayer } from "@keel-engine/bake";
import { crawlPalette } from "./crawl-themes.ts";
import type { CrawlTheme } from "./crawl-themes.ts";
import type { DungeonDressing } from "./dungeon-dress.ts";
import { MASK_PER_METRE, lightMask } from "./dungeon-light.ts";
import { MAT, QUAD, QUAD_FLOATS } from "./dungeon-scene.ts";
import { ABYSS_FS, ABYSS_VS, LIGHT_FS, LIGHT_VS, ROW, WORLD_FS, WORLD_VS } from "./dungeon-gl-world-shaders.ts";
import { FLAME_FS, FLAME_VS, SHADOW_FS, SHADOW_VS, spriteShaders } from "./dungeon-gl-fx-shaders.ts";
import type { DungeonScene } from "./dungeon-scene.ts";

/**
 * The view, as keel/bake's PixelView has it (structurally) -- orthographic. With an `eye` it's a PERSPECTIVE view
 * instead (a chase camera, a third-person camera behind the hero): the camera stands at `eye` looking along
 * `axes.forward` (right and up its basis), `fov` its vertical field of view; `center` is what it looks at (the
 * cutaway's and the depth range's middle), and `pixelsPerMetre` is the sprites' baked density (a sprite is drawn
 * at the scale its distance gives it). Everything else -- the light map, fog, flames, the abyss, lit sprites -- is
 * the same.
 */
export interface DungeonDrawView {
  readonly center: readonly [number, number, number];
  readonly pixelsPerMetre: number;
  readonly width: number;
  readonly height: number;
  readonly axes: { readonly right: readonly [number, number, number]; readonly up: readonly [number, number, number]; readonly forward: readonly [number, number, number] };
  readonly eye?: readonly [number, number, number];
  /** Vertical field of view (radians; default 1.0). */
  readonly fov?: number;
  /** Near and far planes (m; default 0.3, 90). */
  readonly near?: number;
  readonly far?: number;
}
/** keel/bake's look-table layout constants (its SLOTS, LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW). */
export interface LookLayout { readonly slots: number; readonly looksPerRow: number; readonly lookTexels: number; readonly paintsPerRow: number; readonly paletteRow: number }
/**
 * Sprites: keel/bake's LayerInstances floats (x y z, u0 v0 w h, ax ay, page, look, flags, scale, dissolve). Flags: 1
 * unlit (glows), 2 unfogged, 4 cut with the walls (a prop on a wall the cutaway sinks: hung on it, it goes with the
 * wall; with 16 too it stands on the floor against it, and is cut at the stub as the wall is), 8 the hero (inked
 * outline, lifted).
 */
export const LIT_SPRITE_FLOATS = 14;

export interface DungeonDrawOptions {
  readonly time: number;
  /** The hero (world x, z): the cutaway's focus and the light he carries. */
  readonly focus?: readonly [number, number] | null;
  readonly cutaway?: "stub" | "dither" | "off";
  /** How far round the focus the cutaway reaches (m): across the view either side (default 6.5), and toward the camera (default 7.1) -- a side-scroller wants its whole screen open; `front: false` stops keeping
   * the default camera's front walls low (for a camera turned another way, where they can be the walls behind). */
  readonly cutReach?: { readonly across?: number; readonly before?: number; readonly front?: boolean };
  /** Fog of war on (else everything as if in sight). */
  readonly fog?: boolean;
  /** Lights on (else the ambient alone). */
  readonly lights?: boolean;
  /** The hero's light on. */
  readonly heroLight?: boolean;
  /** Door leaves' angles (radians, 0 shut .. pi/2 open), by door. */
  readonly doors?: Float32Array | null;
  readonly sprites?: { readonly data: Float32Array; readonly count: number } | null;
  /** Contact shadows on the floor: x, z, radius (m) each -- under the characters and the big props. */
  readonly shadows?: { readonly data: Float32Array; readonly count: number } | null;
  /** The hero's ring at his feet (world x, z), or none. */
  readonly ring?: readonly [number, number] | null;
  /** A sprite (its index in the sprites) seen through walls as a silhouette where they hide it: the hero. */
  readonly silhouette?: number;
  /** Light scale (1 as the theme says). */
  readonly exposure?: number;
  /** Depth sprites (keel/bake depth.ts): texels at the depth of what they show (default on when the pages carry heights). */
  readonly heights?: boolean;
  /**
   * Checks (tools/occlusion-check): `ids` draws every sprite pixel as its index + 1 (24 bits over RGB; surfaces 0,
   * no abyss, shadows, flames); `surfaceDepth` draws the surfaces alone, each pixel its depth (24 bits over RGB, the
   * clear 0); `depthTest: false` draws the sprites over everything (the no-depth reference).
   */
  readonly debug?: { readonly ids?: boolean; readonly surfaceDepth?: boolean; readonly depthTest?: boolean };
}

export interface DungeonRenderer {
  setScene(scene: DungeonScene, dressing: DungeonDressing): void;
  setTheme(theme: CrawlTheme): void;
  /** Move a light (a prop's flame found after building it); re-cuts its mask. Call before draw; cheap for a few. */
  moveLight(index: number, x: number, y: number, z: number): void;
  /** The atlas pages (keel/bake's), with their height planes for depth sprites. */
  setPages(pages: ReadonlyArray<{ readonly width: number; readonly height: number; readonly rgba: Uint8Array; readonly heights?: Uint8Array | undefined }>): void;
  setLooks(t: { readonly palette: { readonly width: number; readonly height: number; readonly rgba: Uint8Array }; readonly paints: { readonly width: number; readonly height: number; readonly data: Uint32Array }; readonly looks: { readonly width: number; readonly height: number; readonly data: Uint32Array } }): void;
  /** The fog (a byte a cell, 0..255), or null: all in sight. */
  setFog(fog: Uint8Array | null): void;
  /** Where the hero is (world x, z): his light's mask is re-cut when he's moved a quarter metre. */
  setHero(x: number, z: number): void;
  draw(view: DungeonDrawView, opts: DungeonDrawOptions): void;
  readonly stats: { quads: number; lights: number; flames: number; sprites: number; heroMasks: number; lightmap: string; heightBytes: number };
  readonly gl: WebGL2RenderingContext;
}

// ---------------------------------------------------------------- the renderer

const LIGHT_FLOATS = 20;
const FLAME_FLOATS = 8;
const LIGHTMAP_PER_METRE = 4;

export function createDungeonRenderer(gl: WebGL2RenderingContext, { looks, capacity = 1 << 14 }: { readonly looks: LookLayout; readonly capacity?: number }): DungeonRenderer {
  const compile = (type: number, src: string, what: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Dungeon ${what} shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const link = (vs: string, fs: string, what: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, what));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, what));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Dungeon ${what} program: ${gl.getProgramInfoLog(p)}`);
    const cache = new Map<string, WebGLUniformLocation | null>();
    const u = (name: string) => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name)); return cache.get(name)!; };
    return { p, u };
  };
  const sp = spriteShaders(looks);
  const P = { light: link(LIGHT_VS, LIGHT_FS, "light"), world: link(WORLD_VS, WORLD_FS, "surface"), abyss: link(ABYSS_VS, ABYSS_FS, "abyss"), sprite: link(sp.vs, sp.fs, "sprite"), flame: link(FLAME_VS, FLAME_FS, "flame"), shadow: link(SHADOW_VS, SHADOW_FS, "shadow") };

  const corners = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vaoFor = (buf: WebGLBuffer, stride: number, attribs: ReadonlyArray<readonly [number, number, number]>) => {
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [loc, size, off] of attribs) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    return v;
  };
  const QA = [[1, 3, 0], [2, 3, 3], [3, 3, 6], [4, 3, 9], [5, 4, 12]] as const;
  const quadBuf = gl.createBuffer()!, doorBuf = gl.createBuffer()!, lightBuf = gl.createBuffer()!, spriteBuf = gl.createBuffer()!, flameBuf = gl.createBuffer()!, shadowBuf = gl.createBuffer()!, silBuf = gl.createBuffer()!;
  const quadVao = vaoFor(quadBuf, QUAD_FLOATS, QA), doorVao = vaoFor(doorBuf, QUAD_FLOATS, QA);
  const lightVao = vaoFor(lightBuf, LIGHT_FLOATS, [[1, 4, 0], [2, 4, 4], [3, 4, 8], [4, 4, 12], [5, 2, 16]]);
  const spriteVao = vaoFor(spriteBuf, LIT_SPRITE_FLOATS, [[1, 3, 0], [2, 4, 3], [3, 2, 7], [4, 4, 9], [5, 1, 13]]);
  const flameVao = vaoFor(flameBuf, FLAME_FLOATS, [[1, 4, 0], [2, 4, 4]]);
  const shadowVao = vaoFor(shadowBuf, 3, [[1, 3, 0]]);
  const silVao = vaoFor(silBuf, LIT_SPRITE_FLOATS, [[1, 3, 0], [2, 4, 3], [3, 2, 7], [4, 4, 9], [5, 1, 13]]);
  gl.bindBuffer(gl.ARRAY_BUFFER, silBuf);
  gl.bufferData(gl.ARRAY_BUFFER, LIT_SPRITE_FLOATS * 4, gl.DYNAMIC_DRAW);
  const abyssVao = gl.createVertexArray()!;
  gl.bindVertexArray(abyssVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let spriteCap = 0;

  const tex2d = (filter: number) => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const palTex = tex2d(gl.NEAREST), fogTex = tex2d(gl.LINEAR), maskTex = tex2d(gl.LINEAR), lightTex = tex2d(gl.LINEAR), decorTex = tex2d(gl.LINEAR), aoTex = tex2d(gl.LINEAR), liquidTex = tex2d(gl.LINEAR);
  let lookPal: WebGLTexture | null = null, looksTex: WebGLTexture | null = null, paintsTex: WebGLTexture | null = null, pages: WebGLTexture | null = null, heights: WebGLTexture | null = null;
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  const lightFbo = gl.createFramebuffer()!;
  let lightW = 0, lightH = 0;

  // Scene state.
  let scene: DungeonScene | null = null, dress: DungeonDressing | null = null, theme: CrawlTheme | null = null;
  let quadCount = 0;
  let lightData = new Float32Array(0), lightCount = 0, heroSlot = -1;
  const MASK_ATLAS = 2048;
  let shelfX = 0, shelfY = 0, shelfH = 0;
  let heroMaskAt: [number, number] = [0, 0], heroMaskSize = 0, heroLast: [number, number] = [-1e9, -1e9], heroMasks = 0;
  let flameData = new Float32Array(0), flameCount = 0;
  let fogOn = false;
  const doorData = new Float32Array(QUAD_FLOATS * 64 * 4);

  const allocMask = (size: number): [number, number] => {
    if (shelfX + size > MASK_ATLAS) { shelfX = 0; shelfY += shelfH + 1; shelfH = 0; }
    if (shelfY + size > MASK_ATLAS) throw new RangeError("Light masks overflow their atlas.");
    const at: [number, number] = [shelfX, shelfY];
    shelfX += size + 1; shelfH = Math.max(shelfH, size);
    return at;
  };
  const writeMask = (at: readonly [number, number], size: number, data: Uint8Array) => {
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, at[0], at[1], size, size, gl.RED, gl.UNSIGNED_BYTE, data.subarray(0, size * size));
  };
  const setLight = (i: number, L: { x: number; y: number; z: number; radius: number; colour: readonly [number, number, number]; strength: number; flicker: number; speed: number; seed: number }, kind: number, at: readonly [number, number], mask: { size: number; x0: number; z0: number }, on = 1) => {
    const o = i * LIGHT_FLOATS;
    lightData.set([L.x, L.y, L.z, L.radius, L.colour[0], L.colour[1], L.colour[2], L.strength, L.flicker, L.speed, L.seed, kind, mask.x0, mask.z0, at[0], at[1], mask.size, on, 0, 0], o);
  };
  const KINDS = ["torch", "sconce", "brazier", "candle", "crystal", "fungus", "lava", "shaft", "hero", "key", "sigil"];

  const api: DungeonRenderer = {
    gl,
    stats: { quads: 0, lights: 0, flames: 0, sprites: 0, heroMasks: 0, lightmap: "", heightBytes: 0 },
    setTheme(t) {
      theme = t;
      const pal = crawlPalette(t);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pal.width, pal.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pal.rgba);
    },
    setScene(s, S) {
      scene = s; dress = S;
      api.setTheme(S.theme);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.quads, gl.STATIC_DRAW);
      quadCount = s.count;
      // The light map covers the dungeon.
      lightW = Math.ceil(s.w * s.tile * LIGHTMAP_PER_METRE); lightH = Math.ceil(s.d * s.tile * LIGHTMAP_PER_METRE);
      gl.bindTexture(gl.TEXTURE_2D, lightTex);
      if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, lightW, lightH, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lightW, lightH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      api.stats.lightmap = `${lightW}x${lightH} ${floatOk ? "RGBA16F" : "RGBA8"}`;
      // Masks: every light's, then the hero's slot.
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK_ATLAS, MASK_ATLAS, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      shelfX = 0; shelfY = 0; shelfH = 0;
      lightCount = S.lights.length + 1;
      lightData = new Float32Array(lightCount * LIGHT_FLOATS);
      S.lights.forEach((L, i) => {
        const m = lightMask(s, L.x, L.z, L.radius);
        const at = allocMask(m.size);
        writeMask(at, m.size, m.data);
        setLight(i, L, KINDS.indexOf(L.kind), at, m);
      });
      heroSlot = S.lights.length;
      const hr = S.theme.lights.hero.radius;
      heroMaskSize = Math.ceil(hr * 2 * MASK_PER_METRE) + 2;
      heroMaskAt = allocMask(heroMaskSize);
      heroLast = [-1e9, -1e9];
      setLight(heroSlot, { x: 0, y: 1.6, z: 0, ...S.theme.lights.hero, seed: 0.5 }, KINDS.indexOf("hero"), heroMaskAt, { size: heroMaskSize, x0: 0, z0: 0 }, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
      gl.bufferData(gl.ARRAY_BUFFER, lightData, gl.DYNAMIC_DRAW);
      // Flames and shafts.
      // (A moon shaft shows where its light comes from: a faint beam down through the broken roof.)
      const shafts = S.lights.filter((L) => L.kind === "shaft");
      flameCount = s.flames.length + shafts.length;
      flameData = new Float32Array(Math.max(1, flameCount) * FLAME_FLOATS);
      s.flames.forEach((f, i) => { const L = S.lights[f.light]!; flameData.set([f.x, f.y, f.z, f.size, f.kind, f.seed, L.flicker, L.speed], i * FLAME_FLOATS); });
      shafts.forEach((L, i) => flameData.set([L.x, 0, L.z, 1, 4, L.seed, 0, 0], (s.flames.length + i) * FLAME_FLOATS));
      gl.bindBuffer(gl.ARRAY_BUFFER, flameBuf);
      gl.bufferData(gl.ARRAY_BUFFER, flameData, gl.DYNAMIC_DRAW);
      // Decor masks per cell (blended by the sampler), contact shade per half metre.
      {
        const N = s.w * s.d, dec = new Uint8Array(N * 4);
        for (let q = 0; q < N; q += 1) { const b2 = S.decor[q]!; dec[q * 4] = b2 & 2 ? 255 : 0; dec[q * 4 + 1] = b2 & 4 ? 255 : 0; dec[q * 4 + 2] = b2 & 16 ? 255 : 0; dec[q * 4 + 3] = b2 & 32 ? 255 : 0; }
        gl.bindTexture(gl.TEXTURE_2D, decorTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, s.w, s.d, 0, gl.RGBA, gl.UNSIGNED_BYTE, dec);
        const liq = new Uint8Array(N);
        for (let q = 0; q < N; q += 1) liq[q] = S.floor[q] === 3 || S.floor[q] === 4 ? 255 : 0;
        gl.bindTexture(gl.TEXTURE_2D, liquidTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.w, s.d, 0, gl.RED, gl.UNSIGNED_BYTE, liq);
        const ao = new Uint8Array(s.fw * s.fd);
        for (let fz = 0; fz < s.fd; fz += 1) for (let fx = 0; fx < s.fw; fx += 1) {
          let n2 = 0, t = 0;
          for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) { const x = fx + dx, z = fz + dz; const wgt = 3 - Math.max(Math.abs(dx), Math.abs(dz)); t += wgt; if (x < 0 || z < 0 || x >= s.fw || z >= s.fd || s.fine[z * s.fw + x] === 2 || s.fine[z * s.fw + x] === 5) n2 += wgt; }
          ao[fz * s.fw + fx] = Math.min(255, Math.round((n2 / t) * 2 * 255));
        }
        gl.bindTexture(gl.TEXTURE_2D, aoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.fw, s.fd, 0, gl.RED, gl.UNSIGNED_BYTE, ao);
      }
      // Fog: all in sight until told otherwise.
      gl.bindTexture(gl.TEXTURE_2D, fogTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.w, s.d, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(s.w * s.d).fill(255));
      fogOn = false;
      api.stats.quads = quadCount; api.stats.lights = S.lights.length; api.stats.flames = flameCount;
    },
    moveLight(index, x, y, z) {
      if (!scene || !dress) return;
      const L = dress.lights[index];
      if (!L) return;
      L.x = x; L.y = y; L.z = z;
      const o = index * LIGHT_FLOATS;
      const m = lightMask(scene, x, z, L.radius);
      const at: [number, number] = [lightData[o + 14]!, lightData[o + 15]!];
      if (m.size > lightData[o + 16]!) return; // (a bigger mask than its slot: keep the old one)
      writeMask(at, m.size, m.data);
      lightData[o] = x; lightData[o + 1] = y; lightData[o + 2] = z; lightData[o + 12] = m.x0; lightData[o + 13] = m.z0; lightData[o + 16] = m.size;
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, lightData, o, LIGHT_FLOATS);
      // (Its flame too.)
      for (let f = 0; f < (scene.flames.length); f += 1) if (scene.flames[f]!.light === index) { flameData[f * FLAME_FLOATS] = x; flameData[f * FLAME_FLOATS + 1] = y; flameData[f * FLAME_FLOATS + 2] = z; gl.bindBuffer(gl.ARRAY_BUFFER, flameBuf); gl.bufferSubData(gl.ARRAY_BUFFER, f * FLAME_FLOATS * 4, flameData, f * FLAME_FLOATS, FLAME_FLOATS); }
    },
    setPages(list) {
      if (!list.length) return;
      const w = Math.max(...list.map((p) => p.width)), h = Math.max(...list.map((p) => p.height));
      if (pages) gl.deleteTexture(pages);
      pages = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, pages);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, list.length);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      list.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.rgba));
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      // (Depth sprites: the height planes, an RG8 array beside the pages.)
      if (heights) { gl.deleteTexture(heights); heights = null; }
      api.stats.heightBytes = 0;
      if (list.some((p) => p.heights)) {
        heights = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, w, h, list.length);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        list.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RG, gl.UNSIGNED_BYTE, p.heights ?? new Uint8Array(p.width * p.height * 2)));
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        api.stats.heightBytes = w * h * list.length * 2;
      }
    },
    setLooks({ palette, paints, looks: lk }) {
      const up = (old: WebGLTexture | null, t: { width: number; height: number; data: Uint32Array }) => { if (old) gl.deleteTexture(old); const x = tex2d(gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, t.width, t.height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, t.data); return x; };
      if (lookPal) gl.deleteTexture(lookPal);
      lookPal = tex2d(gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, palette.width, palette.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette.rgba);
      looksTex = up(looksTex, lk); paintsTex = up(paintsTex, paints);
    },
    setFog(fog) {
      if (!scene) return;
      fogOn = !!fog;
      if (!fog) return;
      gl.bindTexture(gl.TEXTURE_2D, fogTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, scene.w, scene.d, gl.RED, gl.UNSIGNED_BYTE, fog);
    },
    setHero(x, z) {
      if (!scene || heroSlot < 0) return;
      const o = heroSlot * LIGHT_FLOATS;
      lightData[o] = x; lightData[o + 2] = z; lightData[o + 17] = 1;
      if (Math.hypot(x - heroLast[0], z - heroLast[1]) >= 0.25) {
        const m = lightMask(scene, x, z, lightData[o + 3]!);
        writeMask(heroMaskAt, m.size, m.data);
        lightData[o + 12] = m.x0; lightData[o + 13] = m.z0; lightData[o + 16] = m.size;
        heroLast = [x, z]; heroMasks += 1; api.stats.heroMasks = heroMasks;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, lightData, o, LIGHT_FLOATS);
    },
    draw(view, opts) {
      if (!scene || !dress || !theme) return;
      const s = scene, th = theme;
      const { time } = opts;
      const surfaceDepth = !!opts.debug?.surfaceDepth;
      const ids = !!opts.debug?.ids || surfaceDepth;
      const W = view.width, H = view.height, k = view.pixelsPerMetre;
      const ax = view.axes;
      const range = (Math.max(W, H) / k) * 4;
      const persp = !!view.eye;
      const eye = view.eye ?? view.center;
      const tanHalf = Math.tan((view.fov ?? 1.0) / 2);
      const near = view.near ?? 0.3, far = view.far ?? 90;
      const tile = s.tile;
      // (The hero's light: on or off.)
      if (heroSlot >= 0) { const on = opts.heroLight !== false && opts.focus ? 1 : 0; const o = heroSlot * LIGHT_FLOATS + 17; if (lightData[o] !== on) { lightData[o] = on; gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf); gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, lightData, o, 1); } }
      // 1. The light map.
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFbo);
      gl.viewport(0, 0, lightW, lightH);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (opts.lights !== false) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(P.light.p);
        gl.uniform4f(P.light.u("uMap"), 0, 0, lightW / LIGHTMAP_PER_METRE, lightH / LIGHTMAP_PER_METRE);
        gl.uniform2f(P.light.u("uMaskInv"), 1 / MASK_ATLAS, 1 / MASK_ATLAS);
        gl.uniform1f(P.light.u("uTime"), time);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(P.light.u("uMasks"), 0);
        gl.bindVertexArray(lightVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lightCount);
        gl.disable(gl.BLEND);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // 2. The picture: the abyss, then everything depth-tested.
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      if (ids) gl.clearColor(0, 0, 0, 1); else gl.clearColor(th.abyss.fog[0], th.abyss.fog[1], th.abyss.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const view3 = (u: (n: string) => WebGLUniformLocation | null) => {
        gl.uniform3f(u("uCenter"), view.center[0], view.center[1], view.center[2]);
        gl.uniform3f(u("uRight"), ax.right[0], ax.right[1], ax.right[2]);
        gl.uniform3f(u("uUp"), ax.up[0], ax.up[1], ax.up[2]);
        gl.uniform3f(u("uForward"), ax.forward[0], ax.forward[1], ax.forward[2]);
        gl.uniform1f(u("uK"), k);
        gl.uniform2f(u("uSize"), W, H);
        gl.uniform1f(u("uDepthRange"), range);
        gl.uniform1f(u("uPersp"), persp ? 1 : 0);
        gl.uniform3f(u("uEye"), eye[0], eye[1], eye[2]);
        gl.uniform1f(u("uTan"), tanHalf);
        gl.uniform2f(u("uClip"), near, far);
      };
      const shadeUniforms = (u: (n: string) => WebGLUniformLocation | null) => {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u("uPal"), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lightTex); gl.uniform1i(u("uLight"), 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, fogTex); gl.uniform1i(u("uFog"), 2);
        gl.uniform4f(u("uLightRect"), 0, 0, LIGHTMAP_PER_METRE / lightW, LIGHTMAP_PER_METRE / lightH);
        gl.uniform1f(u("uLightScale"), (opts.exposure ?? 1) * (floatOk ? 1 : 2));
        gl.uniform2f(u("uFogScale"), 1 / (s.w * tile), 1 / (s.d * tile));
        gl.uniform1f(u("uFogOn"), opts.fog !== false && fogOn ? 1 : 0);
        gl.uniform3f(u("uAmbient"), th.ambient[0], th.ambient[1], th.ambient[2]);
        gl.uniform1f(u("uRemembered"), th.remembered);
        gl.uniform1f(u("uLightsOn"), opts.lights !== false ? 1 : 0);
        gl.uniform1f(u("uTime"), time);
      };
      // The abyss.
      gl.depthMask(false);
      gl.useProgram(P.abyss.p);
      if (!ids) {
        const u = P.abyss.u;
        view3(u);
        gl.uniform1f(u("uDepth"), s.abyss);
        gl.uniform3f(u("uFogC"), th.abyss.fog[0], th.abyss.fog[1], th.abyss.fog[2]);
        gl.uniform3f(u("uGlow"), ...(th.abyss.glow ?? [0, 0, 0]) as [number, number, number]);
        gl.uniform1f(u("uGlowOn"), th.abyss.glow ? 1 : 0);
        gl.uniform1f(u("uMist"), th.abyss.mist);
        gl.uniform1f(u("uTime"), time);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u("uPal"), 0);
        gl.bindVertexArray(abyssVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      applyLayer(gl, "ground"); // (floors, then the walls and doors: "objects", the same rule)
      // Surfaces.
      const focus = opts.focus ?? null;
      const cutMode = !focus || opts.cutaway === "off" ? 0 : opts.cutaway === "dither" ? 2 : 1;
      // (The cutaway's reach: across the view either side, and toward the camera from just behind him.)
      const across = opts.cutReach?.across ?? 6.5, before = opts.cutReach?.before ?? 7.1;
      const cutE: [number, number, number] = [across, (before - 0.5) / 2, (before + 0.5) / 2];
      gl.useProgram(P.world.p);
      {
        const u = P.world.u;
        view3(u);
        shadeUniforms(u);
        const hx = ax.forward[0], hz = ax.forward[2], hl = Math.hypot(hx, hz) || 1;
        gl.uniform2f(u("uFocus"), focus ? focus[0] : 0, focus ? focus[1] : 0);
        gl.uniform2f(u("uHead"), hx / hl, hz / hl);
        gl.uniform2f(u("uLat"), ax.right[0], ax.right[2]);
        gl.uniform3f(u("uCutE"), cutE[0], cutE[1], cutE[2]);
        gl.uniform1f(u("uCutMode"), cutMode);
        gl.uniform1f(u("uStub"), 0.7);
        gl.uniform1f(u("uFront"), cutMode === 1 && opts.cutReach?.front !== false ? 1 : 0);
        gl.uniform4i(u("uStyle"), th.wall.style, th.floor.style, th.floor.corridor, th.id === "cave" ? ROW.moss : th.id === "forge" ? ROW.lava : ROW.rug);
        gl.uniform3f(u("uAbyssFog"), th.abyss.fog[0], th.abyss.fog[1], th.abyss.fog[2]);
        gl.uniform3f(u("uCam"), ax.forward[0], ax.forward[1], ax.forward[2]);
        gl.uniform4f(u("uDoorGlow"), 0, 0, 0, th.decor.niches);
        gl.uniform1f(u("uTile"), tile);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, decorTex); gl.uniform1i(u("uDecor"), 3);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, liquidTex); gl.uniform1i(u("uLiquid"), 5);
        gl.uniform1f(u("uLava"), th.liquid === "lava" ? 1 : 0);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, aoTex); gl.uniform1i(u("uAo"), 4);
        gl.uniform2f(u("uAoScale"), 1 / (s.w * tile), 1 / (s.d * tile));
        gl.uniform1f(u("uIds"), surfaceDepth ? 2 : ids ? 1 : 0);
        gl.bindVertexArray(quadVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, quadCount);
        // Doors: their leaves, turned by their angles.
        const nd = buildDoors(s, dress, opts.doors ?? null, doorData);
        if (nd) {
          gl.bindBuffer(gl.ARRAY_BUFFER, doorBuf);
          gl.bufferData(gl.ARRAY_BUFFER, doorData.subarray(0, nd * QUAD_FLOATS), gl.DYNAMIC_DRAW);
          gl.bindVertexArray(doorVao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nd);
        }
      }
      // Contact shadows: under the characters and the big props, dithered, multiplied onto the floor.
      const sh = opts.shadows;
      if (sh && sh.count && !ids) {
        gl.useProgram(P.shadow.p);
        view3(P.shadow.u);
        applyLayer(gl, "decals");
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
        gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sh.data.subarray(0, sh.count * 3), gl.DYNAMIC_DRAW);
        gl.uniform1f(P.shadow.u("uRing"), 0);
        gl.bindVertexArray(shadowVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sh.count);
        gl.disable(gl.BLEND);
        // The hero's ring (the first shadow's slot, redrawn).
        if (opts.ring) {
          gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([opts.ring[0], opts.ring[1], 0.62]));
          gl.uniform1f(P.shadow.u("uRing"), 1);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        }
        applyLayer(gl, "objects");
      }
      // Sprites.
      const spr = opts.sprites;
      api.stats.sprites = spr?.count ?? 0;
      if (spr && spr.count && pages && lookPal && looksTex && paintsTex && !surfaceDepth) {
        gl.useProgram(P.sprite.p);
        const u = P.sprite.u;
        view3(u);
        shadeUniforms(u);
        const hx2 = ax.forward[0], hz2 = ax.forward[2], hl2 = Math.hypot(hx2, hz2) || 1;
        gl.uniform2f(u("uFocus"), focus ? focus[0] : 0, focus ? focus[1] : 0);
        gl.uniform2f(u("uHead"), hx2 / hl2, hz2 / hl2);
        gl.uniform2f(u("uLat"), ax.right[0], ax.right[2]);
        gl.uniform3f(u("uCutE"), cutE[0], cutE[1], cutE[2]);
        gl.uniform1f(u("uCutMode"), cutMode);
        gl.uniform1f(u("uStub"), 0.7);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, pages); gl.uniform1i(u("uPages"), 3);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, lookPal); gl.uniform1i(u("uLookPal"), 4);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, looksTex); gl.uniform1i(u("uLooks"), 5);
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, paintsTex); gl.uniform1i(u("uPaints"), 6);
        const hOn = !!heights && opts.heights !== false;
        gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D_ARRAY, hOn ? heights : null); gl.uniform1i(u("uHeights"), 7);
        gl.uniform1i(u("uHeightOn"), hOn && !persp ? 1 : 0); // (depth sprites are orthographic: a perspective card is flat)
        gl.uniform1i(u("uIds"), ids ? 1 : 0);
        gl.uniform1i(u("uIdBase"), 0);
        applyLayer(gl, "objects");
        if (opts.debug?.depthTest === false) gl.depthFunc(gl.ALWAYS);
        gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
        if (spr.count > spriteCap) { spriteCap = Math.max(capacity, spr.count); gl.bufferData(gl.ARRAY_BUFFER, spriteCap * LIT_SPRITE_FLOATS * 4, gl.DYNAMIC_DRAW); }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, spr.data, 0, spr.count * LIT_SPRITE_FLOATS);
        gl.uniform4f(u("uSil"), 0, 0, 0, 0);
        gl.bindVertexArray(spriteVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, spr.count);
        applyLayer(gl, "objects");
        // The hero where a wall hides him: a pale silhouette through it.
        const si = opts.silhouette ?? -1;
        if (si >= 0 && si < spr.count && !ids) {
          gl.bindBuffer(gl.ARRAY_BUFFER, silBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, spr.data, si * LIT_SPRITE_FLOATS, LIT_SPRITE_FLOATS);
          gl.uniform4f(u("uSil"), 0.62, 0.72, 0.95, 1);
          applyLayer(gl, "through");
          gl.bindVertexArray(silVao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
          applyLayer(gl, "objects");
          gl.uniform4f(u("uSil"), 0, 0, 0, 0);
        }
      }
      // Flames and shafts (no depth written: a flame never hides what's behind its glow).
      if (flameCount && opts.lights !== false && !ids) {
        applyLayer(gl, "translucent");
        gl.useProgram(P.flame.p);
        const u = P.flame.u;
        view3(u);
        gl.uniform1f(u("uTime"), time);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u("uPal"), 0);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, fogTex); gl.uniform1i(u("uFog"), 2);
        gl.uniform2f(u("uFogScale"), 1 / (s.w * tile), 1 / (s.d * tile));
        gl.uniform1f(u("uFogOn"), opts.fog !== false && fogOn ? 1 : 0);
        gl.uniform1f(u("uRemembered"), th.remembered);
        gl.bindVertexArray(flameVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, flameCount);
        applyLayer(gl, "objects");
      }
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
  };
  return api;
}

/** The door leaves as quads for this frame (double doors hinged at their jambs, swinging away from the camera). */
function buildDoors(s: DungeonScene, S: DungeonDressing, angles: Float32Array | null, out: Float32Array): number {
  let n = 0;
  const cap = Math.floor(out.length / QUAD_FLOATS);
  // (A leaf is a column's face: the cutaway takes it down to a stub with its lintel when it stands between the camera and the hero.)
  let cx = 0, cz = 0, fr = 0;
  const push = (px: number, py: number, pz: number, ux: number, uz: number, h: number, mat: number, seed: number, bits: number) => {
    if (n >= cap) return;
    out.set([px, py, pz, ux, 0, uz, 0, h, 0, mat, seed, bits + fr + 256 * QUAD.FACE, cx, cz, 1e9, 1e9], n * QUAD_FLOATS);
    n += 1;
  };
  s.doors.forEach((dr, i) => {
    const th = angles ? angles[i] ?? 0 : 0;
    const jamb = S.doors[i]!.jambs ? 0.22 : 0.05;
    const lw = (s.tile - jamb * 2) / 2;
    const c = Math.cos(th) * lw, sn = Math.sin(th) * lw;
    const mat = dr.locked ? MAT.LOCKED : MAT.DOOR;
    cx = dr.x0 + s.tile / 2; cz = dr.z0 + s.tile / 2; fr = dr.front ? 32 : 0;
    if (dr.axis === 1) {
      const z = dr.z0 + dr.at;
      push(dr.x0 + jamb, 0, z, c, sn, 2, mat, i, 0);
      push(dr.x0 + s.tile - jamb, 0, z, -c, sn, 2, mat, i, 1);
    } else {
      const x = dr.x0 + dr.at;
      push(x, 0, dr.z0 + jamb, sn, c, 2, mat, i, 0);
      push(x, 0, dr.z0 + s.tile - jamb, sn, -c, 2, mat, i, 1);
    }
  });
  return n;
}
