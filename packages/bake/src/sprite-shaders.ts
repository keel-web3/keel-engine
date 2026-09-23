import { SLOTS } from "./indexed.ts";
import { LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW } from "./looks.ts";
import { SWAY_VS, swayFragment } from "./sway.ts";
import { LAYER_FS } from "./paint-shader.ts";
import type { DepthAxis } from "./depth.ts";
import type { MeshFilterInput } from "./filters.ts";

const SLOTS_GLSL = String(SLOTS);
const LOOKS_PER_ROW_GLSL = String(LOOKS_PER_ROW);
const LOOK_TEXELS_GLSL = String(LOOK_TEXELS);
const PAINTS_PER_ROW_GLSL = String(PAINTS_PER_ROW);
const PALETTE_ROW_GLSL = String(PALETTE_ROW);

/** A look table's textures (looks.ts): the palette (RGBA8), the paints and the looks (RGBA32UI); decal placements (RGBA32UI) and the decals' atlas (RGBA8), when it has any. */
export interface LookTextures {
  readonly palette: { readonly width: number; readonly height: number; readonly rgba: Uint8Array };
  readonly paints: { readonly width: number; readonly height: number; readonly data: Uint32Array };
  readonly looks: { readonly width: number; readonly height: number; readonly data: Uint32Array };
  readonly places?: { readonly width: number; readonly height: number; readonly data: Uint32Array } | undefined;
  readonly decals?: { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | undefined;
}
/** How drawLayers turns indexed texels into pixels. */
export interface LayerStyle {
  /** The dither screen: 0 none, 2, 4 or 8 (Bayer), anchored to the screen (default 4). */
  readonly screen?: number;
  /** How far the screen reaches between two entries (default 0.9). */
  readonly dither?: number;
  /** Entries darker on an outline edge (default 3, the pixel pass's classic). */
  readonly outline?: number;
  /**
   * Where the dither screens are anchored: "screen" (default: the picture's pixels -- a still scene) or "sprite" (each
   * sprite's own anchor pixel, so a moving thing's pattern moves with it instead of crawling across it).
   */
  readonly ditherAnchor?: "screen" | "sprite";
  /** Clear to this colour first (RGB 0..1; null keeps what's drawn, depth included). */
  readonly clear?: readonly [number, number, number] | null;
  /**
   * Depth sprites (depth.ts): each texel at the depth of the point it shows, from the pages' heights (default on when
   * the pages carry them; texels without a height keep their anchor's depth, as before).
   */
  readonly heights?: boolean;
  /** Which depth the scene writes (depth.ts): "ground" (keel/terrain's; sprites placed by spritePosition -- default) or "view". */
  readonly depth?: DepthAxis;
  /** Depth sprites: metres a texel wins a tie with what's under it by (default 5 mm: over the CPU ground's depth steps). */
  readonly tie?: number;
  /**
   * An ID picture instead of colours (picking, the occlusion checks): every pixel its instance's index + 1 + `idBase`,
   * 24 bits over RGB (depth as ever).
   */
  readonly ids?: boolean;
  readonly idBase?: number;
}

/** An atlas page: RGBA texels, and for depth sprites a height per texel (two bytes each, high then low: indexed.ts). */
export interface AtlasPage { readonly width: number; readonly height: number; readonly rgba: Uint8Array; readonly heights?: Uint8Array | undefined }

export const VS = `#version 300 es
layout(location=0) in vec2 aCorner;           // 0..1 quad corner
layout(location=1) in vec3 aPos;              // world position (the sprite's ground anchor)
layout(location=2) in vec4 aRect;             // u0, v0, w, h in atlas pixels
layout(location=3) in vec2 aAnchor;           // anchor in sprite pixels
layout(location=4) in vec3 aLayerFlags;       // page layer, flags, scale
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK;                             // pixels per metre
uniform vec2 uSize;                           // picture size in pixels
uniform float uDepthRange;                    // metres of depth mapped to 0..1
out vec3 vUv;
void main() {
  vec3 d = aPos - uCenter;
  // The anchor's picture pixel, snapped to a whole pixel: sprites never land between pixels.
  vec2 anchor = floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  float s = aLayerFlags.z;
  vec2 px = anchor - floor(aAnchor * s + 0.5) + aCorner * floor(aRect.zw * s + 0.5);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  float depth = clamp(0.5 + dot(d, uForward) / uDepthRange, 0.0, 1.0); // (nearer the camera: smaller forward distance: smaller depth)
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vUv = vec3(aRect.xy + aCorner * aRect.zw, aLayerFlags.x);
}`;

export const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uPages;
in vec3 vUv;
out vec4 outColor;
void main() {
  vec4 c = texelFetch(uPages, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0);
  if (c.a < 0.5) discard;                     // (pixel art: a texel is there or it isn't)
  outColor = vec4(c.rgb, 1.0);
}`;

// The layer program: indexed sprites through their looks (plain RGBA sprites alongside, look -1), one draw.
export const LAYER_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in vec4 aRect;
layout(location=3) in vec2 aAnchor;
layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK;
uniform vec2 uSize;
uniform float uDepthRange;
out vec3 vUv;
flat out int vLook;
flat out vec2 vDepth;                          // the instance's depth, and its bias (both 0..1 of the depth range)
flat out vec4 vDS;                             // depth sprites: the anchor's depth (m), its metres up the picture, its rect's height (texels), scale
flat out int vId;
flat out vec2 vAnchor;                         // the anchor's whole pixel (x right, y down): a sprite-anchored dither
void main() {
  vId = gl_InstanceID;
  vec3 d = aPos - uCenter;
  vec2 anchor = floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  vAnchor = anchor;
  float s = aExtra.w;
  vec2 px = anchor - floor(aAnchor * s + 0.5) + aCorner * floor(aRect.zw * s + 0.5);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  float depth = clamp(0.5 + dot(d, uForward) / uDepthRange, 0.0, 1.0);
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vUv = vec3(aRect.xy + aCorner * aRect.zw, aExtra.x);
  vLook = int(floor(aExtra.y + 0.5));
  vDepth = vec2(depth, abs(aExtra.z) / uDepthRange);
  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);
}`;

// The paint shader lives in paint-shader.ts: the mesh pass paints through the same one.

// Billboards (engine): the same layers seen through a PERSPECTIVE camera -- a unit far off in a first-person or chase
// view. Each anchor is projected (and snapped to a whole pixel); its sprite is drawn at the instance's scale (the
// caller picks the baked scale nearest the size it shows at, so texels stay about a pixel each); its depth is its
// distance over `far` -- keel/render's convention, so what render({ depthOut }) left in the depth buffer hides it. The
// spare float is a dissolve (0..1): texels under that share of a 4x4 screen are dropped -- the pixels a solid fading
// in (keel/render's raster fade) takes.
export const BILLBOARD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in vec4 aRect;
layout(location=3) in vec2 aAnchor;
layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale
layout(location=5) in float aFade;            // dissolved share
uniform vec3 uEye, uRight, uUp, uForward;
uniform float uTan, uAspect, uFar, uLift;
uniform int uContract;                         // 1: depth by project.ts's contract (linear forward), not the raymarcher's radial
uniform vec2 uSize;
out vec3 vUv;
flat out int vLook;
flat out vec2 vDepth;
flat out float vFade;
flat out vec4 vDS;                             // (depth sprites are orthographic: a billboard keeps its distance)
flat out int vId;
flat out vec2 vAnchor;
void main() {
  vDS = vec4(0.0);
  vId = gl_InstanceID;
  vec3 e = aPos - uEye;
  float z = dot(e, uForward);
  vUv = vec3(aRect.xy + aCorner * aRect.zw, aExtra.x);
  vLook = int(floor(aExtra.y + 0.5));
  vFade = aFade;
  if (z < 0.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vDepth = vec2(1.0, 0.0); return; }
  vec2 ndc0 = vec2(dot(e, uRight) / (z * uTan * uAspect), dot(e, uUp) / (z * uTan));
  vec2 anchor = floor(vec2((ndc0.x * 0.5 + 0.5) * uSize.x, (0.5 - ndc0.y * 0.5) * uSize.y) + 0.5);
  vAnchor = anchor;
  float s = aExtra.w;
  vec2 px = anchor - floor(aAnchor * s + 0.5) + aCorner * floor(aRect.zw * s + 0.5);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  // (The whole sprite at its anchor's distance, pulled toward the eye by uLift: the ground just in front of its feet doesn't cut them off.)
  // (By default the raymarched world's own depth -- distance over far, radial -- so a billboard sorts against keel/render's
  // picture. In a live-mesh scene, the one contract instead: linear forward distance from the eye, 0.5 at the eye.)
  float depth = uContract == 1 ? clamp(0.5 + (z - uLift) / uFar, 0.0, 1.0) : clamp((length(e) - uLift) / uFar, 0.0, 1.0);
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vDepth = vec2(depth, abs(aExtra.z) / uFar);
}`;
export const BILLBOARD_FS = LAYER_FS
  .replace("flat in vec2 vDepth;", "flat in vec2 vDepth;\nflat in float vFade;")
  .replace("void main() {\n  vec4 c = texelFetch", "void main() {\n  if (vFade > 0.0 && bayer(ivec2(gl_FragCoord.xy), 4) < vFade) discard;\n  vec4 c = texelFetch");
if (BILLBOARD_FS === LAYER_FS || !BILLBOARD_FS.includes("vFade > 0.0")) throw new Error("BILLBOARD_FS: LAYER_FS changed under its edits.");
// Swaying layers (sway.ts): the layer shader with each texel row fetched from a whole-pixel shifted column.
export const SWAY_FS = swayFragment(LAYER_FS);
// Layers with per-instance effects (fx.ts): the spare float is a dissolve (whole 16ths) and a flash (the fraction).
export const FX_VS = LAYER_VS
  .replace("layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale", "layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale\nlayout(location=5) in float aFx;              // packFx(flash, dissolve)")
  .replace("flat out vec2 vDepth;", "flat out vec2 vDepth;\nflat out float vFx;")
  .replace("  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);\n}", "  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);\n  vFx = aFx;\n}");
export const FX_FS = LAYER_FS
  .replace("flat in vec2 vDepth;", "flat in vec2 vDepth;\nflat in float vFx;")
  .replace("void main() {\n  vec4 c = texelFetch", "void main() {\n  float fxD = floor(max(vFx, 0.0)) / 16.0;\n  float fxF = fract(max(vFx, 0.0));\n  if (fxD > 0.0 && bayer(ivec2(gl_FragCoord.xy), 4) < fxD) discard;\n  vec4 c = texelFetch")
  .replace("  if (edge) idx = max(0, idx - uOutline);", "  if (!edge && fxF > 0.0) idx = fxF > 0.7 ? len - 1 : min(len - 1, idx + int(ceil(fxF * float(len))));\n  if (edge) idx = max(0, idx - uOutline);");

if (!FX_VS.includes("vFx = aFx;") || !FX_VS.includes("in float aFx;") || !FX_FS.includes("fxD > 0.0") || !FX_FS.includes("fxF > 0.7")) throw new Error("FX shaders: LAYER_VS / LAYER_FS changed under their edits.");

/** A perspective camera for drawBillboards: keel/render's (its eye, its basis, its vertical fov). */
export interface BillboardCamera {
  readonly eye: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  /** Vertical field of view, radians. */
  readonly fov: number;
}
/** How drawBillboards draws: the layer style, the depth range (keel/render's FAR, 140 m) and how far the depth is pulled toward the eye. */
export interface BillboardStyle extends Omit<LayerStyle, "clear"> {
  readonly far?: number;
  readonly lift?: number;
  /**
   * "radial" (default): the raymarched world's depth, distance over `far` -- what keel/render's depthOut leaves. "contract":
   * keel/bake project.ts's linear forward distance, so billboards sort with a live mesh scene through a perspective camera.
   */
  readonly depthMode?: "radial" | "contract";
}

/** One live mesh in a frame (drawMeshes). */
export interface MeshDraw {
  /** The key setMesh gave it. */
  readonly mesh: string;
  /** Optional prebuilt replacement, used only below a quarter-pixel projected error. Error is in local metres.
   * Bounds/UVs must describe the same object. Ranges and per-part poses always keep the full mesh. */
  readonly lod?: { readonly mesh: string; readonly error: number };
  /** Its transform (column-major 4x4: meshMatrix, mulMatrix). */
  readonly matrix: ArrayLike<number>;
  /** The look table's index it's painted with. */
  readonly look: number;
  /**
   * The point its picture snaps to a whole pixel by, and its dither is anchored to (default the matrix's translation).
   * Parts of one thing (a car's body and wheels) share it, so they never slip a pixel apart.
   */
  readonly anchor?: readonly [number, number, number];
  /**
   * A pose (mesh.ts poseMatrices): a 4x4 a part, taking the mesh's rest pose to this frame's -- a limb bent, a door
   * swung. Absent: the mesh as it was made.
   */
  readonly parts?: Float32Array | undefined;
  /**
   * Live emission per slot (0..1 added to its shade): a headlight lit at night, a taillight under braking, a hot
   * exhaust -- on the part itself, this frame. Indexed by slot (keel/bake SLOTS).
   */
  readonly glow?: ArrayLike<number> | undefined;
  /**
   * Light spilling OFF a part (bloom.ts): per slot, its colour and how hard it burns -- r, g, b, strength (0..1 each),
   * four numbers a slot. A brake light under braking glows round its own shape; a headlight at night; a neon tube.
   */
  readonly bloom?: ArrayLike<number> | undefined;
  /** What this draw belongs to (a car): lights with the same owner skip it -- its own headlights don't light it. */
  readonly owner?: number;
  /**
   * One surface cut into many draws (a terrain's tiles): draws sharing a seam (non-zero) outline as ONE thing, so no
   * ink runs along the cuts between them. They take the first such draw's bloom. Absent: every draw its own.
   */
  readonly seam?: number;
  /**
   * How big its own pixels look, in picture pixels (default 1). 4 samples on a quarter-resolution grid beside
   * fine objects, with nothing baked. 1..31. This quantizes appearance; the material pass still shades the full target.
   */
  readonly chunk?: number;
  /** Lightness scale (default 1), shade added (a flash, 0..1), how much is drawn (a dithered fade, 0..1). */
  readonly light?: number;
  readonly flash?: number;
  readonly fade?: number;
  /** A smooth body-space wipe: [position 0..1, side 0 old / 1 new]. */
  readonly wipe?: readonly [number, number];
  /**
   * Draw only these indices of the mesh: [offset, count] (a level of detail's prefix, or the delta between two levels --
   * keel/lod rangesOf). Absent: the whole mesh.
   */
  readonly range?: readonly [number, number];
  /**
   * How much of the style's weather snow this draw takes (0..1, default 1): 0 for what snow never lies on -- a lit sign,
   * a cloud, a plane in the sky. Only read when the style has weather.
   */
  readonly snow?: number;
  /** The complementary dither: kept exactly where a plain `fade` of 1 - fade would discard (an A/B cross-fade). */
  readonly fadeInvert?: boolean;
  /**
   * Wear the style's `markFilter` instead of the picture's `filter` (filters.ts). A gallery car whose chain seed
   * hasn't arrived is drawn `marked` with `markFilter: "ghost"`, and goes solid the moment its seed lands.
   */
  readonly marked?: boolean;
}
/** A live light: a point (no `dir`) or a spot (`dir` and `cone`, the cosine of its half angle). */
export interface MeshLight {
  readonly pos: readonly [number, number, number];
  readonly radius: number;
  readonly intensity: number;
  readonly dir?: readonly [number, number, number];
  readonly cone?: number;
  /** Which of the style's tints it wears (1-based; absent: it only brightens). */
  readonly tint?: number;
  /** Whose lamp it is (a draw's `owner`): it never lights that thing itself. */
  readonly owner?: number;
}
/** How drawMeshes draws: the layer style, plus the sun (world, default over the viewer's left shoulder), ambient, lights and the outline's depth gap. */
export interface MeshStyle extends Omit<LayerStyle, "heights"> {
  /** Diagnostic override: false keeps full geometry for draws with a prebuilt replacement. */
  readonly lod?: boolean;
  readonly sun?: readonly [number, number, number];
  readonly ambient?: number;
  readonly lights?: readonly MeshLight[];
  /** Metres a neighbour must be behind for a part's edge to be outlined (default 0.06). */
  readonly gap?: number;
  /** Skip meshes the frustum can't see (default true; false draws everything, for a debug shot). */
  readonly cull?: boolean;
  /**
   * The sun's own shadow (default on): the meshes drawn once from the sun into a depth map, so a roof shades its cabin
   * and a car shades the one beside it. `strength` 0..1 (default 0.75), `size` the map's pixels (default 1024).
   */
  readonly shadows?: boolean | { readonly strength?: number; readonly size?: number; /** False submits all shadow casters as a diagnostic reference. */ readonly cull?: boolean };
  /** How far (picture pixels) a reflection is followed across the picture (default 260; 0 turns mirroring off). */
  readonly mirror?: number;
  /** How far a part's bloom spreads (picture pixels, up to BLOOM_REACH; default 3; 0 off). */
  readonly bloom?: number;
  /** Bound bloom to the emitting meshes plus its kernel reach (default true); false is a diagnostic reference. */
  readonly bloomScissor?: boolean;
  /** Resolve emission once before filtering (default true); false compares the direct material reads. */
  readonly bloomCache?: boolean;
  /** Separable squared-tent glow for broad emission; false retains the radial filter (default). */
  readonly bloomSeparable?: boolean;
  /** Ramps a coloured light can wear, [base in the palette, length] (up to 24; LookTable.ramp gives a role's base). */
  readonly tints?: readonly (readonly [number, number])[];
  /** Distance haze (perspective only): what's far goes toward `colour` (linear 0..1) in dithered steps. */
  readonly fog?: MeshFog;
  /**
   * The filter the whole picture wears (filters.ts): a name ("soft", "toon", "comic", "ghost", "wraith"), a filter
   * of your own, or nothing for the painted look. The world is lit exactly as it always is -- a filter only decides
   * how that light meets the palette.
   */
  readonly filter?: MeshFilterInput;
  /**
   * A SECOND filter, worn only by the draws that ask for it (MeshDraw.marked). One frame carries two at most: the
   * picture's and this -- enough for a gallery whose known cars are painted and whose unknown ones are ghosts. A
   * third is a second drawMeshes call.
   */
  readonly markFilter?: MeshFilterInput;
  /** Seconds, for the filters that move (a ghost breathes and glitches). Absent: they hold still. */
  readonly time?: number;
  /**
   * Called once the G-buffer is painted into the target, before the bloom: a game's own full-screen pass that reads
   * what pass 1 wrote (which look and slot each pixel is, its true forward distance, its normal) -- open water shaded
   * over the painted surface, say. It draws into the bound target itself and leaves the depth test as LEQUAL.
   */
  readonly after?: (g: MeshGBuffer) => void;
  /**
   * Weather on the meshes (opt-in: without it every pixel paints exactly as it always has). Snow lies on what faces up
   * -- roofs, ledges, a car's roof and bonnet, the land, a tree's crown -- whole on a flat top, climbing steeper faces
   * as it deepens, in a dithered edge anchored to the world; wet darkens what it's on, gives it a sheen at a glance,
   * and runs down the walls in the rain.
   */
  readonly weather?: MeshWeather;
}
/**
 * The weather a mesh frame wears. `snow` and `wet` are amounts (0..1) everywhere -- or, with a `map`, what the map says
 * times them. Snow's depth is in tenths of a metre (1: 10 cm and more, and everything that faces up is white). Crossed
 * cards (grass, bushes, tree crowns) take no snow: foliage wears its season in its own paint.
 */
export interface MeshWeather {
  /** Snow's ramp in the palette, [base, length] (LookTable.ramp of a white role). Without it no snow shows. */
  readonly snowRamp?: readonly [number, number];
  readonly snow?: number;
  readonly wet?: number;
  /**
   * Snow and wet over the world, RGBA8 over `box` (x0, z0, x1, z1), filtered: r, g and b the snow's depth (0..1) at
   * the three `altitudes` (m; between them it's blended, above and below held), a the wet (0..1). Re-uploaded when its
   * `version` changes.
   */
  readonly map?: {
    readonly data: Uint8Array; readonly width: number; readonly height: number;
    readonly box: readonly [number, number, number, number]; readonly altitudes: readonly [number, number, number]; readonly version: number;
  };
  /** Rain running down the walls (0 none .. 1 a downpour). */
  readonly rain?: number;
  /** Seconds, for the rain's run. */
  readonly time?: number;
}
/**
 * The mesh pass's G-buffer, for MeshStyle.after (mesh.ts MESH_GFS): `ga` slot + 1 / 255, shade, surface uv; `gb` (uint)
 * look + 1, draw << 16 | part, the contract depth's bits, the forward distance's bits; `gc` (int) anchor, tint + chunk
 * * 32 (+ the weather's snow share << 10: mask the chunk with & 31), tint strength | flags; `gd` the normal (octahedral) and body space. `target` is the framebuffer painted into.
 */
export interface MeshGBuffer {
  readonly ga: WebGLTexture; readonly gb: WebGLTexture; readonly gc: WebGLTexture; readonly gd: WebGLTexture;
  readonly width: number; readonly height: number; readonly target: WebGLFramebuffer | null;
  /** The draws as drawn (culled and LOD-picked): gb's draw index is an index into this -- a pass can look a pixel's draw up (its owner, say). */
  readonly draws?: readonly MeshDraw[];
}
/**
 * Haze by true distance from the eye: none nearer than `near`, rising to `max` (default 1) at `far`, in `steps` dithered
 * bands (default 4) -- pixel art has no blending, so a far wall takes a dithered share of the haze colour instead.
 */
export interface MeshFog { readonly colour: readonly [number, number, number]; readonly near: number; readonly far: number; readonly max?: number; readonly steps?: number }
