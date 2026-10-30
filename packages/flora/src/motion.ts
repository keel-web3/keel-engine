// The ground's memory of being moved: a small grid of damped springs laid over
// a field, one 2D bend per cell plus how pressed-down it is, stepped on the
// CPU at a fixed rate and sampled as a texture by every plant, card and ground
// shell over it. So a thousand bushes cost no more than ten, any number of
// bodies can walk through at once, and what they do lasts: stalks spring back
// and wobble after a foot leaves, trodden ground stays flat for a few seconds,
// and neighbouring cells pull on each other, so a blow runs out as a ring.
// Deterministic: the same pushes on the same steps make the same field.

import { DataTexture, Vector4 } from "@keel-engine/lit";

export interface FloraMotionSpec {
  /** The ground it covers: min x, min z, max x, max z. Outside it nothing bends. */
  readonly bounds: readonly [number, number, number, number];
  /** Cells on a side. */
  readonly cells?: number;
  /** Spring back to upright (1/s^2): higher is quicker and stiffer. */
  readonly stiffness?: number;
  /** How fast a wobble dies (1/s). */
  readonly damping?: number;
  /** How hard neighbours pull (1/s^2): the speed a blow's ring runs out at. */
  readonly coupling?: number;
  /** Seconds trodden ground takes to rise again. */
  readonly recovery?: number;
}

/** Something leaning on the plants now: held each step until the list changes. */
export interface FloraBody {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly strength?: number;
  /** Its velocity (m/s), which drags the plants along. */
  readonly vx?: number;
  readonly vz?: number;
}

/** One blow: a landing, a blast, a thrown stone. */
export interface FloraImpact {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly strength?: number;
  /** A direction (radians) to throw everything one way instead of outward. */
  readonly direction?: number;
}

export interface FloraMotion {
  /** What a shader needs: uFloraWind, uFloraFrame, uFloraMotion. */
  readonly uniforms: {
    readonly uFloraWind: { value: Vector4 };
    readonly uFloraFrame: { value: Vector4 };
    readonly uFloraMotion: { value: DataTexture };
  };
  /** Wind strength (0 still, 1 a gale) and the direction it blows toward, in radians from +x toward +z. */
  setWind(strength: number, direction: number): void;
  setTime(seconds: number): void;
  setBodies(bodies: readonly FloraBody[]): void;
  impact(blow: FloraImpact): void;
  /** Advances the springs by `dt` seconds and uploads them if anything moved. */
  step(dt: number): void;
  /** The bend (x, z) and press (0..1) at a point. */
  at(x: number, z: number): readonly [number, number, number];
  dispose(): void;
}

// Uniforms and the one sampling function, for any vertex shader over the field.
export const FLORA_MOTION_HEAD = /* glsl */ `
uniform vec4 uFloraFrame;
uniform sampler2D uFloraMotion;
vec3 floraField(vec2 at) {
  vec4 t = texture2D(uFloraMotion, (at - uFloraFrame.xy) * uFloraFrame.zw);
  return vec3((t.rg * 255.0 - 128.0) / 127.0, t.b);
}
float floraGustAt(float along, float time) {
  float g = 0.5 + 0.5 * sin(time * 1.3 - along * 0.35) * sin(time * 0.47 - along * 0.13 + 1.7);
  return g * g;
}
`;

const STEP = 1 / 60;
const MAX_STEPS = 6;
const REST = 1e-4;

export function createFloraMotion(spec: FloraMotionSpec): FloraMotion {
  const [x0, z0, x1, z1] = spec.bounds;
  if (!(x1 > x0 && z1 > z0)) throw new RangeError("A motion field needs bounds with some size.");
  const n = spec.cells ?? 96;
  if (!Number.isInteger(n) || n < 4 || n > 512) throw new RangeError("A motion field is 4..512 cells on a side.");
  const k = spec.stiffness ?? 34, c = spec.damping ?? 3.2, q = spec.coupling ?? 48;
  const fade = Math.exp(-STEP / Math.max(0.05, spec.recovery ?? 3.5));
  const sx = n / (x1 - x0), sz = n / (z1 - z0);
  const dx = new Float32Array(n * n), dz = new Float32Array(n * n), vx = new Float32Array(n * n), vz = new Float32Array(n * n), press = new Float32Array(n * n);
  const fx = new Float32Array(n * n), fz = new Float32Array(n * n);
  const bytes = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i += 1) { bytes[i * 4] = 128; bytes[i * 4 + 1] = 128; bytes[i * 4 + 3] = 255; }
  const texture = new DataTexture(bytes, n, n, "rgba", "u8", undefined, undefined, undefined, "linear", "linear");
  texture.needsUpdate = true;
  const wind = new Vector4(0, 1, 0, 0);
  const frame = new Vector4(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0));
  let bodies: readonly FloraBody[] = [];
  let carry = 0;
  let awake = false;

  /** Calls `visit` for each cell under a disc, with the falloff and the unit way out from its centre. */
  const under = (x: number, z: number, radius: number, visit: (i: number, w: number, ax: number, az: number, d: number) => void): void => {
    const i0 = Math.max(0, Math.floor((x - radius - x0) * sx)), i1 = Math.min(n - 1, Math.ceil((x + radius - x0) * sx));
    const j0 = Math.max(0, Math.floor((z - radius - z0) * sz)), j1 = Math.min(n - 1, Math.ceil((z + radius - z0) * sz));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const wx = x0 + (i + 0.5) / sx - x, wz = z0 + (j + 0.5) / sz - z, d = Math.hypot(wx, wz);
        if (d >= radius) continue;
        const u = Math.min(1, Math.max(0, (d - radius * 0.3) / (radius * 0.7)));
        const w = 1 - u * u * (3 - 2 * u);
        visit(j * n + i, w, d > 1e-5 ? wx / d : 0, d > 1e-5 ? wz / d : 0, d);
      }
    }
  };

  const solve = (): void => {
    fx.fill(0);
    fz.fill(0);
    for (const body of bodies) {
      const strength = body.strength ?? 1, drag = 1.6 * strength;
      under(body.x, body.z, body.radius, (i, w, ax, az) => {
        // Holds the plants about 0.9 out of its way, against the spring.
        fx[i] = (fx[i] ?? 0) + (ax * 0.9 * strength * k + (body.vx ?? 0) * drag * k * 0.1) * w;
        fz[i] = (fz[i] ?? 0) + (az * 0.9 * strength * k + (body.vz ?? 0) * drag * k * 0.1) * w;
        press[i] = Math.max(press[i] ?? 0, Math.min(1, w * strength));
      });
    }
    let energy = bodies.length;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const o = j * n + i;
        const l = i > 0 ? o - 1 : o, r = i < n - 1 ? o + 1 : o, d = j > 0 ? o - n : o, u = j < n - 1 ? o + n : o;
        const ox = dx[o]!, oz = dz[o]!;
        const lx = dx[l]! + dx[r]! + dx[d]! + dx[u]! - 4 * ox, lz = dz[l]! + dz[r]! + dz[d]! + dz[u]! - 4 * oz;
        vx[o] = vx[o]! + (fx[o]! - k * ox - c * vx[o]! + q * lx) * STEP;
        vz[o] = vz[o]! + (fz[o]! - k * oz - c * vz[o]! + q * lz) * STEP;
        energy += vx[o]! * vx[o]! + vz[o]! * vz[o]! + ox * ox + oz * oz;
      }
    }
    for (let o = 0; o < n * n; o += 1) {
      dx[o] = dx[o]! + vx[o]! * STEP;
      dz[o] = dz[o]! + vz[o]! * STEP;
      press[o] = press[o]! * fade;
      energy += press[o]!;
    }
    awake = energy > REST * n;
  };

  const upload = (): void => {
    for (let o = 0; o < n * n; o += 1) {
      bytes[o * 4] = 128 + Math.round(Math.max(-1, Math.min(1, dx[o]!)) * 127);
      bytes[o * 4 + 1] = 128 + Math.round(Math.max(-1, Math.min(1, dz[o]!)) * 127);
      bytes[o * 4 + 2] = Math.round(Math.min(1, press[o]!) * 255);
    }
    texture.needsUpdate = true;
  };

  return {
    uniforms: { uFloraWind: { value: wind }, uFloraFrame: { value: frame }, uFloraMotion: { value: texture } },
    setWind(strength, direction) {
      wind.x = Math.max(0, strength);
      wind.y = Math.cos(direction);
      wind.z = Math.sin(direction);
    },
    setTime(seconds) { wind.w = seconds; },
    setBodies(list) {
      bodies = list;
      if (list.length > 0) awake = true;
    },
    impact(blow) {
      const strength = blow.strength ?? 1;
      const along = blow.direction;
      under(blow.x, blow.z, blow.radius, (i, w, ax, az) => {
        vx[i] = vx[i]! + (along === undefined ? ax : Math.cos(along)) * w * strength * 9;
        vz[i] = vz[i]! + (along === undefined ? az : Math.sin(along)) * w * strength * 9;
        press[i] = Math.min(1, press[i]! + w * strength * 0.8);
      });
      awake = true;
    },
    step(dt) {
      if (!awake) { carry = 0; return; }
      carry = Math.min(carry + Math.max(0, dt), STEP * MAX_STEPS);
      let moved = false;
      while (carry >= STEP) {
        carry -= STEP;
        solve();
        moved = true;
      }
      if (moved) upload();
    },
    at(x, z) {
      const i = Math.floor((x - x0) * sx), j = Math.floor((z - z0) * sz);
      if (i < 0 || j < 0 || i >= n || j >= n) return [0, 0, 0];
      const o = j * n + i;
      return [dx[o]!, dz[o]!, press[o]!];
    },
    dispose() { texture.dispose(); },
  };
}
