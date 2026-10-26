// Ported from Three.js r180's extras/core/Shape.js (MIT, see packages/lit/NOTICE).
// toJSON and fromJSON are not ported.

import { Path } from "./Path.ts";
import { generateUUID } from "../math/mathUtils.ts";
import type { Vector2, Vector2Like } from "../math/Vector2.ts";

/** A flat outline with holes: what shape() fills and extrude() extrudes. */
export class Shape extends Path {
  uuid: string;
  holes: Path[];

  constructor(points?: readonly Vector2Like[]) {
    super(points);

    this.uuid = generateUUID();

    this.type = "Shape";

    this.holes = [];
  }

  getPointsHoles(divisions?: number): Vector2[][] {
    const holesPts: Vector2[][] = [];

    for (let i = 0, l = this.holes.length; i < l; i++) {
      holesPts[i] = this.holes[i]!.getPoints(divisions);
    }

    return holesPts;
  }

  /** The outline's and the holes' points (curves sampled at divisions). */
  extractPoints(divisions?: number): { shape: Vector2[]; holes: Vector2[][] } {
    return {
      shape: this.getPoints(divisions),
      holes: this.getPointsHoles(divisions),
    };
  }

  override copy(source: Shape): this {
    super.copy(source);

    this.holes = [];

    for (let i = 0, l = source.holes.length; i < l; i++) {
      const hole = source.holes[i]!;

      this.holes.push(hole.clone());
    }

    return this;
  }
}
