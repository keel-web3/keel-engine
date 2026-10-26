// Ported from Three.js r180's renderers/webgl/WebGLCubeMaps.js (MIT, see
// packages/lit/NOTICE), as a pass-through: keel/lit has no environment maps,
// so there is never an equirectangular texture to turn into a cube render
// target. get() hands every texture back as r180 does for one that isn't
// equirectangular, and refuses one that is (r180's conversion, through
// WebGLCubeRenderTarget.fromEquirectangularTexture, is dropped).

import type { Texture } from "../texture/Texture.ts";

/** r180's WebGLCubeMaps. */
export interface CubeMaps {
  get<T extends Texture | null | undefined>(texture: T): T;
  dispose(): void;
}

export function createCubeMaps(_renderer: unknown): CubeMaps {
  function get<T extends Texture | null | undefined>(texture: T): T {
    if (texture && texture.isTexture) {
      const mapping = texture.mapping;

      if (mapping === "equirect-reflection" || mapping === "equirect-refraction") {
        throw new Error("keel/lit: equirectangular environment maps are not supported");
      }
    }

    return texture;
  }

  function dispose(): void {
    // (nothing held)
  }

  return {
    get: get,
    dispose: dispose,
  };
}
