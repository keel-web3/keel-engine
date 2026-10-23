// The studio: a dark sweep lit by soft boxes, as a product is shot. One description, two evaluators -- GLSL for the
// GPU (the prefiltered cube is rendered from it) and the same maths in TypeScript (tests, and a page that wants a
// colour without a GPU).

import { type Vec3, cross, dot, normalize } from "./math.ts";

export interface SoftBox {
  /** Where it hangs, as a direction from the subject (normalised for you). */
  readonly dir: Vec3;
  /** Half its width and height as tangents of the angle it spans. */
  readonly size: readonly [number, number];
  /** Linear radiance. */
  readonly colour: Vec3;
  readonly intensity: number;
  /** Edge softness (0 crisp .. 0.5 very soft) as a fraction of its size. */
  readonly soft?: number;
  /** Turn about its own axis (radians): a strip leaning in. */
  readonly roll?: number;
}

export interface Studio {
  /** Gradient: straight up, at the horizon, straight down (linear). */
  readonly sky: Vec3;
  readonly horizon: Vec3;
  readonly ground: Vec3;
  readonly boxes: readonly SoftBox[];
}

/** The house studio: a big key upper left, two strips for the edges, a soft top, a low fill. Neutral, a touch warm. */
export const STUDIO: Studio = {
  sky: [0.06, 0.06, 0.068],
  horizon: [0.12, 0.115, 0.12],
  ground: [0.02, 0.019, 0.021],
  boxes: [
    // The key: big, high, front left.
    { dir: [-0.55, 0.5, 0.68], size: [0.62, 0.46], colour: [1, 0.97, 0.93], intensity: 4.2, soft: 0.35 },
    // A broad front fill behind the camera: what a face looking at you reflects.
    { dir: [0.08, 0.22, 1], size: [0.95, 0.42], colour: [1, 0.99, 0.97], intensity: 1.55, soft: 0.5 },
    // Edge strips: right (cool) and left (warm), for the chamfers and the walls.
    { dir: [0.95, 0.12, 0.28], size: [0.08, 0.9], colour: [0.94, 0.97, 1], intensity: 5.5, soft: 0.3, roll: 0.05 },
    { dir: [-0.97, 0.05, -0.1], size: [0.06, 0.85], colour: [1, 0.96, 0.92], intensity: 3.2, soft: 0.3 },
    // Overhead.
    { dir: [0.05, 1, 0.12], size: [0.8, 0.36], colour: [1, 1, 1], intensity: 2.0, soft: 0.4 },
    // A low bounce card, so undersides don't go black.
    { dir: [0.2, -0.45, 0.85], size: [0.7, 0.18], colour: [1, 0.98, 0.95], intensity: 0.45, soft: 0.5 },
  ],
};

export interface BoxFrame { readonly c: [number, number, number]; readonly r: [number, number, number]; readonly u: [number, number, number] }

/** Each box's frame: its centre direction and its right and up axes (rolled). */
export function boxFrame(b: SoftBox): BoxFrame {
  const c = normalize(b.dir);
  const ref: Vec3 = Math.abs(c[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  let r = normalize(cross(ref, c)), u = normalize(cross(c, r));
  const roll = b.roll ?? 0;
  if (roll) {
    const cs = Math.cos(roll), sn = Math.sin(roll);
    const r2: [number, number, number] = [r[0] * cs + u[0] * sn, r[1] * cs + u[1] * sn, r[2] * cs + u[2] * sn];
    u = normalize(cross(c, r2)); r = r2;
  }
  return { c, r, u };
}

const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Linear radiance arriving from direction d (pointing away from the subject). */
export function studioRadiance(s: Studio, dIn: Vec3): [number, number, number] {
  const d = normalize(dIn);
  const y = d[1];
  const up = smooth(0, 1, y), down = smooth(0, -0.6, y);
  const out: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a += 1) out[a] = s.horizon[a]! * (1 - up - down) + s.sky[a]! * up + s.ground[a]! * down;
  for (const b of s.boxes) {
    const f = boxFrame(b), cz = dot(d, f.c);
    if (cz <= 0.01) continue;
    const x = dot(d, f.r) / cz, yy = dot(d, f.u) / cz;
    const soft = Math.max(1e-3, b.soft ?? 0.2);
    const mx = 1 - smooth(b.size[0] * (1 - soft), b.size[0] * (1 + soft * 0.5), Math.abs(x));
    const my = 1 - smooth(b.size[1] * (1 - soft), b.size[1] * (1 + soft * 0.5), Math.abs(yy));
    const k = mx * my * b.intensity;
    for (let a = 0; a < 3; a += 1) out[a] = out[a]! + b.colour[a]! * k;
  }
  return out;
}

/** GLSL for `vec3 studio(vec3 d)`: the same as studioRadiance, the boxes baked in as constants. */
export function studioGlsl(s: Studio): string {
  const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(+v.toPrecision(7)));
  const v3 = (v: Vec3): string => `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
  const lines = s.boxes.map((b) => {
    const fr = boxFrame(b), soft = Math.max(1e-3, b.soft ?? 0.2);
    return `  c += softBox(d, ${v3(fr.c)}, ${v3(fr.r)}, ${v3(fr.u)}, vec2(${f(b.size[0])}, ${f(b.size[1])}), ${f(soft)}) * ${v3([b.colour[0] * b.intensity, b.colour[1] * b.intensity, b.colour[2] * b.intensity])};`;
  });
  return `
float softBox(vec3 d, vec3 c, vec3 r, vec3 u, vec2 size, float soft) {
  float cz = dot(d, c);
  if (cz <= 0.01) return 0.0;
  float x = abs(dot(d, r) / cz), y = abs(dot(d, u) / cz);
  float mx = 1.0 - smoothstep(size.x * (1.0 - soft), size.x * (1.0 + soft * 0.5), x);
  float my = 1.0 - smoothstep(size.y * (1.0 - soft), size.y * (1.0 + soft * 0.5), y);
  return mx * my;
}
vec3 studio(vec3 d) {
  d = normalize(d);
  float up = smoothstep(0.0, 1.0, d.y), down = smoothstep(0.0, -0.6, d.y);
  vec3 c = ${v3(s.horizon)} * (1.0 - up - down) + ${v3(s.sky)} * up + ${v3(s.ground)} * down;
${lines.join("\n")}
  return c;
}
`;
}
