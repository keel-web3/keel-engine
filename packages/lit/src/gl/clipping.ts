// Ported from Three.js r180's renderers/webgl/WebGLClipping.js (MIT, see
// packages/lit/NOTICE). The renderer's and the materials' clipping planes, in
// view space, as the `clippingPlanes` uniform and the plane counts program
// parameters take (numPlanes, numIntersection). Ported whole: with no planes
// (the grove's case) it keeps r180's state, `uniform` `{ value: null,
// needsUpdate: false }` and counts of 0, so programs come out as r180's.

import { Matrix3 } from "../math/Matrix3.ts";
import { Plane } from "../math/Plane.ts";
import type { Matrix4 } from "../math/Matrix4.ts";

export interface ClippingCamera {
  readonly matrixWorldInverse: Matrix4;
}

export interface ClippingMaterial {
  readonly clippingPlanes: readonly Plane[] | null;
  readonly clipIntersection: boolean;
  readonly clipShadows: boolean;
}

/** r180's WebGLProperties, as clipping reads it (a material's clippingState). */
export interface ClippingProperties {
  get(object: object): { clippingState?: Float32Array | null };
}

export interface Clipping {
  readonly uniform: { value: Float32Array | null; needsUpdate: boolean };
  numPlanes: number;
  numIntersection: number;
  init(planes: readonly Plane[], enableLocalClipping: boolean): boolean;
  beginShadows(): void;
  endShadows(): void;
  setGlobalState(planes: readonly Plane[] | null, camera: ClippingCamera): void;
  setState(material: ClippingMaterial, camera: ClippingCamera, useCache: boolean): void;
}

/** r180's WebGLClipping. */
export function createClipping(properties: ClippingProperties): Clipping {
  let globalState: Float32Array | null = null,
    numGlobalPlanes = 0,
    localClippingEnabled = false,
    renderingShadows = false;

  const plane = new Plane(),
    viewNormalMatrix = new Matrix3(),

    uniform: Clipping["uniform"] = { value: null, needsUpdate: false };

  const scope: Clipping = {
    uniform: uniform,
    numPlanes: 0,
    numIntersection: 0,

    init(planes, enableLocalClipping) {
      const enabled =
        planes.length !== 0 ||
        enableLocalClipping ||
        // enable state of previous frame - the clipping code has to
        // run another frame in order to reset the state:
        numGlobalPlanes !== 0 ||
        localClippingEnabled;

      localClippingEnabled = enableLocalClipping;

      numGlobalPlanes = planes.length;

      return enabled;
    },

    beginShadows() {
      renderingShadows = true;
      projectPlanes(null);
    },

    endShadows() {
      renderingShadows = false;
    },

    setGlobalState(planes, camera) {
      globalState = projectPlanes(planes, camera, 0);
    },

    setState(material, camera, useCache) {
      const planes = material.clippingPlanes,
        clipIntersection = material.clipIntersection,
        clipShadows = material.clipShadows;

      const materialProperties = properties.get(material);

      if (!localClippingEnabled || planes === null || planes.length === 0 || renderingShadows && !clipShadows) {
        // there's no local clipping

        if (renderingShadows) {
          // there's no global clipping

          projectPlanes(null);
        } else {
          resetGlobalState();
        }
      } else {
        const nGlobal = renderingShadows ? 0 : numGlobalPlanes,
          lGlobal = nGlobal * 4;

        let dstArray = materialProperties.clippingState || null;

        uniform.value = dstArray; // ensure unique state

        dstArray = projectPlanes(planes, camera, lGlobal, useCache)!;

        for (let i = 0; i !== lGlobal; ++i) {
          dstArray[i] = globalState![i]!;
        }

        materialProperties.clippingState = dstArray;
        scope.numIntersection = clipIntersection ? scope.numPlanes : 0;
        scope.numPlanes += nGlobal;
      }
    },
  };

  function resetGlobalState(): void {
    if (uniform.value !== globalState) {
      uniform.value = globalState;
      uniform.needsUpdate = numGlobalPlanes > 0;
    }

    scope.numPlanes = numGlobalPlanes;
    scope.numIntersection = 0;
  }

  function projectPlanes(planes: readonly Plane[] | null, camera?: ClippingCamera, dstOffset?: number, skipTransform?: boolean): Float32Array | null {
    const nPlanes = planes !== null ? planes.length : 0;
    let dstArray: Float32Array | null = null;

    if (nPlanes !== 0) {
      dstArray = uniform.value;

      if (skipTransform !== true || dstArray === null) {
        const flatSize = dstOffset! + nPlanes * 4,
          viewMatrix = camera!.matrixWorldInverse;

        viewNormalMatrix.getNormalMatrix(viewMatrix);

        if (dstArray === null || dstArray.length < flatSize) {
          dstArray = new Float32Array(flatSize);
        }

        for (let i = 0, i4 = dstOffset!; i !== nPlanes; ++i, i4 += 4) {
          plane.copy(planes![i]!).applyMatrix4(viewMatrix, viewNormalMatrix);

          plane.normal.toArray(dstArray, i4);
          dstArray[i4 + 3] = plane.constant;
        }
      }

      uniform.value = dstArray;
      uniform.needsUpdate = true;
    }

    scope.numPlanes = nPlanes;
    scope.numIntersection = 0;

    return dstArray;
  }

  return scope;
}
