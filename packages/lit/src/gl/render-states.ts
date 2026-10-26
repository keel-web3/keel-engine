// Ported from Three.js r180's renderers/webgl/WebGLRenderStates.js (MIT, see
// packages/lit/NOTICE). Per stage and render depth: the camera, the lights
// and shadow casters a frame collected, and their uniform state.

import { createLights } from "./lights.ts";
import type { LightLike, Lights, LightsExtensions } from "./lights.ts";
import type { Matrix4 } from "../math/Matrix4.ts";

export interface RenderStateCamera {
  readonly id: number;
  readonly matrixWorldInverse: Matrix4;
}

export interface RenderState {
  init(camera: RenderStateCamera): void;
  state: {
    lightsArray: LightLike[];
    shadowsArray: LightLike[];

    camera: RenderStateCamera | null;

    lights: Lights;

    /** The transmission pass's target per camera id (keel/lit does not draw transmission; kept for r180's shape). */
    transmissionRenderTarget: Record<number, unknown>;
  };
  setupLights(): void;
  setupLightsView(camera: RenderStateCamera): void;

  pushLight(light: LightLike): void;
  pushShadow(shadowLight: LightLike): void;
}

/** r180's WebGLRenderState. */
export function createRenderState(extensions: LightsExtensions): RenderState {
  const lights = createLights(extensions);

  const lightsArray: LightLike[] = [];
  const shadowsArray: LightLike[] = [];

  function init(camera: RenderStateCamera): void {
    state.camera = camera;

    lightsArray.length = 0;
    shadowsArray.length = 0;
  }

  function pushLight(light: LightLike): void {
    lightsArray.push(light);
  }

  function pushShadow(shadowLight: LightLike): void {
    shadowsArray.push(shadowLight);
  }

  function setupLights(): void {
    lights.setup(lightsArray);
  }

  function setupLightsView(camera: RenderStateCamera): void {
    lights.setupView(lightsArray, camera);
  }

  const state: RenderState["state"] = {
    lightsArray: lightsArray,
    shadowsArray: shadowsArray,

    camera: null,

    lights: lights,

    transmissionRenderTarget: {},
  };

  return {
    init: init,
    state: state,
    setupLights: setupLights,
    setupLightsView: setupLightsView,

    pushLight: pushLight,
    pushShadow: pushShadow,
  };
}

export interface RenderStates {
  get(scene: object, renderCallDepth?: number): RenderState;
  dispose(): void;
}

/** r180's WebGLRenderStates. */
export function createRenderStates(extensions: LightsExtensions): RenderStates {
  let renderStates = new WeakMap<object, RenderState[]>();

  function get(scene: object, renderCallDepth = 0): RenderState {
    const renderStateArray = renderStates.get(scene);
    let renderState: RenderState;

    if (renderStateArray === undefined) {
      renderState = createRenderState(extensions);
      renderStates.set(scene, [renderState]);
    } else {
      if (renderCallDepth >= renderStateArray.length) {
        renderState = createRenderState(extensions);
        renderStateArray.push(renderState);
      } else {
        renderState = renderStateArray[renderCallDepth]!;
      }
    }

    return renderState;
  }

  function dispose(): void {
    renderStates = new WeakMap();
  }

  return {
    get: get,
    dispose: dispose,
  };
}
