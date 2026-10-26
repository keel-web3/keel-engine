// Ported from Three.js r180's renderers/webgl/WebGLShadowMap.js (MIT, see
// packages/lit/NOTICE): each shadow-casting light's depth map, drawn from the
// light with a depth material per caster, in r180's order.
//
// Dropped: VSM's blur pass (VSMPass: the grove's shadows are PCF soft; with
// type "vsm" the map is drawn, as r180 draws it, but never blurred). The VSM
// pass's materials and full-screen triangle are still made, as r180 makes
// them, so material, geometry and node ids count up the same.

import { DepthMaterial } from "../material/DepthMaterial.ts";
import { DistanceMaterial } from "../material/DistanceMaterial.ts";
import { CustomMaterial } from "../material/CustomMaterial.ts";
import type { Material } from "../material/Material.ts";
import { Attribute } from "../core/Attribute.ts";
import { Geometry } from "../core/Geometry.ts";
import type { GeometryGroup } from "../core/Geometry.ts";
import type { Layers } from "../core/Layers.ts";
import { Mesh } from "../scene/Mesh.ts";
import { Vector4 } from "../math/Vector4.ts";
import { Vector2 } from "../math/Vector2.ts";
import type { Matrix4 } from "../math/Matrix4.ts";
import { Frustum } from "../math/Frustum.ts";
import type { CullObject } from "../math/Frustum.ts";
import { RenderTarget } from "../texture/RenderTarget.ts";
import type { RenderTargetOptions } from "../texture/RenderTarget.ts";
import type { Texture } from "../texture/Texture.ts";
import type { Blending, ShadowMapType, Side } from "../constants.ts";

// ---- what this module receives

/** r180's WebGLState, as the shadow map sets it. */
export interface ShadowMapState {
  setBlending(blending: Blending): void;
  setScissorTest(scissorTest: boolean): void;
  viewport(viewport: Vector4): void;
  buffers: {
    color: { setClear(r: number, g: number, b: number, a: number): void };
    depth: { setTest(depthTest: boolean): void; getReversed(): boolean };
  };
}

/** A camera, as the shadow map passes it on. */
export interface ShadowMapCamera {
  readonly layers: Layers;
}

/** The light's shadow camera. */
export interface ShadowCamera extends ShadowMapCamera {
  readonly matrixWorldInverse: Matrix4;
  updateProjectionMatrix(): void;
}

/** A light's shadow (SunShadow fits). */
export interface ShadowLike {
  autoUpdate: boolean;
  needsUpdate: boolean;
  mapSize: Vector2;
  map: RenderTarget | null;
  readonly camera: ShadowCamera;
  readonly isPointLightShadow?: boolean;
  getFrameExtents(): Vector2;
  getViewportCount(): number;
  getViewport(viewportIndex: number): Vector4 | undefined;
  updateMatrices(light: any, viewportIndex?: number): void;
  getFrustum(): Frustum;
}

/** A shadow-casting light (SunLight fits). */
export interface ShadowLight {
  name: string;
  readonly shadow?: ShadowLike;
  readonly isPointLight?: boolean;
}

/** A node in the scene, as renderObject walks it. */
export interface ShadowNode {
  visible: boolean;
  readonly layers: Layers;
  readonly isMesh?: boolean;
  readonly isLine?: boolean;
  readonly isPoints?: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  frustumCulled: boolean;
  readonly modelViewMatrix: Matrix4;
  readonly matrixWorld: Matrix4;
  material?: Material | Material[];
  readonly children: readonly ShadowNode[];
  customDepthMaterial?: Material | undefined;
  customDistanceMaterial?: Material | undefined;
  onBeforeShadow(renderer: unknown, object: any, camera: any, shadowCamera: any, geometry: any, depthMaterial: any, group: any): void;
  onAfterShadow(renderer: unknown, object: any, camera: any, shadowCamera: any, geometry: any, depthMaterial: any, group: any): void;
}

/** r180's WebGLRenderer, as the shadow map calls it. */
export interface ShadowMapRenderer {
  readonly state: ShadowMapState;
  readonly properties: { get(object: object): any };
  localClippingEnabled: boolean;
  getRenderTarget(): RenderTarget | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(renderTarget: RenderTarget | null, activeCubeFace?: number, activeMipmapLevel?: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  renderBufferDirect(camera: any, scene: null, geometry: any, material: Material, object: any, group: GeometryGroup | null): void;
}

/** r180's WebGLObjects, as the shadow map calls it. */
export interface ShadowMapObjects {
  update(object: any): { groups: GeometryGroup[] };
}

/** r180's WebGLCapabilities, as the shadow map reads it. */
export interface ShadowMapCapabilities {
  maxTextureSize: number;
}

/** What a material may carry, as getDepthMaterial copies it (only some kinds have each). */
type ShadowSourceMaterial = Material & {
  map?: Texture | null;
  alphaMap?: Texture | null;
  displacementMap?: Texture | null;
  displacementScale?: number;
  displacementBias?: number;
  wireframe?: boolean;
  wireframeLinewidth?: number;
  linewidth?: number;
};

/** The shadow map (r180's WebGLShadowMap). */
export interface ShadowMap {
  enabled: boolean;
  autoUpdate: boolean;
  needsUpdate: boolean;
  type: ShadowMapType;
  render(lights: readonly ShadowLight[], scene: ShadowNode, camera: ShadowMapCamera): void;
}

export function createShadowMap(renderer: ShadowMapRenderer, objects: ShadowMapObjects, capabilities: ShadowMapCapabilities): ShadowMap {
  let _frustum = new Frustum();

  const _shadowMapSize = new Vector2(),
    _viewportSize = new Vector2(),

    _viewport = new Vector4(),

    _depthMaterial = new DepthMaterial({ depthPacking: "rgba" }),
    _distanceMaterial = new DistanceMaterial(),

    _materialCache: Record<string, Record<string, Material>> = {},

    _maxTextureSize = capabilities.maxTextureSize;

  const shadowSide: Record<Side, Side> = { front: "back", back: "front", both: "both" };

  // (VSM's blur materials and triangle: made, never drawn -- see the header)
  const shadowMaterialVertical = new CustomMaterial({
    defines: {
      VSM_SAMPLES: 8,
    },
    uniforms: {
      shadow_pass: { value: null },
      resolution: { value: new Vector2() },
      radius: { value: 4.0 },
    },
  });

  const shadowMaterialHorizontal = shadowMaterialVertical.clone();
  shadowMaterialHorizontal.defines["HORIZONTAL_PASS"] = 1;

  const fullScreenTri = new Geometry();
  fullScreenTri.setAttribute(
    "position",
    new Attribute(
      new Float32Array([- 1, - 1, 0.5, 3, - 1, 0.5, - 1, 3, 0.5]),
      3,
    ),
  );

  const fullScreenMesh = new Mesh(fullScreenTri, shadowMaterialVertical);
  void fullScreenMesh;

  const scope: ShadowMap = {
    enabled: false,

    autoUpdate: true,
    needsUpdate: false,

    type: "pcf",

    render,
  };

  let _previousType = scope.type;

  function render(lights: readonly ShadowLight[], scene: ShadowNode, camera: ShadowMapCamera): void {
    if (scope.enabled === false) return;
    if (scope.autoUpdate === false && scope.needsUpdate === false) return;

    if (lights.length === 0) return;

    const currentRenderTarget = renderer.getRenderTarget();
    const activeCubeFace = renderer.getActiveCubeFace();
    const activeMipmapLevel = renderer.getActiveMipmapLevel();

    const _state = renderer.state;

    // (GL state for the depth map)
    _state.setBlending("none");

    if (_state.buffers.depth.getReversed() === true) {
      _state.buffers.color.setClear(0, 0, 0, 0);
    } else {
      _state.buffers.color.setClear(1, 1, 1, 1);
    }

    _state.buffers.depth.setTest(true);
    _state.setScissorTest(false);

    // (the shadow map type changed?)

    const toVSM = (_previousType !== "vsm" && scope.type === "vsm");
    const fromVSM = (_previousType === "vsm" && scope.type !== "vsm");

    // (the depth maps)

    for (let i = 0, il = lights.length; i < il; i++) {
      const light = lights[i]!;
      const shadow = light.shadow;

      if (shadow === undefined) {
        console.warn("keel/lit ShadowMap:", light, "has no shadow.");
        continue;
      }

      if (shadow.autoUpdate === false && shadow.needsUpdate === false) continue;

      _shadowMapSize.copy(shadow.mapSize);

      const shadowFrameExtents = shadow.getFrameExtents();

      _shadowMapSize.multiply(shadowFrameExtents);

      _viewportSize.copy(shadow.mapSize);

      if (_shadowMapSize.x > _maxTextureSize || _shadowMapSize.y > _maxTextureSize) {
        if (_shadowMapSize.x > _maxTextureSize) {
          _viewportSize.x = Math.floor(_maxTextureSize / shadowFrameExtents.x);
          _shadowMapSize.x = _viewportSize.x * shadowFrameExtents.x;
          shadow.mapSize.x = _viewportSize.x;
        }

        if (_shadowMapSize.y > _maxTextureSize) {
          _viewportSize.y = Math.floor(_maxTextureSize / shadowFrameExtents.y);
          _shadowMapSize.y = _viewportSize.y * shadowFrameExtents.y;
          shadow.mapSize.y = _viewportSize.y;
        }
      }

      if (shadow.map === null || toVSM === true || fromVSM === true) {
        const pars: RenderTargetOptions = (scope.type !== "vsm") ? { minFilter: "nearest", magFilter: "nearest" } : {};

        if (shadow.map !== null) {
          shadow.map.dispose();
        }

        shadow.map = new RenderTarget(_shadowMapSize.x, _shadowMapSize.y, pars);
        shadow.map.texture.name = light.name + ".shadowMap";

        shadow.camera.updateProjectionMatrix();
      }

      renderer.setRenderTarget(shadow.map);
      renderer.clear();

      const viewportCount = shadow.getViewportCount();

      for (let vp = 0; vp < viewportCount; vp++) {
        const viewport = shadow.getViewport(vp)!;

        _viewport.set(
          _viewportSize.x * viewport.x,
          _viewportSize.y * viewport.y,
          _viewportSize.x * viewport.z,
          _viewportSize.y * viewport.w,
        );

        _state.viewport(_viewport);

        shadow.updateMatrices(light, vp);

        _frustum = shadow.getFrustum();

        renderObject(scene, camera, shadow.camera, light, scope.type);
      }

      // (VSM's blur pass dropped: see the header)

      shadow.needsUpdate = false;
    }

    _previousType = scope.type;

    scope.needsUpdate = false;

    renderer.setRenderTarget(currentRenderTarget, activeCubeFace, activeMipmapLevel);
  }

  function getDepthMaterial(object: ShadowNode, material: ShadowSourceMaterial, light: ShadowLight, type: ShadowMapType): Material {
    let result: Material | null = null;

    const customMaterial = (light.isPointLight === true) ? object.customDistanceMaterial : object.customDepthMaterial;

    if (customMaterial !== undefined) {
      result = customMaterial;
    } else {
      result = (light.isPointLight === true) ? _distanceMaterial : _depthMaterial;

      if ((renderer.localClippingEnabled && material.clipShadows === true && Array.isArray(material.clippingPlanes) && material.clippingPlanes.length !== 0) ||
        (material.displacementMap && material.displacementScale !== 0) ||
        (material.alphaMap && material.alphaTest > 0) ||
        (material.map && material.alphaTest > 0) ||
        (material.alphaToCoverage === true)) {
        // (a material of its own, for this state)

        const keyA = result.uuid, keyB = material.uuid;

        let materialsForVariant = _materialCache[keyA];

        if (materialsForVariant === undefined) {
          materialsForVariant = {};
          _materialCache[keyA] = materialsForVariant;
        }

        let cachedMaterial = materialsForVariant[keyB];

        if (cachedMaterial === undefined) {
          cachedMaterial = result.clone();
          materialsForVariant[keyB] = cachedMaterial;
          material.addEventListener("dispose", onMaterialDispose);
        }

        result = cachedMaterial;
      }
    }

    // (as r180: every field is set, whether or not the material has it, so a
    // depth material can end up with an undefined map from a custom material)
    const out = result as unknown as Record<string, unknown>;

    out["visible"] = material.visible;
    out["wireframe"] = material.wireframe;

    if (type === "vsm") {
      out["side"] = (material.shadowSide !== null) ? material.shadowSide : material.side;
    } else {
      out["side"] = (material.shadowSide !== null) ? material.shadowSide : shadowSide[material.side];
    }

    out["alphaMap"] = material.alphaMap;
    out["alphaTest"] = (material.alphaToCoverage === true) ? 0.5 : material.alphaTest; // (alphaToCoverage, roughly: a fixed alphaTest)
    out["map"] = material.map;

    out["clipShadows"] = material.clipShadows;
    out["clippingPlanes"] = material.clippingPlanes;
    out["clipIntersection"] = material.clipIntersection;

    out["displacementMap"] = material.displacementMap;
    out["displacementScale"] = material.displacementScale;
    out["displacementBias"] = material.displacementBias;

    out["wireframeLinewidth"] = material.wireframeLinewidth;
    out["linewidth"] = material.linewidth;

    if (light.isPointLight === true && (result as { isMeshDistanceMaterial?: boolean }).isMeshDistanceMaterial === true) {
      const materialProperties = renderer.properties.get(result);
      materialProperties.light = light;
    }

    return result;
  }

  function renderObject(object: ShadowNode, camera: ShadowMapCamera, shadowCamera: ShadowCamera, light: ShadowLight, type: ShadowMapType): void {
    if (object.visible === false) return;

    const visible = object.layers.test(camera.layers);

    if (visible && (object.isMesh || object.isLine || object.isPoints)) {
      if ((object.castShadow || (object.receiveShadow && type === "vsm")) && (!object.frustumCulled || _frustum.intersectsObject(object as unknown as CullObject))) {
        object.modelViewMatrix.multiplyMatrices(shadowCamera.matrixWorldInverse, object.matrixWorld);

        const geometry = objects.update(object);
        const material = object.material as ShadowSourceMaterial | ShadowSourceMaterial[];

        if (Array.isArray(material)) {
          const groups = geometry.groups;

          for (let k = 0, kl = groups.length; k < kl; k++) {
            const group = groups[k]!;
            const groupMaterial = material[group.materialIndex];

            if (groupMaterial && groupMaterial.visible) {
              const depthMaterial = getDepthMaterial(object, groupMaterial, light, type);

              object.onBeforeShadow(renderer, object, camera, shadowCamera, geometry, depthMaterial, group);

              renderer.renderBufferDirect(shadowCamera, null, geometry, depthMaterial, object, group);

              object.onAfterShadow(renderer, object, camera, shadowCamera, geometry, depthMaterial, group);
            }
          }
        } else if (material.visible) {
          const depthMaterial = getDepthMaterial(object, material, light, type);

          object.onBeforeShadow(renderer, object, camera, shadowCamera, geometry, depthMaterial, null);

          renderer.renderBufferDirect(shadowCamera, null, geometry, depthMaterial, object, null);

          object.onAfterShadow(renderer, object, camera, shadowCamera, geometry, depthMaterial, null);
        }
      }
    }

    const children = object.children;

    for (let i = 0, l = children.length; i < l; i++) {
      renderObject(children[i]!, camera, shadowCamera, light, type);
    }
  }

  function onMaterialDispose(event: { target?: unknown }): void {
    const material = event.target as Material;

    material.removeEventListener("dispose", onMaterialDispose);

    // (the material's own depth / distance variants go too)

    for (const id in _materialCache) {
      const cache = _materialCache[id]!;

      const uuid = material.uuid;

      if (uuid in cache) {
        const shadowMaterial = cache[uuid]!;
        shadowMaterial.dispose();
        delete cache[uuid];
      }
    }
  }

  return scope;
}
