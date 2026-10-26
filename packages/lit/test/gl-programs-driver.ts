// A test-only renderer for gl-programs.test.ts: r180's WebGLRenderer's frame
// (render, projectObject, renderScene, renderObject, renderBufferDirect,
// getProgram, setProgram, setRenderTarget, clear) ported as it is, wired to
// keel/lit's src/gl modules the way r180 wires its own. It is the harness
// the program layer is checked through until keel/lit's renderer lands; it
// leaves out what the test's stages never reach (XR, transmission, morph,
// skinning, batching, UBOs, compile()).
//
// (Ported from Three.js r180's renderers/WebGLRenderer.js, MIT, see
// packages/lit/NOTICE.)

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Color } from "../src/math/Color.ts";
import { Frustum } from "../src/math/Frustum.ts";
import { Matrix4 } from "../src/math/Matrix4.ts";
import { Vector3 } from "../src/math/Vector3.ts";
import { Vector4 } from "../src/math/Vector4.ts";
import { createAttributes } from "../src/gl/attributes.ts";
import { createBackground } from "../src/gl/background.ts";
import { createBindingStates } from "../src/gl/binding-states.ts";
import { createBufferRenderer } from "../src/gl/buffer-renderer.ts";
import { createCapabilities } from "../src/gl/capabilities.ts";
import { createClipping } from "../src/gl/clipping.ts";
import { createCubeMaps } from "../src/gl/cube-maps.ts";
import { createCubeUVMaps } from "../src/gl/cube-uv-maps.ts";
import { createExtensions } from "../src/gl/extensions.ts";
import { createGeometries } from "../src/gl/geometries.ts";
import { createIndexedBufferRenderer } from "../src/gl/indexed-buffer-renderer.ts";
import { createInfo } from "../src/gl/info.ts";
import { createMaterials } from "../src/gl/materials.ts";
import { createObjects } from "../src/gl/objects.ts";
import { createPrograms } from "../src/gl/programs.ts";
import { createProperties } from "../src/gl/properties.ts";
import { createRenderLists } from "../src/gl/render-lists.ts";
import { createRenderStates } from "../src/gl/render-states.ts";
import { createShadowMap } from "../src/gl/shadow-map.ts";
import { createState } from "../src/gl/state.ts";
import { createTextures } from "../src/gl/textures.ts";
import { createUtils } from "../src/gl/utils.ts";
import { seqWithValue, upload } from "../src/gl/uniforms.ts";

export interface DriverHooks {
  /** Called where r180 calls material.onBeforeCompile (before onCompile runs). */
  capture?(material: any, parameters: any): void;
}

export function createDriver(canvas: any, hooks: DriverHooks = {}): any {
  const _this: any = {};

  _this.domElement = canvas;
  _this.debug = { checkShaderErrors: true, onShaderError: null };

  _this.autoClear = true;
  _this.autoClearColor = true;
  _this.autoClearDepth = true;
  _this.autoClearStencil = true;
  _this.sortObjects = true;
  _this.clippingPlanes = [];
  _this.localClippingEnabled = false;
  _this.toneMapping = "none";
  _this.toneMappingExposure = 1.0;
  _this.outputColorSpace = "srgb";

  const renderListStack: any[] = [];
  const renderStateStack: any[] = [];

  let currentRenderList: any = null;
  let currentRenderState: any = null;

  let _currentActiveCubeFace = 0;
  let _currentActiveMipmapLevel = 0;
  let _currentRenderTarget: any = null;
  let _currentMaterialId = -1;
  let _currentCamera: any = null;

  const _currentViewport = new Vector4();
  const _currentScissor = new Vector4();
  let _currentScissorTest: boolean | null = null;

  const _width = canvas.width;
  const _height = canvas.height;
  const _pixelRatio = 1;

  const _viewport = new Vector4(0, 0, _width, _height);
  const _scissor = new Vector4(0, 0, _width, _height);
  const _scissorTest = false;

  const _frustum = new Frustum();

  let _clippingEnabled = false;
  let _localClippingEnabled = false;

  const _projScreenMatrix = new Matrix4();
  const _vector3 = new Vector3();
  const _vector4 = new Vector4();

  const _emptyScene = { background: null, fog: null, environment: null, overrideMaterial: null, isScene: true };

  const _gl: WebGL2RenderingContext = canvas.getContext("webgl2", {
    alpha: true, depth: true, stencil: false, antialias: false, premultipliedAlpha: true,
    preserveDrawingBuffer: false, powerPreference: "default", failIfMajorPerformanceCaveat: false,
  });

  // ---- initGLContext

  const extensions = createExtensions(_gl);
  extensions.init();
  const utils = createUtils(_gl, extensions);
  const capabilities = createCapabilities(_gl, extensions, { precision: "highp", logarithmicDepthBuffer: false, reversedDepthBuffer: false }, utils);
  const state = createState(_gl, extensions);
  const info = createInfo(_gl);
  const properties = createProperties();
  const textures = createTextures(_gl, extensions as any, state as any, properties, capabilities as any, utils as any, info as any);
  const cubemaps = createCubeMaps(_this);
  const cubeuvmaps = createCubeUVMaps(_this);
  const attributes = createAttributes(_gl);
  const bindingStates = createBindingStates(_gl, attributes);
  const geometries = createGeometries(_gl, attributes, info, bindingStates);
  const objects = createObjects(_gl, geometries, attributes, info);
  const clipping = createClipping(properties);
  const programCache = createPrograms(_this, cubemaps as any, cubeuvmaps as any, extensions, capabilities, bindingStates as any, clipping);
  const materials = createMaterials(_this, properties);
  const renderLists = createRenderLists<any, any, any, any>();
  const renderStates = createRenderStates(extensions);
  const background = createBackground(_this, cubemaps as any, cubeuvmaps as any, state as any, objects, false, true);

  _this.capabilities = capabilities;
  _this.extensions = extensions;
  _this.properties = properties;
  _this.renderLists = renderLists;
  _this.state = state;
  _this.info = info;

  const shadowMap = createShadowMap(_this, objects as any, capabilities);
  _this.shadowMap = shadowMap;

  const bufferRenderer = createBufferRenderer(_gl, extensions, info);
  const indexedBufferRenderer = createIndexedBufferRenderer(_gl, extensions, info);

  info.programs = programCache.programs;

  _this.getContext = () => _gl;
  _this.getPixelRatio = () => _pixelRatio;

  _this.clear = function (color = true, depth = true, stencil = true) {
    let bits = 0;

    if (color) bits |= _gl.COLOR_BUFFER_BIT;
    if (depth) bits |= _gl.DEPTH_BUFFER_BIT;

    if (stencil) {
      bits |= _gl.STENCIL_BUFFER_BIT;
      state.buffers.stencil.setMask(0xffffffff);
    }

    _gl.clear(bits);
  };

  _this.getClearColor = (target: Color) => target.copy(background.getClearColor());
  _this.setClearColor = (color: any, alpha?: number) => background.setClearColor(color, alpha);

  function onMaterialDispose(event: any): void {
    const material = event.target;
    material.removeEventListener("dispose", onMaterialDispose);
    deallocateMaterial(material);
  }

  function deallocateMaterial(material: any): void {
    releaseMaterialProgramReferences(material);
    properties.remove(material);
  }

  function releaseMaterialProgramReferences(material: any): void {
    const programs = properties.get(material).programs;

    if (programs !== undefined) {
      programs.forEach(function (program: any) {
        programCache.releaseProgram(program);
      });

      if (material.isShaderMaterial) {
        programCache.releaseShaderCache(material);
      }
    }
  }

  _this.renderBufferDirect = function (camera: any, scene: any, geometry: any, material: any, object: any, group: any) {
    if (scene === null) scene = _emptyScene;

    const frontFaceCW = (object.isMesh && object.matrixWorld.determinant() < 0);

    const program = setProgram(camera, scene, geometry, material, object);

    state.setMaterial(material, frontFaceCW);

    let index = geometry.index;
    const rangeFactor = 1;

    const drawRange = geometry.drawRange;
    const position = geometry.attributes.position;

    let drawStart = drawRange.start * rangeFactor;
    let drawEnd = (drawRange.start + drawRange.count) * rangeFactor;

    if (group !== null) {
      drawStart = Math.max(drawStart, group.start * rangeFactor);
      drawEnd = Math.min(drawEnd, (group.start + group.count) * rangeFactor);
    }

    if (index !== null) {
      drawStart = Math.max(drawStart, 0);
      drawEnd = Math.min(drawEnd, index.count);
    } else if (position !== undefined && position !== null) {
      drawStart = Math.max(drawStart, 0);
      drawEnd = Math.min(drawEnd, position.count);
    }

    const drawCount = drawEnd - drawStart;

    if (drawCount < 0 || drawCount === Infinity) return;

    bindingStates.setup(object, material, program as any, geometry, index);

    let renderer: any = bufferRenderer;

    if (index !== null) {
      const attribute = attributes.get(index);
      renderer = indexedBufferRenderer;
      renderer.setIndex(attribute);
    }

    if (object.isMesh) {
      renderer.setMode(_gl.TRIANGLES);
    } else if (object.isSprite) {
      renderer.setMode(_gl.TRIANGLES);
    }

    if (object.isInstancedMesh) {
      renderer.renderInstances(drawStart, drawCount, object.count);
    } else {
      renderer.render(drawStart, drawCount);
    }
    index = null;
  };

  _this.render = function (scene: any, camera: any) {
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();

    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();

    if (scene.isScene === true) scene.onBeforeRender(_this, scene, camera, _currentRenderTarget);

    currentRenderState = renderStates.get(scene, renderStateStack.length);
    currentRenderState.init(camera);

    renderStateStack.push(currentRenderState);

    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix, "webgl", camera.reversedDepth);

    _localClippingEnabled = this.localClippingEnabled;
    _clippingEnabled = clipping.init(this.clippingPlanes, _localClippingEnabled);

    currentRenderList = renderLists.get(scene, renderListStack.length);
    currentRenderList.init();

    renderListStack.push(currentRenderList);

    projectObject(scene, camera, 0, _this.sortObjects);

    currentRenderList.finish();

    if (_this.sortObjects === true) {
      currentRenderList.sort(null, null);
    }

    background.addToRenderList(currentRenderList, scene);

    this.info.render.frame++;

    if (_clippingEnabled === true) clipping.beginShadows();

    const shadowsArray = currentRenderState.state.shadowsArray;

    shadowMap.render(shadowsArray, scene, camera);

    if (_clippingEnabled === true) clipping.endShadows();

    if (this.info.autoReset === true) this.info.reset();

    currentRenderState.setupLights();

    background.render(scene);

    renderScene(currentRenderList, scene, camera);

    if (_currentRenderTarget !== null && _currentActiveMipmapLevel === 0) {
      textures.updateMultisampleRenderTarget(_currentRenderTarget);
      textures.updateRenderTargetMipmap(_currentRenderTarget);
    }

    if (scene.isScene === true) scene.onAfterRender(_this, scene, camera);

    bindingStates.resetDefaultState();
    _currentMaterialId = -1;
    _currentCamera = null;

    renderStateStack.pop();

    if (renderStateStack.length > 0) {
      currentRenderState = renderStateStack[renderStateStack.length - 1];
      if (_clippingEnabled === true) clipping.setGlobalState(_this.clippingPlanes, currentRenderState.state.camera);
    } else {
      currentRenderState = null;
    }

    renderListStack.pop();

    if (renderListStack.length > 0) {
      currentRenderList = renderListStack[renderListStack.length - 1];
    } else {
      currentRenderList = null;
    }
  };

  function projectObject(object: any, camera: any, groupOrder: number, sortObjects: boolean): void {
    if (object.visible === false) return;

    const visible = object.layers.test(camera.layers);

    if (visible) {
      if (object.isGroup) {
        groupOrder = object.renderOrder;
      } else if (object.isLight) {
        currentRenderState.pushLight(object);

        if (object.castShadow) {
          currentRenderState.pushShadow(object);
        }
      } else if (object.isSprite) {
        if (!object.frustumCulled || _frustum.intersectsSprite(object)) {
          if (sortObjects) {
            _vector4.setFromMatrixPosition(object.matrixWorld).applyMatrix4(_projScreenMatrix);
          }

          const geometry = objects.update(object);
          const material = object.material;

          if (material.visible) {
            currentRenderList.push(object, geometry, material, groupOrder, _vector4.z, null);
          }
        }
      } else if (object.isMesh || object.isLine || object.isPoints) {
        if (!object.frustumCulled || _frustum.intersectsObject(object)) {
          const geometry: any = objects.update(object);
          const material = object.material;

          if (sortObjects) {
            if (object.boundingSphere !== undefined) {
              if (object.boundingSphere === null) object.computeBoundingSphere();
              _vector4.copy(object.boundingSphere.center);
            } else {
              if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
              _vector4.copy(geometry.boundingSphere.center);
            }

            _vector4.applyMatrix4(object.matrixWorld).applyMatrix4(_projScreenMatrix);
          }

          if (Array.isArray(material)) {
            const groups = geometry.groups;

            for (let i = 0, l = groups.length; i < l; i++) {
              const group = groups[i];
              const groupMaterial = material[group.materialIndex];

              if (groupMaterial && groupMaterial.visible) {
                currentRenderList.push(object, geometry, groupMaterial, groupOrder, _vector4.z, group);
              }
            }
          } else if (material.visible) {
            currentRenderList.push(object, geometry, material, groupOrder, _vector4.z, null);
          }
        }
      }
    }

    const children = object.children;

    for (let i = 0, l = children.length; i < l; i++) {
      projectObject(children[i], camera, groupOrder, sortObjects);
    }
  }

  function renderScene(currentRenderList: any, scene: any, camera: any, viewport?: any): void {
    const opaqueObjects = currentRenderList.opaque;
    const transmissiveObjects = currentRenderList.transmissive;
    const transparentObjects = currentRenderList.transparent;

    currentRenderState.setupLightsView(camera);

    if (_clippingEnabled === true) clipping.setGlobalState(_this.clippingPlanes, camera);

    if (viewport) state.viewport(_currentViewport.copy(viewport));

    if (opaqueObjects.length > 0) renderObjects(opaqueObjects, scene, camera);
    if (transmissiveObjects.length > 0) renderObjects(transmissiveObjects, scene, camera);
    if (transparentObjects.length > 0) renderObjects(transparentObjects, scene, camera);

    state.buffers.depth.setTest(true);
    state.buffers.depth.setMask(true);
    state.buffers.color.setMask(true);

    state.setPolygonOffset(false);
  }

  function renderObjects(renderList: any[], scene: any, camera: any): void {
    const overrideMaterial = scene.isScene === true ? scene.overrideMaterial : null;

    for (let i = 0, l = renderList.length; i < l; i++) {
      const renderItem = renderList[i];

      const object = renderItem.object;
      const geometry = renderItem.geometry;
      const group = renderItem.group;
      let material = renderItem.material;

      if (material.allowOverride === true && overrideMaterial !== null) {
        material = overrideMaterial;
      }

      if (object.layers.test(camera.layers)) {
        renderObject(object, scene, camera, geometry, material, group);
      }
    }
  }

  function renderObject(object: any, scene: any, camera: any, geometry: any, material: any, group: any): void {
    object.onBeforeRender(_this, scene, camera, geometry, material, group);

    object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
    object.normalMatrix.getNormalMatrix(object.modelViewMatrix);

    material.onBeforeRender(_this, scene, camera, geometry, object, group);

    if (material.transparent === true && material.side === "both" && material.forceSinglePass === false) {
      material.side = "back";
      material.needsUpdate = true;
      _this.renderBufferDirect(camera, scene, geometry, material, object, group);

      material.side = "front";
      material.needsUpdate = true;
      _this.renderBufferDirect(camera, scene, geometry, material, object, group);

      material.side = "both";
    } else {
      _this.renderBufferDirect(camera, scene, geometry, material, object, group);
    }

    object.onAfterRender(_this, scene, camera, geometry, material, group);
  }

  function getProgram(material: any, scene: any, object: any): any {
    if (scene.isScene !== true) scene = _emptyScene;

    const materialProperties = properties.get(material);

    const lights = currentRenderState.state.lights;
    const shadowsArray = currentRenderState.state.shadowsArray;

    const lightsStateVersion = lights.state.version;

    const parameters = programCache.getParameters(material, lights.state, shadowsArray, scene, object);
    const programCacheKey = programCache.getProgramCacheKey(parameters);

    let programs = materialProperties.programs;

    materialProperties.environment = material.isMeshStandardMaterial ? scene.environment : null;
    materialProperties.fog = scene.fog;
    materialProperties.envMap = (material.isMeshStandardMaterial ? cubeuvmaps : cubemaps).get(material.envMap || materialProperties.environment);
    materialProperties.envMapRotation = (materialProperties.environment !== null && material.envMap === null) ? scene.environmentRotation : material.envMapRotation;

    if (programs === undefined) {
      material.addEventListener("dispose", onMaterialDispose);

      programs = new Map();
      materialProperties.programs = programs;
    }

    let program = programs.get(programCacheKey);

    if (program !== undefined) {
      if (materialProperties.currentProgram === program && materialProperties.lightsStateVersion === lightsStateVersion) {
        updateCommonMaterialProperties(material, parameters);

        return program;
      }
    } else {
      parameters.uniforms = programCache.getUniforms(material);

      hooks.capture?.(material, parameters);
      material.onCompile(parameters, _this);

      program = programCache.acquireProgram(parameters, programCacheKey);
      programs.set(programCacheKey, program);

      materialProperties.uniforms = parameters.uniforms;
    }

    const uniforms = materialProperties.uniforms;

    if ((!material.isShaderMaterial && !material.isRawShaderMaterial) || material.clipping === true) {
      uniforms.clippingPlanes = clipping.uniform;
    }

    updateCommonMaterialProperties(material, parameters);

    materialProperties.needsLights = materialNeedsLights(material);
    materialProperties.lightsStateVersion = lightsStateVersion;

    if (materialProperties.needsLights) {
      uniforms.ambientLightColor.value = lights.state.ambient;
      uniforms.lightProbe.value = lights.state.probe;
      uniforms.directionalLights.value = lights.state.directional;
      uniforms.directionalLightShadows.value = lights.state.directionalShadow;
      uniforms.spotLights.value = lights.state.spot;
      uniforms.spotLightShadows.value = lights.state.spotShadow;
      uniforms.rectAreaLights.value = lights.state.rectArea;
      uniforms.ltc_1.value = lights.state.rectAreaLTC1;
      uniforms.ltc_2.value = lights.state.rectAreaLTC2;
      uniforms.pointLights.value = lights.state.point;
      uniforms.pointLightShadows.value = lights.state.pointShadow;
      uniforms.hemisphereLights.value = lights.state.hemi;

      uniforms.directionalShadowMap.value = lights.state.directionalShadowMap;
      uniforms.directionalShadowMatrix.value = lights.state.directionalShadowMatrix;
      uniforms.spotShadowMap.value = lights.state.spotShadowMap;
      uniforms.spotLightMatrix.value = lights.state.spotLightMatrix;
      uniforms.spotLightMap.value = lights.state.spotLightMap;
      uniforms.pointShadowMap.value = lights.state.pointShadowMap;
      uniforms.pointShadowMatrix.value = lights.state.pointShadowMatrix;
    }

    materialProperties.currentProgram = program;
    materialProperties.uniformsList = null;

    return program;
  }

  function getUniformList(materialProperties: any): any {
    if (materialProperties.uniformsList === null) {
      const progUniforms = materialProperties.currentProgram.getUniforms();
      materialProperties.uniformsList = seqWithValue(progUniforms.seq, materialProperties.uniforms);
    }

    return materialProperties.uniformsList;
  }

  function updateCommonMaterialProperties(material: any, parameters: any): void {
    const materialProperties = properties.get(material);

    materialProperties.outputColorSpace = parameters.outputColorSpace;
    materialProperties.batching = parameters.batching;
    materialProperties.batchingColor = parameters.batchingColor;
    materialProperties.instancing = parameters.instancing;
    materialProperties.instancingColor = parameters.instancingColor;
    materialProperties.instancingMorph = parameters.instancingMorph;
    materialProperties.skinning = parameters.skinning;
    materialProperties.morphTargets = parameters.morphTargets;
    materialProperties.morphNormals = parameters.morphNormals;
    materialProperties.morphColors = parameters.morphColors;
    materialProperties.morphTargetsCount = parameters.morphTargetsCount;
    materialProperties.numClippingPlanes = parameters.numClippingPlanes;
    materialProperties.numIntersection = parameters.numClipIntersection;
    materialProperties.vertexAlphas = parameters.vertexAlphas;
    materialProperties.vertexTangents = parameters.vertexTangents;
    materialProperties.toneMapping = parameters.toneMapping;
  }

  function setProgram(camera: any, scene: any, geometry: any, material: any, object: any): any {
    if (scene.isScene !== true) scene = _emptyScene;

    textures.resetTextureUnits();

    const fog = scene.fog;
    const environment = material.isMeshStandardMaterial ? scene.environment : null;
    const colorSpace = (_currentRenderTarget === null) ? _this.outputColorSpace : (_currentRenderTarget.isXRRenderTarget === true ? _currentRenderTarget.texture.colorSpace : "linear");
    const envMap = (material.isMeshStandardMaterial ? cubeuvmaps : cubemaps).get(material.envMap || environment);
    const vertexAlphas = material.vertexColors === true && !!geometry.attributes.color && geometry.attributes.color.itemSize === 4;
    const vertexTangents = !!geometry.attributes.tangent && (!!material.normalMap || material.anisotropy > 0);
    const morphTargets = !!geometry.morphAttributes.position;
    const morphNormals = !!geometry.morphAttributes.normal;
    const morphColors = !!geometry.morphAttributes.color;

    let toneMapping = "none";

    if (material.toneMapped) {
      if (_currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true) {
        toneMapping = _this.toneMapping;
      }
    }

    const morphAttribute = geometry.morphAttributes.position || geometry.morphAttributes.normal || geometry.morphAttributes.color;
    const morphTargetsCount = (morphAttribute !== undefined) ? morphAttribute.length : 0;

    const materialProperties = properties.get(material);
    const lights = currentRenderState.state.lights;

    if (_clippingEnabled === true) {
      if (_localClippingEnabled === true || camera !== _currentCamera) {
        const useCache = camera === _currentCamera && material.id === _currentMaterialId;
        clipping.setState(material, camera, useCache);
      }
    }

    let needsProgramChange = false;

    if (material.version === materialProperties.__version) {
      if (materialProperties.needsLights && (materialProperties.lightsStateVersion !== lights.state.version)) {
        needsProgramChange = true;
      } else if (materialProperties.outputColorSpace !== colorSpace) {
        needsProgramChange = true;
      } else if (object.isBatchedMesh && materialProperties.batching === false) {
        needsProgramChange = true;
      } else if (!object.isBatchedMesh && materialProperties.batching === true) {
        needsProgramChange = true;
      } else if (object.isInstancedMesh && materialProperties.instancing === false) {
        needsProgramChange = true;
      } else if (!object.isInstancedMesh && materialProperties.instancing === true) {
        needsProgramChange = true;
      } else if (object.isSkinnedMesh && materialProperties.skinning === false) {
        needsProgramChange = true;
      } else if (!object.isSkinnedMesh && materialProperties.skinning === true) {
        needsProgramChange = true;
      } else if (object.isInstancedMesh && materialProperties.instancingColor === true && object.instanceColor === null) {
        needsProgramChange = true;
      } else if (object.isInstancedMesh && materialProperties.instancingColor === false && object.instanceColor !== null) {
        needsProgramChange = true;
      } else if (object.isInstancedMesh && materialProperties.instancingMorph === true && object.morphTexture === null) {
        needsProgramChange = true;
      } else if (object.isInstancedMesh && materialProperties.instancingMorph === false && object.morphTexture !== null) {
        needsProgramChange = true;
      } else if (materialProperties.envMap !== envMap) {
        needsProgramChange = true;
      } else if (material.fog === true && materialProperties.fog !== fog) {
        needsProgramChange = true;
      } else if (materialProperties.numClippingPlanes !== undefined &&
        (materialProperties.numClippingPlanes !== clipping.numPlanes ||
          materialProperties.numIntersection !== clipping.numIntersection)) {
        needsProgramChange = true;
      } else if (materialProperties.vertexAlphas !== vertexAlphas) {
        needsProgramChange = true;
      } else if (materialProperties.vertexTangents !== vertexTangents) {
        needsProgramChange = true;
      } else if (materialProperties.morphTargets !== morphTargets) {
        needsProgramChange = true;
      } else if (materialProperties.morphNormals !== morphNormals) {
        needsProgramChange = true;
      } else if (materialProperties.morphColors !== morphColors) {
        needsProgramChange = true;
      } else if (materialProperties.toneMapping !== toneMapping) {
        needsProgramChange = true;
      } else if (materialProperties.morphTargetsCount !== morphTargetsCount) {
        needsProgramChange = true;
      }
    } else {
      needsProgramChange = true;
      materialProperties.__version = material.version;
    }

    let program = materialProperties.currentProgram;

    if (needsProgramChange === true) {
      program = getProgram(material, scene, object);
    }

    let refreshProgram = false;
    let refreshMaterial = false;
    let refreshLights = false;

    const p_uniforms = program.getUniforms(),
      m_uniforms = materialProperties.uniforms;

    if (state.useProgram(program.program)) {
      refreshProgram = true;
      refreshMaterial = true;
      refreshLights = true;
    }

    if (material.id !== _currentMaterialId) {
      _currentMaterialId = material.id;
      refreshMaterial = true;
    }

    if (refreshProgram || _currentCamera !== camera) {
      const reversedDepthBuffer = state.buffers.depth.getReversed();

      if (reversedDepthBuffer && camera.reversedDepth !== true) {
        camera._reversedDepth = true;
        camera.updateProjectionMatrix();
      }

      p_uniforms.setValue(_gl, "projectionMatrix", camera.projectionMatrix);

      p_uniforms.setValue(_gl, "viewMatrix", camera.matrixWorldInverse);

      const uCamPos = p_uniforms.map.cameraPosition;

      if (uCamPos !== undefined) {
        uCamPos.setValue(_gl, _vector3.setFromMatrixPosition(camera.matrixWorld));
      }

      if (capabilities.logarithmicDepthBuffer) {
        p_uniforms.setValue(_gl, "logDepthBufFC", 2.0 / (Math.log(camera.far + 1.0) / Math.LN2));
      }

      if (material.isMeshPhongMaterial ||
        material.isMeshToonMaterial ||
        material.isMeshLambertMaterial ||
        material.isMeshBasicMaterial ||
        material.isMeshStandardMaterial ||
        material.isShaderMaterial) {
        p_uniforms.setValue(_gl, "isOrthographic", camera.isOrthographicCamera === true);
      }

      if (_currentCamera !== camera) {
        _currentCamera = camera;

        refreshMaterial = true;
        refreshLights = true;
      }
    }

    if (refreshMaterial || materialProperties.receiveShadow !== object.receiveShadow) {
      materialProperties.receiveShadow = object.receiveShadow;
      p_uniforms.setValue(_gl, "receiveShadow", object.receiveShadow);
    }

    if (material.isMeshStandardMaterial && material.envMap === null && scene.environment !== null) {
      m_uniforms.envMapIntensity.value = scene.environmentIntensity;
    }

    if (refreshMaterial) {
      p_uniforms.setValue(_gl, "toneMappingExposure", _this.toneMappingExposure);

      if (materialProperties.needsLights) {
        markUniformsLightsNeedsUpdate(m_uniforms, refreshLights);
      }

      if (fog && material.fog === true) {
        materials.refreshFogUniforms(m_uniforms, fog);
      }

      materials.refreshMaterialUniforms(m_uniforms, material, _pixelRatio, _height, currentRenderState.state.transmissionRenderTarget[camera.id]);

      upload(_gl, getUniformList(materialProperties), m_uniforms, textures as any);
    }

    if (material.isShaderMaterial && material.uniformsNeedUpdate === true) {
      upload(_gl, getUniformList(materialProperties), m_uniforms, textures as any);
      material.uniformsNeedUpdate = false;
    }

    if (material.isSpriteMaterial) {
      p_uniforms.setValue(_gl, "center", object.center);
    }

    p_uniforms.setValue(_gl, "modelViewMatrix", object.modelViewMatrix);
    p_uniforms.setValue(_gl, "normalMatrix", object.normalMatrix);
    p_uniforms.setValue(_gl, "modelMatrix", object.matrixWorld);

    return program;
  }

  function markUniformsLightsNeedsUpdate(uniforms: any, value: boolean): void {
    uniforms.ambientLightColor.needsUpdate = value;
    uniforms.lightProbe.needsUpdate = value;

    uniforms.directionalLights.needsUpdate = value;
    uniforms.directionalLightShadows.needsUpdate = value;
    uniforms.pointLights.needsUpdate = value;
    uniforms.pointLightShadows.needsUpdate = value;
    uniforms.spotLights.needsUpdate = value;
    uniforms.spotLightShadows.needsUpdate = value;
    uniforms.rectAreaLights.needsUpdate = value;
    uniforms.hemisphereLights.needsUpdate = value;
  }

  function materialNeedsLights(material: any): boolean {
    return material.isMeshLambertMaterial || material.isMeshToonMaterial || material.isMeshPhongMaterial ||
      material.isMeshStandardMaterial || material.isShadowMaterial ||
      (material.isShaderMaterial && material.lights === true);
  }

  _this.getActiveCubeFace = () => _currentActiveCubeFace;
  _this.getActiveMipmapLevel = () => _currentActiveMipmapLevel;
  _this.getRenderTarget = () => _currentRenderTarget;

  const _scratchFrameBuffer = _gl.createFramebuffer();

  _this.setRenderTarget = function (renderTarget: any, activeCubeFace = 0, activeMipmapLevel = 0) {
    _currentRenderTarget = renderTarget;
    _currentActiveCubeFace = activeCubeFace;
    _currentActiveMipmapLevel = activeMipmapLevel;

    const useDefaultFramebuffer = true;
    let framebuffer: any = null;

    if (renderTarget) {
      const renderTargetProperties = properties.get(renderTarget);

      if (renderTargetProperties.__webglFramebuffer === undefined) {
        textures.setupRenderTarget(renderTarget);
      } else if (renderTarget.depthBuffer) {
        const depthTexture = renderTarget.depthTexture;
        if (renderTargetProperties.__boundDepthTexture !== depthTexture) {
          textures.setupDepthRenderbuffer(renderTarget);
        }
      }

      const __webglFramebuffer = properties.get(renderTarget).__webglFramebuffer;

      if ((renderTarget.samples > 0) && textures.useMultisampledRTT(renderTarget) === false) {
        framebuffer = properties.get(renderTarget).__webglMultisampledFramebuffer;
      } else {
        if (Array.isArray(__webglFramebuffer)) {
          framebuffer = __webglFramebuffer[activeMipmapLevel];
        } else {
          framebuffer = __webglFramebuffer;
        }
      }

      _currentViewport.copy(renderTarget.viewport);
      _currentScissor.copy(renderTarget.scissor);
      _currentScissorTest = renderTarget.scissorTest;
    } else {
      _currentViewport.copy(_viewport).multiplyScalar(_pixelRatio).floor();
      _currentScissor.copy(_scissor).multiplyScalar(_pixelRatio).floor();
      _currentScissorTest = _scissorTest;
    }

    if (activeMipmapLevel !== 0) {
      framebuffer = _scratchFrameBuffer;
    }

    const framebufferBound = state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);

    if (framebufferBound && useDefaultFramebuffer) {
      state.drawBuffers(renderTarget, framebuffer);
    }

    state.viewport(_currentViewport);
    state.scissor(_currentScissor);
    state.setScissorTest(_currentScissorTest!);

    _currentMaterialId = -1;
  };

  return _this;
}
