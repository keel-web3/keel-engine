// The stages gl-programs.test.ts draws, shared with the fixture generator
// (make-gl-programs-fixtures.mjs, outside this repo: Three is never a
// dependency here), which builds the same stages from r180's classes under
// keel/lit's names and draws them with r180's own WebGLRenderer.
//
// Each stage is a grid of quads, one per material variant (every material
// class; flat shading, vertex colours with and without alpha, map, emissive,
// alphaTest, transparency, each side, instancing with and without instance
// colours, grove's onCompile patch), under one lighting and fog setup, drawn
// over two frames with a few changes between them.

import type * as K from "../src/index.ts";

// (r180's classes or keel/lit's, under keel/lit's names; k maps a keel/lit
// constant to the side's own value, patch installs an onCompile patch)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export type Lib = typeof K & {
  k(table: string, value: string): Any;
  patch(material: Any, fn: (shader: Any, renderer: unknown) => void): void;
};

/** grove's patch: sway the vertices, tint the colour (as the grove's leaves do). */
export function grovePatch(shader: Any): void {
  shader.uniforms.uSway = { value: 0.25 };
  shader.vertexShader = "uniform float uSway;\n" + shader.vertexShader.replace(
    "#include <begin_vertex>",
    "#include <begin_vertex>\n\ttransformed.x += sin( position.y * 3.0 ) * uSway;",
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <color_fragment>",
    "#include <color_fragment>\n\tdiffuseColor.rgb *= 0.9 + 0.1 * clamp( - vViewPosition.z * 0.05, 0.0, 1.0 );",
  );
}

/** A second patch: the fragment only (its own cache key). */
export function tintPatch(shader: Any): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <color_fragment>",
    "#include <color_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0, 0.8, 0.6 ), 0.25 );",
  );
}

const CUSTOM_VERTEX = `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec2 vUv;
void main() {
	vUv = uv;
	vec4 mvPosition = modelViewMatrix * vec4( position + normal * uTime, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const CUSTOM_FRAGMENT = `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform vec2 uOffset;
uniform sampler2D uMap;
uniform float uLevels[ 3 ];
varying vec2 vUv;
void main() {
	vec3 c = uColor * texture2D( uMap, vUv + uOffset ).rgb;
#if LEVELS > 2
	c *= uLevels[ 0 ] + uLevels[ 1 ] + uLevels[ 2 ];
#endif
	gl_FragColor = vec4( c, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

// (grid cell i: a quad's position, in front of the camera)
function cell(i: number): [number, number, number] {
  const col = i % 8, row = Math.floor(i / 8);
  return [-7 + col * 2, 0.5 + (row % 2) * 0.25, -6 + row * 2.5];
}

function quad(lib: Lib, colors: 0 | 3 | 4): Any {
  const g = new lib.Geometry();
  g.setAttribute("position", new lib.Attribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3, false));
  g.setAttribute("normal", new lib.Attribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3, false));
  g.setAttribute("uv", new lib.Attribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2, false));
  if (colors === 3) g.setAttribute("color", new lib.Attribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0]), 3, false));
  if (colors === 4) g.setAttribute("color", new lib.Attribute(new Float32Array([1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 0.25, 1, 1, 0, 1]), 4, false));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function texture(lib: Lib, seed: number, repeat = 1): Any {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + seed * 101) % 256;
  const t = new lib.DataTexture(data, 4, 4);
  t.colorSpace = lib.k("colorSpace", "srgb");
  if (repeat !== 1) {
    t.wrapS = t.wrapT = lib.k("wrapping", "repeat");
    t.repeat.set(repeat, repeat);
    t.offset.set(0.25, 0.125);
    t.rotation = 0.3;
  }
  t.needsUpdate = true;
  return t;
}

function gradient(lib: Lib): Any {
  const t = new lib.DataTexture(new Uint8Array([60, 60, 60, 255, 160, 160, 160, 255, 255, 255, 255, 255]), 3, 1);
  t.minFilter = t.magFilter = lib.k("filter", "nearest");
  t.needsUpdate = true;
  return t;
}

/** A stage to draw: the renderer's settings, and what changes before each frame. */
export interface Built {
  stage: Any;
  camera: Any;
  settings: { toneMapping: Any; outputColorSpace: Any; shadows: Any | null };
  /** Run before frame f (f = 0, 1). */
  frames: ((f: number) => void)[];
}

interface Variant {
  name: string;
  make(lib: Lib, at: [number, number, number]): Any;
}

// (named by role: the material's name is what the fixture keys programs by)
function mesh(lib: Lib, name: string, material: Any, colors: 0 | 3 | 4 = 0): Any {
  material.name = name;
  const m = new lib.Mesh(quad(lib, colors), material);
  m.name = name;
  return m;
}

function instances(lib: Lib, name: string, material: Any, color: boolean): Any {
  material.name = name;
  const m = new lib.Instances(quad(lib, 0), material, 3);
  const mat = new lib.Matrix4();
  for (let i = 0; i < 3; i++) {
    mat.makeTranslation(i * 0.4 - 0.4, i * 0.3, -i * 0.2);
    m.setMatrixAt(i, mat);
    if (color) m.setColorAt(i, new lib.Color(0.2 + i * 0.3, 0.5, 1 - i * 0.3));
  }
  m.name = name;
  return m;
}

const VARIANTS: Variant[] = [
  // ---- flat (r180's MeshBasicMaterial)
  { name: "flat", make: (l) => mesh(l, "flat", new l.FlatMaterial({ color: 0x44aa88 })) },
  { name: "flat-map", make: (l) => mesh(l, "flat-map", new l.FlatMaterial({ map: texture(l, 1, 2) })) },
  { name: "flat-vcolor", make: (l) => mesh(l, "flat-vcolor", new l.FlatMaterial({ vertexColors: true }), 3) },
  { name: "flat-valpha", make: (l) => mesh(l, "flat-valpha", new l.FlatMaterial({ vertexColors: true, transparent: true }), 4) },
  { name: "flat-transparent", make: (l) => mesh(l, "flat-transparent", new l.FlatMaterial({ color: 0xff8800, transparent: true, opacity: 0.5 })) },
  { name: "flat-alphatest", make: (l) => mesh(l, "flat-alphatest", new l.FlatMaterial({ map: texture(l, 2), alphaTest: 0.5 })) },
  { name: "flat-back", make: (l) => mesh(l, "flat-back", new l.FlatMaterial({ color: 0x8844aa, side: l.k("side", "back") })) },
  { name: "flat-both", make: (l) => mesh(l, "flat-both", new l.FlatMaterial({ color: 0x2266cc, side: l.k("side", "both") })) },
  { name: "flat-nofog", make: (l) => mesh(l, "flat-nofog", new l.FlatMaterial({ color: 0xcccccc, fog: false })) },
  // ---- lit (r180's MeshStandardMaterial)
  { name: "lit", make: (l) => mesh(l, "lit", new l.LitMaterial({ color: 0x55cc55 })) },
  { name: "lit-flatshading", make: (l) => mesh(l, "lit-flatshading", new l.LitMaterial({ color: 0x5577cc, flatShading: true })) },
  { name: "lit-map", make: (l) => mesh(l, "lit-map", new l.LitMaterial({ map: texture(l, 3) })) },
  { name: "lit-emissive", make: (l) => mesh(l, "lit-emissive", new l.LitMaterial({ color: 0x222222, emissive: 0x663311, emissiveIntensity: 0.7 })) },
  { name: "lit-rough", make: (l) => mesh(l, "lit-rough", new l.LitMaterial({ color: 0x999999, roughness: 0.35, metalness: 0.6 })) },
  { name: "lit-alphatest", make: (l) => mesh(l, "lit-alphatest", new l.LitMaterial({ map: texture(l, 4), alphaTest: 0.4 })) },
  { name: "lit-transparent-both", make: (l) => mesh(l, "lit-transparent-both", new l.LitMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6, side: l.k("side", "both") })) },
  { name: "lit-vcolor", make: (l) => mesh(l, "lit-vcolor", new l.LitMaterial({ vertexColors: true }), 3) },
  { name: "lit-instanced", make: (l) => instances(l, "lit-instanced", new l.LitMaterial({ color: 0x77aa33 }), false) },
  { name: "lit-instanced-color", make: (l) => instances(l, "lit-instanced-color", new l.LitMaterial({ color: 0xffffff }), true) },
  {
    name: "lit-grove",
    make(l) {
      const m = new l.LitMaterial({ color: 0x66bb44, side: l.k("side", "both"), map: texture(l, 5) });
      l.patch(m, grovePatch);
      return instances(l, "lit-grove", m, true);
    },
  },
  { name: "lit-dither", make: (l) => mesh(l, "lit-dither", new l.LitMaterial({ color: 0xbbaa99, dithering: true })) },
  {
    name: "lit-tint",
    make(l) {
      const m = new l.LitMaterial({ color: 0xaa6633 });
      l.patch(m, tintPatch);
      return mesh(l, "lit-tint", m);
    },
  },
  // ---- toon
  { name: "toon", make: (l) => mesh(l, "toon", new l.ToonMaterial({ color: 0xdd7744 })) },
  { name: "toon-gradient", make: (l) => mesh(l, "toon-gradient", new l.ToonMaterial({ color: 0x4477dd, gradientMap: gradient(l) })) },
  { name: "toon-instanced-color", make: (l) => instances(l, "toon-instanced-color", new l.ToonMaterial({ color: 0xffffff }), true) },
  {
    name: "toon-grove",
    make(l) {
      const m = new l.ToonMaterial({ color: 0x88cc55, alphaTest: 0.3, map: texture(l, 6) });
      l.patch(m, grovePatch);
      return mesh(l, "toon-grove", m);
    },
  },
  // ---- billboards (r180's sprites)
  {
    name: "billboard",
    make(l) {
      const m = new l.BillboardMaterial({ color: 0xffeeaa });
      m.name = "billboard";
      const s = new l.Billboard(m);
      s.name = "billboard";
      return s;
    },
  },
  {
    name: "billboard-map",
    make(l) {
      const m = new l.BillboardMaterial({ map: texture(l, 7), alphaTest: 0.25, rotation: 0.4, transparent: false });
      m.name = "billboard-map";
      const s = new l.Billboard(m);
      s.center.set(0.5, 0.25);
      s.scale.set(1.5, 1, 1);
      s.name = "billboard-map";
      return s;
    },
  },
  // ---- custom (r180's ShaderMaterial)
  {
    name: "custom",
    make(l) {
      const m = new l.CustomMaterial({
        vertexShader: CUSTOM_VERTEX,
        fragmentShader: CUSTOM_FRAGMENT,
        defines: { LEVELS: 3 },
        uniforms: {
          uTime: { value: 0.1 },
          uColor: { value: new l.Color(0.8, 0.6, 0.4) },
          uOffset: { value: new l.Vector2(0.1, 0.2) },
          uMap: { value: texture(l, 8) },
          uLevels: { value: [0.2, 0.3, 0.5] },
        },
      });
      return mesh(l, "custom", m);
    },
  },
  {
    name: "custom-fog",
    make(l) {
      const m = new l.CustomMaterial({
        vertexShader: CUSTOM_VERTEX,
        fragmentShader: CUSTOM_FRAGMENT,
        fog: true,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new l.Color(0.3, 0.9, 0.6) },
          uOffset: { value: new l.Vector2(0, 0) },
          uMap: { value: texture(l, 9) },
          uLevels: { value: [1, 1, 1] },
          fogDensity: { value: 0.00025 },
          fogNear: { value: 1 },
          fogFar: { value: 2000 },
          fogColor: { value: new l.Color(0xffffff) },
        },
      });
      return mesh(l, "custom-fog", m);
    },
  },
  {
    name: "custom-glsl3",
    make(l) {
      const m = new l.CustomMaterial({
        vertexShader: CUSTOM_VERTEX,
        fragmentShader: CUSTOM_FRAGMENT,
        glslVersion: "300 es",
        defines: { LEVELS: 2 },
        uniforms: {
          uTime: { value: 0.05 },
          uColor: { value: new l.Color(0.5, 0.5, 1) },
          uOffset: { value: new l.Vector2(0.5, 0) },
          uMap: { value: texture(l, 10) },
          uLevels: { value: [0.5, 0.5, 0] },
        },
      });
      return mesh(l, "custom-glsl3", m);
    },
  },
  // ---- depth
  { name: "depth-rgba", make: (l) => mesh(l, "depth-rgba", new l.DepthMaterial({ depthPacking: l.k("depthPacking", "rgba") })) },
];

function camera(lib: Lib): Any {
  const c = new lib.PerspectiveCamera(50, 1.5, 0.1, 100);
  c.position.set(0, 6, 22);
  c.lookAt(0, 0, 0);
  return c;
}

function populate(lib: Lib, stage: Any, only?: readonly string[], cast = false): Record<string, Any> {
  const out: Record<string, Any> = {};
  let i = 0;
  for (const v of VARIANTS) {
    if (only !== undefined && !only.includes(v.name)) continue;
    const at = cell(i++);
    const o = v.make(lib, at);
    o.position.set(at[0], at[1], at[2]);
    o.rotation.set(-0.3, 0.2 * (i % 3), 0);
    if (cast) {
      o.castShadow = i % 2 === 0;
      o.receiveShadow = i % 3 !== 0;
    }
    stage.add(o);
    out[v.name] = o;
  }
  return out;
}

function lights(lib: Lib, stage: Any, shadows: boolean): Any[] {
  const ambient = new lib.AmbientLight(0xffeedd, 0.4);
  const sky = new lib.SkyLight(0x88aaff, 0x443322, 0.6);
  const sunA = new lib.SunLight(0xfff4e0, 1.2);
  sunA.position.set(5, 10, 7);
  const sunB = new lib.SunLight(0xaaccff, 0.5);
  sunB.position.set(-6, 4, -3);
  if (shadows) {
    sunB.castShadow = true;
    sunB.shadow.mapSize.set(1024, 1024);
    sunB.shadow.bias = -0.0005;
    sunB.shadow.normalBias = 0.02;
    sunB.shadow.radius = 3;
    sunB.shadow.camera.left = -10;
    sunB.shadow.camera.right = 10;
    sunB.shadow.camera.top = 10;
    sunB.shadow.camera.bottom = -10;
  }
  stage.add(ambient, sky, sunA, sunB);
  return [ambient, sky, sunA, sunB];
}

// (the changes between frames: a colour, a light moved, an alphaTest crossing zero, a custom uniform)
function changes(objects: Record<string, Any>, ls: Any[]): (f: number) => void {
  return (f) => {
    if (f !== 1) return;
    objects["flat"]?.material.color.setHex(0x113355);
    objects["lit-rough"]?.material.color.setHex(0x335577);
    const alphaTest = objects["lit-alphatest"]?.material;
    if (alphaTest) alphaTest.alphaTest = 0;
    const flatAlpha = objects["flat-alphatest"]?.material;
    if (flatAlpha) flatAlpha.alphaTest = 0.75;
    const custom = objects["custom"]?.material;
    if (custom) custom.uniforms.uTime.value = 0.3;
    const sunA = ls[2];
    if (sunA) sunA.position.set(3, 12, 4);
  };
}

export const scenes: Record<string, (lib: Lib) => Built> = {
  /** No lights, no fog, sRGB output, no tone mapping. */
  unlit(lib) {
    const stage = new lib.Stage();
    const objects = populate(lib, stage);
    return {
      stage, camera: camera(lib),
      settings: { toneMapping: lib.k("toneMapping", "none"), outputColorSpace: lib.k("colorSpace", "srgb"), shadows: null },
      frames: [changes(objects, []), changes(objects, [])],
    };
  },

  /** Ambient + sky + two suns, no shadows, linear fog. */
  lights(lib) {
    const stage = new lib.Stage();
    stage.fog = new lib.Fog(0xddeeff, 10, 60);
    const ls = lights(lib, stage, false);
    const objects = populate(lib, stage);
    const ch = changes(objects, ls);
    return {
      stage, camera: camera(lib),
      settings: { toneMapping: lib.k("toneMapping", "none"), outputColorSpace: lib.k("colorSpace", "srgb"), shadows: null },
      frames: [ch, ch],
    };
  },

  /** The same lights, one sun casting PCF soft shadows, exponential fog. */
  shadows(lib) {
    const stage = new lib.Stage();
    stage.fog = new lib.FogExp2(0xddeeff, 0.02);
    const ls = lights(lib, stage, true);
    const objects = populate(lib, stage, undefined, true);
    const ch = changes(objects, ls);
    return {
      stage, camera: camera(lib),
      settings: { toneMapping: lib.k("toneMapping", "none"), outputColorSpace: lib.k("colorSpace", "srgb"), shadows: lib.k("shadowMapType", "pcf-soft") },
      frames: [ch, ch],
    };
  },

  /** A few materials under ACES filmic tone mapping into linear output. */
  tonemapped(lib) {
    const stage = new lib.Stage();
    const ls = lights(lib, stage, false);
    const objects = populate(lib, stage, ["flat", "lit", "lit-map", "toon", "billboard", "custom", "lit-grove"]);
    const ch = changes(objects, ls);
    return {
      stage, camera: camera(lib),
      settings: { toneMapping: lib.k("toneMapping", "aces-filmic"), outputColorSpace: lib.k("colorSpace", "linear"), shadows: null },
      frames: [ch, ch],
    };
  },
};

/** The scenes whose uniform uploads the fixture keeps whole (the rest: one short hash per call). */
export const FULL_UNIFORMS: readonly string[] = ["lights"];

/** Whether a recorded call is part of the uniform upload sequence. */
export function isUniformCall(call: readonly unknown[]): boolean {
  const name = call[0] as string;
  return name === "useProgram" || /^uniform(?!BlockBinding)/.test(name) || name === "@frame";
}

/** Program object ids ("#program12", "#program12:diffuse") renamed by first appearance (P0, P1, ...): the other GL objects count them up differently. */
export function normalizeIds(calls: readonly (readonly unknown[])[]): unknown[][] {
  const ids = new Map<string, string>();
  const rename = (s: string) => s.replace(/#program(\d+)/g, (_m, n: string) => {
    let id = ids.get(n);
    if (id === undefined) {
      id = `P${ids.size}`;
      ids.set(n, id);
    }
    return id;
  });
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return rename(v);
    if (Array.isArray(v)) return v.map(walk);
    return v;
  };
  return calls.map((c) => walk(c) as unknown[]);
}

/** Every value a capture records: strings, numbers and booleans as they are, the rest as a marker. */
export function captureValue(v: unknown, sha: (s: string) => string): unknown {
  if (v === undefined) return "<undefined>";
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 64 ? `sha:${sha(v)}` : v;
  if (typeof v === "object") return Object.keys(v as object);
  return `<${typeof v}>`;
}

/** A renderer, as runScene drives it: r180's WebGLRenderer or the test's driver. */
export interface SceneRenderer {
  render(stage: Any, camera: Any): void;
  toneMapping: Any;
  outputColorSpace: Any;
  shadowMap: { enabled: boolean; type: Any };
  info: { programs: { cacheKey: string }[] | null };
}

export interface SceneRecord {
  /** Per program, in creation order: its cache key, then sha256 of its vertex and fragment source as gl.shaderSource got them. */
  programs: [string, string, string][];
  /** The program parameters' keys, in order (every capture has the same). */
  keys: string[];
  /** Per onCompile call: the material's role, the program it created (or -1: reused), then each parameter's value (see captureValue). */
  captures: unknown[][];
  /** The uniform upload sequence (useProgram, uniform*, frame markers), program ids normalized; whole or one 8-hex hash per call. */
  uniforms: unknown[];
}

/**
 * Draws a stage for two frames on a fresh stand-in and records it. `capture`
 * is handed to makeRenderer: the renderer calls it where r180 calls
 * onBeforeCompile.
 */
export function runScene(
  name: string,
  lib: Lib,
  makeRenderer: (canvas: Any, capture: (material: Any, parameters: Any) => void) => SceneRenderer,
  standIn: (options: Any) => Any,
  sha: (s: string) => string,
  encode: (v: unknown) => string,
): { record: SceneRecord; uniformCalls: unknown[][]; sources: string[] } {
  const si = standIn({ width: 300, height: 200 });
  const captures: unknown[][] = [];
  let keys: string[] | null = null;

  const capture = (material: Any, parameters: Any) => {
    const k = Object.keys(parameters);
    if (keys === null) keys = k;
    else if (k.join() !== keys.join()) throw new Error(`${name}: parameter keys changed: ${k.join()}`);
    si.calls.push(["@capture", captures.length]);
    captures.push([material.name || material.type, -1, ...k.map((key) => captureValue(parameters[key], sha))]);
  };

  const renderer = makeRenderer(si.canvas, capture);
  const built = scenes[name]!(lib);
  renderer.toneMapping = built.settings.toneMapping;
  renderer.outputColorSpace = built.settings.outputColorSpace;
  if (built.settings.shadows !== null) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = built.settings.shadows;
  }

  for (let f = 0; f < built.frames.length; f++) {
    built.frames[f]!(f);
    si.calls.push(["@frame", f]);
    renderer.render(built.stage, built.camera);
  }

  // (which capture created which program: createProgram calls after its marker, before the next capture)
  let created = 0, current = -1;
  const sources: string[] = [];
  for (const call of si.calls as unknown[][]) {
    if (call[0] === "@capture") current = call[1] as number;
    else if (call[0] === "createProgram") {
      if (current >= 0 && captures[current]![1] === -1) captures[current]![1] = created;
      created++;
    } else if (call[0] === "shaderSource") sources.push(call[2] as string);
  }

  const list = renderer.info.programs ?? [];
  const programs: [string, string, string][] = list.map((p, i) => [p.cacheKey, sha(sources[2 * i] ?? ""), sha(sources[2 * i + 1] ?? "")]);
  if (sources.length !== 2 * list.length) throw new Error(`${name}: ${sources.length} shader sources for ${list.length} programs`);

  const uniformCalls = normalizeIds((si.calls as unknown[][]).filter(isUniformCall));
  const uniforms = FULL_UNIFORMS.includes(name) ? uniformCalls : uniformCalls.map((c) => sha(encode(c)).slice(0, 8));

  return { record: { programs, keys: keys ?? [], captures, uniforms }, uniformCalls, sources };
}
