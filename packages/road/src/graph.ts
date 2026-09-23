// A road network: junctions (nodes) joined by roads (edges), each road a path
// with a class -- and the class decides its width. Widths are a rule here, not
// a hope: an arterial is wide enough to race four abreast, whatever a
// generator's parcels would like, and a road narrower than its class allows is
// refused when the graph is made.

import { boundsOf } from "./path.ts";
import type { Path } from "./path.ts";

/** What kind of road: a highway, a city arterial (the race roads), a street, an alley. */
/** A ramp is a one-lane, one-way slip road joining a freeway: no pavement, a shoulder each side. A freeway runs three lanes each way. */
export type RoadClass = "highway" | "arterial" | "street" | "alley" | "ramp" | "freeway";

/** Each class's half width (m, centre to kerb) at its narrowest, and its lanes each way. */
export const ROAD_CLASS: Readonly<Record<RoadClass, { readonly minHalf: number; readonly lanes: number }>> = {
  // (A highway's 7.4 m is the carriageway; its shoulder is paint beyond it.)
  highway: { minHalf: 7.4, lanes: 2 },
  // (~14.6 m kerb to kerb: four to six cars abreast -- what a street race needs.)
  arterial: { minHalf: 7.3, lanes: 2 },
  street: { minHalf: 4.5, lanes: 1 },
  alley: { minHalf: 2.5, lanes: 1 },
  ramp: { minHalf: 3.6, lanes: 1 },
  // (A freeway: three lanes each way, out past the ring and on to the next city.)
  freeway: { minHalf: 11.1, lanes: 3 },
};

export interface RoadNode {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

export interface RoadEdge {
  readonly id: number;
  /** The junctions it joins (a -> b is its path's direction). A closed loop has a === b. */
  readonly a: number;
  readonly b: number;
  readonly cls: RoadClass;
  readonly path: Path;
  /** Half its width (m), and its lanes each way. */
  readonly half: number;
  readonly lanes: number;
  readonly oneWay: boolean;
  /** It crosses water or a valley on a deck: the land under it is not its road (present only when true). */
  readonly bridge?: true;
}

export interface RoadGraph {
  readonly nodes: readonly RoadNode[];
  readonly edges: readonly RoadEdge[];
  /** Per node, the edges that meet there. */
  readonly at: readonly (readonly number[])[];
  /** The box round every road: [x0, z0, x1, z1]. */
  readonly bounds: readonly [number, number, number, number];
}

/** A road to add: its ends, class and path (half width and lanes default to its class's). */
export interface EdgeSpec {
  readonly a: number;
  readonly b: number;
  readonly cls: RoadClass;
  readonly path: Path;
  readonly half?: number;
  readonly lanes?: number;
  readonly oneWay?: boolean;
  readonly bridge?: boolean;
}

/** Make a graph, holding every road to its class's width. Throws on a road too narrow or a missing node. */
export function roadGraph(nodes: readonly RoadNode[], specs: readonly EdgeSpec[]): RoadGraph {
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const at: number[][] = nodes.map(() => []);
  const edges = specs.map<RoadEdge>((e, id) => {
    const rule = ROAD_CLASS[e.cls];
    const half = e.half ?? rule.minHalf;
    if (half < rule.minHalf) throw new Error(`A ${e.cls} is at least ${rule.minHalf} m half-width; edge ${id} asked for ${half}.`);
    const ia = byId.get(e.a), ib = byId.get(e.b);
    if (ia === undefined || ib === undefined) throw new Error(`Edge ${id} joins a node that isn't there.`);
    at[ia]!.push(id);
    if (ib !== ia) at[ib]!.push(id);
    return { id, a: e.a, b: e.b, cls: e.cls, path: e.path, half, lanes: e.lanes ?? rule.lanes, oneWay: e.oneWay ?? false, ...(e.bridge ? { bridge: true as const } : {}) };
  });
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const e of edges) {
    const b = boundsOf(e.path);
    x0 = Math.min(x0, b[0] - e.half); z0 = Math.min(z0, b[1] - e.half); x1 = Math.max(x1, b[2] + e.half); z1 = Math.max(z1, b[3] + e.half);
  }
  return { nodes, edges, at, bounds: [x0, z0, x1, z1] };
}

/** A graph of one closed loop (a circuit) -- the simplest road network there is. */
export function loopGraph(path: Path, cls: RoadClass, half?: number): RoadGraph {
  return roadGraph([{ id: 0, x: path.x[0]!, z: path.z[0]! }], [{ a: 0, b: 0, cls, path, ...(half !== undefined ? { half } : {}) }]);
}
