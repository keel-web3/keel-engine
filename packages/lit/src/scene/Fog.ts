// Ported from Three.js r180's scenes/Fog.js and scenes/FogExp2.js (MIT, see packages/lit/NOTICE).

import { Color } from "../math/Color.ts";
import type { ColorRepresentation } from "../math/Color.ts";

/** Linear fog: none at `near`, full at `far`. */
export class Fog {
  readonly isFog = true;

  name: string;
  color: Color;
  near: number;
  far: number;

  constructor(color?: ColorRepresentation, near = 1, far = 1000) {
    this.name = "";

    this.color = new Color(color);

    this.near = near;
    this.far = far;
  }

  clone(): Fog {
    return new Fog(this.color, this.near, this.far);
  }
}

/** Exponential squared fog. */
export class FogExp2 {
  readonly isFogExp2 = true;

  name: string;
  color: Color;
  density: number;

  constructor(color?: ColorRepresentation, density = 0.00025) {
    this.name = "";

    this.color = new Color(color);
    this.density = density;
  }

  clone(): FogExp2 {
    return new FogExp2(this.color, this.density);
  }
}
