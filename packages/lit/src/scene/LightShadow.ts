// Ported from Three.js r180's lights/LightShadow.js and DirectionalLightShadow.js
// (MIT, see packages/lit/NOTICE). toJSON is not ported.

import { Matrix4 } from "../math/Matrix4.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Vector4 } from "../math/Vector4.ts";
import { Frustum } from "../math/Frustum.ts";
import type { Node } from "../core/Node.ts";
import type { RenderTarget } from "../texture/RenderTarget.ts";
import type { TextureType } from "../constants.ts";
import type { Camera } from "./Camera.ts";
import { OrthoCamera } from "./OrthoCamera.ts";

const _projScreenMatrix = /*@__PURE__*/ new Matrix4();
const _lightPositionWorld = /*@__PURE__*/ new Vector3();
const _lookTarget = /*@__PURE__*/ new Vector3();

/** A light with a target, as updateMatrices reads it. */
export interface ShadowCaster {
  readonly matrixWorld: Matrix4;
  readonly target: Node;
}

/** A light's shadow: the camera it renders depth from, the map, and the matrix that reads it back. */
export class LightShadow<C extends Camera = Camera> {
  camera: C;

  intensity: number;

  bias: number;
  normalBias: number;
  radius: number;
  blurSamples: number;

  mapSize: Vector2;

  mapType: TextureType;

  map: RenderTarget | null;
  mapPass: RenderTarget | null;
  /** World to shadow-map space (texture coordinates and depth in [0, 1]). */
  matrix: Matrix4;

  autoUpdate: boolean;
  needsUpdate: boolean;

  _frustum: Frustum;
  _frameExtents: Vector2;

  _viewportCount: number;
  _viewports: Vector4[];

  constructor(camera: C) {
    this.camera = camera;

    this.intensity = 1;

    this.bias = 0;
    this.normalBias = 0;
    this.radius = 1;
    this.blurSamples = 8;

    this.mapSize = new Vector2(512, 512);

    this.mapType = "u8";

    this.map = null;
    this.mapPass = null;
    this.matrix = new Matrix4();

    this.autoUpdate = true;
    this.needsUpdate = false;

    this._frustum = new Frustum();
    this._frameExtents = new Vector2(1, 1);

    this._viewportCount = 1;

    this._viewports = [new Vector4(0, 0, 1, 1)];
  }

  getViewportCount(): number {
    return this._viewportCount;
  }

  getFrustum(): Frustum {
    return this._frustum;
  }

  /** Puts the camera at the light looking at its target, then rebuilds the frustum and the shadow matrix. */
  updateMatrices(light: ShadowCaster): void {
    const shadowCamera = this.camera;
    const shadowMatrix = this.matrix;

    _lightPositionWorld.setFromMatrixPosition(light.matrixWorld);
    shadowCamera.position.copy(_lightPositionWorld);

    _lookTarget.setFromMatrixPosition(light.target.matrixWorld);
    shadowCamera.lookAt(_lookTarget);
    shadowCamera.updateMatrixWorld();

    _projScreenMatrix.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(_projScreenMatrix, shadowCamera.coordinateSystem, shadowCamera.reversedDepth);

    if (shadowCamera.reversedDepth) {
      shadowMatrix.set(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
      );
    } else {
      shadowMatrix.set(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0,
      );
    }

    shadowMatrix.multiply(_projScreenMatrix);
  }

  getViewport(viewportIndex: number): Vector4 | undefined {
    return this._viewports[viewportIndex];
  }

  getFrameExtents(): Vector2 {
    return this._frameExtents;
  }

  dispose(): void {
    if (this.map) {
      this.map.dispose();
    }

    if (this.mapPass) {
      this.mapPass.dispose();
    }
  }

  copy(source: LightShadow<C>): this {
    this.camera = source.camera.clone();

    this.intensity = source.intensity;

    this.bias = source.bias;
    this.radius = source.radius;

    this.autoUpdate = source.autoUpdate;
    this.needsUpdate = source.needsUpdate;
    this.normalBias = source.normalBias;
    this.blurSamples = source.blurSamples;

    this.mapSize.copy(source.mapSize);

    return this;
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }
}

/** A sun's shadow (r180's DirectionalLightShadow): an orthographic camera, 10 by 10, from 0.5 to 500. */
export class SunShadow extends LightShadow<OrthoCamera> {
  readonly isDirectionalLightShadow = true;
  // (KEEL's name for the same flag)
  readonly isSunShadow = true;

  constructor() {
    super(new OrthoCamera(- 5, 5, 5, - 5, 0.5, 500));
  }
}
