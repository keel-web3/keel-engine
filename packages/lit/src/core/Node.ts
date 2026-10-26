// Ported from Three.js r180's core/Object3D.js (MIT, see packages/lit/NOTICE).
// raycast and toJSON are not ported.

import { Quaternion } from "../math/Quaternion.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Matrix4 } from "../math/Matrix4.ts";
import { Euler } from "../math/Euler.ts";
import { Matrix3 } from "../math/Matrix3.ts";
import { generateUUID } from "../math/mathUtils.ts";
import { Emitter } from "./Emitter.ts";
import type { EmitterEvent } from "./Emitter.ts";
import { Layers } from "./Layers.ts";
import type { Geometry } from "./Geometry.ts";
import type { Material } from "../material/Material.ts";
import type { Camera } from "../scene/Camera.ts";
import type { Stage } from "../scene/Stage.ts";

/** A geometry group, as the render hooks get it. */
export interface DrawGroup {
  start: number;
  count: number;
  materialIndex?: number;
}

let _object3DId = 0;

const _v1 = /*@__PURE__*/ new Vector3();
const _q1 = /*@__PURE__*/ new Quaternion();
const _m1 = /*@__PURE__*/ new Matrix4();
const _target = /*@__PURE__*/ new Vector3();

const _position = /*@__PURE__*/ new Vector3();
const _scale = /*@__PURE__*/ new Vector3();
const _quaternion = /*@__PURE__*/ new Quaternion();

const _xAxis = /*@__PURE__*/ new Vector3(1, 0, 0);
const _yAxis = /*@__PURE__*/ new Vector3(0, 1, 0);
const _zAxis = /*@__PURE__*/ new Vector3(0, 0, 1);

const _addedEvent: EmitterEvent = { type: "added" };
const _removedEvent: EmitterEvent = { type: "removed" };
const _childaddedEvent: EmitterEvent = { type: "childadded", child: null };
const _childremovedEvent: EmitterEvent = { type: "childremoved", child: null };

/** A thing in the scene graph with a transform (r180's Object3D). */
export class Node extends Emitter {
  static DEFAULT_UP = /*@__PURE__*/ new Vector3(0, 1, 0);
  static DEFAULT_MATRIX_AUTO_UPDATE = true;
  static DEFAULT_MATRIX_WORLD_AUTO_UPDATE = true;

  // (r180's flag, and KEEL's name for it)
  declare readonly isObject3D: true;
  declare readonly isNode: true;

  declare readonly id: number;
  declare uuid: string;
  declare name: string;
  declare type: string;
  declare parent: Node | null;
  declare children: Node[];
  declare up: Vector3;

  // (own, enumerable, not writable: as r180 defines them)
  declare readonly position: Vector3;
  declare readonly rotation: Euler;
  declare readonly quaternion: Quaternion;
  declare readonly scale: Vector3;
  declare readonly modelViewMatrix: Matrix4;
  declare readonly normalMatrix: Matrix3;

  declare matrix: Matrix4;
  declare matrixWorld: Matrix4;
  declare matrixAutoUpdate: boolean;
  /** Checked by the renderer. */
  declare matrixWorldAutoUpdate: boolean;
  declare matrixWorldNeedsUpdate: boolean;
  declare layers: Layers;
  declare visible: boolean;
  declare castShadow: boolean;
  declare receiveShadow: boolean;
  declare frustumCulled: boolean;
  declare renderOrder: number;
  declare animations: unknown[];
  declare customDepthMaterial: Material | undefined;
  declare customDistanceMaterial: Material | undefined;
  declare userData: Record<string, unknown>;

  constructor() {
    super();

    // (assigned in r180's order, so a node's own keys come out in r180's order)
    (this as { isObject3D: boolean }).isObject3D = true;
    (this as { isNode: boolean }).isNode = true;

    Object.defineProperty(this, "id", { value: _object3DId++ });

    this.uuid = generateUUID();
    this.name = "";
    this.type = "Node";
    this.parent = null;
    this.children = [];
    this.up = Node.DEFAULT_UP.clone();

    const position = new Vector3();
    const rotation = new Euler();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);

    function onRotationChange(): void {
      quaternion.setFromEuler(rotation, false);
    }

    function onQuaternionChange(): void {
      rotation.setFromQuaternion(quaternion, undefined, false);
    }

    rotation._onChange(onRotationChange);
    quaternion._onChange(onQuaternionChange);

    Object.defineProperties(this, {
      position: { configurable: true, enumerable: true, value: position },
      rotation: { configurable: true, enumerable: true, value: rotation },
      quaternion: { configurable: true, enumerable: true, value: quaternion },
      scale: { configurable: true, enumerable: true, value: scale },
      modelViewMatrix: { value: new Matrix4() },
      normalMatrix: { value: new Matrix3() },
    });

    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.matrixAutoUpdate = Node.DEFAULT_MATRIX_AUTO_UPDATE;
    this.matrixWorldAutoUpdate = Node.DEFAULT_MATRIX_WORLD_AUTO_UPDATE;
    this.matrixWorldNeedsUpdate = false;
    this.layers = new Layers();
    this.visible = true;
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = true;
    this.renderOrder = 0;
    this.animations = [];
    this.customDepthMaterial = undefined;
    this.customDistanceMaterial = undefined;
    this.userData = {};
  }

  // ---- the renderer's hooks (no-ops; assign your own)

  onBeforeShadow(_renderer: unknown, _object: Node, _camera: Camera, _shadowCamera: Camera, _geometry: Geometry, _depthMaterial: Material, _group: DrawGroup | null): void {}

  onAfterShadow(_renderer: unknown, _object: Node, _camera: Camera, _shadowCamera: Camera, _geometry: Geometry, _depthMaterial: Material, _group: DrawGroup | null): void {}

  onBeforeRender(_renderer: unknown, _scene: Stage, _camera: Camera, _geometry: Geometry, _material: Material, _group: DrawGroup | null): void {}

  onAfterRender(_renderer: unknown, _scene: Stage, _camera: Camera, _geometry: Geometry, _material: Material, _group: DrawGroup | null): void {}

  // ---- transforms

  applyMatrix4(matrix: Matrix4): void {
    if (this.matrixAutoUpdate) this.updateMatrix();

    this.matrix.premultiply(matrix);

    this.matrix.decompose(this.position, this.quaternion, this.scale);
  }

  applyQuaternion(q: Quaternion): this {
    this.quaternion.premultiply(q);
    return this;
  }

  /** (assumes axis is normalized) */
  setRotationFromAxisAngle(axis: Vector3, angle: number): void {
    this.quaternion.setFromAxisAngle(axis, angle);
  }

  setRotationFromEuler(euler: Euler): void {
    this.quaternion.setFromEuler(euler, true);
  }

  /** (assumes the upper 3x3 of m is a pure rotation matrix, unscaled) */
  setRotationFromMatrix(m: Matrix4): void {
    this.quaternion.setFromRotationMatrix(m);
  }

  /** (assumes q is normalized) */
  setRotationFromQuaternion(q: Quaternion): void {
    this.quaternion.copy(q);
  }

  /** Rotates about an axis in object space (axis normalized). */
  rotateOnAxis(axis: Vector3, angle: number): this {
    _q1.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(_q1);
    return this;
  }

  /** Rotates about an axis in world space (axis normalized; assumes no rotated parent). */
  rotateOnWorldAxis(axis: Vector3, angle: number): this {
    _q1.setFromAxisAngle(axis, angle);
    this.quaternion.premultiply(_q1);
    return this;
  }

  rotateX(angle: number): this {
    return this.rotateOnAxis(_xAxis, angle);
  }

  rotateY(angle: number): this {
    return this.rotateOnAxis(_yAxis, angle);
  }

  rotateZ(angle: number): this {
    return this.rotateOnAxis(_zAxis, angle);
  }

  /** Moves along an axis in object space (axis normalized). */
  translateOnAxis(axis: Vector3, distance: number): this {
    _v1.copy(axis).applyQuaternion(this.quaternion);
    this.position.add(_v1.multiplyScalar(distance));
    return this;
  }

  translateX(distance: number): this {
    return this.translateOnAxis(_xAxis, distance);
  }

  translateY(distance: number): this {
    return this.translateOnAxis(_yAxis, distance);
  }

  translateZ(distance: number): this {
    return this.translateOnAxis(_zAxis, distance);
  }

  localToWorld(vector: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(this.matrixWorld);
  }

  worldToLocal(vector: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(_m1.copy(this.matrixWorld).invert());
  }

  /**
   * Turns to face a world point (no non-uniformly scaled parents). A camera or
   * a light points its -z at it, anything else its +z, as r180 does.
   */
  lookAt(x: Vector3 | number, y?: number, z?: number): void {
    if (typeof x === "object" && x.isVector3) {
      _target.copy(x);
    } else {
      _target.set(x as number, y as number, z as number);
    }

    const parent = this.parent;

    this.updateWorldMatrix(true, false);

    _position.setFromMatrixPosition(this.matrixWorld);

    const flags = this as { isCamera?: boolean; isLight?: boolean };
    if (flags.isCamera || flags.isLight) {
      _m1.lookAt(_position, _target, this.up);
    } else {
      _m1.lookAt(_target, _position, this.up);
    }

    this.quaternion.setFromRotationMatrix(_m1);

    if (parent) {
      _m1.extractRotation(parent.matrixWorld);
      _q1.setFromRotationMatrix(_m1);
      this.quaternion.premultiply(_q1.invert());
    }
  }

  // ---- the graph

  add(...objects: Node[]): this {
    if (objects.length > 1) {
      for (let i = 0; i < objects.length; i++) {
        this.add(objects[i]!);
      }

      return this;
    }

    const object = objects[0];

    if (object === this) {
      console.error("keel/lit Node.add: object can't be added as a child of itself.", object);
      return this;
    }

    if (object && object.isObject3D) {
      object.removeFromParent();
      object.parent = this;
      this.children.push(object);

      object.dispatchEvent(_addedEvent);

      _childaddedEvent.child = object;
      this.dispatchEvent(_childaddedEvent);
      _childaddedEvent.child = null;
    } else {
      console.error("keel/lit Node.add: object not an instance of Node.", object);
    }

    return this;
  }

  remove(...objects: Node[]): this {
    if (objects.length > 1) {
      for (let i = 0; i < objects.length; i++) {
        this.remove(objects[i]!);
      }

      return this;
    }

    const object = objects[0];
    const index = this.children.indexOf(object as Node);

    if (index !== - 1) {
      object!.parent = null;
      this.children.splice(index, 1);

      object!.dispatchEvent(_removedEvent);

      _childremovedEvent.child = object;
      this.dispatchEvent(_childremovedEvent);
      _childremovedEvent.child = null;
    }

    return this;
  }

  removeFromParent(): this {
    const parent = this.parent;

    if (parent !== null) {
      parent.remove(this);
    }

    return this;
  }

  clear(): this {
    return this.remove(...this.children);
  }

  /** Adds a child keeping its world transform (no non-uniformly scaled nodes). */
  attach(object: Node): this {
    this.updateWorldMatrix(true, false);

    _m1.copy(this.matrixWorld).invert();

    if (object.parent !== null) {
      object.parent.updateWorldMatrix(true, false);
      _m1.multiply(object.parent.matrixWorld);
    }

    object.applyMatrix4(_m1);

    object.removeFromParent();
    object.parent = this;
    this.children.push(object);

    object.updateWorldMatrix(false, true);

    object.dispatchEvent(_addedEvent);

    _childaddedEvent.child = object;
    this.dispatchEvent(_childaddedEvent);
    _childaddedEvent.child = null;

    return this;
  }

  getObjectById(id: number): Node | undefined {
    return this.getObjectByProperty("id", id);
  }

  getObjectByName(name: string): Node | undefined {
    return this.getObjectByProperty("name", name);
  }

  getObjectByProperty(name: string, value: unknown): Node | undefined {
    if ((this as unknown as Record<string, unknown>)[name] === value) return this;

    for (let i = 0, l = this.children.length; i < l; i++) {
      const child = this.children[i]!;
      const object = child.getObjectByProperty(name, value);

      if (object !== undefined) {
        return object;
      }
    }

    return undefined;
  }

  getObjectsByProperty(name: string, value: unknown, result: Node[] = []): Node[] {
    if ((this as unknown as Record<string, unknown>)[name] === value) result.push(this);

    const children = this.children;

    for (let i = 0, l = children.length; i < l; i++) {
      children[i]!.getObjectsByProperty(name, value, result);
    }

    return result;
  }

  getWorldPosition(target: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.matrixWorld);
  }

  getWorldQuaternion(target: Quaternion): Quaternion {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_position, target, _scale);
    return target;
  }

  getWorldScale(target: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_position, _quaternion, target);
    return target;
  }

  getWorldDirection(target: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);

    const e = this.matrixWorld.elements;

    return target.set(e[8]!, e[9]!, e[10]!).normalize();
  }

  traverse(callback: (object: Node) => void): void {
    callback(this);

    const children = this.children;

    for (let i = 0, l = children.length; i < l; i++) {
      children[i]!.traverse(callback);
    }
  }

  traverseVisible(callback: (object: Node) => void): void {
    if (this.visible === false) return;

    callback(this);

    const children = this.children;

    for (let i = 0, l = children.length; i < l; i++) {
      children[i]!.traverseVisible(callback);
    }
  }

  traverseAncestors(callback: (object: Node) => void): void {
    const parent = this.parent;

    if (parent !== null) {
      callback(parent);
      parent.traverseAncestors(callback);
    }
  }

  // ---- matrices

  updateMatrix(): void {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }

  updateMatrixWorld(force?: boolean): void {
    if (this.matrixAutoUpdate) this.updateMatrix();

    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) {
          this.matrixWorld.copy(this.matrix);
        } else {
          this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
        }
      }

      this.matrixWorldNeedsUpdate = false;

      force = true;
    }

    // (descendants follow when this one changed)
    const children = this.children;

    for (let i = 0, l = children.length; i < l; i++) {
      const child = children[i]!;
      child.updateMatrixWorld(force);
    }
  }

  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void {
    const parent = this.parent;

    if (updateParents === true && parent !== null) {
      parent.updateWorldMatrix(true, false);
    }

    if (this.matrixAutoUpdate) this.updateMatrix();

    if (this.matrixWorldAutoUpdate === true) {
      if (this.parent === null) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
    }

    if (updateChildren === true) {
      const children = this.children;

      for (let i = 0, l = children.length; i < l; i++) {
        const child = children[i]!;
        child.updateWorldMatrix(false, true);
      }
    }
  }

  // ---- copies

  clone(recursive?: boolean): this {
    return new (this.constructor as new () => this)().copy(this, recursive);
  }

  copy(source: Node, recursive = true): this {
    this.name = source.name;

    this.up.copy(source.up);

    this.position.copy(source.position);
    this.rotation.order = source.rotation.order;
    this.quaternion.copy(source.quaternion);
    this.scale.copy(source.scale);

    this.matrix.copy(source.matrix);
    this.matrixWorld.copy(source.matrixWorld);

    this.matrixAutoUpdate = source.matrixAutoUpdate;

    this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
    this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;

    this.layers.mask = source.layers.mask;
    this.visible = source.visible;

    this.castShadow = source.castShadow;
    this.receiveShadow = source.receiveShadow;

    this.frustumCulled = source.frustumCulled;
    this.renderOrder = source.renderOrder;

    this.animations = source.animations.slice();

    this.userData = JSON.parse(JSON.stringify(source.userData)) as Record<string, unknown>;

    if (recursive === true) {
      for (let i = 0; i < source.children.length; i++) {
        const child = source.children[i]!;
        this.add(child.clone());
      }
    }

    return this;
  }
}
