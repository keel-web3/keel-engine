// Ported from Three.js r180's objects/Sprite.js (MIT, see packages/lit/NOTICE).
// raycast is not ported. r180 interleaves the shared quad's position and uv in
// one buffer; here they are two plain attributes holding the same numbers.

import { Vector2 } from "../math/Vector2.ts";
import { Node } from "../core/Node.ts";
import { Geometry } from "../core/Geometry.ts";
import { Attribute } from "../core/Attribute.ts";
import { BillboardMaterial } from "../material/BillboardMaterial.ts";

let _geometry: Geometry | undefined;

/** A quad that always faces the camera (r180's Sprite). All billboards share one geometry. */
export class Billboard extends Node {
  readonly isSprite = true;
  // (KEEL's name for the same flag)
  readonly isBillboard = true;

  geometry: Geometry;
  material: BillboardMaterial;

  /** Where the quad hangs from its position, in its own [0, 1] square ((0.5, 0.5): centred). */
  center: Vector2;

  count: number;

  constructor(material: BillboardMaterial = new BillboardMaterial()) {
    super();

    this.type = "Billboard";

    if (_geometry === undefined) {
      _geometry = new Geometry();

      // (r180's interleaved quad: x, y, z, u, v per corner)
      const position = new Float32Array([
        - 0.5, - 0.5, 0,
        0.5, - 0.5, 0,
        0.5, 0.5, 0,
        - 0.5, 0.5, 0,
      ]);
      const uv = new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
      ]);

      _geometry.setIndex([0, 1, 2, 0, 2, 3]);
      _geometry.setAttribute("position", new Attribute(position, 3, false));
      _geometry.setAttribute("uv", new Attribute(uv, 2, false));
    }

    this.geometry = _geometry;
    this.material = material;

    this.center = new Vector2(0.5, 0.5);

    this.count = 1;
  }

  override copy(source: Billboard, recursive?: boolean): this {
    super.copy(source, recursive);

    if (source.center !== undefined) this.center.copy(source.center);

    this.material = source.material;

    return this;
  }
}
