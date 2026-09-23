// The live mesh pass: a design's solids, kept on the GPU as one mesh, drawn
// every frame at its exact position, heading and pose -- and painted through
// the same look table as an indexed sprite (paint-shader.ts). This is the
// engine's default path for a 3D game; baking is what you do when a flat
// picture is the product.
//
// Two passes. The first rasterises every visible mesh into a small G-buffer:
// per pixel its part's slot, its shade, where it is on that part's surface and
// in the whole thing, its normal, which look paints it, and its depth. The
// second paints that buffer through the looks, in one fullscreen draw -- so
// the palette, the dither screens, the decals, the sheens and the outline are
// the sprite path's, on a real 3D object.
//
// Before either, a shadow pass draws the meshes from the sun; and before all
// of it, the frustum decides what is worth drawing at all (cull.ts).

import { createSizeCache } from "./size-cache.ts";
import { SLOTS } from "./indexed.ts";
import { MESH_GFS, MESH_LIGHTS, MESH_SHADOW_FS, MESH_VS } from "./mesh.ts";
import type { LookMesh } from "./mesh.ts";
import { LAYER_FS } from "./paint-shader.ts";
import { BLOOM_REACH, createBloomPass, hasBloom } from "./bloom.ts";
import { screenBounds } from "./screen-bounds.ts";
import { projectedMeshError } from "./mesh-lod.ts";
import { frustumOf, visible } from "./cull.ts";
import { partBounds, posedBounds } from "./draw-bounds.ts";
import type { Bounds } from "./draw-bounds.ts";
import { shadowView } from "./shadow-view.ts";
import { defaultMeshSun, projectionOf, shotOfView } from "./project.ts";
import type { Projection } from "./project.ts";
import { depthKappa } from "./depth.ts";
import type { PixelView } from "./view.ts";
import type { MeshDraw, MeshStyle } from "./sprites.ts";
import { filterUniforms } from "./filters.ts";

/** What the mesh pass needs from the renderer around it. */
export interface MeshPassDeps {
  readonly gl: WebGL2RenderingContext;
  /** Link a program (the renderer's own compiler, so a shader error reads the same). */
  link(vs: string, fs: string, what: string): WebGLProgram;
  /** The look table's textures, or null before setLooks. */
  looks(): { palette: WebGLTexture | null; looks: WebGLTexture | null; paints: WebGLTexture | null; places: WebGLTexture | null; decals: WebGLTexture | null } | null;
  /** The picture's size in pixels. */
  size(): readonly [number, number];
  /** The sprite pages and their heights: the paint shader declares those samplers even though a mesh never reads them. */
  pages(): readonly [WebGLTexture | null, WebGLTexture | null];
}

/** Every uniform the paint pass binds (the layer shader's own set, plus the G-buffer's). */
type PaintUniform = "center" | "right" | "up" | "forward" | "k" | "size" | "depth" | "pages" | "looks" | "paints" | "palette" | "places" | "decals" | "anchorDither" | "screen" | "dither" | "outline" | "heights" | "heightOn" | "ds" | "ids" | "idBase";

/** What a frame cost: how many meshes are held, how many were drawn, and how many the frustum threw away. */
export interface MeshStats { readonly meshes: number; readonly drawn: number; readonly culled: number; readonly triangles: number; readonly bloomPixels: number; readonly reduced: number; readonly shadowDrawn: number; readonly shadowTriangles: number }

export interface MeshPass {
  setMesh(key: string, mesh: LookMesh | null): void;
  /** Draw through a pixel view (orthographic: every existing game) or any projection (project.ts: a chase or hood cam). */
  draw(view: PixelView | Projection, draws: readonly MeshDraw[], style?: MeshStyle): void;
  readonly stats: MeshStats;
}

// Live meshes (drawMeshes' second pass): LAYER_FS reading pass 1's G-buffer in place of a sprite's texels -- the same
// looks, finishes, marks, decals, sheens, screens and outline, on a real 3D object drawn at its exact heading.
const MESH_FS = [
  ["uniform sampler2DArray uPages;", "uniform sampler2DArray uPages;\nuniform sampler2D uGA;\nuniform highp usampler2D uGB;\nuniform highp isampler2D uGC;\nuniform sampler2D uGD;\nuniform float uGap;\nuniform vec3 uMirrorAxes[3];  // right, up, forward: a reflected ray's way across the picture\nuniform vec2 uMirrorK;        // pixels a metre, and how far a reflection reaches (pixels)\nuniform ivec2 uTints[24];  // a coloured light's ramp: its base in the palette, its length\nuniform int uChunkMax;     // the biggest pixel size any draw in this call asked for"],
  ["flat in vec2 vAnchor;", "vec2 vAnchor;"],
  ["in vec3 vUv;\nflat in int vLook;\nflat in vec2 vDepth;\nflat in vec4 vDS;\nflat in int vId;", "vec3 vUv; int vLook; vec2 vDepth; vec4 vDS; int vId;"],
  ["void main() {\n  vec4 c = texelFetch(uPages, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0);\n  ivec3 hAt = ivec3(ivec2(vUv.xy), int(vUv.z + 0.5));\n  if (vLook < 0) { if (c.a < 0.5) discard; outColor = uIds == 1 ? idColour() : vec4(c.rgb, 1.0); gl_FragDepth = texelZ(hAt, vDepth.x); return; }",
   `void main() {
  ivec2 fp = ivec2(gl_FragCoord.xy);
  ivec2 gsz = textureSize(uGB, 0);
  // A thing drawn at its OWN pixel size (MeshDraw.chunk): every picture pixel in a cell reads the cell's middle, so it
  // lands as one fat pixel -- shade, surface, depth and all. A pixel the thing missed looks at the coarsest cell it
  // could belong to, so a chunky thing's edge stays chunky instead of being eaten away.
  ivec4 gc = texelFetch(uGC, fp, 0);
  int chunk = max(1, (gc.z >> 5) & 31);
  if (chunk == 1 && uChunkMax > 1) {
    ivec2 q = (fp / uChunkMax) * uChunkMax + ivec2(uChunkMax / 2);
    ivec4 gq = texelFetch(uGC, q, 0);
    if (((gq.z >> 5) & 31) > 1) { fp = q; gc = gq; chunk = (gq.z >> 5) & 31; }
  }
  if (chunk > 1) { fp = (fp / chunk) * chunk + ivec2(chunk / 2); gc = texelFetch(uGC, fp, 0); }
  uvec4 gb = texelFetch(uGB, fp, 0);
  if (gb.x == 0u) discard;
  vec4 c = texelFetch(uGA, fp, 0);
  vLook = int(gb.x) - 1; vId = int(gb.y >> 16u);
  vAnchor = vec2(gc.xy);
  float myZ = uintBitsToFloat(gb.w);
  bool meshEdge = false;
  for (int k = 0; k < 4; k++) {
    ivec2 q = fp + chunk * (k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1));
    if (q.x < 0 || q.y < 0 || q.x >= gsz.x || q.y >= gsz.y) continue;
    uvec4 o = texelFetch(uGB, q, 0);
    if (o.x == 0u) meshEdge = true;
    else if (o.y != gb.y && uintBitsToFloat(o.w) > myZ + uGap) meshEdge = true;
  }`],
  ["  bool edge = (r & 128) != 0;", "  bool edge = meshEdge;\n  vec4 gd = texelFetch(uGD, fp, 0);"],
  // ("windows" reads a facade grid's packed bytes: on a face without one (a roof, a plain box) it's just the wall.)
  ["  int kind = int(A.z & 15u);", "  int kind = int(A.z & 15u);\n  if (kind == 8 && (gc.w & 256) == 0) kind = 0;"],
  // (A facade's wall lifts toward the street it's lit from: its height is in the body channel -- mesh.ts MESH_GFS --
  // so a big face falls through its ramp and the dither screen shows, instead of one flat entry.)
  ["    float wr, wallLift = 0.0;", "    float wr, wallLift = (0.22 - gd.w) * 2.2;"],
  // (Its dither reads the cell too, so a fat pixel comes out one colour.)
  ["  ivec2 dp = uDitherAnchor == 1 ? ivec2(int(gl_FragCoord.x) - int(vAnchor.x), int(gl_FragCoord.y) + int(vAnchor.y)) : ivec2(gl_FragCoord.xy);", "  ivec2 dp = (uDitherAnchor == 1 ? ivec2(fp.x - int(vAnchor.x), fp.y + int(vAnchor.y)) : fp) / chunk;"],
  // A pattern painted in BODY space reads the whole thing's own coordinates (mesh.ts): a stripe centred on its middle,
  // running from nose to tail across every panel it crosses, instead of restarting on each one.
  ["  else if (kind > 0 && marks(kind, c.ba, ", "  else if (kind > 0 && marks(kind, (B.z & 65536u) != 0u ? gd.zw : c.ba, "],
  // A paint's ramp at a shade, without its marks or decals: what a reflection of it reads as.
  ["void main() {\n  ivec2 fp = ivec2(gl_FragCoord.xy);", `void plainPaint(int look, int slot, float shade, out int rbase, out int rlen, out float rx) {
  uint pp = paintOf(look, slot);
  rbase = -1; rlen = 1; rx = 0.0;
  if (pp == 0u) return;
  uvec4 PA = paintTexel(pp - 1u, 0);
  rbase = int(PA.x); rlen = max(int(PA.y & 255u), 1);
  rx = finish(int(PA.y >> 8u), shade) * float(rlen - 1);
}
void main() {
  ivec2 fp = ivec2(gl_FragCoord.xy);`],
  ["  // (The paint's own screen and reach, or the draw call's.)", `  // What it mirrors: the reflected ray marched across the picture (the view is orthographic, so its way is a straight
  // line in pixels and in depth). What it meets is read at ITS paint's ramp, and dithered in by how mirrored this is.
  float mirrorK = float((B.z >> 17u) & 15u) / 15.0;
  // Only these dither cells can display a reflection; don't trace rays for discarded cells.
  if (mirrorK > 0.02 && uMirrorK.y > 0.0 && bayer(fp / chunk, 4) < mirrorK) {
    // (The normal came back octahedral: two channels, unfolded here.)
    vec2 oc = gd.xy * 2.0 - 1.0;
    vec3 nrm = vec3(oc, 1.0 - abs(oc.x) - abs(oc.y));
    if (nrm.z < 0.0) nrm = vec3((1.0 - abs(nrm.yx)) * vec2(nrm.x >= 0.0 ? 1.0 : -1.0, nrm.y >= 0.0 ? 1.0 : -1.0), nrm.z);
    nrm = normalize(nrm);
    vec3 rd = reflect(uMirrorAxes[2], nrm);
    vec2 vel = vec2(dot(rd, uMirrorAxes[0]), -dot(rd, uMirrorAxes[1])) * uMirrorK.x;  // (pixels a metre, y down)
    float dz = dot(rd, uMirrorAxes[2]);
    float vl = max(length(vel), 1e-3);
    float stepM = max(1.5, uMirrorK.y / 48.0) / vl;   // (the whole reach, in 48 steps)
    float rayZ = uintBitsToFloat(gb.w);
    ivec2 gsz2 = textureSize(uGB, 0);
    int hitLook = -1, hitSlot = 0; float hitShade = 0.0;
    for (int i = 1; i <= 48; i++) {
      float t = float(i) * stepM;
      if (t * vl > uMirrorK.y) break;
      ivec2 q = fp + ivec2(floor(vel * t + 0.5));
      if (q.x < 0 || q.y < 0 || q.x >= gsz2.x || q.y >= gsz2.y) break;
      uvec4 og = texelFetch(uGB, q, 0);
      if (og.x == 0u) continue;
      float oz = uintBitsToFloat(og.w);
      float rz = rayZ + dz * t;
      if (rz > oz && rz - oz < 0.5 && og.y != gb.y) {
        vec4 oc = texelFetch(uGA, q, 0);
        hitLook = int(og.x) - 1; hitSlot = int(oc.r * 255.0 + 0.5) - 1; hitShade = oc.g;
        break;
      }
    }
    if (hitLook >= 0 && hitSlot >= 0) {
      int rb, rl; float rx;
      plainPaint(hitLook, hitSlot, hitShade, rb, rl, rx);
      // (Pixel art has no blending: the mirrored colour takes a dithered share of the pixels.)
      if (rb >= 0 && bayer(fp / chunk, 4) < mirrorK) { base = rb; len = rl; x = rx; }
    }
  }
  // A coloured light over it: its ramp instead of the paint's, at the pixel's own shade -- dithered in by how strong it is.
  // (gc.z packs the tint id in its low five bits, the draw's pixel size and its snow above them: the id alone.)
  int tintId = gc.z & 31;
  if (tintId > 0 && (gc.w & 255) > 0) {
    float lit = float(gc.w & 255) / 255.0;
    if (lit > 0.12 && bayer(fp / chunk, 4) < min(1.0, lit * 1.6)) {
      ivec2 tr = uTints[clamp(tintId - 1, 0, 23)];
      base = tr.x; len = max(tr.y, 1);
      x = clamp(c.g * 0.7 + lit * 0.5, 0.0, 1.0) * float(len - 1);
    }
  }
  // (The paint's own screen and reach, or the draw call's.)`],

  ["  gl_FragDepth = clamp(texelZ(hAt, vDepth.x) + ((r & 64) != 0 ? vDepth.y : -vDepth.y), 0.0, 1.0);", "  gl_FragDepth = uintBitsToFloat(gb.z);"],
  // Distance haze (MeshStyle.fog): the pixel's TRUE distance from the eye -- its forward distance along its own ray, so
  // turning the camera never moves it -- takes a dithered share of the haze colour, in whole steps.
  ["uniform int uChunkMax;     // the biggest pixel size any draw in this call asked for", "uniform int uChunkMax;     // the biggest pixel size any draw in this call asked for\nuniform vec4 uFog;         // the haze colour, and its most (0: none)\nuniform vec3 uFogRange;    // where it starts and is whole (m), and its steps\nuniform vec2 uFogRay;      // tan(fov / 2) across and up the picture: a pixel's ray"],
  ["  outColor = uIds == 1 ? idColour() : vec4(pal(base + idx).rgb, 1.0);\n}", `  outColor = uIds == 1 ? idColour() : vec4(pal(base + idx).rgb, 1.0);
  if (uFog.w > 0.0 && uIds == 0) {
    vec2 ndc = (vec2(fp) + 0.5) / uSize * 2.0 - 1.0;
    float dist = uintBitsToFloat(gb.w) * length(vec3(ndc * uFogRay, 1.0));
    float f = clamp((dist - uFogRange.x) / max(uFogRange.y - uFogRange.x, 1e-3), 0.0, 1.0) * uFog.w;
    float q = clamp(floor(f * uFogRange.z + bayer(fp / chunk, 4)) / uFogRange.z, 0.0, 1.0);
    outColor.rgb = mix(outColor.rgb, uFog.rgb, q);
  }
}`],

  // ---------------------------------------------------------------- paint filters (filters.ts)
  // How the shade pass 1 already worked out meets the palette. Two filters are live at once: the picture's (uF*) and
  // the one MARKED draws wear (uG*), chosen per pixel from a bit the G-buffer carries. Kind 0 is no filter at all,
  // and a frame with neither paints exactly as it did before any of this existed.
  ["uniform vec2 uMirrorK;        // pixels a metre, and how far a reflection reaches (pixels)",
   `uniform vec2 uMirrorK;        // pixels a metre, and how far a reflection reaches (pixels)
uniform float uTime;          // seconds, for the filters that move
uniform int uFKind;           // the picture's filter (filters.ts FILTER_KIND: 0 none, 1 cel, 2 ghost)
uniform vec4 uF0, uF1, uF2;   // its parameters
uniform int uGKind;           // the filter a marked draw wears instead
uniform vec4 uG0, uG1, uG2;   // its parameters`],
  // This pixel's filter: the marked draw's, or the picture's. (MESH_GFS puts the mark in gC.w's bit 9.)
  ["  uvec4 gb = texelFetch(uGB, fp, 0);\n  if (gb.x == 0u) discard;",
   `  uvec4 gb = texelFetch(uGB, fp, 0);
  if (gb.x == 0u) discard;
  bool marked = (gc.w & 512) != 0;
  int fKind = marked && uGKind > 0 ? uGKind : uFKind;
  vec4 fA = marked && uGKind > 0 ? uG0 : uF0;
  vec4 fB = marked && uGKind > 0 ? uG1 : uF1;
  vec4 fC = marked && uGKind > 0 ? uG2 : uF2;
  // A ghost's rows slip sideways now and then: the whole pixel is read from along the row, so what it finds -- shade,
  // surface, depth, part -- is consistent, and the silhouette tears rather than smearing.
  if (fKind == 2 && fC.x > 0.0) {
    float row = floor(float(fp.y) / max(float(chunk), 1.0));
    float t = floor(uTime * max(fC.y, 0.001) * 6.0);
    float h = fract(sin(row * 12.9898 + t * 78.233) * 43758.5453);
    if (h > 0.86) {
      int sh = int(floor((fract(h * 37.0) - 0.5) * 2.0 * fC.x)) * chunk;
      ivec2 q = ivec2(clamp(fp.x + sh, 0, gsz.x - 1), fp.y);
      uvec4 og = texelFetch(uGB, q, 0);
      if (og.x != 0u) { fp = q; gb = og; gc = texelFetch(uGC, fp, 0); }
    }
  }`],
  // The ink: one picture pixel as ever, or the filter's -- the ring widened, and its diagonals joined so a fat line
  // turns a corner instead of growing a notch. (inkR 1 tests exactly the four neighbours it always did.)
  [`  bool meshEdge = false;
  for (int k = 0; k < 4; k++) {
    ivec2 q = fp + chunk * (k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1));
    if (q.x < 0 || q.y < 0 || q.x >= gsz.x || q.y >= gsz.y) continue;
    uvec4 o = texelFetch(uGB, q, 0);
    if (o.x == 0u) meshEdge = true;
    else if (o.y != gb.y && uintBitsToFloat(o.w) > myZ + uGap) meshEdge = true;
  }`,
   `  bool meshEdge = false;
  bool meshRim = false;   // (an edge against NOTHING: the silhouette, which a ghost keeps when its middle has gone)
  int inkR = max(1, int(fB.y));
  for (int k = 0; k < 8; k++) {
    if (k >= 4 && inkR < 2) break;
    ivec2 o = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : k == 3 ? ivec2(0, -1)
            : k == 4 ? ivec2(1, 1) : k == 5 ? ivec2(-1, 1) : k == 6 ? ivec2(1, -1) : ivec2(-1, -1);
    ivec2 q = fp + chunk * inkR * o;
    if (q.x < 0 || q.y < 0 || q.x >= gsz.x || q.y >= gsz.y) continue;
    uvec4 ob = texelFetch(uGB, q, 0);
    if (ob.x == 0u) { meshEdge = true; meshRim = true; }
    else if (ob.y != gb.y && uintBitsToFloat(ob.w) > myZ + uGap) meshEdge = true;
  }
  // The ghost: its middle dithers away to whatever stands behind it, its silhouette holds. The shape reads at a
  // glance and the picture behind shows through it -- a thing that is there without pretending to be known.
  if (fKind == 2) {
    float keep = meshRim ? max(fA.x, fA.y) : fA.x;
    float breath = fC.y > 0.0 ? 0.82 + 0.18 * sin(uTime * fC.y * 6.2831853) : 1.0;
    if (bayer(fp / chunk, 4) >= keep * breath) discard;
  }`],
  // The cel's bands. The finish has already bent the light onto the paint (matte, metal, glow); the cel takes what
  // comes out, moves the terminator, and drops it into whole steps -- so every paint in the picture bands together
  // and a metal flank still reads as metal, in two tones instead of eight.
  ["  float t = finish(int(A.y >> 8u), c.g);",
   `  float t = finish(int(A.y >> 8u), c.g);
  float celBand = -1.0;
  if (fKind == 1) {
    float lit = clamp(t + fC.y, 0.0, 1.0);
    float tm = fA.y;
    lit = lit < tm ? lit / tm * 0.5 : 0.5 + (lit - tm) / max(1.0 - tm, 1e-3) * 0.5;
    celBand = min(floor(lit * fA.x), fA.x - 1.0);
    // The floor: banding drops a face the sun never reaches -- the back of a car -- onto ONE entry, and at 0 that
    // entry is the bottom of the ramp, which is black whatever the paint. The bands span floor..1 instead, so an
    // unlit red panel stays dark red and the picture keeps its colour where the light stops.
    t = fC.x + (1.0 - fC.x) * (celBand / max(fA.x - 1.0, 1.0));
  } else if (fKind == 2) {
    // A ghost is drained toward the TOP of its ramp, its silhouette higher still: what survives keeps its paint's hue
    // but none of its shape -- a bright, flat, lit-from-nowhere shell rather than a dark smudge. (A thing that is not
    // yet known should read as absent, not as badly lit.)
    t = mix(t, meshRim ? 0.96 : 0.58, fA.z);
  }`],
  // The cel's highlight on the lit band, and its rim: where the surface turns away from the eye it climbs its ramp,
  // so the silhouette carries a bright line of its own paint inside the ink one. (The normal came back octahedral.)
  ["  float x = t * float(len - 1);",
   `  float x = t * float(len - 1);
  if (celBand >= 0.0) {
    if (celBand > fA.x - 1.5) x += fA.w;
    if (fB.x > 0.0 && fB.w > 0.0) {
      vec2 co = gd.xy * 2.0 - 1.0;
      vec3 cn = vec3(co, 1.0 - abs(co.x) - abs(co.y));
      if (cn.z < 0.0) cn = vec3((1.0 - abs(cn.yx)) * vec2(cn.x >= 0.0 ? 1.0 : -1.0, cn.y >= 0.0 ? 1.0 : -1.0), cn.z);
      if (abs(dot(normalize(cn), uMirrorAxes[2])) < fB.w) x += fB.x;
    }
  }
  // A ghost drained toward a palette entry of its own (filters.ts GhostParams.entry) leaves its ramp entirely.
  if (fKind == 2 && fA.w >= 0.0) { base = int(fA.w); len = 1; x = 0.0; }`],
  // The screen's reach across a band: a cel at full hardness leaves none, so the step between two entries comes out
  // as one clean line rather than a dithered gradient. (fA.z is 1 - hardness; 1 when there is no cel.)
  ["  x += th * (reach > 0u ? float(reach - 1u) / 32.0 : uDither);",
   "  x += th * (reach > 0u ? float(reach - 1u) / 32.0 : uDither) * (celBand >= 0.0 ? fA.z : 1.0);"],
  // The ink's own colour: one palette entry for every edge in the picture (a drawn line), or the pixel's own ramp
  // darkened by `outline`, as it always was.
  ["  if (edge) idx = max(0, idx - uOutline);",
   "  if (edge && fB.z >= 0.0) { base = int(fB.z); idx = 0; }\n  else if (edge) idx = max(0, idx - uOutline);"],
  // ---------------------------------------------------------------- wall material detail (looks.ts WallDetail)
  // A facade grid's wall, painted as brick, concrete panel, corrugated sheet, siding, stucco, glass or stone -- only on
  // a paint whose pattern word carries a detail (its high half), so every other paint is untouched. Every line is ONE
  // picture pixel wide: it's drawn where the lattice's index changes between a pixel and its neighbour, whatever the
  // distance, and a lattice finer than three pixels a line halves until it isn't.
  ["void plainPaint(int look, int slot, float shade, out int rbase, out int rlen, out float rx) {",
   `// (A facade pixel's place in its cell, in 256ths: the packed bytes' high nibbles, the body channel's low ones -- MESH_GFS.)
vec2 facadeF(ivec2 q) {
  vec4 a = texelFetch(uGA, q, 0);
  int lo = int(texelFetch(uGD, q, 0).z * 255.0 + 0.5);
  int bu = int(a.b * 255.0 + 0.5), bv = int(a.a * 255.0 + 0.5);
  return (vec2(float((bu >> 4) * 16 + (lo >> 4)), float((bv >> 4) * 16 + (lo & 15))) + 0.5) / 256.0;
}
// (A neighbour on a facade of the same draw and part: its coordinate means the same as this pixel's.)
bool facadeSame(ivec2 q, uint who) {
  ivec2 sz = textureSize(uGB, 0);
  if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) return false;
  uvec4 o = texelFetch(uGB, q, 0);
  return o.x != 0u && o.y == who && (texelFetch(uGC, q, 0).w & 256) != 0;
}
float wrapD(float d) { d = abs(d); return min(d, 1.0 - d); }
// (n lines a cell, halved while a step is under three pixels: cpp is cells a pixel.)
float latticeN(float n, float cpp) { for (int i = 0; i < 7; i++) { if (n * cpp <= 0.34 || n <= 1.0) break; n *= 0.5; } return n; }
float latIdx(float f, float n, float off) { return mod(floor(f * n + off), n); }
// (A cell's own seeded value from 0..1 on a lattice that wraps with the cell, so neighbouring cells meet seamlessly.)
float pnoise(vec2 f, float per) {
  vec2 g = f * per, i = floor(g), t = fract(g); t = t * t * (3.0 - 2.0 * t);
  vec2 j = mod(i + 1.0, per); i = mod(i, per);
  return mix(mix(hash12(i), hash12(vec2(j.x, i.y)), t.x), mix(hash12(vec2(i.x, j.y)), hash12(j), t.x), t.y);
}
float wallDetail(uint D, ivec2 fp, int chunk, uint who, vec4 c, int gw, int pane, int wtype, float wfill) {
  int mat = int(D & 15u);
  float grime = float((D >> 4u) & 15u) / 15.0, footK = float((D >> 8u) & 15u) / 15.0;
  float sc = ((D >> 13u) & 3u) == 1u ? 2.0 : ((D >> 13u) & 3u) == 2u ? 0.5 : ((D >> 13u) & 3u) == 3u ? 4.0 : 1.0;
  vec2 F = facadeF(fp);
  ivec2 qR = fp + ivec2(chunk, 0), qD = fp - ivec2(0, chunk), qU = fp + ivec2(0, chunk);
  bool hR = facadeSame(qR, who), hD = facadeSame(qD, who), hU = facadeSame(qU, who);
  vec2 FR = hR ? facadeF(qR) : F, FD = hD ? facadeF(qD) : F, FU = hU ? facadeF(qU) : F;
  // (Cells a pixel, across and up: how fine a lattice this wall can show here.)
  float cx = hR ? max(wrapD(FR.x - F.x), 0.25 * wrapD(FR.y - F.y)) : 0.05;
  float cy = hD ? max(wrapD(FD.y - F.y), 0.25 * wrapD(FD.x - F.x)) : hU ? wrapD(FU.y - F.y) : 0.05;
  int bu = int(c.b * 255.0 + 0.5), bv = int(c.a * 255.0 + 0.5);
  float cellR = float((bu & 15) * 16 + (bv & 15));
  float x = 0.0;
  bool wall = pane == 0;
  if (mat == 1 || mat == 7) {
    // Brick in running bond (courses, head joints half a brick over on every other course), or stone in big ashlar blocks.
    float ny = latticeN((mat == 1 ? 16.0 : 4.0) * sc, cy), nx = latticeN((mat == 1 ? 8.0 : 3.0) * sc, cx);
    float course = latIdx(F.y, ny, 0.0), off = mod(course, 2.0) * 0.5, brick = latIdx(F.x, nx, off);
    bool bed = hD && latIdx(FD.y, ny, 0.0) != course;
    bool head = hR && latIdx(FR.x, nx, off) != brick && latIdx(FR.y, ny, 0.0) == course;
    float h = hash12(vec2(brick + cellR * 17.0, course + cellR * 3.0));
    // (A brick's own shade fades as the bricks shrink toward three pixels: far, the bond reads; the speckle doesn't.)
    float big = smoothstep(3.0, 8.0, 1.0 / max(ny * cy, 1e-4));
    if (wall) x += bed || head ? (mat == 1 ? -0.95 : -0.85) : ((h - 0.5) * (mat == 1 ? 0.8 : 0.25) - (mat == 1 && h > 0.92 ? 0.45 : 0.0)) * big;
  } else if (mat == 2) {
    // Precast concrete: two panels a bay, one a storey, their seams dark; form-tie dots in rows; each panel its own pour.
    float nx = latticeN(2.0 * sc, cx), ny = latticeN(sc, cy);
    float px_ = latIdx(F.x, nx, 0.0), py_ = latIdx(F.y, ny, 0.0);
    bool seam = (hD && latIdx(FD.y, ny, 0.0) != py_) || (hR && latIdx(FR.x, nx, 0.0) != px_);
    float tx = nx * 3.0, ty = ny * 2.0;
    bool tie = tx * cx <= 0.25 && ty * cy <= 0.25 && hR && hD && latIdx(FR.x, tx, 0.5) != latIdx(F.x, tx, 0.5) && latIdx(FD.y, ty, 0.5) != latIdx(F.y, ty, 0.5);
    if (wall) x += seam ? -1.0 : tie ? -0.75 : (hash12(vec2(px_ + cellR, py_ * 7.0 + cellR)) - 0.5) * 0.5 + 0.15 * (fract(F.y * ny) - 0.5);
  } else if (mat == 3) {
    // Corrugated sheet: vertical ribs, a dark valley line between each and a lit crest; a lap every storey.
    float nr = latticeN(24.0 * sc, cx), ny = latticeN(sc, cy);
    float rib = latIdx(F.x, nr, 0.0);
    bool valley = hR && latIdx(FR.x, nr, 0.0) != rib;
    bool lap = hD && latIdx(FD.y, ny, 0.0) != latIdx(F.y, ny, 0.0);
    if (wall) x += lap ? -0.8 : valley ? -0.75 : fract(F.x * nr) < 0.5 ? 0.3 : 0.0;
  } else if (mat == 4) {
    // Lap siding: a shadow line under every board, each board lit toward its lower edge.
    float ny = latticeN(12.0 * sc, cy);
    bool lap = hD && latIdx(FD.y, ny, 0.0) != latIdx(F.y, ny, 0.0);
    if (wall) x += lap ? -0.95 : 0.4 * (0.5 - fract(F.y * ny));
  } else if (mat == 5) {
    // Stucco: a blotchy render, and fine pits where the wall is near enough to show them.
    float n = pnoise(F, 5.0) * 0.65 + pnoise(F + 0.37, 11.0) * 0.35;
    if (wall) x += (n - 0.5) * 0.75 - (48.0 * max(cx, cy) <= 0.5 && hash12(floor(F * 48.0) + cellR) > 0.93 ? 0.5 : 0.0);
  } else if (mat == 6) {
    // A curtain wall: mullions down the middle of each bay and a transom across each storey, through glass and all.
    float nx = latticeN(2.0 * sc, cx), ny = latticeN(sc, cy);
    bool mullion = hR && latIdx(FR.x, nx, 0.0) != latIdx(F.x, nx, 0.0);
    bool transom = hD && latIdx(FD.y, ny, 0.0) != latIdx(F.y, ny, 0.0);
    if (mullion || transom) x -= pane == 2 ? 1.6 : 1.0;
    else if (wall) x += 0.25;
  }
  // Sills: a lit ledge under each window and rain streaks running down from it, their length each column's own. (The
  // window's own test, windowAt, asked of this column just above the sill: the ledge and streaks sit under real glass.)
  if (wtype >= 0 && wtype != 3 && wall) {
    float sill = wtype == 1 ? 0.12 : wtype == 4 ? 0.1 : wtype == 2 ? 0.34 : 0.24, rr;
    vec2 probe = vec2(float(int(F.x * 16.0) * 16 + (bu & 15)), float((int(sill * 16.0) + 1) * 16 + (bv & 15))) / 255.0;
    if (F.y < sill && windowAt(probe, wtype, wfill, 0.0, rr) != 0) {
      if (hU && windowAt(texelFetch(uGA, qU, 0).ba, wtype, wfill, 0.0, rr) != 0) x += 0.9;
      else if (grime > 0.0) {
        float nc = latticeN(32.0, cx * 0.5), h = hash12(vec2(floor(F.x * nc), cellR + 5.0));
        float len = (0.35 + 0.65 * fract(h * 7.3)) * sill;
        if (h < 0.6 && sill - F.y < len) x -= grime * 1.4 * (1.0 - (sill - F.y) / len);
      }
    }
  }
  // The foot: a dark contact band where the wall meets what it stands on, and grime rising a few metres off it.
  int footQ = (gw >> 10) & 31;
  if (footQ < 31) {
    float d = float(footQ) * 0.25;
    x -= footK * (d < 0.25 ? 1.5 : d < 0.5 ? 1.0 : d < 1.0 ? 0.5 : 0.0) + grime * 0.6 * max(0.0, 1.0 - d / 6.0);
  }
  // The coping: where the wall turns onto its own roof (the pixel above is this thing's top face), one lit pixel.
  if (((D >> 12u) & 1u) != 0u && !hU) {
    ivec2 sz = textureSize(uGB, 0);
    if (qU.y < sz.y) {
      uvec4 o = texelFetch(uGB, qU, 0);
      if (o.x != 0u && o.y == who && (texelFetch(uGC, qU, 0).w & 256) == 0) x += 1.3;
    }
  }
  return x;
}
void plainPaint(int look, int slot, float shade, out int rbase, out int rlen, out float rx) {`],
  ["  if (kind == 8 && (gc.w & 256) == 0) kind = 0;", "  if (kind == 8 && (gc.w & 256) == 0) kind = 0;\n  int wPane = 0, wType = -1; float wFill = 0.0;"],
  ["    int w = windowAt(c.ba, int((A.z >> 8u) & 15u), float((A.z >> 12u) & 15u) / 15.0, float((A.z >> 4u) & 15u) / 15.0, wr);",
   "    int w = windowAt(c.ba, int((A.z >> 8u) & 15u), float((A.z >> 12u) & 15u) / 15.0, float((A.z >> 4u) & 15u) / 15.0, wr);\n    wPane = w; wType = int((A.z >> 8u) & 15u); wFill = float((A.z >> 12u) & 15u) / 15.0;"],
  ["  // (Where the dither screens are read: the picture's pixel, or the sprite's own",
   "  if ((A.z >> 16u) != 0u && (gc.w & 256) != 0) x += wallDetail(A.z >> 16u, fp, chunk, gb.y, c, gc.w, wPane, wType, wFill);\n  // (Where the dither screens are read: the picture's pixel, or the sprite's own"],
  // A crossed card's ink is one entry, not the style's outline: a field of tufts reads as foliage, not as black lace.
  ["  else if (edge) idx = max(0, idx - uOutline);", "  else if (edge) idx = max(0, idx - ((gc.w & 1280) == 1024 ? min(uOutline, 1) : uOutline));"],
  // ---------------------------------------------------------------- weather (MeshStyle.weather)
  // Snow on what faces up, wet on everything else -- only when the style has weather (uWxOn), so a frame without it
  // paints exactly as before. The pixel's world point comes back from its forward distance along its own ray.
  ["uniform float uTime;          // seconds, for the filters that move",
   `uniform float uTime;          // seconds, for the filters that move
uniform int uWxOn;            // 1: the style has weather
uniform vec3 uCenter, uRight, uUp, uForward;  // the camera (the pass binds them; the weather needs a pixel's world point)
uniform int uWxPersp;         // 1: a perspective camera (the world point is along the pixel's ray from the eye)
uniform vec4 uWxAmt;          // snow, wet, rain down the walls, seconds
uniform ivec2 uWxRamp;        // snow's ramp: base, length
uniform int uWxMapOn;
uniform sampler2D uWxMap;     // r, g, b snow at three heights, a wet (MeshWeather.map)
uniform vec4 uWxBox;
uniform vec3 uWxAlt;`],
  ["  // (The paint's own screen and reach, or the draw call's.)\n  int scr",
   `  if (uWxOn == 1 && uIds == 0) {
    vec2 wo = gd.xy * 2.0 - 1.0;
    vec3 wn = vec3(wo, 1.0 - abs(wo.x) - abs(wo.y));
    if (wn.z < 0.0) wn = vec3((1.0 - abs(wn.yx)) * vec2(wn.x >= 0.0 ? 1.0 : -1.0, wn.y >= 0.0 ? 1.0 : -1.0), wn.z);
    wn = normalize(wn);
    vec2 wndc = (vec2(fp) + 0.5) / uSize * 2.0 - 1.0;
    float wvz = uintBitsToFloat(gb.w);
    vec3 wpt = uWxPersp == 1 ? uCenter + (uForward + wndc.x * uFogRay.x * uRight + wndc.y * uFogRay.y * uUp) * wvz
                             : uCenter + uRight * ((float(fp.x) + 0.5 - uSize.x * 0.5) / uK) + uUp * ((float(fp.y) + 0.5 - uSize.y * 0.5) / uK) + uForward * wvz;
    float snowD = uWxAmt.x, wetD = uWxAmt.y;
    if (uWxMapOn == 1) {
      vec4 m = texture(uWxMap, (wpt.xz - uWxBox.xy) / (uWxBox.zw - uWxBox.xy));
      float y = wpt.y;
      float s01 = y <= uWxAlt.x ? m.r : y <= uWxAlt.y ? mix(m.r, m.g, (y - uWxAlt.x) / (uWxAlt.y - uWxAlt.x)) : y <= uWxAlt.z ? mix(m.g, m.b, (y - uWxAlt.y) / (uWxAlt.z - uWxAlt.y)) : m.b;
      snowD *= s01; wetD *= m.a;
    }
    snowD *= float((gc.z >> 10) & 31) / 31.0;
    bool lit = int(A.y >> 8u) == 4 || wPane == 2;
    // (A crossed card -- a tuft, a bush, a tree's crown -- takes no snow here: foliage wears its season in its own paint.)
    bool card = (gc.w & 1280) == 1024;
    bool snowed = false;
    if (snowD > 0.003 && !lit && !card && uWxRamp.y > 0) {
      // (A flat top is white from a dusting up; the deeper it lies, the steeper the faces it holds on.)
      float need = 0.9 - min(snowD * 2.5, 1.0) * 0.5;
      float cover = clamp((wn.y - need) / 0.12, 0.0, 1.0) * clamp(snowD * 12.0, 0.0, 1.0);
      float n = vnoise(wpt.xz * 2.3 + wpt.y * 0.7) * 0.7 + bayer(fp / chunk, 4) * 0.3;
      if (cover > n * 0.96 + 0.02) {
        base = uWxRamp.x; len = max(uWxRamp.y, 1);
        x = clamp(0.3 + c.g * 0.8, 0.0, 1.0) * float(len - 1);
        snowed = true;
      }
    }
    if (!snowed && wetD > 0.01 && !lit) {
      // Wet: a shade darker, a sheen where it's seen at a glance, and the rain running down a wall in thin streaks.
      x -= wetD * 0.9;
      vec3 vdir = uWxPersp == 1 ? normalize(wpt - uCenter) : uForward;
      float glance = pow(1.0 - abs(dot(vdir, wn)), 4.0);
      if (bayer(fp / chunk, 4) < glance * wetD * 1.2) x += 1.6;
      if (abs(wn.y) < 0.4 && uWxAmt.z > 0.0) {
        float col = floor(dot(wpt.xz, normalize(vec2(-wn.z, wn.x) + 1e-5)) * 4.0);
        float h = hash12(vec2(col, 3.1));
        if (h < 0.35 * uWxAmt.z) { float ph = fract(wpt.y * 0.35 + uWxAmt.w * (0.6 + h) + h * 9.0); if (ph < 0.1) x += 1.1; }
      }
    }
  }
  // (The paint's own screen and reach, or the draw call's.)
  int scr`],
].reduce((src, [find, rep]) => { if (!src.includes(find!)) throw new Error(`MESH_FS: LAYER_FS changed under its edits (${find!.slice(0, 40)}).`); return src.replace(find!, rep!); }, LAYER_FS);
const FULLSCREEN_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;

export function createMeshPass(deps: MeshPassDeps): MeshPass {
  const { gl, link } = deps;
  const stats = { meshes: 0, drawn: 0, culled: 0, triangles: 0, bloomPixels: 0, reduced: 0, shadowDrawn: 0, shadowTriangles: 0 };
  const bloom = createBloomPass(gl, link);
  // (The picture's size, read fresh each frame: the renderer owns it.)
  let W = 1, H = 1;
  const sizeNow = (): void => { const [w, h] = deps.size(); W = w; H = h; };

  // Live meshes: built the first time setMesh or drawMeshes is called.
  type MeshU = "model" | "center" | "right" | "up" | "forward" | "k" | "depth" | "tie" | "size" | "snap" | "ground" | "sun" | "look" | "draw" | "lightCount" | "anchor" | "fx" | "wipe" | "lightPos" | "lightDir" | "lightI" | "lightTint" | "slotGlow" | "parts" | "posed" | "lightOwner" | "owner" | "chunk" | "persp" | "proj" | "shadow" | "shadowMat" | "shadowK" | "shadowPass" | "clipRange" | "marked" | "snowK";
  interface MeshGpu { vao: WebGLVertexArrayObject; bufs: WebGLBuffer[]; count: number; lo: [number, number, number]; hi: [number, number, number]; bounds: Bounds; parts: ReadonlyMap<number, Bounds> }
  interface Meshes {
    gprog: WebGLProgram; gu: Record<MeshU, WebGLUniformLocation | null>;
    cprog: WebGLProgram; cu: Record<PaintUniform | "ga" | "gb" | "gc" | "gd" | "gap" | "tints" | "chunkMax" | "mirrorAxes" | "mirrorK" | "fog" | "fogRange" | "fogRay" | "time" | "fKind" | "f0" | "f1" | "f2" | "gKind" | "g0" | "g1" | "g2" | "wxOn" | "wxPersp" | "wxAmt" | "wxRamp" | "wxMapOn" | "wxMap" | "wxBox" | "wxAlt", WebGLUniformLocation | null>;
    fbo: WebGLFramebuffer | null; ga: WebGLTexture | null; gb: WebGLTexture | null; gc: WebGLTexture | null; gd: WebGLTexture | null; zb: WebGLRenderbuffer | null; w: number; h: number;
    tri: WebGLVertexArrayObject; meshes: Map<string, MeshGpu>; poses: WebGLTexture | null; poseRows: number;
    sprog: WebGLProgram; su: Record<MeshU, WebGLUniformLocation | null>; sfbo: WebGLFramebuffer; smap: WebGLTexture | null; ssize: number;
    wxMap: WebGLTexture | null; wxMapKey: unknown; wxMapVersion: number;
  }
  let meshState: Meshes | null = null;
  const meshes = (): Meshes => {
    if (meshState) return meshState;
    const gprog = link(MESH_VS, MESH_GFS, "Mesh");
    const g = (n: string) => gl.getUniformLocation(gprog, n);
    const gu = { model: g("uModel"), center: g("uCenter"), right: g("uRight"), up: g("uUp"), forward: g("uForward"), k: g("uK"), depth: g("uDepthRange"), tie: g("uTie"), size: g("uSize"), snap: g("uSnap"), ground: g("uGround"), sun: g("uSun"), look: g("uLook"), draw: g("uDraw"), lightCount: g("uLightCount"), anchor: g("uAnchor"), fx: g("uFx"), wipe: g("uWipe"), lightPos: g("uLightPos"), lightDir: g("uLightDir"), lightI: g("uLightI"), lightTint: g("uLightTint"), slotGlow: g("uSlotGlow"), parts: g("uParts"), posed: g("uPosed"), lightOwner: g("uLightOwner"), owner: g("uOwner"), chunk: g("uChunk"), persp: g("uPersp"), proj: g("uProj"), shadow: g("uShadow"), shadowMat: g("uShadowMat"), shadowK: g("uShadowK"), shadowPass: g("uShadowPass"), clipRange: g("uClipRange"), marked: g("uMarked"), snowK: g("uSnowK") };
    const sprog = link(MESH_VS, MESH_SHADOW_FS, "Mesh shadow");
    const sg = (n: string) => gl.getUniformLocation(sprog, n);
    const su = { ...gu } as Record<MeshU, WebGLUniformLocation | null>;
    for (const key of Object.keys(su) as MeshU[]) su[key] = sg(`u${key[0]!.toUpperCase()}${key.slice(1)}`);
    const cprog = link(FULLSCREEN_VS, MESH_FS, "Mesh paint");
    const c = (n: string) => gl.getUniformLocation(cprog, n);
    const cu = { center: c("uCenter"), right: c("uRight"), up: c("uUp"), forward: c("uForward"), k: c("uK"), size: c("uSize"), depth: c("uDepthRange"), pages: c("uPages"), looks: c("uLooks"), paints: c("uPaints"), palette: c("uPalette"), places: c("uPlaces"), anchorDither: c("uDitherAnchor"), decals: c("uDecals"), screen: c("uScreen"), dither: c("uDither"), outline: c("uOutline"), heights: c("uHeights"), heightOn: c("uHeightOn"), ds: c("uDS"), ids: c("uIds"), idBase: c("uIdBase"), ga: c("uGA"), gb: c("uGB"), gc: c("uGC"), gd: c("uGD"), gap: c("uGap"), tints: c("uTints"), chunkMax: c("uChunkMax"), mirrorAxes: c("uMirrorAxes"), mirrorK: c("uMirrorK"), fog: c("uFog"), fogRange: c("uFogRange"), fogRay: c("uFogRay"), time: c("uTime"), fKind: c("uFKind"), f0: c("uF0"), f1: c("uF1"), f2: c("uF2"), gKind: c("uGKind"), g0: c("uG0"), g1: c("uG1"), g2: c("uG2"), wxOn: c("uWxOn"), wxPersp: c("uWxPersp"), wxAmt: c("uWxAmt"), wxRamp: c("uWxRamp"), wxMapOn: c("uWxMapOn"), wxMap: c("uWxMap"), wxBox: c("uWxBox"), wxAlt: c("uWxAlt") };
    const tri = gl.createVertexArray()!;
    meshState = { gprog, gu, cprog, cu, fbo: null, ga: null, gb: null, gc: null, gd: null, zb: null, w: 0, h: 0, tri, meshes: new Map(), poses: null, poseRows: 0, sprog, su, sfbo: gl.createFramebuffer()!, smap: null, ssize: 0, wxMap: null, wxMapKey: null, wxMapVersion: -1 };
    return meshState;
  };
  const targets = createSizeCache(2, (W, H) => {
    const M = { fbo: gl.createFramebuffer()!, ga: null as WebGLTexture | null, gb: null as WebGLTexture | null, gc: null as WebGLTexture | null, gd: null as WebGLTexture | null, zb: null as WebGLRenderbuffer | null, w: W, h: H };
    const make = (internal: number, format: number, type: number): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, W, H, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    };
    gl.activeTexture(gl.TEXTURE7);
    M.ga = make(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    M.gb = make(gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT);
    M.gc = make(gl.RGBA16I, gl.RGBA_INTEGER, gl.SHORT);
    M.gd = make(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    M.zb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, M.zb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, M.ga, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, M.gb, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, M.gc, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, M.gd, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, M.zb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    gl.activeTexture(gl.TEXTURE0);
    return M;
  }, M => {
    for (const t of [M.ga, M.gb, M.gc, M.gd]) gl.deleteTexture(t);
    gl.deleteRenderbuffer(M.zb); gl.deleteFramebuffer(M.fbo);
  });
  const gbuffer = (M: Meshes): void => {
    sizeNow();
    if (M.w !== W || M.h !== H || !M.ga) Object.assign(M, targets(W, H));
  };

  // A pose's part matrices: an RGBA32F row of four texels a part, uploaded for the draw that wears it.
  const poseTexture = (M: Meshes, parts: Float32Array): void => {
    const rows = parts.length / 16;
    gl.activeTexture(gl.TEXTURE12);
    if (!M.poses || M.poseRows < rows) {
      if (M.poses) gl.deleteTexture(M.poses);
      M.poses = gl.createTexture()!;
      M.poseRows = Math.max(64, rows * 2);
      gl.bindTexture(gl.TEXTURE_2D, M.poses);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, M.poseRows, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    } else gl.bindTexture(gl.TEXTURE_2D, M.poses);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, rows, gl.RGBA, gl.FLOAT, parts);
  };
  const lightPos = new Float32Array(MESH_LIGHTS * 4), lightDir = new Float32Array(MESH_LIGHTS * 4), lightI = new Float32Array(MESH_LIGHTS), lightTint = new Float32Array(MESH_LIGHTS), lightOwner = new Float32Array(MESH_LIGHTS);
  const slotGlow = new Float32Array(SLOTS), noGlow = new Float32Array(SLOTS), tintRamps = new Int32Array(48);
  /**
   * The per-draw uniforms as last sent. A city's draws mostly share them (no glow, no wipe, the same fade and chunk),
   * and every uniform call costs the same whether it changes anything or not -- so each is sent only when it differs
   * from the draw before's. `unsent` forgets them before a pass's loop (the program is shared with other passes).
   */
  const sent = new Float64Array(18), sentGlow = new Float32Array(SLOTS);
  let glowSent = false;
  const unsent = (): void => { sent.fill(NaN); glowSent = false; };
  const u1 = (k: number, loc: WebGLUniformLocation | null, v: number, int: boolean): void => {
    if (sent[k] === v) return;
    sent[k] = v;
    if (int) gl.uniform1i(loc, v); else gl.uniform1f(loc, v);
  };
  const u2 = (k: number, loc: WebGLUniformLocation | null, a: number, b: number, int: boolean): void => {
    if (sent[k] === a && sent[k + 1] === b) return;
    sent[k] = a; sent[k + 1] = b;
    if (int) gl.uniform2i(loc, a, b); else gl.uniform2f(loc, a, b);
  };
  const u4 = (k: number, loc: WebGLUniformLocation | null, a: number, b: number, c: number, d: number): void => {
    if (sent[k] === a && sent[k + 1] === b && sent[k + 2] === c && sent[k + 3] === d) return;
    sent[k] = a; sent[k + 1] = b; sent[k + 2] = c; sent[k + 3] = d;
    gl.uniform4f(loc, a, b, c, d);
  };
  /** The per-slot glow (none: zeros), sent when its values differ from the last sent. */
  const glowTo = (loc: WebGLUniformLocation | null, glow: ArrayLike<number> | undefined): void => {
    const v = glow ? perSlot(slotGlow, glow) : noGlow;
    if (glowSent) { let same = true; for (let j = 0; j < SLOTS; j += 1) if (sentGlow[j] !== v[j]) { same = false; break; } if (same) return; }
    sentGlow.set(v); glowSent = true;
    gl.uniform1fv(loc, v);
  };
  const perSlot = (into: Float32Array, from: ArrayLike<number> | undefined): Float32Array => {
    into.fill(0);
    if (from) for (let j = 0; j < Math.min(SLOTS, from.length); j += 1) into[j] = from[j]!;
    return into;
  };
  const setMesh = (key: string, mesh: LookMesh | null): void => {
      const M = meshes();
      const old = M.meshes.get(key);
      if (old) { for (const b of old.bufs) gl.deleteBuffer(b); gl.deleteVertexArray(old.vao); M.meshes.delete(key); }
      stats.meshes = M.meshes.size;
      if (!mesh) return;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buf = (loc: number, data: Float32Array, size: number): WebGLBuffer => {
        const b = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(loc, 0);
        return b;
      };
      const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < mesh.positions.length; v += 3) for (let a = 0; a < 3; a += 1) { const q = mesh.positions[v + a]!; if (q < lo[a]!) lo[a] = q; if (q > hi[a]!) hi[a] = q; }
      const bufs = [buf(0, mesh.positions, 3), buf(1, mesh.normals, 3), buf(2, mesh.attrs, 4), buf(3, mesh.bodies, 3)];
      // (Facade feet only where the mesh has a grid: otherwise location 4 reads the generic -1 set before each pass.)
      if (mesh.facade) bufs.push(buf(4, mesh.facade, 1));
      const ib = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      bufs.push(ib);
      gl.bindVertexArray(null);
    M.meshes.set(key, { vao, bufs, count: mesh.indices.length, lo, hi, bounds: [...lo, ...hi], parts: partBounds(mesh) });
    stats.meshes = M.meshes.size;
  };

  const draw = (view: PixelView | Projection, draws: readonly MeshDraw[], style: MeshStyle = {}): void => {
    sizeNow();
    // One projection either way. A pixel view resolves to the orthographic one with the range it always had, so an
    // existing game draws exactly as before; a chase or hood cam hands its own.
    const proj: Projection = "clip" in view ? view : projectionOf(shotOfView(view), W, H, Math.max(W, H) / view.pixelsPerMetre * 4);
    const persp = proj.kind === "persp";
    const viewYaw = "clip" in view ? Math.atan2(proj.forward[0], proj.forward[2]) : view.yaw;
    const M0 = meshes();
    // Animated bounds are measured from cached per-part boxes once per draw, then shared by all passes.
    const posed = new Map<MeshDraw, { lo: number[]; hi: number[]; bounds: Bounds }>();
    const boundsFor = (d: MeshDraw) => {
      const g = M0.meshes.get(d.mesh)!;
      if (!d.parts || d.parts.length < 16) return g;
      let b = posed.get(d);
      if (!b) { const bounds = posedBounds(g.parts, d.parts); b = { lo: bounds.slice(0, 3), hi: bounds.slice(3), bounds }; posed.set(d, b); }
      return b;
    };
    const submitted = draws.filter(d => { const g = M0.meshes.get(d.mesh); return g && g.count > 0 && (d.fade ?? 1) > 0 && (d.range?.[1] ?? 1) > 0; });
    const planes = style.cull === false ? null : frustumOf(proj);
    const shown = planes ? submitted.filter(d => {
      const b = boundsFor(d);
      const pad = d.lod ? d.lod.error * Math.hypot(d.matrix[0]!, d.matrix[1]!, d.matrix[2]!, d.matrix[4]!, d.matrix[5]!, d.matrix[6]!, d.matrix[8]!, d.matrix[9]!, d.matrix[10]!) : 0;
      return visible(planes, b.lo, b.hi, d.matrix, pad);
    }) : submitted;
    stats.drawn = shown.length;
    stats.culled = draws.length - shown.length;
    stats.reduced = 0;
    // No visible geometry means no material resolve or bloom. A caller-supplied after pass may still
    // need the cleared G-buffer (for example water), so preserve that path and explicit screen clears.
    if (!shown.length && !style.after) {
      stats.triangles = stats.shadowDrawn = stats.shadowTriangles = stats.bloomPixels = 0;
      if (style.clear) {
        gl.clearColor(style.clear[0], style.clear[1], style.clear[2], 1); gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      return;
    }
    draws = style.lod === false || !shown.some(d => d.lod) ? shown : shown.map((d) => {
      if (!d.lod || d.parts || d.range || !M0.meshes.has(d.lod.mesh)) return d;
      const g = M0.meshes.get(d.mesh);
      if (!g || !(projectedMeshError(proj, g.lo, g.hi, d.matrix, d.lod.error) < .25)) return d;
      stats.reduced++;
      return { ...d, mesh: d.lod.mesh };
    });
      const { screen = 4, dither = 0.9, outline = 3, clear = null, ambient = 0.16, lights = [], gap = 0.06 } = style;
      const L = deps.looks();
      if (!L || !L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      const M = meshes();
      gbuffer(M);
      const { right, up, forward } = proj, ctr = proj.origin, k = proj.k;
      const range = proj.depthRange;
      // (The sun over the viewer's left shoulder, as a bake's -- or the style's, in the world.)
      const s0 = style.sun ?? defaultMeshSun(proj, viewYaw);
      const sl = Math.hypot(s0[0], s0[1], s0[2]) || 1;
      const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      // The sun's pass: the meshes as the sun sees them, depth only -- what it can't see is in shadow.
      const sh = style.shadows === false ? null : (typeof style.shadows === "object" ? style.shadows : {});
      const shadowK = sh ? Math.max(0, Math.min(1, sh.strength ?? 0.75)) : 0;
      const size = Math.max(256, Math.min(4096, sh?.size ?? 1024));
      // Shadow detail is independent of camera LOD: a small/offscreen object can cast a large visible shadow.
      const box = (draw: MeshDraw) => ({ draw, matrix: draw.matrix, bounds: boundsFor(draw).bounds });
      const shadow = shadowK > 0 ? shadowView(shown.map(box), submitted.map(box), s0, size, sh?.cull !== false) : null;
      const sunMat = shadow?.matrix;
      stats.shadowDrawn = shadow?.casters.length ?? 0; stats.shadowTriangles = 0;
      if (sunMat) {
        if (!M.smap || M.ssize !== size) {
          if (M.smap) gl.deleteTexture(M.smap);
          M.smap = gl.createTexture()!;
          gl.activeTexture(gl.TEXTURE13);
          gl.bindTexture(gl.TEXTURE_2D, M.smap);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          M.ssize = size;
          gl.bindFramebuffer(gl.FRAMEBUFFER, M.sfbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, M.smap, 0);
          gl.drawBuffers([gl.NONE]);
          gl.readBuffer(gl.NONE);
          gl.activeTexture(gl.TEXTURE0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, M.sfbo);
        gl.viewport(0, 0, size, size);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.CULL_FACE);
        gl.clearBufferfv(gl.DEPTH, 0, [1]);
        gl.useProgram(M.sprog);
        gl.vertexAttrib1f(4, -1);
        gl.uniform1i(M.su.shadowPass, 1);
        gl.uniformMatrix4fv(M.su.shadowMat, false, sunMat);
        for (const { draw: d } of shadow!.casters) {
          const g = M.meshes.get(d.mesh);
          if (!g || (d.fade ?? 1) <= 0) continue;
          gl.uniformMatrix4fv(M.su.model, false, d.matrix as Float32List);
          if (d.parts && d.parts.length >= 16) { poseTexture(M, d.parts); gl.uniform1i(M.su.parts, 12); gl.uniform1i(M.su.posed, 1); } else gl.uniform1i(M.su.posed, 0);
          gl.bindVertexArray(g.vao);
          // (A range draws that stretch of the indices only: a level's prefix, or a fading delta.)
          const [off, cnt] = d.range ?? [0, g.count];
          const count = Math.max(0, Math.min(cnt, g.count - off));
          gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, off * 4);
          stats.shadowTriangles += count / 3;
        }
        gl.bindVertexArray(null);
      }
      // Pass 1: the G-buffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.CULL_FACE);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.clearBufferuiv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.clearBufferiv(gl.COLOR, 2, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 3, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      gl.useProgram(M.gprog);
      gl.vertexAttrib1f(4, -1);
      const G = M.gu;
      gl.uniform3f(G.center, ctr[0], ctr[1], ctr[2]);
      gl.uniform3f(G.right, right[0], right[1], right[2]);
      gl.uniform3f(G.up, up[0], up[1], up[2]);
      gl.uniform3f(G.forward, forward[0], forward[1], forward[2]);
      gl.uniform1f(G.k, k); gl.uniform1f(G.depth, range); gl.uniform1f(G.tie, style.tie ?? 0.005);
      // (An orthographic view sorts over its own span when it names one -- deep enough for a tall scene; project.ts.)
      gl.uniform1f(G.clipRange, persp ? range : proj.clipFar ?? range);
      gl.uniform2f(G.size, W, H);
      // (Ground depth is the orthographic sprite convention; under perspective depth is the view's own, always.)
      gl.uniform1i(G.ground, !persp && (style.depth ?? "ground") === "ground" ? 1 : 0);
      gl.uniform1i(G.persp, persp ? 1 : 0);
      gl.uniformMatrix4fv(G.proj, false, proj.clip);
      gl.uniform3f(G.sun, s0[0] / sl, s0[1] / sl, s0[2] / sl);
      gl.uniform1i(G.shadowPass, 0);
      gl.uniform1f(G.shadowK, sunMat ? shadowK : 0);
      if (sunMat) { gl.uniformMatrix4fv(G.shadowMat, false, sunMat); gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, M.smap); gl.uniform1i(G.shadow, 13); gl.activeTexture(gl.TEXTURE0); }
      const nl = Math.min(MESH_LIGHTS, lights.length);
      lights.slice(0, nl).forEach((l, i) => {
        lightPos.set([l.pos[0], l.pos[1], l.pos[2], l.radius], i * 4);
        lightDir.set(l.dir ? [l.dir[0], l.dir[1], l.dir[2], l.cone ?? 0.8] : [0, 0, 0, 0], i * 4);
        lightI[i] = l.intensity;
        lightTint[i] = l.tint ?? 0;
        lightOwner[i] = l.owner ?? 0;
      });
      gl.uniform1i(G.lightCount, nl);
      if (nl) { gl.uniform4fv(G.lightPos, lightPos); gl.uniform4fv(G.lightDir, lightDir); gl.uniform1fv(G.lightI, lightI); gl.uniform1fv(G.lightTint, lightTint); gl.uniform1fv(G.lightOwner, lightOwner); }
      let triangles = 0;
      // (Draws sharing a seam write the first one's id: one surface to the outline -- MeshDraw.seam.)
      const seams = new Map<number, number>();
      draws.forEach((d, i) => { if (d.seam && !seams.has(d.seam)) seams.set(d.seam, i); });
      unsent();
      draws.forEach((d, i) => {
        const g = M.meshes.get(d.mesh);
        if (!g || (d.fade ?? 1) <= 0) return;
        const m = d.matrix;
        const at = d.anchor ?? [m[12]!, m[13]!, m[14]!];
        // (Where the thing sits in the picture: its dither's anchor. An orthographic draw also snaps its whole picture
        // to that whole pixel, so a moving car never crawls; a perspective draw doesn't -- nothing there is pixel-locked.)
        const [ax, ay] = proj.project([at[0], at[1], at[2]]);
        const sx = Math.floor(ax + 0.5), sy = Math.floor(ay + 0.5);
        gl.uniformMatrix4fv(G.model, false, m as Float32List);
        // (The rest only when it differs from the draw before's: see `sent`.)
        u2(0, G.snap, persp ? 0 : sx - ax, persp ? 0 : -(sy - ay), false);
        u2(2, G.anchor, sx, sy, true);
        u1(4, G.look, d.look, true); u1(5, G.draw, d.seam ? seams.get(d.seam)! : i, true); u1(6, G.owner, d.owner ?? 0, false);
        u1(7, G.chunk, Math.max(1, Math.min(31, Math.round(d.chunk ?? 1))), true);
        u1(8, G.marked, d.marked ? 1 : 0, true);
        u1(9, G.snowK, style.weather ? Math.max(0, Math.min(1, d.snow ?? 1)) : 0, false);
        u2(10, G.wipe, d.wipe?.[0] ?? -1, d.wipe?.[1] ?? 0, false);
        u4(12, G.fx, d.light ?? 1, d.flash ?? 0, d.fadeInvert ? -(d.fade ?? 1) : d.fade ?? 1, ambient);
        glowTo(G.slotGlow, d.glow);
        if (d.parts && d.parts.length >= 16) { poseTexture(M, d.parts); u1(16, G.parts, 12, true); u1(17, G.posed, 1, true); } else u1(17, G.posed, 0, true);
        gl.bindVertexArray(g.vao);
        const [off, cnt] = d.range ?? [0, g.count];
        const n = Math.max(0, Math.min(cnt, g.count - off));
        gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, off * 4);
        triangles += n / 3;
      });
      stats.triangles = triangles;
      gl.bindVertexArray(null);
      // Pass 2: paint the G-buffer through the looks, into what was bound.
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
      gl.viewport(0, 0, W, H);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(M.cprog);
      const U = M.cu;
      gl.uniform3f(U.center, ctr[0], ctr[1], ctr[2]);
      gl.uniform3f(U.right, right[0], right[1], right[2]);
      gl.uniform3f(U.up, up[0], up[1], up[2]);
      gl.uniform3f(U.forward, forward[0], forward[1], forward[2]);
      gl.uniform1f(U.k, k); gl.uniform2f(U.size, W, H); gl.uniform1f(U.depth, range);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.uniform1i(U.anchorDither, style.ditherAnchor === "sprite" ? 1 : 0);
      gl.uniform1i(U.ids, style.ids ? 1 : 0); gl.uniform1i(U.idBase, style.idBase ?? 0); gl.uniform1i(U.heightOn, 0);
      gl.uniform1f(U.gap, gap);
      const fog = persp ? style.fog : undefined;
      gl.uniform4f(U.fog, fog?.colour[0] ?? 0, fog?.colour[1] ?? 0, fog?.colour[2] ?? 0, fog ? Math.max(0, Math.min(1, fog.max ?? 1)) : 0);
      gl.uniform3f(U.fogRange, fog?.near ?? 0, fog?.far ?? 1, Math.max(1, Math.round(fog?.steps ?? 4)));
      gl.uniform2f(U.fogRay, proj.tanHalfFov * (W / H), proj.tanHalfFov);
      // The paint filters (filters.ts): the picture's, and the one marked draws wear. Kind 0 costs the paint nothing.
      const fPic = filterUniforms(style.filter);
      const fMark = filterUniforms(style.markFilter);
      gl.uniform1f(U.time, style.time ?? 0);
      gl.uniform1i(U.fKind, fPic.kind);
      gl.uniform4f(U.f0, fPic.a[0], fPic.a[1], fPic.a[2], fPic.a[3]);
      gl.uniform4f(U.f1, fPic.b[0], fPic.b[1], fPic.b[2], fPic.b[3]);
      gl.uniform4f(U.f2, fPic.c[0], fPic.c[1], fPic.c[2], fPic.c[3]);
      gl.uniform1i(U.gKind, fMark.kind);
      gl.uniform4f(U.g0, fMark.a[0], fMark.a[1], fMark.a[2], fMark.a[3]);
      gl.uniform4f(U.g1, fMark.b[0], fMark.b[1], fMark.b[2], fMark.b[3]);
      gl.uniform4f(U.g2, fMark.c[0], fMark.c[1], fMark.c[2], fMark.c[3]);
      // Weather (MeshStyle.weather): off unless asked for. Its map is uploaded when a new one (or a new version) comes.
      const wx = style.weather;
      gl.uniform1i(U.wxOn, wx ? 1 : 0);
      if (wx) {
        gl.uniform1i(U.wxPersp, persp ? 1 : 0);
        gl.uniform4f(U.wxAmt, Math.max(0, wx.snow ?? 0), Math.max(0, Math.min(1, wx.wet ?? 0)), Math.max(0, Math.min(1, wx.rain ?? 0)), wx.time ?? 0);
        gl.uniform2i(U.wxRamp, wx.snowRamp?.[0] ?? 0, wx.snowRamp?.[1] ?? 0);
        const map = wx.map;
        if (map && (map.data !== M.wxMapKey || map.version !== M.wxMapVersion)) {
          if (!M.wxMap) M.wxMap = gl.createTexture()!;
          gl.activeTexture(gl.TEXTURE15);
          gl.bindTexture(gl.TEXTURE_2D, M.wxMap);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, map.width, map.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, map.data);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          M.wxMapKey = map.data; M.wxMapVersion = map.version;
        }
        gl.uniform1i(U.wxMapOn, map ? 1 : 0);
        if (map) {
          gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, M.wxMap); gl.uniform1i(U.wxMap, 15);
          gl.uniform4f(U.wxBox, map.box[0], map.box[1], map.box[2], map.box[3]);
          gl.uniform3f(U.wxAlt, map.altitudes[0], Math.max(map.altitudes[0] + 1, map.altitudes[1]), Math.max(map.altitudes[1] + 2, map.altitudes[2]));
        }
      }
      tintRamps.fill(0);
      (style.tints ?? []).slice(0, 24).forEach((t, i) => { tintRamps[i * 2] = t[0]; tintRamps[i * 2 + 1] = t[1]; });
      gl.uniform2iv(U.tints, tintRamps);
      gl.uniform1i(U.chunkMax, draws.reduce((m, d) => Math.max(m, Math.min(31, Math.round(d.chunk ?? 1))), 1));
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, L.places); gl.uniform1i(U.places, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, L.decals); gl.uniform1i(U.decals, 6);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, M.ga); gl.uniform1i(U.ga, 7);
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, M.gb); gl.uniform1i(U.gb, 8);
      gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, M.gc); gl.uniform1i(U.gc, 9);
      gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, M.gd); gl.uniform1i(U.gd, 14);
      gl.uniform3fv(U.mirrorAxes, new Float32Array([right[0], right[1], right[2], up[0], up[1], up[2], forward[0], forward[1], forward[2]]));
      // (How far a reflection is followed: far enough to find the CAR BESIDE YOU, not just this car's own flank.)
      gl.uniform2f(U.mirrorK, k, style.mirror ?? 260);
      // (Samplers the paint never reads still need a unit of their own type.)
      gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D_ARRAY, deps.pages()[0]); gl.uniform1i(U.pages, 10);
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D_ARRAY, deps.pages()[1]); gl.uniform1i(U.heights, 11);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.bindVertexArray(M.tri);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      // (A game's own pass over the painted G-buffer -- MeshStyle.after -- before the bloom lights it.)
      if (style.after) {
        style.after({ ga: M.ga!, gb: M.gb!, gc: M.gc!, gd: M.gd!, width: W, height: H, target: prev, draws });
        gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
        gl.viewport(0, 0, W, H);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        gl.bindVertexArray(null);
        gl.activeTexture(gl.TEXTURE0);
      }
      // Pass 3: bloom -- light off the parts that burn, in their own shape (bloom.ts).
      const reach = style.bloom ?? 3;
      let rect: [number, number, number, number] | undefined;
      if (reach > 0 && style.bloomScissor !== false) {
        let left = W, bottom = H, right = 0, top = 0;
        for (const d of draws) {
          if (!hasBloom(d.bloom)) continue;
          const g = M.meshes.get(d.mesh);
          if (!g) continue;
          // A seam reads the first draw's bloom, so its whole group must be covered.
          if (d.seam) { left = bottom = 0; right = W; top = H; break; }
          // One extra pixel covers orthographic snapping and raster precision; the kernel reaches out on both axes.
          const b = boundsFor(d);
          const r = screenBounds(proj, b.lo, b.hi, d.matrix, Math.min(BLOOM_REACH, Math.round(reach)) + 1);
          if (!r[2] || !r[3]) continue;
          left = Math.min(left, r[0]); bottom = Math.min(bottom, r[1]); right = Math.max(right, r[0] + r[2]); top = Math.max(top, r[1] + r[3]);
        }
        rect = [left, bottom, Math.max(0, right - left), Math.max(0, top - bottom)];
      }
      stats.bloomPixels = reach > 0 && draws.some(d => hasBloom(d.bloom)) ? rect ? rect[2] * rect[3] : W * H : 0;
      bloom.draw(M.ga!, M.gb!, draws.map((d) => d.bloom), W, H, reach, rect, style.bloomCache, style.bloomSeparable);
  };

  return { setMesh, draw, get stats() { return { ...stats }; } };
}
