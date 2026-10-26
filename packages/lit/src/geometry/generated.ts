// What the generators share: a Geometry carrying r180's `parameters` and a KEEL `type`.

import { Geometry } from "../core/Geometry.ts";

/** A generated geometry: its parameters as r180 records them (before flooring and clamping). */
export type Generated<P> = Geometry & { parameters: P };

/** A new Geometry with KEEL's type string and r180's parameters, set as r180's constructors set them. */
export function generated<P>(type: string, parameters: P): Generated<P> {
  const geometry = new Geometry() as Generated<P>;

  geometry.type = type;

  geometry.parameters = parameters;

  return geometry;
}
