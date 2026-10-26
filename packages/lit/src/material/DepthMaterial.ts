// Ported from Three.js r180's materials/MeshDepthMaterial.js (MIT, see packages/lit/NOTICE).
// Internal: the shadow map draws casters with it (r180 makes its own with
// depthPacking RGBADepthPacking, so "rgba" here); the default stays r180's "basic".

import { Material } from "./Material.ts";
import type { MaterialParameters } from "./Material.ts";
import type { Texture } from "../texture/Texture.ts";
import type { DepthPacking } from "../constants.ts";

export class DepthMaterial extends Material {
  readonly isMeshDepthMaterial = true;
  // (KEEL's name for the same flag)
  readonly isDepthMaterial = true;

  depthPacking: DepthPacking;

  map: Texture | null;

  alphaMap: Texture | null;

  displacementMap: Texture | null;
  displacementScale: number;
  displacementBias: number;

  wireframe: boolean;
  wireframeLinewidth: number;

  constructor(parameters?: MaterialParameters<DepthMaterial>) {
    super();

    this.type = "DepthMaterial";

    this.depthPacking = "basic";

    this.map = null;

    this.alphaMap = null;

    this.displacementMap = null;
    this.displacementScale = 1;
    this.displacementBias = 0;

    this.wireframe = false;
    this.wireframeLinewidth = 1;

    this.setValues(parameters);
  }

  override copy(source: DepthMaterial): this {
    super.copy(source);

    this.depthPacking = source.depthPacking;

    this.map = source.map;

    this.alphaMap = source.alphaMap;

    this.displacementMap = source.displacementMap;
    this.displacementScale = source.displacementScale;
    this.displacementBias = source.displacementBias;

    this.wireframe = source.wireframe;
    this.wireframeLinewidth = source.wireframeLinewidth;

    return this;
  }
}
