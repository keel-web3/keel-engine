// Ported from Three.js r180's materials/ShaderMaterial.js (MIT, see packages/lit/NOTICE).

import { Material } from "./Material.ts";
import type { MaterialParameters } from "./Material.ts";
import { cloneUniforms, cloneUniformsGroups } from "../shader/uniforms.ts";
import type { Uniforms } from "../shader/uniforms.ts";
import type { GlslVersion } from "../constants.ts";

// (r180's ShaderChunk default_vertex and default_fragment, text for text)
const default_vertex = /* glsl */ `
void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const default_fragment = /* glsl */ `
void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}
`;

/** A uniform buffer block (r180's UniformsGroup), as far as the material needs it. */
export interface UniformsGroupLike {
  clone(): UniformsGroupLike;
}

export interface ShaderExtensions {
  /** Vertex shader clipping. */
  clipCullDistance: boolean;
  /** multi_draw and gl_DrawID. */
  multiDraw: boolean;
}

/** A material from your own GLSL (r180's ShaderMaterial). */
export class CustomMaterial extends Material {
  readonly isShaderMaterial = true;
  // (KEEL's name for the same flag)
  readonly isCustomMaterial = true;

  defines: Record<string, unknown>;
  uniforms: Uniforms;
  uniformsGroups: UniformsGroupLike[];

  vertexShader: string;
  fragmentShader: string;

  linewidth: number;

  wireframe: boolean;
  wireframeLinewidth: number;

  /** Whether the program reads the stage's fog. */
  fog: boolean;
  /** Whether the program reads the lights. */
  lights: boolean;
  /** Whether the program takes the renderer's clipping planes. */
  clipping: boolean;

  extensions: ShaderExtensions;

  /** Values for attributes the geometry lacks. */
  defaultAttributeValues: Record<string, number[]>;

  /** Binds this attribute to location 0 (r180: `undefined` by default). */
  index0AttributeName: string | undefined;
  uniformsNeedUpdate: boolean;

  glslVersion: GlslVersion | null;

  constructor(parameters?: MaterialParameters<CustomMaterial>) {
    super();

    this.type = "CustomMaterial";

    this.defines = {};
    this.uniforms = {};
    this.uniformsGroups = [];

    this.vertexShader = default_vertex;
    this.fragmentShader = default_fragment;

    this.linewidth = 1;

    this.wireframe = false;
    this.wireframeLinewidth = 1;

    this.fog = false;
    this.lights = false;
    this.clipping = false;

    this.forceSinglePass = true;

    this.extensions = {
      clipCullDistance: false,
      multiDraw: false,
    };

    this.defaultAttributeValues = {
      color: [1, 1, 1],
      uv: [0, 0],
      uv1: [0, 0],
    };

    this.index0AttributeName = undefined;
    this.uniformsNeedUpdate = false;

    this.glslVersion = null;

    if (parameters !== undefined) {
      this.setValues(parameters);
    }
  }

  override copy(source: CustomMaterial): this {
    super.copy(source);

    this.fragmentShader = source.fragmentShader;
    this.vertexShader = source.vertexShader;

    this.uniforms = cloneUniforms(source.uniforms);
    this.uniformsGroups = cloneUniformsGroups(source.uniformsGroups);

    this.defines = Object.assign({}, source.defines);

    this.wireframe = source.wireframe;
    this.wireframeLinewidth = source.wireframeLinewidth;

    this.fog = source.fog;
    this.lights = source.lights;
    this.clipping = source.clipping;

    this.extensions = Object.assign({}, source.extensions);

    this.glslVersion = source.glslVersion;

    return this;
  }
}
