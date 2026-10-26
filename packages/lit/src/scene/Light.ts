// Ported from Three.js r180's lights/Light.js, AmbientLight.js and HemisphereLight.js
// (MIT, see packages/lit/NOTICE). toJSON is not ported.

import { Color } from "../math/Color.ts";
import type { ColorRepresentation } from "../math/Color.ts";
import { Node } from "../core/Node.ts";

/** What every light shares: a colour and an intensity. A light points its -z (lookAt) as a camera does. */
export class Light extends Node {
  readonly isLight = true;

  color: Color;
  intensity: number;

  constructor(color?: ColorRepresentation, intensity = 1) {
    super();

    this.type = "Light";

    this.color = new Color(color);
    this.intensity = intensity;
  }

  dispose(): void {
    // (empty here, a light with a shadow frees it)
  }

  override copy(source: Light, recursive?: boolean): this {
    super.copy(source, recursive);

    this.color.copy(source.color);
    this.intensity = source.intensity;

    return this;
  }
}

/** Light from everywhere at once. */
export class AmbientLight extends Light {
  readonly isAmbientLight = true;

  constructor(color?: ColorRepresentation, intensity?: number) {
    super(color, intensity);

    this.type = "AmbientLight";
  }
}

/** A sky colour from above and a ground colour from below, blended by the normal (r180's HemisphereLight). */
export class SkyLight extends Light {
  readonly isHemisphereLight = true;
  // (KEEL's name for the same flag)
  readonly isSkyLight = true;

  groundColor: Color;

  constructor(skyColor?: ColorRepresentation, groundColor?: ColorRepresentation, intensity?: number) {
    super(skyColor, intensity);

    this.type = "SkyLight";

    this.position.copy(Node.DEFAULT_UP);
    this.updateMatrix();

    this.groundColor = new Color(groundColor);
  }

  override copy(source: SkyLight, recursive?: boolean): this {
    super.copy(source, recursive);

    this.groundColor.copy(source.groundColor);

    return this;
  }
}
