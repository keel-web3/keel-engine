// Ported from Three.js r180's objects/InstancedMesh.js (MIT, see packages/lit/NOTICE).
// raycast is not ported.

import { Box3 } from "../math/Box3.ts";
import { Matrix4 } from "../math/Matrix4.ts";
import { Sphere } from "../math/Sphere.ts";
import type { Color } from "../math/Color.ts";
import { InstanceAttribute } from "../core/Attribute.ts";
import type { Geometry } from "../core/Geometry.ts";
import type { Material } from "../material/Material.ts";
import { DataTexture } from "../texture/DataTexture.ts";
import type { DataImage } from "../texture/Source.ts";
import { Mesh } from "./Mesh.ts";

const _instanceLocalMatrix = /*@__PURE__*/ new Matrix4();
const _box3 = /*@__PURE__*/ new Box3();
const _identity = /*@__PURE__*/ new Matrix4();
const _sphere = /*@__PURE__*/ new Sphere();

/**
 * One geometry drawn `count` times, each with its own matrix and, once
 * setColorAt is called, its own colour (r180's InstancedMesh). The matrices
 * are a Float32Array of count * 16, column-major, identity to start; the
 * colours a Float32Array of count * 3 in the working (linear) colour space,
 * white to start. Set `instanceMatrix.needsUpdate` / `instanceColor.needsUpdate`
 * after changing them.
 */
export class Instances<G extends Geometry = Geometry, M extends Material | Material[] = Material | Material[]> extends Mesh<G, M> {
  readonly isInstancedMesh = true;
  // (KEEL's name for the same flag)
  readonly isInstances = true;

  instanceMatrix: InstanceAttribute<Float32Array>;
  instanceColor: InstanceAttribute<Float32Array> | null;
  morphTexture: DataTexture | null;

  boundingBox: Box3 | null;
  boundingSphere: Sphere | null;

  constructor(geometry: G | undefined, material: M | undefined, count: number) {
    super(geometry, material);

    this.type = "Instances";

    this.instanceMatrix = new InstanceAttribute(new Float32Array(count * 16), 16);
    this.instanceColor = null;
    this.morphTexture = null;

    this.count = count;

    this.boundingBox = null;
    this.boundingSphere = null;

    for (let i = 0; i < count; i++) {
      this.setMatrixAt(i, _identity);
    }
  }

  /** The union of every instance's box (in this mesh's space). */
  computeBoundingBox(): void {
    const geometry = this.geometry;
    const count = this.count;

    if (this.boundingBox === null) {
      this.boundingBox = new Box3();
    }

    if (geometry.boundingBox === null) {
      geometry.computeBoundingBox();
    }

    this.boundingBox.makeEmpty();

    for (let i = 0; i < count; i++) {
      this.getMatrixAt(i, _instanceLocalMatrix);

      _box3.copy(geometry.boundingBox!).applyMatrix4(_instanceLocalMatrix);

      this.boundingBox.union(_box3);
    }
  }

  /** The union of every instance's sphere (in this mesh's space). */
  computeBoundingSphere(): void {
    const geometry = this.geometry;
    const count = this.count;

    if (this.boundingSphere === null) {
      this.boundingSphere = new Sphere();
    }

    if (geometry.boundingSphere === null) {
      geometry.computeBoundingSphere();
    }

    this.boundingSphere.makeEmpty();

    for (let i = 0; i < count; i++) {
      this.getMatrixAt(i, _instanceLocalMatrix);

      _sphere.copy(geometry.boundingSphere!).applyMatrix4(_instanceLocalMatrix);

      this.boundingSphere.union(_sphere);
    }
  }

  override copy(source: Instances<G, M>, recursive?: boolean): this {
    super.copy(source, recursive);

    this.instanceMatrix.copy(source.instanceMatrix);

    if (source.morphTexture !== null) this.morphTexture = source.morphTexture.clone();
    if (source.instanceColor !== null) this.instanceColor = source.instanceColor.clone();

    this.count = source.count;

    if (source.boundingBox !== null) this.boundingBox = source.boundingBox.clone();
    if (source.boundingSphere !== null) this.boundingSphere = source.boundingSphere.clone();

    return this;
  }

  getColorAt(index: number, color: Color): void {
    color.fromArray(this.instanceColor!.array, index * 3);
  }

  getMatrixAt(index: number, matrix: Matrix4): void {
    matrix.fromArray(this.instanceMatrix.array, index * 16);
  }

  /** Reads instance `index`'s morph influences into `object.morphTargetInfluences`. */
  getMorphAt(index: number, object: Mesh): void {
    const objectInfluences = object.morphTargetInfluences!;

    const data = (this.morphTexture!.source.data as DataImage).data as Float32Array;

    // (all influences, plus the base influence sum first)
    const len = objectInfluences.length + 1;
    const dataIndex = index * len + 1;

    for (let i = 0; i < objectInfluences.length; i++) {
      objectInfluences[i] = data[dataIndex + i]!;
    }
  }

  /** The colour (its r, g, b as they are: linear) of instance `index`. Makes instanceColor (white) the first time. */
  setColorAt(index: number, color: Color): void {
    if (this.instanceColor === null) {
      this.instanceColor = new InstanceAttribute(new Float32Array(this.instanceMatrix.count * 3).fill(1), 3);
    }

    color.toArray(this.instanceColor.array, index * 3);
  }

  setMatrixAt(index: number, matrix: Matrix4): void {
    matrix.toArray(this.instanceMatrix.array, index * 16);
  }

  /** Stores `object.morphTargetInfluences` as instance `index`'s (a red float DataTexture, one row per instance). */
  setMorphAt(index: number, object: Mesh): void {
    const objectInfluences = object.morphTargetInfluences!;

    // (the base influence, then every influence)
    const len = objectInfluences.length + 1;

    if (this.morphTexture === null) {
      this.morphTexture = new DataTexture(new Float32Array(len * this.count), len, this.count, "red", "float");
    }

    const array = (this.morphTexture.source.data as DataImage).data as Float32Array;

    let morphInfluencesSum = 0;

    for (let i = 0; i < objectInfluences.length; i++) {
      morphInfluencesSum += objectInfluences[i]!;
    }

    const morphBaseInfluence = this.geometry.morphTargetsRelative ? 1 : 1 - morphInfluencesSum;

    const dataIndex = len * index;

    array[dataIndex] = morphBaseInfluence;

    array.set(objectInfluences, dataIndex + 1);
  }

  // (instances keep no per-mesh morph targets)
  override updateMorphTargets(): void {}

  dispose(): void {
    this.dispatchEvent({ type: "dispose" });

    if (this.morphTexture !== null) {
      this.morphTexture.dispose();
      this.morphTexture = null;
    }
  }
}
