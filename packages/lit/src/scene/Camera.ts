// Ported from Three.js r180's cameras/Camera.js (MIT, see packages/lit/NOTICE).

import { Matrix4 } from "../math/Matrix4.ts";
import type { Vector3 } from "../math/Vector3.ts";
import type { CoordinateSystem } from "../math/types.ts";
import { Node } from "../core/Node.ts";

/** What every camera shares: the view and projection matrices. A camera looks down its -z. */
export class Camera extends Node {
  readonly isCamera = true;

  matrixWorldInverse: Matrix4;

  projectionMatrix: Matrix4;
  projectionMatrixInverse: Matrix4;

  coordinateSystem: CoordinateSystem;

  _reversedDepth: boolean;

  constructor() {
    super();

    this.type = "Camera";

    this.matrixWorldInverse = new Matrix4();

    this.projectionMatrix = new Matrix4();
    this.projectionMatrixInverse = new Matrix4();

    this.coordinateSystem = "webgl";

    this._reversedDepth = false;
  }

  get reversedDepth(): boolean {
    return this._reversedDepth;
  }

  override copy(source: Camera, recursive?: boolean): this {
    super.copy(source, recursive);

    this.matrixWorldInverse.copy(source.matrixWorldInverse);

    this.projectionMatrix.copy(source.projectionMatrix);
    this.projectionMatrixInverse.copy(source.projectionMatrixInverse);

    this.coordinateSystem = source.coordinateSystem;

    return this;
  }

  override getWorldDirection(target: Vector3): Vector3 {
    return super.getWorldDirection(target).negate();
  }

  override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force);

    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }

  override updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void {
    super.updateWorldMatrix(updateParents, updateChildren);

    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }

  // (r180's camera clone takes no `recursive`: children always come along)
  override clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }
}

/** A camera's view offset (setViewOffset): a window into a larger frame. */
export interface CameraView {
  enabled: boolean;
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}
