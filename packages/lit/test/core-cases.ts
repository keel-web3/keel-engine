// The scene-core parity cases: what to feed r180 and the port, and what to read
// back. As math-cases.ts: the fixture generator (outside this repo, where Three
// lives) runs each case's `run` on r180's classes under KEEL's names and
// records the outputs; core.test.ts runs the same code on ours and wants the
// same bits.
//
// Constants cross between the two through `lib.k` (a KEEL string in, the lib's
// own value out: the string here, r180's number there) and `lib.n` (a value
// out of the lib, to r180's number: through src/constants.ts here, as is
// there). `snap` reads any object back generically: its own keys in order
// (less the is* flags, ids and uuids), maths values as numbers, constants as
// r180's numbers, so a missing field, an extra one, a reordered one or a
// different default all show.

import { createHash } from "node:crypto";

import type * as K from "../src/index.ts";
import type { R180Table } from "../src/index.ts";

/** The classes under test: ours, or r180's under the same names. */
export type Lib = typeof K & {
  /** A KEEL constant, in this lib's terms. */
  k(table: R180Table | "colorSpace", value: string): never;
  /** One of this lib's constants, as r180's number (or r180's colour space string). */
  n(table: R180Table | "colorSpace", value: unknown): unknown;
};

export type Rng = () => number;

// (inputs come back from JSON: plain data, read by the case that made them)
type In = any;
type Any = any;

export interface Case {
  make(r: Rng): In;
  run(lib: Lib, input: In): unknown;
}

// ---- input makers

const SPECIALS = [0, -0, 1, -1, 0.5, 2];
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const num = (r: Rng, s = 10): number => (r() < 0.05 ? pick(r, SPECIALS) : (r() * 2 - 1) * s);
const pos = (r: Rng, lo: number, hi: number): number => lo + r() * (hi - lo);
const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const vec = (r: Rng, n: number, s = 10): number[] => Array.from({ length: n }, () => num(r, s));
const angle = (r: Rng): number => (r() < 0.12 ? (Math.floor(r() * 9) - 4) * (Math.PI / 2) : (r() * 2 - 1) * 2 * Math.PI);
const ORDERS = ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"] as const;

function unitQuat(r: Rng): number[] {
  if (r() < 0.08) {
    const q = [0, 0, 0, 0];
    q[Math.floor(r() * 4)] = r() < 0.5 ? 1 : -1;
    return q;
  }
  const q = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
  const l = Math.sqrt(q[0]! * q[0]! + q[1]! * q[1]! + q[2]! * q[2]! + q[3]! * q[3]!) || 1;
  return q.map((v) => v / l);
}

function unitVec(r: Rng): number[] {
  if (r() < 0.1) return pick(r, [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]);
  const v = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
  const l = Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!) || 1;
  return v.map((x) => x / l);
}

const scale3 = (r: Rng): number[] => (r() < 0.2 ? [1, 1, 1] : [pos(r, 0.2, 3) * (r() < 0.1 ? -1 : 1), pos(r, 0.2, 3), pos(r, 0.2, 3)]);
const trs = (r: Rng) => ({ p: vec(r, 3, 20), q: unitQuat(r), s: scale3(r) });

// ---- builders and readers

const V3 = (lib: Lib, a: number[]) => new lib.Vector3(a[0], a[1], a[2]);
const Q = (lib: Lib, a: number[]) => new lib.Quaternion(a[0], a[1], a[2], a[3]);
const M4 = (lib: Lib, m: { p: number[]; q: number[]; s: number[] }) => new lib.Matrix4().compose(V3(lib, m.p), Q(lib, m.q), V3(lib, m.s));

const v2 = (v: { x: number; y: number }) => [v.x, v.y];
const v3 = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
const q4 = (q: K.Quaternion) => [q.x, q.y, q.z, q.w];
const eu = (e: K.Euler) => [e.x, e.y, e.z, e.order];
const el = (m: K.Matrix3 | K.Matrix4) => Array.from(m.elements);
const box = (b: K.Box3 | null) => (b === null ? null : [...v3(b.min), ...v3(b.max)]);
const sph = (s: K.Sphere | null) => (s === null ? null : [...v3(s.center), s.radius]);
const planes = (f: K.Frustum) => f.planes.map((p) => [...v3(p.normal), p.constant]);

// (which fields hold constants, by name, and their table)
const CONSTANT_FIELDS: Record<string, R180Table | "colorSpace"> = {
  side: "side", shadowSide: "side", blending: "blending",
  blendSrc: "blendFactor", blendDst: "blendFactor", blendSrcAlpha: "blendFactor", blendDstAlpha: "blendFactor",
  blendEquation: "blendEquation", blendEquationAlpha: "blendEquation",
  depthFunc: "depthFunc", stencilFunc: "compareFunc", compareFunction: "compareFunc",
  stencilFail: "stencilOp", stencilZFail: "stencilOp", stencilZPass: "stencilOp",
  normalMapType: "normalMapType", combine: "combine", depthPacking: "depthPacking",
  mapping: "mapping", wrapS: "wrapping", wrapT: "wrapping", magFilter: "filter", minFilter: "filter",
  format: "pixelFormat", colorSpace: "colorSpace", usage: "usage", gpuType: "textureType", mapType: "textureType",
  coordinateSystem: "coordinateSystem",
};

const SKIP = new Set(["uuid", "_listeners", "parent"]);

/** Any value as plain data (see the header). */
export function snap(lib: Lib, value: unknown, seen: Set<object> = new Set(), depth = 0): unknown {
  if (value === undefined) return "<undefined>";
  if (value === null || typeof value !== "object") {
    return typeof value === "function" ? "<function>" : value;
  }
  const v = value as Any;
  if (ArrayBuffer.isView(v)) return { [v.constructor.name]: Array.from(v as unknown as ArrayLike<number>) };
  if (v.isColor) return { color: [v.r, v.g, v.b] };
  if (v.isVector2) return v2(v);
  if (v.isVector3) return v3(v);
  if (v.isVector4) return [v.x, v.y, v.z, v.w];
  if (v.isQuaternion) return q4(v);
  if (v.isEuler) return eu(v);
  if (v.isMatrix3 || v.isMatrix4) return el(v);
  if (v.isBox3) return box(v);
  if (v.isSphere) return sph(v);
  if (v.isPlane) return [...v3(v.normal), v.constant];
  if (Array.isArray(v.planes) && typeof v.setFromProjectionMatrix === "function") return planes(v);
  if (seen.has(v)) return "<seen>";
  if (depth > 6) return "<deep>";
  seen.add(v);
  if (Array.isArray(v)) return v.map((x) => snap(lib, x, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v)) {
    if (SKIP.has(key) || key.startsWith("is")) continue;
    // (a node's or material's type is its class name, which differs; a texture's is a constant)
    if (key === "type" && !v.isTexture) continue;
    const x = v[key];
    const table = key === "type" ? "textureType" : CONSTANT_FIELDS[key];
    out[key] = table !== undefined && typeof x === "string" || table !== undefined && typeof x === "number" ? lib.n(table, x) : snap(lib, x, seen, depth + 1);
  }
  return out;
}

/** An attribute's numbers and settings. */
const attr = (lib: Lib, a: K.Attribute | null | undefined) =>
  a == null ? null : { array: snap(lib, a.array), itemSize: a.itemSize, count: a.count, normalized: a.normalized, version: a.version, usage: lib.n("usage", a.usage) };

function geometryOut(lib: Lib, g: K.Geometry) {
  const attributes: Record<string, unknown> = {};
  for (const name of Object.keys(g.attributes)) attributes[name] = attr(lib, g.attributes[name]);
  const morph: Record<string, unknown> = {};
  for (const name of Object.keys(g.morphAttributes)) morph[name] = g.morphAttributes[name]!.map((a) => attr(lib, a));
  return {
    index: attr(lib, g.index), attributes, morph,
    groups: g.groups.map((x) => [x.start, x.count, x.materialIndex]),
    drawRange: [g.drawRange.start, g.drawRange.count],
    boundingBox: box(g.boundingBox), boundingSphere: sph(g.boundingSphere),
  };
}

// ---- the scene graph

const KINDS = ["node", "group", "mesh", "camera", "perspective", "ortho", "light", "sun", "sky"] as const;

function makeNode(lib: Lib, kind: string): K.Node {
  switch (kind) {
    case "group": return new lib.Group();
    case "mesh": return new lib.Mesh();
    case "camera": return new lib.Camera();
    case "perspective": return new lib.PerspectiveCamera(60, 1.5, 0.5, 100);
    case "ortho": return new lib.OrthoCamera(-2, 2, 2, -2, 0.1, 50);
    case "light": return new lib.AmbientLight(0xffffff, 1);
    case "sun": return new lib.SunLight(0xffffff, 1);
    case "sky": return new lib.SkyLight(0xffffff, 0x333333, 1);
    default: return new lib.Node();
  }
}

function makeOp(r: Rng, n: number): unknown[] {
  const i = int(r, 0, n - 1);
  const k = r();
  if (k < 0.14) return [i, "position", vec(r, 3, 20)];
  if (k < 0.24) return [i, "euler", [angle(r), angle(r), angle(r)], pick(r, ORDERS)];
  if (k < 0.32) return [i, "quat", unitQuat(r)];
  if (k < 0.4) return [i, "scale", scale3(r)];
  if (k < 0.48) return [i, r() < 0.5 ? "lookAtV" : "lookAtN", r() < 0.1 ? [0, 0, 0] : vec(r, 3, 30)];
  if (k < 0.54) return [i, pick(r, ["rotateX", "rotateY", "rotateZ", "translateX", "translateY", "translateZ"]), num(r, 4)];
  if (k < 0.6) return [i, pick(r, ["rotateOnAxis", "rotateOnWorldAxis", "translateOnAxis", "setRotationFromAxisAngle"]), unitVec(r), num(r, 4)];
  if (k < 0.65) return [i, "applyMatrix4", trs(r)];
  if (k < 0.69) return [i, "applyQuaternion", unitQuat(r)];
  if (k < 0.72) return [i, "setRotationFromEuler", [angle(r), angle(r), angle(r)], pick(r, ORDERS)];
  if (k < 0.76) return [i, "updateMatrixWorld", r() < 0.3];
  if (k < 0.8) return [i, "updateWorldMatrix", r() < 0.5, r() < 0.5];
  if (k < 0.83) return [i, "manualMatrix", trs(r)];
  if (k < 0.86) return [i, "up", unitVec(r)];
  if (k < 0.9) return [i, "attach", int(r, 0, n - 1)];
  if (k < 0.93) return [i, "worldAuto", r() < 0.7];
  return [i, "copy", int(r, 0, n - 1)];
}

function makeGraph(r: Rng, maxNodes = 10) {
  const n = int(r, 1, maxNodes);
  const nodes = Array.from({ length: n }, (_, i) => ({
    kind: pick(r, KINDS),
    parent: i === 0 || r() < 0.1 ? -1 : int(r, 0, i - 1),
    p: vec(r, 3, 10), e: [angle(r), angle(r), angle(r)], order: pick(r, ORDERS), s: scale3(r),
  }));
  const ops = Array.from({ length: int(r, 0, 14) }, () => makeOp(r, n));
  return { nodes, ops, end: pick(r, ["matrixWorld", "matrixWorld", "worldMatrix", "none"]) };
}

const isAncestor = (a: K.Node, b: K.Node): boolean => {
  for (let p: K.Node | null = b; p !== null; p = p.parent) if (p === a) return true;
  return false;
};

function buildGraph(lib: Lib, input: In): K.Node[] {
  const nodes: K.Node[] = [];
  for (const d of input.nodes) {
    const node = makeNode(lib, d.kind);
    node.name = "n" + nodes.length;
    node.position.set(d.p[0], d.p[1], d.p[2]);
    node.rotation.set(d.e[0], d.e[1], d.e[2], d.order);
    node.scale.set(d.s[0], d.s[1], d.s[2]);
    if (d.parent >= 0) nodes[d.parent]!.add(node);
    nodes.push(node);
  }
  return nodes;
}

function applyOp(lib: Lib, nodes: K.Node[], op: unknown[]): void {
  const [i, name, a, b] = op as [number, string, Any, Any];
  const node = nodes[i]!;
  switch (name) {
    case "position": node.position.set(a[0], a[1], a[2]); break;
    case "euler": node.rotation.set(a[0], a[1], a[2], b); break;
    case "quat": node.quaternion.set(a[0], a[1], a[2], a[3]); break;
    case "scale": node.scale.set(a[0], a[1], a[2]); break;
    case "lookAtV": node.lookAt(V3(lib, a)); break;
    case "lookAtN": node.lookAt(a[0], a[1], a[2]); break;
    case "rotateX": case "rotateY": case "rotateZ": case "translateX": case "translateY": case "translateZ":
      (node as Any)[name](a); break;
    case "rotateOnAxis": case "rotateOnWorldAxis": case "translateOnAxis": case "setRotationFromAxisAngle":
      (node as Any)[name](V3(lib, a), b); break;
    case "applyMatrix4": node.applyMatrix4(M4(lib, a)); break;
    case "applyQuaternion": node.applyQuaternion(Q(lib, a)); break;
    case "setRotationFromEuler": node.setRotationFromEuler(new lib.Euler(a[0], a[1], a[2], b)); break;
    case "updateMatrixWorld": node.updateMatrixWorld(a); break;
    case "updateWorldMatrix": node.updateWorldMatrix(a, b); break;
    case "manualMatrix":
      node.matrixAutoUpdate = false;
      node.matrix.copy(M4(lib, a));
      node.matrixWorldNeedsUpdate = true;
      break;
    case "up": node.up.set(a[0], a[1], a[2]); break;
    case "worldAuto": node.matrixWorldAutoUpdate = a; break;
    case "attach": {
      const other = nodes[a as number]!;
      if (other !== node && !isAncestor(other, node)) node.attach(other);
      break;
    }
    case "copy": {
      const other = nodes[a as number]!;
      if (other.constructor === node.constructor && other !== node) node.copy(other as Any, false);
      break;
    }
  }
}

function nodeOut(node: K.Node) {
  const out: unknown[] = [el(node.matrix), el(node.matrixWorld), v3(node.position), q4(node.quaternion), eu(node.rotation), v3(node.scale), node.matrixWorldNeedsUpdate, node.matrixAutoUpdate];
  const cam = node as Any;
  if (cam.isCamera) out.push(el(cam.matrixWorldInverse));
  return out;
}

// ---- the cases

export const cases: Record<string, Case> = {
  // Nested transforms through every way of setting them, then the world matrices.
  "node.transforms": {
    make: (r) => makeGraph(r),
    run(lib, input) {
      const nodes = buildGraph(lib, input);
      for (const op of input.ops) applyOp(lib, nodes, op);
      const roots = nodes.filter((x) => x.parent === null);
      if (input.end === "matrixWorld") for (const root of roots) root.updateMatrixWorld();
      if (input.end === "worldMatrix") for (const root of roots) root.updateWorldMatrix(false, true);
      return {
        nodes: nodes.map(nodeOut),
        parents: nodes.map((x) => (x.parent === null ? -1 : nodes.indexOf(x.parent))),
      };
    },
  },

  // The world-space queries (each brings the world matrices up to date first).
  "node.world": {
    make: (r) => ({ ...makeGraph(r, 6), q: int(r, 0, 5), point: vec(r, 3, 10) }),
    run(lib, input) {
      const nodes = buildGraph(lib, input);
      for (const op of input.ops) applyOp(lib, nodes, op);
      const node = nodes[Math.min(input.q, nodes.length - 1)]!;
      const p = node.getWorldPosition(new lib.Vector3());
      const q = node.getWorldQuaternion(new lib.Quaternion());
      const s = node.getWorldScale(new lib.Vector3());
      const d = node.getWorldDirection(new lib.Vector3());
      const lw = node.localToWorld(V3(lib, input.point));
      const wl = node.worldToLocal(V3(lib, input.point));
      return [v3(p), q4(q), v3(s), v3(d), v3(lw), v3(wl), nodes.map(nodeOut)];
    },
  },

  // add / remove / clear / attach, their events, traversal and lookups.
  "node.graph": {
    make(r) {
      const n = int(r, 2, 9);
      const ops = Array.from({ length: int(r, 1, 20) }, () => {
        const k = r();
        const a = int(r, 0, n - 1), b = int(r, 0, n - 1), c = int(r, 0, n - 1);
        if (k < 0.4) return ["add", a, b];
        if (k < 0.5) return ["addMany", a, b, c];
        if (k < 0.62) return ["remove", a, b];
        if (k < 0.7) return ["removeFromParent", a];
        if (k < 0.75) return ["clear", a];
        if (k < 0.82) return ["attach", a, b];
        if (k < 0.9) return ["visible", a, r() < 0.5];
        return ["name", a, "x" + int(r, 0, 3)];
      });
      return { n, ops, layers: Array.from({ length: int(r, 0, 8) }, () => [pick(r, ["set", "enable", "toggle", "disable", "enableAll", "disableAll"]), int(r, 0, 31)]) };
    },
    run(lib, input) {
      const nodes = Array.from({ length: input.n }, (_, i) => {
        const node = new lib.Node();
        node.name = "n" + i;
        return node;
      });
      const log: unknown[] = [];
      for (const node of nodes) {
        for (const type of ["added", "removed", "childadded", "childremoved"]) {
          node.addEventListener(type, (e: Any) => log.push([node.name, e.type, e.child ? e.child.name : null, e.target === node]));
        }
      }
      const ok = (parent: K.Node, ...children: K.Node[]) => children.every((c) => c !== parent && !isAncestor(c, parent));
      for (const [op, a, b, c] of input.ops) {
        const A = nodes[a]!, B = nodes[b]!, C = nodes[c]!;
        if (op === "add" && ok(A, B)) A.add(B);
        if (op === "addMany" && ok(A, B, C) && B !== C && !isAncestor(B, C) && !isAncestor(C, B)) A.add(B, C);
        if (op === "remove") A.remove(B);
        if (op === "removeFromParent") A.removeFromParent();
        if (op === "clear") A.clear();
        if (op === "attach" && ok(A, B)) A.attach(B);
        if (op === "visible") A.visible = b;
        if (op === "name") A.name = b;
      }
      const names = (list: K.Node[]) => list.map((x) => x.name);
      const walk = (root: K.Node, f: "traverse" | "traverseVisible" | "traverseAncestors") => {
        const seen: string[] = [];
        root[f]((x) => seen.push(x.name));
        return seen;
      };
      const layers = new lib.Layers();
      const other = new lib.Layers();
      const masks: unknown[] = [];
      for (const [op, x] of input.layers) {
        (layers as Any)[op](x);
        masks.push([layers.mask, layers.test(other), layers.isEnabled(x)]);
      }
      return {
        log,
        children: nodes.map((x) => names(x.children)),
        walks: nodes.map((x) => [walk(x, "traverse"), walk(x, "traverseVisible"), walk(x, "traverseAncestors")]),
        byName: nodes.map((x) => x.getObjectByName("x1")?.name ?? null),
        byProperty: nodes.map((x) => names(x.getObjectsByProperty("visible", false))),
        masks,
      };
    },
  },

  // Perspective cameras: projection, view, view offsets, film, zoom.
  "camera.perspective": {
    make: (r) => ({
      fov: pos(r, 10, 120), aspect: pos(r, 0.3, 3), near: pos(r, 0.01, 2), far: pos(r, 10, 5000), zoom: r() < 0.5 ? 1 : pos(r, 0.3, 4),
      filmGauge: r() < 0.7 ? 35 : pos(r, 10, 70), filmOffset: r() < 0.7 ? 0 : num(r, 5),
      view: r() < 0.3 ? [pos(r, 100, 2000), pos(r, 100, 2000), pos(r, 0, 500), pos(r, 0, 500), pos(r, 50, 800), pos(r, 50, 800)] : null,
      clearView: r() < 0.2, focal: r() < 0.2 ? pos(r, 10, 200) : null,
      p: vec(r, 3, 30), target: vec(r, 3, 30), parent: r() < 0.3 ? trs(r) : null, dist: pos(r, 0.1, 100),
    }),
    run(lib, input) {
      const camera = new lib.PerspectiveCamera(input.fov, input.aspect, input.near, input.far);
      camera.zoom = input.zoom;
      camera.filmGauge = input.filmGauge;
      camera.filmOffset = input.filmOffset;
      camera.updateProjectionMatrix();
      if (input.view) camera.setViewOffset(...(input.view as [number, number, number, number, number, number]));
      if (input.clearView) camera.clearViewOffset();
      if (input.focal !== null) camera.setFocalLength(input.focal);
      if (input.parent) {
        const parent = new lib.Group();
        parent.applyMatrix4(M4(lib, input.parent));
        parent.add(camera);
      }
      camera.position.set(input.p[0], input.p[1], input.p[2]);
      camera.lookAt(V3(lib, input.target));
      (camera.parent ?? camera).updateMatrixWorld();
      const size = camera.getViewSize(input.dist, new lib.Vector2());
      const min = new lib.Vector2(), max = new lib.Vector2();
      camera.getViewBounds(input.dist, min, max);
      return [
        el(camera.projectionMatrix), el(camera.projectionMatrixInverse), el(camera.matrixWorld), el(camera.matrixWorldInverse),
        q4(camera.quaternion), v3(camera.getWorldDirection(new lib.Vector3())),
        camera.fov, camera.aspect, camera.getEffectiveFOV(), camera.getFocalLength(), camera.getFilmWidth(), camera.getFilmHeight(),
        v2(size), v2(min), v2(max), snap(lib, camera.view),
      ];
    },
  },

  "camera.ortho": {
    make: (r) => ({
      lrtb: [num(r, 50), num(r, 50), num(r, 50), num(r, 50)], near: pos(r, -10, 2), far: pos(r, 10, 1000), zoom: r() < 0.5 ? 1 : pos(r, 0.3, 4),
      view: r() < 0.3 ? [pos(r, 100, 2000), pos(r, 100, 2000), pos(r, 0, 500), pos(r, 0, 500), pos(r, 50, 800), pos(r, 50, 800)] : null,
      p: vec(r, 3, 30), target: vec(r, 3, 30), up: r() < 0.2 ? unitVec(r) : null,
    }),
    run(lib, input) {
      const [l, rt, t, b] = input.lrtb;
      const camera = new lib.OrthoCamera(l, rt, t, b, input.near, input.far);
      camera.zoom = input.zoom;
      camera.updateProjectionMatrix();
      if (input.view) camera.setViewOffset(...(input.view as [number, number, number, number, number, number]));
      if (input.up) camera.up.set(input.up[0], input.up[1], input.up[2]);
      camera.position.set(input.p[0], input.p[1], input.p[2]);
      camera.lookAt(V3(lib, input.target));
      camera.updateMatrixWorld();
      return [el(camera.projectionMatrix), el(camera.projectionMatrixInverse), el(camera.matrixWorld), el(camera.matrixWorldInverse), q4(camera.quaternion), v3(camera.getWorldDirection(new lib.Vector3()))];
    },
  },

  // A sun's shadow: updateMatrices puts its camera at the light, aimed at the target.
  "shadow.sun": {
    make: (r) => ({
      p: r() < 0.1 ? [0, pos(r, 1, 50), 0] : vec(r, 3, 60), target: r() < 0.4 ? [0, 0, 0] : vec(r, 3, 20),
      targetInStage: r() < 0.5, parent: r() < 0.25 ? trs(r) : null,
      cam: r() < 0.3 ? null : { l: -pos(r, 1, 60), r: pos(r, 1, 60), t: pos(r, 1, 60), b: -pos(r, 1, 60), near: pos(r, 0.1, 5), far: pos(r, 20, 500) },
      bias: num(r, 0.001), normalBias: num(r, 0.05), radius: pos(r, 0, 8), mapSize: pick(r, [512, 1024, 2048, 4096]),
      twice: r() < 0.3, move: vec(r, 3, 10),
    }),
    run(lib, input) {
      const stage = new lib.Stage();
      const sun = new lib.SunLight(0xfff0dd, 2.5);
      let holder: K.Node = stage;
      if (input.parent) {
        const g = new lib.Group();
        g.applyMatrix4(M4(lib, input.parent));
        stage.add(g);
        holder = g;
      }
      holder.add(sun);
      sun.position.set(input.p[0], input.p[1], input.p[2]);
      sun.target.position.set(input.target[0], input.target[1], input.target[2]);
      if (input.targetInStage) stage.add(sun.target);
      const shadow = sun.shadow;
      if (input.cam) {
        const c = shadow.camera;
        c.left = input.cam.l; c.right = input.cam.r; c.top = input.cam.t; c.bottom = input.cam.b; c.near = input.cam.near; c.far = input.cam.far;
        c.updateProjectionMatrix();
      }
      shadow.bias = input.bias;
      shadow.normalBias = input.normalBias;
      shadow.radius = input.radius;
      shadow.mapSize.set(input.mapSize, input.mapSize);
      const step = () => {
        stage.updateMatrixWorld();
        if (!input.targetInStage) sun.target.updateMatrixWorld();
        shadow.updateMatrices(sun);
      };
      step();
      if (input.twice) {
        sun.position.add(V3(lib, input.move));
        step();
      }
      const c = shadow.camera;
      return [
        el(shadow.matrix), el(c.matrixWorld), el(c.matrixWorldInverse), el(c.projectionMatrix), v3(c.position), q4(c.quaternion),
        planes(shadow.getFrustum()), el(sun.matrixWorld), el(sun.target.matrixWorld),
        shadow.bias, shadow.normalBias, shadow.radius, v2(shadow.mapSize), shadow.getViewportCount(), snap(lib, shadow.getViewport(0)), v2(shadow.getFrameExtents()),
      ];
    },
  },

  // Geometry operations: transforms, normals, bounds, de-indexing.
  "geometry.ops": {
    make(r) {
      const verts = int(r, 3, 24);
      const indexed = r() < 0.6;
      const tris = int(r, 1, 12);
      const ops = Array.from({ length: int(r, 1, 8) }, () => {
        const k = r();
        if (k < 0.12) return ["translate", vec(r, 3, 5)];
        if (k < 0.24) return [pick(r, ["rotateX", "rotateY", "rotateZ"]), angle(r)];
        if (k < 0.32) return ["scale", scale3(r)];
        if (k < 0.38) return ["applyQuaternion", unitQuat(r)];
        if (k < 0.44) return ["applyMatrix4", trs(r)];
        if (k < 0.5) return ["lookAt", vec(r, 3, 10)];
        if (k < 0.56) return ["center"];
        if (k < 0.7) return ["computeVertexNormals"];
        if (k < 0.78) return ["computeBoundingBox"];
        if (k < 0.86) return ["computeBoundingSphere"];
        if (k < 0.92) return ["toNonIndexed"];
        if (k < 0.96) return ["drawRange", int(r, 0, 6), int(r, 0, 30)];
        return ["group", int(r, 0, 6), int(r, 0, 12), int(r, 0, 2)];
      });
      return {
        positions: vec(r, verts * 3, 5),
        index: indexed ? Array.from({ length: tris * 3 }, () => int(r, 0, verts - 1)) : null,
        normals: r() < 0.3 ? vec(r, verts * 3, 1) : null,
        uv: r() < 0.3 ? vec(r, verts * 2, 1) : null,
        tangent: r() < 0.15 ? vec(r, verts * 4, 1) : null,
        morph: r() < 0.2 ? { relative: r() < 0.5, targets: Array.from({ length: int(r, 1, 3) }, () => vec(r, verts * 3, 2)) } : null,
        ops,
      };
    },
    run(lib, input) {
      let g = new lib.Geometry();
      g.setAttribute("position", new lib.Attribute(new Float32Array(input.positions), 3));
      if (input.index) g.setIndex(input.index);
      if (input.normals) g.setAttribute("normal", new lib.Attribute(new Float32Array(input.normals), 3));
      if (input.uv) g.setAttribute("uv", new lib.Attribute(new Float32Array(input.uv), 2));
      if (input.tangent) g.setAttribute("tangent", new lib.Attribute(new Float32Array(input.tangent), 4));
      if (input.morph) {
        g.morphAttributes["position"] = input.morph.targets.map((t: number[]) => new lib.Attribute(new Float32Array(t), 3));
        g.morphTargetsRelative = input.morph.relative;
      }
      const steps: unknown[] = [];
      for (const [op, a, b, c] of input.ops) {
        switch (op) {
          case "translate": g.translate(a[0], a[1], a[2]); break;
          case "rotateX": case "rotateY": case "rotateZ": (g as Any)[op](a); break;
          case "scale": g.scale(a[0], a[1], a[2]); break;
          case "applyQuaternion": g.applyQuaternion(Q(lib, a)); break;
          case "applyMatrix4": g.applyMatrix4(M4(lib, a)); break;
          case "lookAt": g.lookAt(V3(lib, a)); break;
          case "center": g.center(); break;
          case "computeVertexNormals": g.computeVertexNormals(); break;
          case "computeBoundingBox": g.computeBoundingBox(); break;
          case "computeBoundingSphere": g.computeBoundingSphere(); break;
          case "toNonIndexed": if (g.index !== null) g = g.toNonIndexed(); break;
          case "drawRange": g.setDrawRange(a, b); break;
          case "group": g.addGroup(a, b, c); break;
        }
        steps.push(box(g.boundingBox), sph(g.boundingSphere));
      }
      const clone = g.clone();
      return { g: geometryOut(lib, g), clone: geometryOut(lib, clone), steps };
    },
  },

  // setFromPoints and plain accessors on a geometry.
  "geometry.points": {
    make: (r) => ({ points: Array.from({ length: int(r, 0, 12) }, () => (r() < 0.2 ? vec(r, 2, 5) : vec(r, 3, 5))), again: r() < 0.4 ? Array.from({ length: int(r, 0, 14) }, () => vec(r, 3, 5)) : null }),
    run(lib, input) {
      const pts = (list: number[][]) => list.map((p) => (p.length === 2 ? new lib.Vector2(p[0], p[1]) : V3(lib, p)));
      const g = new lib.Geometry().setFromPoints(pts(input.points) as Any);
      if (input.again) g.setFromPoints(pts(input.again) as Any);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return geometryOut(lib, g);
    },
  },

  // Attributes on every array type, normalized or not.
  "attribute.ops": {
    make(r) {
      const type = pick(r, ["Float32Array", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array"]);
      const itemSize = int(r, 1, 4);
      const count = int(r, 1, 6);
      const normalized = type !== "Float32Array" && r() < 0.6;
      const unit = normalized || type === "Float32Array";
      const value = () => (unit ? num(r, 1) : int(r, -100, 300));
      const ops = Array.from({ length: int(r, 1, 10) }, () => {
        const k = r();
        const i = int(r, 0, count - 1);
        if (k < 0.1) return ["setX", i, value()];
        if (k < 0.15) return ["setY", i, value()];
        if (k < 0.2) return ["setZ", i, value()];
        if (k < 0.25) return ["setW", i, value()];
        if (k < 0.32) return ["setXY", i, value(), value()];
        if (k < 0.42) return ["setXYZ", i, value(), value(), value()];
        if (k < 0.5) return ["setXYZW", i, value(), value(), value(), value()];
        if (k < 0.55) return ["setComponent", i, int(r, 0, itemSize - 1), value()];
        if (k < 0.62) return ["applyMatrix4", trs(r)];
        if (k < 0.68) return ["applyMatrix3", vec(r, 9, 2)];
        if (k < 0.74) return ["applyNormalMatrix", vec(r, 9, 2)];
        if (k < 0.8) return ["transformDirection", trs(r)];
        if (k < 0.85) return ["copyAt", i, int(r, 0, count - 1)];
        if (k < 0.9) return ["needsUpdate", r() < 0.7];
        if (k < 0.95) return ["usage", pick(r, ["dynamic", "stream", "static"])];
        return ["range", int(r, 0, 5), int(r, 0, 5)];
      });
      return { type, itemSize, count, normalized, data: Array.from({ length: itemSize * count }, () => (unit ? num(r, 1) : int(r, -100, 300))), ops };
    },
    run(lib, input) {
      const Ctor = (globalThis as Any)[input.type] as new (a: number[] | number) => K.AttributeArray;
      const a = new lib.Attribute(new Ctor(input.data), input.itemSize, input.normalized);
      // (applyMatrix3 and friends read size 2 or 3 vectors; r180 does too, past the item for smaller sizes)
      const reads: unknown[] = [];
      for (const [op, x, y, z, w, v] of input.ops) {
        switch (op) {
          case "setX": a.setX(x, y); break;
          case "setY": if (a.itemSize > 1) a.setY(x, y); break;
          case "setZ": if (a.itemSize > 2) a.setZ(x, y); break;
          case "setW": if (a.itemSize > 3) a.setW(x, y); break;
          case "setXY": if (a.itemSize > 1) a.setXY(x, y, z); break;
          case "setXYZ": if (a.itemSize > 2) a.setXYZ(x, y, z, w); break;
          case "setXYZW": if (a.itemSize > 3) a.setXYZW(x, y, z, w, v); break;
          case "setComponent": a.setComponent(x, y, z); break;
          case "applyMatrix4": if (a.itemSize === 3) a.applyMatrix4(M4(lib, x)); break;
          case "applyMatrix3": a.applyMatrix3(new lib.Matrix3().fromArray(x)); break;
          case "applyNormalMatrix": if (a.itemSize === 3) a.applyNormalMatrix(new lib.Matrix3().fromArray(x)); break;
          case "transformDirection": if (a.itemSize === 3) a.transformDirection(M4(lib, x)); break;
          case "copyAt": a.copyAt(x, a.clone(), y); break;
          case "needsUpdate": a.needsUpdate = x; break;
          case "usage": a.setUsage(lib.k("usage", x)); break;
          case "range": a.addUpdateRange(x, y); break;
        }
        const gets: number[] = [];
        for (let i = 0; i < a.count; i++) {
          gets.push(a.getX(i));
          if (a.itemSize > 1) gets.push(a.getY(i));
          if (a.itemSize > 2) gets.push(a.getZ(i));
          if (a.itemSize > 3) gets.push(a.getW(i));
          for (let c = 0; c < a.itemSize; c++) gets.push(a.getComponent(i, c));
        }
        reads.push(gets);
      }
      const b = a.clone();
      const inst = new lib.InstanceAttribute(new Ctor(input.data), input.itemSize, input.normalized, 3);
      inst.copyArray(a.array);
      return [snap(lib, a), snap(lib, b), snap(lib, inst.clone()), reads];
    },
  },

  // Instances: the matrix and colour buffers, bit for bit, and their bounds.
  "instances.buffers": {
    make(r) {
      const count = int(r, 1, 16);
      const colorOf = () => {
        const k = r();
        if (k < 0.25) return ["hex", int(r, 0, 0xffffff)];
        if (k < 0.45) return ["srgb", [r(), r(), r()]];
        if (k < 0.6) return ["linear", [r(), r(), r()]];
        if (k < 0.75) return ["hsl", [r(), r(), r()]];
        if (k < 0.9) return ["style", pick(r, ["hotpink", "#ffcc88", "rgb(200, 120, 33)", "hsl(120, 50%, 40%)", "#abc", "white", "seagreen"])];
        return ["copy", int(r, 0, 0xffffff)];
      };
      return {
        count,
        matrices: Array.from({ length: int(r, 0, count + 2) }, () => [int(r, 0, count - 1), trs(r)]),
        colors: r() < 0.8 ? Array.from({ length: int(r, 1, count + 2) }, () => [int(r, 0, count - 1), colorOf()]) : [],
        positions: vec(r, int(r, 1, 8) * 3, 3),
        bounds: r() < 0.7,
        drawCount: r() < 0.3 ? int(r, 0, count) : null,
      };
    },
    run(lib, input) {
      const g = new lib.Geometry();
      g.setAttribute("position", new lib.Attribute(new Float32Array(input.positions), 3));
      const mesh = new lib.Instances(g, new lib.LitMaterial(), input.count);
      const before = snap(lib, mesh.instanceMatrix);
      for (const [i, m] of input.matrices) mesh.setMatrixAt(i, M4(lib, m));
      mesh.instanceMatrix.needsUpdate = true;
      for (const [i, [kind, v]] of input.colors) {
        const c = new lib.Color();
        if (kind === "hex") c.setHex(v);
        if (kind === "srgb") c.setRGB(v[0], v[1], v[2], lib.k("colorSpace", "srgb"));
        if (kind === "linear") c.setRGB(v[0], v[1], v[2], lib.k("colorSpace", "linear"));
        if (kind === "hsl") c.setHSL(v[0], v[1], v[2]);
        if (kind === "style") c.setStyle(v);
        if (kind === "copy") c.copy(new lib.Color(v));
        mesh.setColorAt(i, c);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (input.drawCount !== null) mesh.count = input.drawCount;
      if (input.bounds) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
      const reads: unknown[] = [];
      for (let i = 0; i < input.count; i++) {
        const m = new lib.Matrix4();
        mesh.getMatrixAt(i, m);
        const c = new lib.Color(0, 0, 0);
        if (mesh.instanceColor) mesh.getColorAt(i, c);
        reads.push([el(m), [c.r, c.g, c.b]]);
      }
      const clone = mesh.clone();
      return {
        before,
        matrix: snap(lib, mesh.instanceMatrix),
        color: snap(lib, mesh.instanceColor),
        reads,
        box: box(mesh.boundingBox), sphere: sph(mesh.boundingSphere), gbox: box(g.boundingBox), gsphere: sph(g.boundingSphere),
        clone: [snap(lib, clone.instanceMatrix), snap(lib, clone.instanceColor), clone.count, box(clone.boundingBox), sph(clone.boundingSphere)],
        // (Box3.setFromObject reads the instances' own box)
        world: box(new lib.Box3().setFromObject(mesh)),
      };
    },
  },

  // Every material's fields: defaults, constructor parameters, clone.
  "material.fields": {
    make(r) {
      const cls = pick(r, ["Material", "LitMaterial", "ToonMaterial", "FlatMaterial", "BillboardMaterial", "CustomMaterial", "DepthMaterial", "DistanceMaterial"]);
      const params: Record<string, unknown> = {};
      const maybe = (key: string, value: () => unknown) => {
        if (r() < 0.25) params[key] = value();
      };
      if (cls !== "Material") {
        maybe("opacity", () => r());
        maybe("transparent", () => r() < 0.5);
        maybe("alphaTest", () => (r() < 0.5 ? 0 : r()));
        maybe("depthWrite", () => r() < 0.5);
        maybe("depthTest", () => r() < 0.5);
        maybe("side", () => ["k", "side", pick(r, ["front", "back", "both"])]);
        maybe("blending", () => ["k", "blending", pick(r, ["none", "normal", "add", "multiply"])]);
        maybe("toneMapped", () => r() < 0.5);
        maybe("vertexColors", () => r() < 0.5);
        maybe("polygonOffset", () => r() < 0.5);
        maybe("polygonOffsetFactor", () => num(r, 4));
        maybe("dithering", () => r() < 0.5);
        maybe("name", () => "m" + int(r, 0, 9));
      }
      if (cls === "LitMaterial" || cls === "ToonMaterial" || cls === "FlatMaterial" || cls === "BillboardMaterial") {
        maybe("color", () => (r() < 0.7 ? int(r, 0, 0xffffff) : pick(r, ["#ff8844", "salmon", "rgb(10, 20, 30)"])));
        maybe("fog", () => r() < 0.5);
      }
      if (cls === "LitMaterial") {
        maybe("roughness", () => r());
        maybe("metalness", () => r());
        maybe("emissive", () => int(r, 0, 0xffffff));
        maybe("emissiveIntensity", () => pos(r, 0, 4));
        maybe("flatShading", () => r() < 0.5);
        maybe("envMapIntensity", () => r());
      }
      if (cls === "ToonMaterial") maybe("emissive", () => int(r, 0, 0xffffff));
      if (cls === "FlatMaterial") {
        maybe("reflectivity", () => r());
        maybe("combine", () => ["k", "combine", pick(r, ["multiply", "mix", "add"])]);
      }
      if (cls === "BillboardMaterial") {
        maybe("rotation", () => angle(r));
        maybe("sizeAttenuation", () => r() < 0.5);
      }
      if (cls === "CustomMaterial") {
        maybe("vertexShader", () => "void main() { gl_Position = vec4(position, 1.0); }");
        maybe("fragmentShader", () => "void main() { gl_FragColor = vec4(1.0); }");
        maybe("lights", () => r() < 0.5);
        maybe("fog", () => r() < 0.5);
        maybe("defines", () => ({ USE_X: "", N: int(r, 0, 9) }));
        maybe("uniforms", () => ({ uTime: ["n", r()], uTint: ["color", int(r, 0, 0xffffff)], uOffset: ["v3", vec(r, 3, 2)] }));
      }
      if (cls === "DepthMaterial") maybe("depthPacking", () => ["k", "depthPacking", pick(r, ["basic", "rgba"])]);
      return { cls, params, needsUpdate: int(r, 0, 2), alphaTests: Array.from({ length: int(r, 0, 4) }, () => (r() < 0.4 ? 0 : r())) };
    },
    run(lib, input) {
      const Ctor = (lib as Any)[input.cls] as new (p?: unknown) => K.Material;
      const params: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(input.params as Record<string, unknown>)) {
        if (Array.isArray(v) && v[0] === "k") params[key] = lib.k(v[1], v[2]);
        else if (key === "uniforms") {
          const u: Record<string, unknown> = {};
          for (const [name, [kind, x]] of Object.entries(v as Record<string, [string, Any]>)) {
            u[name] = { value: kind === "n" ? x : kind === "color" ? new lib.Color(x) : V3(lib, x) };
          }
          params[key] = u;
        } else params[key] = v;
      }
      const m = input.cls === "Material" ? new Ctor() : new Ctor(params);
      const fresh = snap(lib, m);
      for (let i = 0; i < input.needsUpdate; i++) m.needsUpdate = true;
      const versions: number[] = [m.version];
      for (const a of input.alphaTests) {
        m.alphaTest = a;
        versions.push(m.version);
      }
      let disposed = 0;
      m.addEventListener("dispose", () => disposed++);
      const clone = m.clone();
      m.dispose();
      return { fresh, alphaTest: m.alphaTest, versions, clone: snap(lib, clone), disposed, hasKey: typeof m.customProgramCacheKey() };
    },
  },

  // Textures and render targets: defaults, constructor arguments, transforms, versions.
  "texture.fields": {
    make(r) {
      const cls = pick(r, ["Texture", "DataTexture", "CanvasTexture", "DepthTexture", "RenderTarget"]);
      const o = <T>(v: () => T): T | null => (r() < 0.35 ? v() : null);
      return {
        cls,
        w: int(r, 1, 64), h: int(r, 1, 64),
        mapping: o(() => pick(r, ["uv", "equirect-reflection"])),
        wrapS: o(() => pick(r, ["clamp", "repeat", "mirror"])), wrapT: o(() => pick(r, ["clamp", "repeat", "mirror"])),
        magFilter: o(() => pick(r, ["nearest", "linear"])), minFilter: o(() => pick(r, ["nearest", "linear", "linear-mipmap-linear", "nearest-mipmap-nearest"])),
        format: o(() => pick(r, cls === "DepthTexture" ? ["depth", "depth-stencil"] : ["rgba", "red", "rg"])),
        type: o(() => pick(r, cls === "DepthTexture" ? ["uint", "float", "depth24-stencil8"] : ["u8", "half", "float"])),
        anisotropy: o(() => int(r, 1, 16)),
        colorSpace: o(() => pick(r, ["srgb", "linear", ""])),
        samples: o(() => pick(r, [0, 4])), depthBuffer: o(() => r() < 0.5), stencilBuffer: o(() => r() < 0.5), count: o(() => int(r, 1, 3)),
        depthTexture: cls === "RenderTarget" && r() < 0.3,
        uv: { offset: vec(r, 2, 1), repeat: [pos(r, 0.2, 4), pos(r, 0.2, 4)], center: [r(), r()], rotation: angle(r) },
        uvs: Array.from({ length: 4 }, () => vec(r, 2, 3)),
        flipY: o(() => r() < 0.5),
        resize: o(() => [int(r, 1, 64), int(r, 1, 64)]),
        needsUpdate: int(r, 0, 2),
      };
    },
    run(lib, input) {
      const kk = (table: Any, v: string | null) => (v === null ? undefined : lib.k(table, v));
      const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
      const args = [kk("mapping", input.mapping), kk("wrapping", input.wrapS), kk("wrapping", input.wrapT), kk("filter", input.magFilter), kk("filter", input.minFilter)];
      let t: Any;
      let disposed = 0;
      if (input.cls === "RenderTarget") {
        const options: Record<string, unknown> = {};
        const set = (key: string, v: unknown) => {
          if (v !== undefined && v !== null) options[key] = v;
        };
        set("wrapS", args[1]); set("wrapT", args[2]); set("magFilter", args[3]); set("minFilter", args[4]);
        set("format", kk("pixelFormat", input.format)); set("type", kk("textureType", input.type)); set("colorSpace", kk("colorSpace", input.colorSpace));
        set("samples", input.samples); set("depthBuffer", input.depthBuffer); set("stencilBuffer", input.stencilBuffer); set("count", input.count);
        if (input.depthTexture) options["depthTexture"] = new lib.DepthTexture(input.w, input.h);
        t = new lib.RenderTarget(input.w, input.h, options);
        t.addEventListener("dispose", () => disposed++);
        const fresh = snap(lib, t);
        if (input.resize) t.setSize(input.resize[0], input.resize[1]);
        const clone = t.clone();
        return { fresh, after: snap(lib, t), clone: snap(lib, clone), disposed, size: [t.width, t.height, t.texture.image.width, t.texture.image.height] };
      }
      if (input.cls === "Texture") t = new lib.Texture({ width: input.w, height: input.h } as Any, ...args, kk("pixelFormat", input.format), kk("textureType", input.type), u(input.anisotropy), kk("colorSpace", input.colorSpace));
      if (input.cls === "CanvasTexture") t = new lib.CanvasTexture({ width: input.w, height: input.h } as Any, ...args, kk("pixelFormat", input.format), kk("textureType", input.type), u(input.anisotropy));
      if (input.cls === "DataTexture") t = new lib.DataTexture(new Uint8Array(input.w * input.h * 4), input.w, input.h, kk("pixelFormat", input.format), kk("textureType", input.type), ...args, u(input.anisotropy), kk("colorSpace", input.colorSpace));
      if (input.cls === "DepthTexture") t = new lib.DepthTexture(input.w, input.h, kk("textureType", input.type), ...args, u(input.anisotropy), kk("pixelFormat", input.format));
      t.addEventListener("dispose", () => disposed++);
      const fresh = snap(lib, t);
      if (input.flipY !== null) t.flipY = input.flipY;
      t.offset.set(input.uv.offset[0], input.uv.offset[1]);
      t.repeat.set(input.uv.repeat[0], input.uv.repeat[1]);
      t.center.set(input.uv.center[0], input.uv.center[1]);
      t.rotation = input.uv.rotation;
      t.updateMatrix();
      const uvs = input.uvs.map((p: number[]) => v2(t.transformUv(new lib.Vector2(p[0], p[1]))));
      for (let i = 0; i < input.needsUpdate; i++) t.needsUpdate = true;
      const clone = t.clone();
      t.dispose();
      return { fresh, matrix: el(t.matrix), uvs, version: [t.version, t.source.version], size: [t.width, t.height, t.depth], clone: snap(lib, clone), disposed };
    },
  },

  // The scene classes' fields: defaults and constructor arguments.
  "object.fields": {
    make(r) {
      const cls = pick(r, ["Node", "Group", "Stage", "Mesh", "Instances", "Billboard", "Camera", "PerspectiveCamera", "OrthoCamera", "AmbientLight", "SunLight", "SkyLight", "Fog", "FogExp2"]);
      return {
        cls, color: r() < 0.5 ? int(r, 0, 0xffffff) : null, ground: r() < 0.5 ? int(r, 0, 0xffffff) : null, intensity: r() < 0.5 ? pos(r, 0, 5) : null,
        nums: vec(r, 6, 50).map((x, i) => (i < 2 ? Math.abs(x) + 1 : x)), count: int(r, 0, 4),
        center: r() < 0.3 ? [r(), r()] : null,
      };
    },
    run(lib, input) {
      const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
      const [a, b, c, d, e, f] = input.nums as number[];
      let o: Any;
      switch (input.cls) {
        case "Node": o = new lib.Node(); break;
        case "Group": o = new lib.Group(); break;
        case "Stage": o = new lib.Stage(); break;
        case "Mesh": o = new lib.Mesh(); break;
        case "Instances": o = new lib.Instances(undefined, undefined, input.count); break;
        case "Billboard": o = new lib.Billboard(); if (input.center) o.center.set(input.center[0], input.center[1]); break;
        case "Camera": o = new lib.Camera(); break;
        case "PerspectiveCamera": o = new lib.PerspectiveCamera(a, b, c! < 0 ? -c! : c, d); break;
        case "OrthoCamera": o = new lib.OrthoCamera(a, b, c, d, e, f); break;
        case "AmbientLight": o = new lib.AmbientLight(u(input.color), u(input.intensity)); break;
        case "SunLight": o = new lib.SunLight(u(input.color), u(input.intensity)); break;
        case "SkyLight": o = new lib.SkyLight(u(input.color), u(input.ground), u(input.intensity)); break;
        case "Fog": o = new lib.Fog(u(input.color), a, b); break;
        case "FogExp2": o = new lib.FogExp2(u(input.color), u(input.intensity)); break;
      }
      const out: Record<string, unknown> = {};
      if (input.cls === "Billboard") {
        // (r180 interleaves the shared quad; read it back through the accessors)
        const g = o.geometry as K.Geometry;
        const read = (name: string, size: number) => {
          const at = g.getAttribute(name)!;
          const list: number[] = [];
          for (let i = 0; i < at.count; i++) {
            list.push(at.getX(i), at.getY(i));
            if (size > 2) list.push(at.getZ(i));
          }
          return list;
        };
        out["quad"] = [Array.from(g.index!.array), read("position", 3), read("uv", 2), g === new lib.Billboard().geometry];
        const { geometry: _g, ...rest } = o;
        void _g;
        out["fields"] = snap(lib, rest);
        out["material"] = snap(lib, o.material);
      } else {
        out["fields"] = snap(lib, o);
      }
      if (o.isObject3D) {
        const clone = o.clone();
        out["clone"] = input.cls === "Billboard" ? [el(clone.matrix), v2(clone.center), clone.material === o.material] : snap(lib, clone);
        let disposed = 0;
        if (typeof o.dispose === "function") {
          o.addEventListener("dispose", () => disposed++);
          o.dispose();
        }
        out["disposed"] = disposed;
      } else {
        out["clone"] = snap(lib, o.clone());
      }
      return out;
    },
  },

  // Version counters and dispose events.
  "versions.dispose": {
    make: (r) => ({ flips: Array.from({ length: int(r, 0, 8) }, () => [pick(r, ["attr", "geometry", "material", "texture", "source", "target"]), r() < 0.75]) }),
    run(lib, input) {
      const a = new lib.Attribute(new Float32Array(6), 3);
      const g = new lib.Geometry();
      const m = new lib.LitMaterial();
      const t = new lib.Texture();
      const rt = new lib.RenderTarget(4, 4);
      const counts: Record<string, number> = { geometry: 0, material: 0, texture: 0, target: 0 };
      g.addEventListener("dispose", () => counts["geometry"]!++);
      m.addEventListener("dispose", () => counts["material"]!++);
      t.addEventListener("dispose", () => counts["texture"]!++);
      rt.addEventListener("dispose", () => counts["target"]!++);
      const log: unknown[] = [];
      for (const [what, v] of input.flips) {
        if (what === "attr") a.needsUpdate = v;
        if (what === "material") m.needsUpdate = v;
        if (what === "texture") t.needsUpdate = v;
        if (what === "source") t.source.needsUpdate = v;
        if (what === "geometry") g.dispose();
        if (what === "target") rt.setSize(v ? 8 : 4, 4);
        log.push([a.version, m.version, t.version, t.source.version, { ...counts }]);
      }
      m.dispose();
      t.dispose();
      return log;
    },
  },
};

// ---- the fixture's compaction

/**
 * An output with every numeric array of 9 or more numbers (a matrix or a buffer;
 * vectors, quaternions, boxes and spheres stay readable)
 * replaced by the sha256 of its exact float64 bytes, as the fixture stores it.
 * (Float32 data reads back as the doubles it holds, so the hash pins its bits
 * too; -0 and NaN keep their own bytes.)
 */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length >= 9 && value.every((x) => typeof x === "number")) {
      const bytes = new Uint8Array(new Float64Array(value as number[]).buffer);
      return { sha256: createHash("sha256").update(bytes).digest("hex"), n: value.length };
    }
    return value.map(compact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = compact(v);
    return out;
  }
  return value;
}
