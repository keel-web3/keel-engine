// Ported from Three.js r180's renderers/webgl/WebGLBackground.js (MIT, see
// packages/lit/NOTICE). The clear colour and alpha, and a stage's colour
// background: render() clears to it (in the unlit uniform colour space, as
// r180 converts it) before the frame draws.
//
// Dropped: texture and cube-texture backgrounds (r180 draws them as a plane
// or a box mesh with its background shaders, which keel/lit's shader library
// does not carry). addToRenderList warns once and adds nothing for them;
// render() still treats them as r180 does (no background clear colour, the
// autoClear clear). XR is not ported: r180's environment blend mode is
// undefined without an XR session, which is the only case here.

import { Color } from "../math/Color.ts";
import type { ColorRepresentation } from "../math/Color.ts";
import { getUnlitUniformColorSpace } from "./materials.ts";
import type { UnlitColorSpaceRenderer } from "./materials.ts";

const _rgb = { r: 0, b: 0, g: 0 };

/** What the background needs of the renderer. */
export interface BackgroundRenderer extends UnlitColorSpaceRenderer {
  readonly autoClear: boolean;
  readonly autoClearColor: boolean;
  readonly autoClearDepth: boolean;
  readonly autoClearStencil: boolean;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
}

/** What the background needs of the GL state (r180's WebGLState buffers). */
export interface BackgroundState {
  readonly buffers: {
    readonly color: {
      setClear(r: number, g: number, b: number, a: number, premultipliedAlpha?: boolean): void;
      setMask(colorMask: boolean): void;
    };
    readonly depth: {
      setTest(depthTest: boolean): void;
      setMask(depthMask: boolean): void;
    };
  };
}

/** The stage, as the background reads it. */
export interface BackgroundScene {
  readonly isScene?: boolean;
  readonly background?: unknown;
  readonly backgroundBlurriness?: number;
}

/** r180's WebGLCubeMaps / WebGLCubeUVMaps, as the background reads them. */
export interface BackgroundEnvMaps {
  get(texture: unknown): unknown;
}

export interface Background {
  getClearColor(): Color;
  setClearColor(color: ColorRepresentation, alpha?: number): void;
  getClearAlpha(): number;
  setClearAlpha(alpha: number): void;
  render(scene: BackgroundScene): void;
  addToRenderList(renderList: unknown, scene: BackgroundScene): void;
  dispose(): void;
}

/** r180's WebGLBackground. */
export function createBackground(
  renderer: BackgroundRenderer,
  cubemaps: BackgroundEnvMaps,
  cubeuvmaps: BackgroundEnvMaps,
  state: BackgroundState,
  _objects: unknown,
  alpha: boolean,
  premultipliedAlpha: boolean,
): Background {
  const clearColor = new Color(0x000000);
  let clearAlpha = alpha === true ? 0 : 1;

  let warned = false;

  function getBackground(scene: BackgroundScene): unknown {
    let background = scene.isScene === true ? scene.background : null;

    if (background && (background as { isTexture?: boolean }).isTexture) {
      const usePMREM = (scene.backgroundBlurriness as number) > 0; // use PMREM if the user wants to blur the background
      background = (usePMREM ? cubeuvmaps : cubemaps).get(background);
    }

    return background;
  }

  function render(scene: BackgroundScene): void {
    let forceClear = false;
    const background = getBackground(scene);

    if (background === null) {
      setClear(clearColor, clearAlpha);
    } else if (background && (background as { isColor?: boolean }).isColor) {
      setClear(background as Color, 1);
      forceClear = true;
    }

    // (r180 reads renderer.xr.getEnvironmentBlendMode() here: undefined without XR, see the header)

    if (renderer.autoClear || forceClear) {
      // buffers might not be writable which is required to ensure a correct clear

      state.buffers.depth.setTest(true);
      state.buffers.depth.setMask(true);
      state.buffers.color.setMask(true);

      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
  }

  function addToRenderList(_renderList: unknown, scene: BackgroundScene): void {
    const background = getBackground(scene);

    if (background && (background as { isTexture?: boolean }).isTexture) {
      // (r180 adds its background plane or box mesh here: not ported, see the header)
      if (!warned) {
        warned = true;
        console.warn("keel/lit background: texture backgrounds are not supported; use a colour.");
      }
    }
  }

  function setClear(color: Color, alpha: number): void {
    color.getRGB(_rgb, getUnlitUniformColorSpace(renderer));

    state.buffers.color.setClear(_rgb.r, _rgb.g, _rgb.b, alpha, premultipliedAlpha);
  }

  function dispose(): void {
    // (r180 frees its background meshes here: none are made, see the header)
  }

  return {
    getClearColor: function () {
      return clearColor;
    },
    setClearColor: function (color, alpha = 1) {
      clearColor.set(color);
      clearAlpha = alpha;
      setClear(clearColor, clearAlpha);
    },
    getClearAlpha: function () {
      return clearAlpha;
    },
    setClearAlpha: function (alpha) {
      clearAlpha = alpha;
      setClear(clearColor, clearAlpha);
    },
    render: render,
    addToRenderList: addToRenderList,
    dispose: dispose,
  };
}
