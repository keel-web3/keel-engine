// Ported from Three.js r180's renderers/webgl/WebGLLights.js (MIT, see
// packages/lit/NOTICE).
//
// The lights' uniform state: setup() sums the ambient lights and fills one
// struct per sun (SunLight, r180's DirectionalLight) and sky (SkyLight, r180's
// HemisphereLight) in r180's order (shadow casters first), with the shadow
// structs, maps and matrices; setupView() turns the directions into view
// space. The state's `hash` and `version` move only when a count changes, as
// r180's do, so programs recompile exactly when r180's would.
//
// Dropped (keel/lit has no such lights): spot, point and rect area lights and
// light probes. Their arrays and counts stay in the state, always empty (the
// probe's nine coefficients stay zero), so the program parameters and the
// uniforms come out as r180's for a scene without them. The uniform caches are
// keyed by r180's light kinds through the is* flags (r180 switches on
// `light.type`, which is KEEL's name here).

import { Color } from "../math/Color.ts";
import { Matrix4 } from "../math/Matrix4.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";

/** A light, as setup and setupView read it (the scene's AmbientLight, SkyLight and SunLight fit). */
export interface LightLike {
  readonly id: number;
  readonly color: Color;
  readonly intensity: number;
  readonly matrixWorld: Matrix4;
  readonly castShadow: boolean;
  readonly isAmbientLight?: boolean;
  readonly isDirectionalLight?: boolean;
  readonly isHemisphereLight?: boolean;
  readonly isLightProbe?: boolean;
  readonly isSpotLight?: boolean;
  readonly isPointLight?: boolean;
  readonly isRectAreaLight?: boolean;
  readonly distance?: number;
  readonly map?: unknown;
  readonly groundColor?: Color;
  readonly target?: { readonly matrixWorld: Matrix4 };
  readonly shadow?: {
    readonly intensity: number;
    readonly bias: number;
    readonly normalBias: number;
    readonly radius: number;
    readonly mapSize: Vector2;
    readonly matrix: Matrix4;
    readonly map: { readonly texture: unknown } | null;
  };
}

export interface DirectionalUniforms {
  direction: Vector3;
  color: Color;
}

export interface HemisphereUniforms {
  direction: Vector3;
  skyColor: Color;
  groundColor: Color;
}

export interface ShadowUniforms {
  shadowIntensity: number;
  shadowBias: number;
  shadowNormalBias: number;
  shadowRadius: number;
  shadowMapSize: Vector2;
}

/** r180's lights state: the light uniforms programs read, and the counts their parameters take. */
export interface LightsState {
  version: number;

  hash: {
    directionalLength: number;
    pointLength: number;
    spotLength: number;
    rectAreaLength: number;
    hemiLength: number;

    numDirectionalShadows: number;
    numPointShadows: number;
    numSpotShadows: number;
    numSpotMaps: number;

    numLightProbes: number;
  };

  ambient: number[];
  probe: Vector3[];
  directional: DirectionalUniforms[];
  directionalShadow: ShadowUniforms[];
  directionalShadowMap: unknown[];
  directionalShadowMatrix: Matrix4[];
  spot: unknown[];
  spotLightMap: unknown[];
  spotShadow: unknown[];
  spotShadowMap: unknown[];
  spotLightMatrix: unknown[];
  rectArea: unknown[];
  rectAreaLTC1: unknown;
  rectAreaLTC2: unknown;
  point: unknown[];
  pointShadow: unknown[];
  pointShadowMap: unknown[];
  pointShadowMatrix: unknown[];
  hemi: HemisphereUniforms[];
  numSpotLightShadowsWithMaps: number;
  numLightProbes: number;
}

export interface Lights {
  setup(lights: LightLike[]): void;
  setupView(lights: readonly LightLike[], camera: { readonly matrixWorldInverse: Matrix4 }): void;
  state: LightsState;
}

export interface LightsExtensions {
  has(name: string): boolean;
}

function UniformsCache() {
  const lights: Record<number, DirectionalUniforms | HemisphereUniforms> = {};

  return {
    get: function (light: LightLike): DirectionalUniforms | HemisphereUniforms {
      if (lights[light.id] !== undefined) {
        return lights[light.id]!;
      }

      let uniforms: DirectionalUniforms | HemisphereUniforms;

      // (r180's switch on light.type: 'DirectionalLight', 'HemisphereLight'; the dropped kinds below)
      if (light.isDirectionalLight === true) {
        uniforms = {
          direction: new Vector3(),
          color: new Color(),
        };
      } else {
        uniforms = {
          direction: new Vector3(),
          skyColor: new Color(),
          groundColor: new Color(),
        };
      }

      lights[light.id] = uniforms;

      return uniforms;
    },
  };
}

function ShadowUniformsCache() {
  const lights: Record<number, ShadowUniforms> = {};

  return {
    get: function (light: LightLike): ShadowUniforms {
      if (lights[light.id] !== undefined) {
        return lights[light.id]!;
      }

      // (r180's 'DirectionalLight' case; spot and point lights are not ported)
      const uniforms: ShadowUniforms = {
        shadowIntensity: 1,
        shadowBias: 0,
        shadowNormalBias: 0,
        shadowRadius: 1,
        shadowMapSize: new Vector2(),
      };

      lights[light.id] = uniforms;

      return uniforms;
    },
  };
}

let nextVersion = 0;

function shadowCastingAndTexturingLightsFirst(lightA: LightLike, lightB: LightLike): number {
  return (lightB.castShadow ? 2 : 0) - (lightA.castShadow ? 2 : 0) + (lightB.map ? 1 : 0) - (lightA.map ? 1 : 0);
}

/** r180's WebGLLights. */
export function createLights(_extensions: LightsExtensions): Lights {
  const cache = UniformsCache();

  const shadowCache = ShadowUniformsCache();

  const state: LightsState = {
    version: 0,

    hash: {
      directionalLength: -1,
      pointLength: -1,
      spotLength: -1,
      rectAreaLength: -1,
      hemiLength: -1,

      numDirectionalShadows: -1,
      numPointShadows: -1,
      numSpotShadows: -1,
      numSpotMaps: -1,

      numLightProbes: -1,
    },

    ambient: [0, 0, 0],
    probe: [],
    directional: [],
    directionalShadow: [],
    directionalShadowMap: [],
    directionalShadowMatrix: [],
    spot: [],
    spotLightMap: [],
    spotShadow: [],
    spotShadowMap: [],
    spotLightMatrix: [],
    rectArea: [],
    rectAreaLTC1: null,
    rectAreaLTC2: null,
    point: [],
    pointShadow: [],
    pointShadowMap: [],
    pointShadowMatrix: [],
    hemi: [],
    numSpotLightShadowsWithMaps: 0,
    numLightProbes: 0,
  };

  for (let i = 0; i < 9; i++) state.probe.push(new Vector3());

  const vector3 = new Vector3();

  function setup(lights: LightLike[]): void {
    let r = 0, g = 0, b = 0;

    for (let i = 0; i < 9; i++) state.probe[i]!.set(0, 0, 0);

    let directionalLength = 0;
    const pointLength = 0;
    const spotLength = 0;
    const rectAreaLength = 0;
    let hemiLength = 0;

    let numDirectionalShadows = 0;
    const numPointShadows = 0;
    const numSpotShadows = 0;
    const numSpotMaps = 0;
    const numSpotShadowsWithMaps = 0;

    const numLightProbes = 0;

    // ordering : [shadow casting + map texturing, map texturing, shadow casting, none ]
    lights.sort(shadowCastingAndTexturingLightsFirst);

    for (let i = 0, l = lights.length; i < l; i++) {
      const light = lights[i]!;

      const color = light.color;
      const intensity = light.intensity;

      const shadowMap = (light.shadow && light.shadow.map) ? light.shadow.map.texture : null;

      if (light.isAmbientLight) {
        r += color.r * intensity;
        g += color.g * intensity;
        b += color.b * intensity;
      } else if (light.isDirectionalLight) {
        const uniforms = cache.get(light) as DirectionalUniforms;

        uniforms.color.copy(light.color).multiplyScalar(light.intensity);

        if (light.castShadow) {
          const shadow = light.shadow!;

          const shadowUniforms = shadowCache.get(light);

          shadowUniforms.shadowIntensity = shadow.intensity;
          shadowUniforms.shadowBias = shadow.bias;
          shadowUniforms.shadowNormalBias = shadow.normalBias;
          shadowUniforms.shadowRadius = shadow.radius;
          shadowUniforms.shadowMapSize = shadow.mapSize;

          state.directionalShadow[directionalLength] = shadowUniforms;
          state.directionalShadowMap[directionalLength] = shadowMap;
          state.directionalShadowMatrix[directionalLength] = light.shadow!.matrix;

          numDirectionalShadows++;
        }

        state.directional[directionalLength] = uniforms;

        directionalLength++;
      } else if (light.isHemisphereLight) {
        const uniforms = cache.get(light) as HemisphereUniforms;

        uniforms.skyColor.copy(light.color).multiplyScalar(intensity);
        uniforms.groundColor.copy(light.groundColor!).multiplyScalar(intensity);

        state.hemi[hemiLength] = uniforms;

        hemiLength++;
      }
      // (light probes, spot, rect area and point lights: not ported, see the header)
    }

    state.ambient[0] = r;
    state.ambient[1] = g;
    state.ambient[2] = b;

    const hash = state.hash;

    if (hash.directionalLength !== directionalLength ||
      hash.pointLength !== pointLength ||
      hash.spotLength !== spotLength ||
      hash.rectAreaLength !== rectAreaLength ||
      hash.hemiLength !== hemiLength ||
      hash.numDirectionalShadows !== numDirectionalShadows ||
      hash.numPointShadows !== numPointShadows ||
      hash.numSpotShadows !== numSpotShadows ||
      hash.numSpotMaps !== numSpotMaps ||
      hash.numLightProbes !== numLightProbes) {
      state.directional.length = directionalLength;
      state.spot.length = spotLength;
      state.rectArea.length = rectAreaLength;
      state.point.length = pointLength;
      state.hemi.length = hemiLength;

      state.directionalShadow.length = numDirectionalShadows;
      state.directionalShadowMap.length = numDirectionalShadows;
      state.pointShadow.length = numPointShadows;
      state.pointShadowMap.length = numPointShadows;
      state.spotShadow.length = numSpotShadows;
      state.spotShadowMap.length = numSpotShadows;
      state.directionalShadowMatrix.length = numDirectionalShadows;
      state.pointShadowMatrix.length = numPointShadows;
      state.spotLightMatrix.length = numSpotShadows + numSpotMaps - numSpotShadowsWithMaps;
      state.spotLightMap.length = numSpotMaps;
      state.numSpotLightShadowsWithMaps = numSpotShadowsWithMaps;
      state.numLightProbes = numLightProbes;

      hash.directionalLength = directionalLength;
      hash.pointLength = pointLength;
      hash.spotLength = spotLength;
      hash.rectAreaLength = rectAreaLength;
      hash.hemiLength = hemiLength;

      hash.numDirectionalShadows = numDirectionalShadows;
      hash.numPointShadows = numPointShadows;
      hash.numSpotShadows = numSpotShadows;
      hash.numSpotMaps = numSpotMaps;

      hash.numLightProbes = numLightProbes;

      state.version = nextVersion++;
    }
  }

  function setupView(lights: readonly LightLike[], camera: { readonly matrixWorldInverse: Matrix4 }): void {
    let directionalLength = 0;
    let hemiLength = 0;

    const viewMatrix = camera.matrixWorldInverse;

    for (let i = 0, l = lights.length; i < l; i++) {
      const light = lights[i]!;

      if (light.isDirectionalLight) {
        const uniforms = state.directional[directionalLength]!;

        uniforms.direction.setFromMatrixPosition(light.matrixWorld);
        vector3.setFromMatrixPosition(light.target!.matrixWorld);
        uniforms.direction.sub(vector3);
        uniforms.direction.transformDirection(viewMatrix);

        directionalLength++;
      } else if (light.isHemisphereLight) {
        const uniforms = state.hemi[hemiLength]!;

        uniforms.direction.setFromMatrixPosition(light.matrixWorld);
        uniforms.direction.transformDirection(viewMatrix);

        hemiLength++;
      }
      // (spot, rect area and point lights: not ported, see the header)
    }
  }

  return {
    setup: setup,
    setupView: setupView,
    state: state,
  };
}
