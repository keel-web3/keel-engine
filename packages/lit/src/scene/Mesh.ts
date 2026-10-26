// Ported from Three.js r180's objects/Mesh.js (MIT, see packages/lit/NOTICE).
// raycast is not ported.

import { Vector3 } from "../math/Vector3.ts";
import { Node } from "../core/Node.ts";
import { Geometry } from "../core/Geometry.ts";
import type { Material } from "../material/Material.ts";
import { FlatMaterial } from "../material/FlatMaterial.ts";

const _tempA = /*@__PURE__*/ new Vector3();
const _morphA = /*@__PURE__*/ new Vector3();

/** Triangles: a geometry drawn with a material (or one per geometry group). */
export class Mesh<G extends Geometry = Geometry, M extends Material | Material[] = Material | Material[]> extends Node {
  readonly isMesh = true;

  geometry: G;
  material: M;

  morphTargetDictionary: Record<string, number> | undefined;
  morphTargetInfluences: number[] | undefined;

  count: number;

  constructor(geometry: G = new Geometry() as G, material: M = new FlatMaterial() as unknown as M) {
    super();

    this.type = "Mesh";

    this.geometry = geometry;
    this.material = material;

    this.morphTargetDictionary = undefined;
    this.morphTargetInfluences = undefined;

    this.count = 1;

    this.updateMorphTargets();
  }

  override copy(source: Mesh<G, M>, recursive?: boolean): this {
    super.copy(source, recursive);

    if (source.morphTargetInfluences !== undefined) {
      this.morphTargetInfluences = source.morphTargetInfluences.slice();
    }

    if (source.morphTargetDictionary !== undefined) {
      this.morphTargetDictionary = Object.assign({}, source.morphTargetDictionary);
    }

    this.material = (Array.isArray(source.material) ? source.material.slice() : source.material) as M;
    this.geometry = source.geometry;

    return this;
  }

  /** One influence (0) per morph target of the geometry's first morph attribute. */
  updateMorphTargets(): void {
    const geometry = this.geometry;

    const morphAttributes = geometry.morphAttributes;
    const keys = Object.keys(morphAttributes);

    if (keys.length > 0) {
      const morphAttribute = morphAttributes[keys[0]!];

      if (morphAttribute !== undefined) {
        this.morphTargetInfluences = [];
        this.morphTargetDictionary = {};

        for (let m = 0, ml = morphAttribute.length; m < ml; m++) {
          const name = morphAttribute[m]!.name || String(m);

          this.morphTargetInfluences.push(0);
          this.morphTargetDictionary[name] = m;
        }
      }
    }
  }

  /** A vertex's position with the morph targets applied (what Box3.setFromObject's precise path reads). */
  getVertexPosition(index: number, target: Vector3): Vector3 {
    const geometry = this.geometry;
    const position = geometry.attributes["position"]!;
    const morphPosition = geometry.morphAttributes["position"];
    const morphTargetsRelative = geometry.morphTargetsRelative;

    target.fromBufferAttribute(position, index);

    const morphInfluences = this.morphTargetInfluences;

    if (morphPosition && morphInfluences) {
      _morphA.set(0, 0, 0);

      for (let i = 0, il = morphPosition.length; i < il; i++) {
        const influence = morphInfluences[i]!;
        const morphAttribute = morphPosition[i]!;

        if (influence === 0) continue;

        _tempA.fromBufferAttribute(morphAttribute, index);

        if (morphTargetsRelative) {
          _morphA.addScaledVector(_tempA, influence);
        } else {
          _morphA.addScaledVector(_tempA.sub(target), influence);
        }
      }

      target.add(_morphA);
    }

    return target;
  }
}
