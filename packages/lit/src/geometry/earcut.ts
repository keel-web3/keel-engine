// Ported from Three.js r180's extras/Earcut.js and its vendored copy of
// mapbox/earcut 3.0.1 (extras/lib/earcut.js; ISC, https://github.com/mapbox/earcut/tree/v3.0.1),
// line for line (MIT, see packages/lit/NOTICE).

interface EarNode {
  // (the vertex's index in the coordinates array, and where it is)
  i: number;
  x: number;
  y: number;
  // (previous and next in the polygon ring)
  prev: EarNode;
  next: EarNode;
  // (z-order curve value, and previous and next in z-order)
  z: number;
  prevZ: EarNode | null;
  nextZ: EarNode | null;
  // (a steiner point)
  steiner: boolean;
}

/** Triangulates a flat polygon with holes: vertex indices, three per triangle (r180's Earcut.triangulate). */
export function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim = 2): number[] {
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0]! * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles: number[] = [];

  if (!outerNode || outerNode.next === outerNode.prev) return triangles;

  // (invSize 0 is earcut's undefined: no z-order hashing)
  let minX = 0, minY = 0, invSize = 0;

  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);

  // (not too simple: hash by z-order later, over the polygon's bounds)
  if (data.length > 80 * dim) {
    minX = Infinity;
    minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i]!;
      const y = data[i + 1]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    // (minX, minY and invSize turn coordinates into integers for the z-order)
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }

  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);

  return triangles;
}

/** r180's Earcut: `Earcut.triangulate(data, holeIndices, dim)`. */
export const Earcut = {
  triangulate(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim = 2): number[] {
    return earcut(data, holeIndices, dim);
  },
};

// (a circular doubly linked list from the points, in the given winding)
function linkedList(data: ArrayLike<number>, start: number, end: number, dim: number, clockwise: boolean): EarNode | undefined {
  let last: EarNode | undefined;

  if (clockwise === (signedArea(data, start, end, dim) > 0)) {
    for (let i = start; i < end; i += dim) last = insertNode((i / dim) | 0, data[i]!, data[i + 1]!, last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode((i / dim) | 0, data[i]!, data[i + 1]!, last);
  }

  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }

  return last;
}

// (collinear or duplicate points removed)
function filterPoints(start: EarNode | undefined, end?: EarNode): EarNode | undefined {
  if (!start) return start;
  if (!end) end = start;

  let p = start,
    again;
  do {
    again = false;

    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== end);

  return end;
}

// (the ear slicing loop)
function earcutLinked(start: EarNode | undefined, triangles: number[], dim: number, minX: number, minY: number, invSize: number, pass: number): void {
  if (!start) return;

  let ear: EarNode = start;

  // (nodes interlinked in z-order)
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

  let stop = ear;

  // (ears sliced one by one)
  while (ear.prev !== ear.next) {
    const prev = ear.prev;
    const next = ear.next;

    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i, ear.i, next.i);

      removeNode(ear);

      // (skipping the next vertex leaves fewer slivers)
      ear = next.next;
      stop = next.next;

      continue;
    }

    ear = next;

    // (round the whole polygon without an ear)
    if (ear === stop) {
      // (filter the points and try again)
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);

      // (then cure small self-intersections locally)
      } else if (pass === 1) {
        earcutLinked(cureLocalIntersections(filterPoints(ear)!, triangles), triangles, dim, minX, minY, invSize, 2);

      // (and last, split the polygon in two)
      } else if (pass === 2) {
        splitEarcut(ear, triangles, dim, minX, minY, invSize);
      }

      break;
    }
  }
}

function isEar(ear: EarNode): boolean {
  const a = ear.prev,
    b = ear,
    c = ear.next;

  // (reflex: not an ear)
  if (area(a, b, c) >= 0) return false;

  // (and no other point inside it)
  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;

  const x0 = Math.min(ax, bx, cx),
    y0 = Math.min(ay, by, cy),
    x1 = Math.max(ax, bx, cx),
    y1 = Math.max(ay, by, cy);

  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }

  return true;
}

function isEarHashed(ear: EarNode, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev,
    b = ear,
    c = ear.next;

  if (area(a, b, c) >= 0) return false;

  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;

  const x0 = Math.min(ax, bx, cx),
    y0 = Math.min(ay, by, cy),
    x1 = Math.max(ax, bx, cx),
    y1 = Math.max(ay, by, cy);

  // (the z-order range of the triangle's bounds)
  const minZ = zOrder(x0, y0, minX, minY, invSize),
    maxZ = zOrder(x1, y1, minX, minY, invSize);

  let p = ear.prevZ,
    n = ear.nextZ;

  // (points inside, looked for both ways)
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;

    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }

  // (the rest in decreasing z-order)
  while (p && p.z >= minZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
  }

  // (and in increasing z-order)
  while (n && n.z <= maxZ) {
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }

  return true;
}

// (small local self-intersections cured)
function cureLocalIntersections(start: EarNode, triangles: number[]): EarNode | undefined {
  let p = start;
  do {
    const a = p.prev,
      b = p.next.next;

    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i, p.i, b.i);

      // (the two nodes removed)
      removeNode(p);
      removeNode(p.next);

      p = start = b;
    }
    p = p.next;
  } while (p !== start);

  return filterPoints(p);
}

// (split by a valid diagonal, and each half triangulated)
function splitEarcut(start: EarNode, triangles: number[], dim: number, minX: number, minY: number, invSize: number): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c: EarNode | undefined = splitPolygon(a, b);

        // (collinear points around the cuts filtered)
        let a2 = filterPoints(a, a.next);
        c = filterPoints(c, c.next);

        earcutLinked(a2, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

// (every hole linked into the outer ring: one ring, no holes)
function eliminateHoles(data: ArrayLike<number>, holeIndices: ArrayLike<number>, outerNode: EarNode, dim: number): EarNode {
  const queue: EarNode[] = [];

  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i]! * dim;
    const end = i < len - 1 ? holeIndices[i + 1]! * dim : data.length;
    const list = linkedList(data, start, end, dim, false)!;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }

  queue.sort(compareXYSlope);

  // (left to right)
  for (let i = 0; i < queue.length; i++) {
    outerNode = eliminateHole(queue[i]!, outerNode);
  }

  return outerNode;
}

function compareXYSlope(a: EarNode, b: EarNode): number {
  let result = a.x - b.x;
  // (holes whose leftmost points meet go counterclockwise, so the bridge found
  // to the outer shell is the point they meet at)
  if (result === 0) {
    result = a.y - b.y;
    if (result === 0) {
      const aSlope = (a.next.y - a.y) / (a.next.x - a.x);
      const bSlope = (b.next.y - b.y) / (b.next.x - b.x);
      result = aSlope - bSlope;
    }
  }
  return result;
}

// (a bridge from the hole to the outer ring, linked)
function eliminateHole(hole: EarNode, outerNode: EarNode): EarNode {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) {
    return outerNode;
  }

  const bridgeReverse = splitPolygon(bridge, hole);

  // (collinear points around the cuts filtered)
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next)!;
}

// (David Eberly's hole bridge)
function findHoleBridge(hole: EarNode, outerNode: EarNode): EarNode | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: EarNode | undefined;

  // (a segment hit by a ray left from the hole's leftmost point; its endpoint
  // with the lesser x is the candidate, unless the ray meets a vertex)
  if (equals(hole, p)) return p;
  do {
    if (equals(hole, p.next)) return p.next;
    else if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        // (the hole touches the segment: its leftmost endpoint)
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);

  if (!m) return null;

  // (no points inside the triangle of hole point, hit and endpoint: a valid
  // bridge; else the point at the least angle to the ray)
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;

  p = m;

  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);

      if (locallyInside(p, hole) &&
        (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
        m = p;
        tanMin = tan;
      }
    }

    p = p.next;
  } while (p !== stop);

  return m;
}

// (whether m's sector holds p's)
function sectorContainsSector(m: EarNode, p: EarNode): boolean {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

// (nodes interlinked in z-order)
function indexCurve(start: EarNode, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);

  p.prevZ!.nextZ = null;
  p.prevZ = null;

  sortLinked(p);
}

// (Simon Tatham's linked list merge sort, http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html)
function sortLinked(list: EarNode | null): EarNode | null {
  let numMerges;
  let inSize = 1;

  do {
    let p = list;
    let e: EarNode;
    list = null;
    let tail: EarNode | null = null;
    numMerges = 0;

    while (p) {
      numMerges++;
      let q: EarNode | null = p;
      let pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }
      let qSize = inSize;

      while (pSize > 0 || (qSize > 0 && q)) {
        if (pSize !== 0 && (qSize === 0 || !q || p!.z <= q.z)) {
          e = p!;
          p = p!.nextZ;
          pSize--;
        } else {
          e = q!;
          q = q!.nextZ;
          qSize--;
        }

        if (tail) tail.nextZ = e;
        else list = e;

        e.prevZ = tail;
        tail = e;
      }

      p = q;
    }

    tail!.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);

  return list;
}

// (the z-order of a point, from its offset over the bounds' longer side)
function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  // (into non-negative 15-bit integers)
  x = ((x - minX) * invSize) | 0;
  y = ((y - minY) * invSize) | 0;

  x = (x | (x << 8)) & 0x00FF00FF;
  x = (x | (x << 4)) & 0x0F0F0F0F;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;

  y = (y | (y << 8)) & 0x00FF00FF;
  y = (y | (y << 4)) & 0x0F0F0F0F;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;

  return x | (y << 1);
}

// (a ring's leftmost node)
function getLeftmost(start: EarNode): EarNode {
  let p = start,
    leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);

  return leftmost;
}

// (whether a point lies in a convex triangle)
function pointInTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py);
}

// (the same, but false at the triangle's first point)
function pointInTriangleExceptFirst(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py);
}

// (whether a diagonal lies inside the polygon)
function isValidDiagonal(a: EarNode, b: EarNode): boolean {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && // (crosses no other edge)
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && // (locally visible)
      !!(area(a.prev, a, b.prev) || area(a, b.prev, b))) || // (no opposite-facing sectors)
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0)); // (the zero-length case)
}

// (a triangle's signed area)
function area(p: EarNode, q: EarNode, r: EarNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(p1: EarNode, p2: EarNode): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

// (whether two segments cross)
function intersects(p1: EarNode, q1: EarNode, p2: EarNode, q2: EarNode): boolean {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));

  // (the general case)
  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegment(p1, p2, q1)) return true; // (p2 on p1q1)
  if (o2 === 0 && onSegment(p1, q2, q1)) return true; // (q2 on p1q1)
  if (o3 === 0 && onSegment(p2, p1, q2)) return true; // (p1 on p2q2)
  if (o4 === 0 && onSegment(p2, q1, q2)) return true; // (q1 on p2q2)

  return false;
}

// (for collinear p, q, r: whether q lies on pr)
function onSegment(p: EarNode, q: EarNode, r: EarNode): boolean {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

function sign(num: number): number {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}

// (whether a diagonal crosses any of the polygon's edges)
function intersectsPolygon(a: EarNode, b: EarNode): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
      intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);

  return false;
}

// (whether a diagonal is locally inside)
function locallyInside(a: EarNode, b: EarNode): boolean {
  return area(a.prev, a, a.next) < 0 ?
    area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
    area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

// (whether a diagonal's midpoint is inside)
function middleInside(a: EarNode, b: EarNode): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
      (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x))
      inside = !inside;
    p = p.next;
  } while (p !== a);

  return inside;
}

// (a bridge between two vertices: one ring split in two, or a hole merged into the outer ring)
function splitPolygon(a: EarNode, b: EarNode): EarNode {
  const a2 = createNode(a.i, a.x, a.y),
    b2 = createNode(b.i, b.x, b.y),
    an = a.next,
    bp = b.prev;

  a.next = b;
  b.prev = a;

  a2.next = an;
  an.prev = a2;

  b2.next = a2;
  a2.prev = b2;

  bp.next = b2;
  b2.prev = bp;

  return b2;
}

// (a node, linked after last if there is one)
function insertNode(i: number, x: number, y: number, last: EarNode | undefined): EarNode {
  const p = createNode(i, x, y);

  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function removeNode(p: EarNode): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;

  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function createNode(i: number, x: number, y: number): EarNode {
  return {
    i,
    x, y,
    // (linked by the caller)
    prev: null as unknown as EarNode,
    next: null as unknown as EarNode,
    z: 0,
    prevZ: null,
    nextZ: null,
    steiner: false,
  };
}

/** How far a triangulation's area is from the polygon's, as a fraction (earcut's deviation). */
export function earcutDeviation(data: ArrayLike<number>, holeIndices: ArrayLike<number> | null | undefined, dim: number, triangles: ArrayLike<number>): number {
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0]! * dim : data.length;

  let polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
  if (hasHoles) {
    for (let i = 0, len = holeIndices.length; i < len; i++) {
      const start = holeIndices[i]! * dim;
      const end = i < len - 1 ? holeIndices[i + 1]! * dim : data.length;
      polygonArea -= Math.abs(signedArea(data, start, end, dim));
    }
  }

  let trianglesArea = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i]! * dim;
    const b = triangles[i + 1]! * dim;
    const c = triangles[i + 2]! * dim;
    trianglesArea += Math.abs(
      (data[a]! - data[c]!) * (data[b + 1]! - data[a + 1]!) -
      (data[a]! - data[b]!) * (data[c + 1]! - data[a + 1]!));
  }

  return polygonArea === 0 && trianglesArea === 0 ? 0 :
    Math.abs((trianglesArea - polygonArea) / polygonArea);
}

function signedArea(data: ArrayLike<number>, start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j]! - data[i]!) * (data[i + 1]! + data[j + 1]!);
    j = i;
  }
  return sum;
}
