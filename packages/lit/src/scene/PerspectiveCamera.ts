// Ported from Three.js r180's cameras/PerspectiveCamera.js (MIT, see packages/lit/NOTICE).

import { RAD2DEG, DEG2RAD } from "../math/mathUtils.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Camera } from "./Camera.ts";
import type { CameraView } from "./Camera.ts";

const _v3 = /*@__PURE__*/ new Vector3();
const _minTarget = /*@__PURE__*/ new Vector2();
const _maxTarget = /*@__PURE__*/ new Vector2();

export class PerspectiveCamera extends Camera {
  readonly isPerspectiveCamera = true;

  /** The vertical field of view, in degrees. */
  fov: number;
  zoom: number;

  near: number;
  far: number;
  focus: number;

  aspect: number;
  view: CameraView | null;

  /** The film's width, in mm. */
  filmGauge: number;
  /** The horizontal film offset (same unit as filmGauge). */
  filmOffset: number;

  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();

    this.type = "PerspectiveCamera";

    this.fov = fov;
    this.zoom = 1;

    this.near = near;
    this.far = far;
    this.focus = 10;

    this.aspect = aspect;
    this.view = null;

    this.filmGauge = 35;
    this.filmOffset = 0;

    this.updateProjectionMatrix();
  }

  override copy(source: PerspectiveCamera, recursive?: boolean): this {
    super.copy(source, recursive);

    this.fov = source.fov;
    this.zoom = source.zoom;

    this.near = source.near;
    this.far = source.far;
    this.focus = source.focus;

    this.aspect = source.aspect;
    this.view = source.view === null ? null : Object.assign({}, source.view);

    this.filmGauge = source.filmGauge;
    this.filmOffset = source.filmOffset;

    return this;
  }

  /** Sets the fov from a focal length on the current film (35mm by default). */
  setFocalLength(focalLength: number): void {
    const vExtentSlope = (0.5 * this.getFilmHeight()) / focalLength;

    this.fov = RAD2DEG * 2 * Math.atan(vExtentSlope);
    this.updateProjectionMatrix();
  }

  getFocalLength(): number {
    const vExtentSlope = Math.tan(DEG2RAD * 0.5 * this.fov);

    return (0.5 * this.getFilmHeight()) / vExtentSlope;
  }

  getEffectiveFOV(): number {
    return RAD2DEG * 2 * Math.atan(Math.tan(DEG2RAD * 0.5 * this.fov) / this.zoom);
  }

  getFilmWidth(): number {
    // (film not completely covered in portrait format, aspect < 1)
    return this.filmGauge * Math.min(this.aspect, 1);
  }

  getFilmHeight(): number {
    // (film not completely covered in landscape format, aspect > 1)
    return this.filmGauge / Math.max(this.aspect, 1);
  }

  /** The view's corners at a distance, in view space. */
  getViewBounds(distance: number, minTarget: Vector2, maxTarget: Vector2): void {
    _v3.set(- 1, - 1, 0.5).applyMatrix4(this.projectionMatrixInverse);

    minTarget.set(_v3.x, _v3.y).multiplyScalar(- distance / _v3.z);

    _v3.set(1, 1, 0.5).applyMatrix4(this.projectionMatrixInverse);

    maxTarget.set(_v3.x, _v3.y).multiplyScalar(- distance / _v3.z);
  }

  getViewSize(distance: number, target: Vector2): Vector2 {
    this.getViewBounds(distance, _minTarget, _maxTarget);

    return target.subVectors(_maxTarget, _minTarget);
  }

  setViewOffset(fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number): void {
    this.aspect = fullWidth / fullHeight;

    if (this.view === null) {
      this.view = {
        enabled: true,
        fullWidth: 1,
        fullHeight: 1,
        offsetX: 0,
        offsetY: 0,
        width: 1,
        height: 1,
      };
    }

    this.view.enabled = true;
    this.view.fullWidth = fullWidth;
    this.view.fullHeight = fullHeight;
    this.view.offsetX = x;
    this.view.offsetY = y;
    this.view.width = width;
    this.view.height = height;

    this.updateProjectionMatrix();
  }

  clearViewOffset(): void {
    if (this.view !== null) {
      this.view.enabled = false;
    }

    this.updateProjectionMatrix();
  }

  updateProjectionMatrix(): void {
    const near = this.near;
    let top = (near * Math.tan(DEG2RAD * 0.5 * this.fov)) / this.zoom;
    let height = 2 * top;
    let width = this.aspect * height;
    let left = - 0.5 * width;
    const view = this.view;

    if (this.view !== null && this.view.enabled) {
      const fullWidth = view!.fullWidth,
        fullHeight = view!.fullHeight;

      left += (view!.offsetX * width) / fullWidth;
      top -= (view!.offsetY * height) / fullHeight;
      width *= view!.width / fullWidth;
      height *= view!.height / fullHeight;
    }

    const skew = this.filmOffset;
    if (skew !== 0) left += (near * skew) / this.getFilmWidth();

    this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far, this.coordinateSystem, this.reversedDepth);

    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
