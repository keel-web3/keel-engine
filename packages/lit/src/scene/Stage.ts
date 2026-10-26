// Ported from Three.js r180's scenes/Scene.js (MIT, see packages/lit/NOTICE).

import { Euler } from "../math/Euler.ts";
import type { Color } from "../math/Color.ts";
import { Node } from "../core/Node.ts";
import type { Material } from "../material/Material.ts";
import type { Texture } from "../texture/Texture.ts";
import type { Fog, FogExp2 } from "./Fog.ts";

/** The root of what gets drawn (r180's Scene): background, fog, an override material. */
export class Stage extends Node {
  readonly isScene = true;
  // (KEEL's name for the same flag)
  readonly isStage = true;

  background: Color | Texture | null;
  environment: Texture | null;
  fog: Fog | FogExp2 | null;

  backgroundBlurriness: number;
  backgroundIntensity: number;
  backgroundRotation: Euler;

  environmentIntensity: number;
  environmentRotation: Euler;

  overrideMaterial: Material | null;

  constructor() {
    super();

    this.type = "Stage";

    this.background = null;
    this.environment = null;
    this.fog = null;

    this.backgroundBlurriness = 0;
    this.backgroundIntensity = 1;
    this.backgroundRotation = new Euler();

    this.environmentIntensity = 1;
    this.environmentRotation = new Euler();

    this.overrideMaterial = null;
  }

  override copy(source: Stage, recursive?: boolean): this {
    super.copy(source, recursive);

    if (source.background !== null) this.background = source.background.clone();
    if (source.environment !== null) this.environment = source.environment.clone();
    if (source.fog !== null) this.fog = source.fog.clone();

    this.backgroundBlurriness = source.backgroundBlurriness;
    this.backgroundIntensity = source.backgroundIntensity;
    this.backgroundRotation.copy(source.backgroundRotation);

    this.environmentIntensity = source.environmentIntensity;
    this.environmentRotation.copy(source.environmentRotation);

    if (source.overrideMaterial !== null) this.overrideMaterial = source.overrideMaterial.clone();

    this.matrixAutoUpdate = source.matrixAutoUpdate;

    return this;
  }
}
