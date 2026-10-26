// Ported from Three.js r180's lights/DirectionalLight.js (MIT, see packages/lit/NOTICE).

import type { ColorRepresentation } from "../math/Color.ts";
import { Node } from "../core/Node.ts";
import { Light } from "./Light.ts";
import { SunShadow } from "./LightShadow.ts";

/**
 * Parallel light, shining from its position toward its target's (r180's
 * DirectionalLight). It starts at (0, 1, 0), aimed at a target at the origin;
 * the target is not in the graph unless you add it.
 */
export class SunLight extends Light {
  readonly isDirectionalLight = true;
  // (KEEL's name for the same flag)
  readonly isSunLight = true;

  target: Node;
  shadow: SunShadow;

  constructor(color?: ColorRepresentation, intensity?: number) {
    super(color, intensity);

    this.type = "SunLight";

    this.position.copy(Node.DEFAULT_UP);
    this.updateMatrix();

    this.target = new Node();

    this.shadow = new SunShadow();
  }

  override dispose(): void {
    this.shadow.dispose();
  }

  override copy(source: SunLight): this {
    super.copy(source);

    this.target = source.target.clone();
    this.shadow = source.shadow.clone();

    return this;
  }
}
