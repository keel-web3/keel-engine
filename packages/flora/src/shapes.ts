// Real 3D plant geometry from a few parts: tapered tubes, folded leaves, lumps.
// A recipe builds in any units; finish() scales it to one unit tall (or one
// long, hanging), so a placement's size is simply its height. Every vertex
// carries what the plant shader needs to move and colour it:
//
//   aPart   role (0 leaf, 1 own colour, 2 bloom), bend (0 at the root, 1 at the
//           tip), its branch's phase, and how much it flutters
//   aShade  x: a baked shade, y: how far along a vine (0..1)
//   aOwn    the colour of role 1 parts: wood, stone, spines, berries

import { Attribute, Color, Geometry } from "@keel-engine/lit";
import type { ColorRepresentation } from "@keel-engine/lit";

export type V3 = readonly [number, number, number];
export const ROLE_LEAF = 0, ROLE_OWN = 1, ROLE_BLOOM = 2;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const v3 = { add, mul, cross, unit };

export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An icosahedron cut `depth` times, as unit points and triangles. */
function sphereMesh(depth: number): { readonly points: V3[]; readonly faces: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  let points: V3[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V3[]).map(unit);
  let faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let d = 0; d < depth; d += 1) {
    const mid = new Map<number, number>(), next: number[] = [];
    points = points.slice();
    const at = (a: number, b: number): number => {
      const key = Math.min(a, b) * 4096 + Math.max(a, b);
      let m = mid.get(key);
      if (m === undefined) { m = points.length; points.push(unit(add(points[a]!, points[b]!))); mid.set(key, m); }
      return m;
    };
    for (let i = 0; i < faces.length; i += 3) {
      const [a, b, c] = [faces[i]!, faces[i + 1]!, faces[i + 2]!];
      const [ab, bc, ca] = [at(a, b), at(b, c), at(c, a)];
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  return { points, faces };
}
const SPHERES = [sphereMesh(0), sphereMesh(1), sphereMesh(2)];

export interface PartStyle {
  readonly role?: number;
  /** Colour of a role 1 part. */
  readonly tone?: ColorRepresentation;
  readonly shade?: number;
  /** Its branch's sway phase, 0..1. */
  readonly phase?: number;
  readonly flutter?: number;
  /** How far along a vine (0..1). */
  readonly along?: number;
}

export interface LeafOptions extends PartStyle {
  /** Half widths along the leaf, base to tip, in shares of the width. */
  readonly outline?: readonly number[];
  /** How far the two halves fold up, 0 flat. */
  readonly fold?: number;
  /** How far the tip falls under gravity, in shares of the length. */
  readonly droop?: number;
}

export const LEAF_OVAL = [0, 0.55, 0.95, 1, 0.75, 0.4, 0];
export const LEAF_BLADE = [0.5, 0.75, 0.7, 0.55, 0.4, 0.2, 0];
export const LEAF_ROUND = [0, 0.8, 1, 1, 0.85, 0.5, 0];
export const LEAF_NEEDLE = [0.6, 0.6, 0];

export class PlantBuilder {
  readonly random: () => number;
  /** 0..1: how much of each part to make; recipes multiply their counts by it. */
  readonly detail: number;
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly part: number[] = [];
  private readonly shade: number[] = [];
  private readonly own: number[] = [];
  private readonly index: number[] = [];
  private readonly color = new Color();

  constructor(seed: number, detail = 1) {
    this.random = seeded(seed);
    this.detail = detail;
  }

  /** A count scaled by the detail, at least one. */
  many(count: number): number { return Math.max(1, Math.round(count * this.detail)); }

  /** A value between low and high. */
  between(low: number, high: number): number { return low + (high - low) * this.random(); }

  get vertices(): number { return this.position.length / 3; }
  get triangles(): number { return this.index.length / 3; }

  private vertex(p: V3, n: V3, style: PartStyle): number {
    const at = this.position.length / 3;
    this.position.push(p[0], p[1], p[2]);
    this.normal.push(n[0], n[1], n[2]);
    this.part.push(style.role ?? ROLE_LEAF, 0, style.phase ?? 0, style.flutter ?? 0);
    this.shade.push(style.shade ?? 1, style.along ?? 0);
    this.color.set(style.tone ?? "#6b4f38");
    this.own.push(this.color.r, this.color.g, this.color.b);
    return at;
  }

  /** A tapering tube along a path. */
  tube(path: readonly V3[], r0: number, r1: number, sides: number, style: PartStyle = {}): void {
    const n = path.length;
    if (n < 2) return;
    let side: V3 = unit(cross(unit(add(path[1]!, mul(path[0]!, -1))), [0.31, 0.11, 0.94]));
    const base = this.vertices;
    for (let i = 0; i < n; i += 1) {
      const ahead = unit(add(path[Math.min(n - 1, i + 1)]!, mul(path[Math.max(0, i - 1)]!, -1)));
      side = unit(cross(cross(ahead, side), ahead));
      const other = cross(ahead, side);
      const t = i / (n - 1), r = r0 + (r1 - r0) * t;
      const along = style.along === undefined ? {} : { along: style.along + t * 0.02 };
      for (let s = 0; s < sides; s += 1) {
        const a = (s / sides) * Math.PI * 2;
        const out = add(mul(side, Math.cos(a)), mul(other, Math.sin(a)));
        this.vertex(add(path[i]!, mul(out, r)), out, { ...style, ...along });
      }
    }
    for (let i = 0; i < n - 1; i += 1) {
      for (let s = 0; s < sides; s += 1) {
        const a = base + i * sides + s, b = base + i * sides + (s + 1) % sides, c = a + sides, d = b + sides;
        this.index.push(a, b, c, b, d, c);
      }
    }
  }

  /** One leaf or petal from `base` along `dir`, its face turned toward `up`. */
  leaf(base: V3, dir: V3, up: V3, length: number, width: number, options: LeafOptions = {}): void {
    const outline = options.outline ?? LEAF_OVAL, fold = options.fold ?? 0.25, droop = options.droop ?? 0;
    const along = unit(dir), side = unit(cross(along, up)), face = unit(cross(side, along));
    const rows = outline.length, start = this.vertices;
    for (let i = 0; i < rows; i += 1) {
      const t = i / (rows - 1);
      const middle = add(add(base, mul(along, t * length)), [0, -droop * length * t * t, 0]);
      const half = (outline[i] ?? 0) * width * 0.5;
      const lift = mul(face, half * fold);
      this.vertex(add(add(middle, mul(side, -half)), lift), unit(add(face, mul(side, -fold))), options);
      this.vertex(middle, face, options);
      this.vertex(add(add(middle, mul(side, half)), lift), unit(add(face, mul(side, fold))), options);
    }
    for (let i = 0; i < rows - 1; i += 1) {
      const a = start + i * 3;
      this.index.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
  }

  /** A lump: stretched, roughened, and flat-shaded when `facets` (stone). */
  lump(center: V3, size: V3, rough: number, depth: number, style: PartStyle & { readonly facets?: boolean } = {}): void {
    const { points, faces } = SPHERES[Math.max(0, Math.min(2, depth))]!;
    const r = this.random, wobble = [r() * 9, r() * 9, r() * 9, 1.5 + r() * 2];
    const out = (p: V3): V3 => {
      const k = 1 + rough * (Math.sin(p[0] * wobble[3]! + wobble[0]!) * Math.sin(p[1] * wobble[3]! + wobble[1]!) + 0.6 * Math.sin(p[2] * wobble[3]! * 2 + wobble[2]!));
      return add(center, [p[0] * size[0] * k, p[1] * size[1] * k, p[2] * size[2] * k]);
    };
    if (style.facets) {
      for (let i = 0; i < faces.length; i += 3) {
        const [a, b, c] = [out(points[faces[i]!]!), out(points[faces[i + 1]!]!), out(points[faces[i + 2]!]!)];
        const n = unit(cross(add(b, mul(a, -1)), add(c, mul(a, -1))));
        const at = this.vertex(a, n, style);
        this.vertex(b, n, style);
        this.vertex(c, n, style);
        this.index.push(at, at + 1, at + 2);
      }
      return;
    }
    const base = this.vertices;
    for (const p of points) this.vertex(out(p), unit([p[0] / size[0], p[1] / size[1], p[2] / size[2]]), style);
    for (const f of faces) this.index.push(base + f);
  }

  /**
   * Bakes the bend weights and scales to one unit tall. `give` is the bend's
   * power (1 a stiff lever, 2 a whip); `hang` measures from an anchor above;
   * `round` turns the normals out from the plant's axis, so a mass of small
   * leaves shades as one rounded thing.
   */
  finish({ give = 1.5, hang = false, round = 0, keepScale = false }: { readonly give?: number; readonly hang?: boolean; readonly round?: number; readonly keepScale?: boolean } = {}): Geometry {
    const count = this.vertices, p = this.position, nrm = this.normal;
    let high = 1e-6;
    for (let i = 0; i < count; i += 1) high = Math.max(high, hang ? -p[i * 3 + 1]! : p[i * 3 + 1]!);
    const scale = keepScale ? 1 : 1 / high;
    for (let i = 0; i < count; i += 1) {
      const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
      if (round > 0) {
        const out = unit([x, y - high * 0.35, z]);
        const n = unit([nrm[i * 3]! * (1 - round) + out[0] * round, nrm[i * 3 + 1]! * (1 - round) + out[1] * round, nrm[i * 3 + 2]! * (1 - round) + out[2] * round]);
        nrm[i * 3] = n[0]; nrm[i * 3 + 1] = n[1]; nrm[i * 3 + 2] = n[2];
      }
      this.part[i * 4 + 1] = Math.max(0, Math.min(1, ((hang ? -y : y) / high))) ** give;
      p[i * 3] = x * scale; p[i * 3 + 1] = y * scale; p[i * 3 + 2] = z * scale;
    }
    const g = new Geometry();
    g.setAttribute("position", new Attribute(new Float32Array(p), 3));
    g.setAttribute("normal", new Attribute(new Float32Array(nrm), 3));
    g.setAttribute("aPart", new Attribute(new Float32Array(this.part), 4));
    g.setAttribute("aShade", new Attribute(new Float32Array(this.shade), 2));
    g.setAttribute("aOwn", new Attribute(new Float32Array(this.own), 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}
