// Ported from Three.js r180's materials/Material.js (MIT, see packages/lit/NOTICE).
// toJSON is not ported. r180's onBeforeCompile is onCompile here.

import { Color } from "../math/Color.ts";
import type { ColorRepresentation } from "../math/Color.ts";
import type { Plane } from "../math/Plane.ts";
import { generateUUID } from "../math/mathUtils.ts";
import { Emitter } from "../core/Emitter.ts";
import type { Node, DrawGroup } from "../core/Node.ts";
import type { Geometry } from "../core/Geometry.ts";
import type { Camera } from "../scene/Camera.ts";
import type { Stage } from "../scene/Stage.ts";
import type { Blending, BlendEquation, BlendFactor, CompareFunction, Side, StencilOp } from "../constants.ts";

/** What onCompile gets to edit: the program's source and uniforms, before it compiles (r180's shader object). */
export interface CompileShader {
  shaderName?: string;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
  defines?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

/** A material's settable fields, as its constructor and setValues take them (colours as anything Color.set reads). */
export type MaterialParameters<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K extends `is${string}` | `_${string}` | "id" | "uuid" | "version" | "needsUpdate" | "type" ? never : K]?:
    T[K] extends Color ? ColorRepresentation : T[K];
};

let _materialId = 0;

/** What every material shares (r180's Material). */
export class Material extends Emitter {
  readonly isMaterial = true;

  declare readonly id: number;

  uuid: string;
  name: string;
  type: string;

  blending: Blending;
  side: Side;
  vertexColors: boolean;

  opacity: number;
  transparent: boolean;
  alphaHash: boolean;

  blendSrc: BlendFactor;
  blendDst: BlendFactor;
  blendEquation: BlendEquation;
  blendSrcAlpha: BlendFactor | null;
  blendDstAlpha: BlendFactor | null;
  blendEquationAlpha: BlendEquation | null;
  blendColor: Color;
  blendAlpha: number;

  depthFunc: CompareFunction;
  depthTest: boolean;
  depthWrite: boolean;

  stencilWriteMask: number;
  stencilFunc: CompareFunction;
  stencilRef: number;
  stencilFuncMask: number;
  stencilFail: StencilOp;
  stencilZFail: StencilOp;
  stencilZPass: StencilOp;
  stencilWrite: boolean;

  clippingPlanes: Plane[] | null;
  clipIntersection: boolean;
  clipShadows: boolean;

  shadowSide: Side | null;

  colorWrite: boolean;

  precision: "highp" | "mediump" | "lowp" | null;

  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;

  dithering: boolean;

  alphaToCoverage: boolean;
  premultipliedAlpha: boolean;
  forceSinglePass: boolean;

  allowOverride: boolean;

  visible: boolean;

  toneMapped: boolean;

  userData: Record<string, unknown>;

  version: number;

  _alphaTest: number;

  constructor() {
    super();

    Object.defineProperty(this, "id", { value: _materialId++ });

    this.uuid = generateUUID();

    this.name = "";
    this.type = "Material";

    this.blending = "normal";
    this.side = "front";
    this.vertexColors = false;

    this.opacity = 1;
    this.transparent = false;
    this.alphaHash = false;

    this.blendSrc = "src-alpha";
    this.blendDst = "one-minus-src-alpha";
    this.blendEquation = "add";
    this.blendSrcAlpha = null;
    this.blendDstAlpha = null;
    this.blendEquationAlpha = null;
    this.blendColor = new Color(0, 0, 0);
    this.blendAlpha = 0;

    this.depthFunc = "less-equal";
    this.depthTest = true;
    this.depthWrite = true;

    this.stencilWriteMask = 0xff;
    this.stencilFunc = "always";
    this.stencilRef = 0;
    this.stencilFuncMask = 0xff;
    this.stencilFail = "keep";
    this.stencilZFail = "keep";
    this.stencilZPass = "keep";
    this.stencilWrite = false;

    this.clippingPlanes = null;
    this.clipIntersection = false;
    this.clipShadows = false;

    this.shadowSide = null;

    this.colorWrite = true;

    // (overrides the renderer's default precision for this material)
    this.precision = null;

    this.polygonOffset = false;
    this.polygonOffsetFactor = 0;
    this.polygonOffsetUnits = 0;

    this.dithering = false;

    this.alphaToCoverage = false;
    this.premultipliedAlpha = false;
    this.forceSinglePass = false;

    // (whether a stage's overrideMaterial may replace this one)
    this.allowOverride = true;

    this.visible = true;

    this.toneMapped = true;

    this.userData = {};

    this.version = 0;

    this._alphaTest = 0;
  }

  /** Fragments under this alpha are discarded. Crossing zero either way changes the program (version++). */
  get alphaTest(): number {
    return this._alphaTest;
  }

  set alphaTest(value: number) {
    if (this._alphaTest > 0 !== value > 0) {
      this.version++;
    }

    this._alphaTest = value;
  }

  // ---- the renderer's hooks (no-ops; assign your own)

  onBeforeRender(_renderer: unknown, _scene: Stage, _camera: Camera, _geometry: Geometry, _object: Node, _group: DrawGroup | null): void {}

  /** r180's onBeforeCompile: edit `shader.vertexShader` / `fragmentShader` / `uniforms` before the program compiles. */
  onCompile(_shader: CompileShader, _renderer: unknown): void {}

  /** Part of the program cache key: by default onCompile's source text (r180: onBeforeCompile's). */
  customProgramCacheKey(): string {
    return this.onCompile.toString();
  }

  setValues(values?: Record<string, unknown>): void {
    if (values === undefined) return;

    const self = this as unknown as Record<string, unknown>;

    for (const key in values) {
      const newValue = values[key];

      if (newValue === undefined) {
        console.warn(`keel/lit Material: parameter '${key}' has value of undefined.`);
        continue;
      }

      const currentValue = self[key] as { isColor?: boolean; isVector3?: boolean; set?: (v: unknown) => void; copy?: (v: unknown) => void } | undefined;

      if (currentValue === undefined) {
        console.warn(`keel/lit Material: '${key}' is not a property of ${this.type}.`);
        continue;
      }

      if (currentValue && currentValue.isColor) {
        (currentValue as unknown as Color).set(newValue as ColorRepresentation);
      } else if (currentValue && currentValue.isVector3 && newValue && (newValue as { isVector3?: boolean }).isVector3) {
        currentValue.copy!(newValue);
      } else {
        self[key] = newValue;
      }
    }
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  copy(source: Material): this {
    this.name = source.name;

    this.blending = source.blending;
    this.side = source.side;
    this.vertexColors = source.vertexColors;

    this.opacity = source.opacity;
    this.transparent = source.transparent;

    this.blendSrc = source.blendSrc;
    this.blendDst = source.blendDst;
    this.blendEquation = source.blendEquation;
    this.blendSrcAlpha = source.blendSrcAlpha;
    this.blendDstAlpha = source.blendDstAlpha;
    this.blendEquationAlpha = source.blendEquationAlpha;
    this.blendColor.copy(source.blendColor);
    this.blendAlpha = source.blendAlpha;

    this.depthFunc = source.depthFunc;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;

    this.stencilWriteMask = source.stencilWriteMask;
    this.stencilFunc = source.stencilFunc;
    this.stencilRef = source.stencilRef;
    this.stencilFuncMask = source.stencilFuncMask;
    this.stencilFail = source.stencilFail;
    this.stencilZFail = source.stencilZFail;
    this.stencilZPass = source.stencilZPass;
    this.stencilWrite = source.stencilWrite;

    const srcPlanes = source.clippingPlanes;
    let dstPlanes: Plane[] | null = null;

    if (srcPlanes !== null) {
      const n = srcPlanes.length;
      dstPlanes = new Array<Plane>(n);

      for (let i = 0; i !== n; ++i) {
        dstPlanes[i] = srcPlanes[i]!.clone();
      }
    }

    this.clippingPlanes = dstPlanes;
    this.clipIntersection = source.clipIntersection;
    this.clipShadows = source.clipShadows;

    this.shadowSide = source.shadowSide;

    this.colorWrite = source.colorWrite;

    this.precision = source.precision;

    this.polygonOffset = source.polygonOffset;
    this.polygonOffsetFactor = source.polygonOffsetFactor;
    this.polygonOffsetUnits = source.polygonOffsetUnits;

    this.dithering = source.dithering;

    this.alphaTest = source.alphaTest;
    this.alphaHash = source.alphaHash;
    this.alphaToCoverage = source.alphaToCoverage;
    this.premultipliedAlpha = source.premultipliedAlpha;
    this.forceSinglePass = source.forceSinglePass;

    this.visible = source.visible;

    this.toneMapped = source.toneMapped;

    this.userData = JSON.parse(JSON.stringify(source.userData)) as Record<string, unknown>;

    return this;
  }

  dispose(): void {
    this.dispatchEvent({ type: "dispose" });
  }

  set needsUpdate(value: boolean) {
    if (value === true) this.version++;
  }
}
