// Ported from Three.js r180's materials/MeshDistanceMaterial.js (MIT, see packages/lit/NOTICE).
// Internal: the shadow map draws point-light casters with it.

import { Material } from "./Material.ts";
import type { MaterialParameters } from "./Material.ts";
import type { Texture } from "../texture/Texture.ts";

export class DistanceMaterial extends Material {
  readonly isMeshDistanceMaterial = true;
  // (KEEL's name for the same flag)
  readonly isDistanceMaterial = true;

  map: Texture | null;

  alphaMap: Texture | null;

  displacementMap: Texture | null;
  displacementScale: number;
  displacementBias: number;

  constructor(parameters?: MaterialParameters<DistanceMaterial>) {
    super();

    this.type = "DistanceMaterial";

    this.map = null;

    this.alphaMap = null;

    this.displacementMap = null;
    this.displacementScale = 1;
    this.displacementBias = 0;

    this.setValues(parameters);
  }

  override copy(source: DistanceMaterial): this {
    super.copy(source);

    this.map = source.map;

    this.alphaMap = source.alphaMap;

    this.displacementMap = source.displacementMap;
    this.displacementScale = source.displacementScale;
    this.displacementBias = source.displacementBias;

    return this;
  }
}
