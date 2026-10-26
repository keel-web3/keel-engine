// Ported from Three.js r180's renderers/WebGLRenderer.js (MIT, see
// packages/lit/NOTICE): the renderer that wires the GL layer together and
// draws a stage. r180's order of operations is kept call for call, so the GL
// call stream (and so the pixels) match.
//
// Not ported (keel/lit has no such objects): WebXR, morph targets, skinning,
// batched meshes, lines, points, LOD, uniform buffer groups and the
// transmission pass. Where r180 branches on one of them, the branch is left
// out; the flags it reads are never set on keel/lit's objects.

import { Color } from "../math/Color.ts";
import { Frustum } from "../math/Frustum.ts";
import { Matrix4 } from "../math/Matrix4.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Vector4 } from "../math/Vector4.ts";
import type { ColorRepresentation } from "../math/Color.ts";
import type { ColorSpace } from "../math/types.ts";
import { colorManagement } from "../math/ColorManagement.ts";
import type { ToneMapping } from "../constants.ts";
import type { Plane } from "../math/Plane.ts";
import type { RenderTarget } from "../texture/RenderTarget.ts";
import { createAnimation } from "./animation.ts";
import type { AnimationLoop } from "./animation.ts";
import { createAttributes } from "./attributes.ts";
import { createBackground } from "./background.ts";
import { createBindingStates } from "./binding-states.ts";
import { createBufferRenderer } from "./buffer-renderer.ts";
import { createCapabilities } from "./capabilities.ts";
import type { Capabilities, Precision } from "./capabilities.ts";
import { createClipping } from "./clipping.ts";
import { createCubeMaps } from "./cube-maps.ts";
import { createCubeUVMaps } from "./cube-uv-maps.ts";
import { createExtensions } from "./extensions.ts";
import type { Extensions } from "./extensions.ts";
import { createGeometries } from "./geometries.ts";
import { createIndexedBufferRenderer } from "./indexed-buffer-renderer.ts";
import { createInfo } from "./info.ts";
import type { Info } from "./info.ts";
import { createMaterials } from "./materials.ts";
import { createObjects } from "./objects.ts";
import { createPrograms } from "./programs.ts";
import { createProperties } from "./properties.ts";
import type { Properties } from "./properties.ts";
import { createRenderLists } from "./render-lists.ts";
import type { RenderLists } from "./render-lists.ts";
import { createRenderStates } from "./render-states.ts";
import { createShadowMap } from "./shadow-map.ts";
import type { ShadowMap } from "./shadow-map.ts";
import { createState } from "./state.ts";
import type { State } from "./state.ts";
import { createTextures } from "./textures.ts";
import { seqWithValue, upload } from "./uniforms.ts";
import { createUtils } from "./utils.ts";

// (r180's renderer reads whatever its objects carry; keel/lit's classes fit)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The options (r180's WebGLRenderer parameters). */
export interface LitRendererOptions {
  /** Draw into this canvas; one is made when left out (`renderer.domElement`). */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  context?: WebGL2RenderingContext | null;
  depth?: boolean;
  stencil?: boolean;
  alpha?: boolean;
  antialias?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: WebGLPowerPreference;
  failIfMajorPerformanceCaveat?: boolean;
  reversedDepthBuffer?: boolean;
  precision?: Precision;
  logarithmicDepthBuffer?: boolean;
}

/** The size setters write into (a Vector2 fits). */
interface SizeTarget {
  set(x: number, y: number): SizeTarget & { floor(): SizeTarget };
}

/** The renderer (r180's WebGLRenderer, with its public members). */
export interface LitRenderer {
  readonly isLitRenderer: true;
  readonly isWebGLRenderer: true;
  readonly domElement: HTMLCanvasElement | OffscreenCanvas;
  readonly debug: {
    checkShaderErrors: boolean;
    onShaderError: ((gl: WebGL2RenderingContext, program: WebGLProgram, glVertexShader: WebGLShader, glFragmentShader: WebGLShader) => void) | null;
  };
  autoClear: boolean;
  autoClearColor: boolean;
  autoClearDepth: boolean;
  autoClearStencil: boolean;
  sortObjects: boolean;
  clippingPlanes: Plane[];
  localClippingEnabled: boolean;
  toneMapping: ToneMapping;
  toneMappingExposure: number;
  transmissionResolutionScale: number;
  outputColorSpace: ColorSpace;
  readonly coordinateSystem: "webgl";

  capabilities: Capabilities;
  extensions: Extensions;
  properties: Properties;
  renderLists: RenderLists<Any, Any, Any, Any>;
  shadowMap: ShadowMap;
  state: State;
  info: Info;

  getContext(): WebGL2RenderingContext;
  getContextAttributes(): WebGLContextAttributes | null;
  forceContextLoss(): void;
  forceContextRestore(): void;
  getPixelRatio(): number;
  setPixelRatio(value: number): void;
  getSize<T extends SizeTarget>(target: T): T;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  getDrawingBufferSize<T extends SizeTarget>(target: T): T;
  setDrawingBufferSize(width: number, height: number, pixelRatio: number): void;
  getCurrentViewport(target: Vector4): Vector4;
  getViewport(target: Vector4): Vector4;
  setViewport(x: number | Vector4, y?: number, width?: number, height?: number): void;
  getScissor(target: Vector4): Vector4;
  setScissor(x: number | Vector4, y?: number, width?: number, height?: number): void;
  getScissorTest(): boolean;
  setScissorTest(boolean: boolean): void;
  setOpaqueSort(method: ((a: Any, b: Any) => number) | null): void;
  setTransparentSort(method: ((a: Any, b: Any) => number) | null): void;
  getClearColor(target: Color): Color;
  setClearColor(color: ColorRepresentation, alpha?: number): void;
  getClearAlpha(): number;
  setClearAlpha(alpha: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  clearColor(): void;
  clearDepth(): void;
  clearStencil(): void;
  dispose(): void;
  renderBufferDirect(camera: Any, scene: Any, geometry: Any, material: Any, object: Any, group: Any): void;
  compile(scene: Any, camera: Any, targetScene?: Any): Set<Any>;
  compileAsync(scene: Any, camera: Any, targetScene?: Any): Promise<Any>;
  setAnimationLoop(callback: AnimationLoop | null): void;
  render(scene: Any, camera: Any): void;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  getRenderTarget(): RenderTarget | null;
  setRenderTarget(renderTarget: RenderTarget | null, activeCubeFace?: number, activeMipmapLevel?: number): void;
  readRenderTargetPixels(renderTarget: RenderTarget, x: number, y: number, width: number, height: number, buffer: ArrayBufferView, activeCubeFaceIndex?: number, textureIndex?: number): void;
  copyFramebufferToTexture(texture: Any, position?: { x: number; y: number } | null, level?: number): void;
  initRenderTarget(target: RenderTarget): void;
  initTexture(texture: Any): void;
  resetState(): void;
}

// (r180's utils.createCanvasElement)
function createCanvasElement(): HTMLCanvasElement {
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
  canvas.style.display = "block";
  return canvas;
}

// (r180's integer texture formats and unsigned types, as clear() tests them)
const INTEGER_FORMATS = new Set(["rgba-integer", "rg-integer", "red-integer"]);
const UNSIGNED_TYPES = new Set(["u8", "uint", "u16", "depth24-stencil8", "u4444", "u5551"]);

/** r180's `new WebGLRenderer( parameters )`. */
export function createLitRenderer(parameters: LitRendererOptions = {}): LitRenderer {
  const {
    canvas = createCanvasElement(),
    context = null,
    depth = true,
    stencil = false,
    alpha = false,
    antialias = false,
    premultipliedAlpha = true,
    preserveDrawingBuffer = false,
    powerPreference = "default",
    failIfMajorPerformanceCaveat = false,
    reversedDepthBuffer = false,
  } = parameters;

  let _alpha: boolean;

  if (context !== null) {
    _alpha = context.getContextAttributes()!.alpha!;
  } else {
    _alpha = alpha;
  }

  const uintClearColor = new Uint32Array(4);
  const intClearColor = new Int32Array(4);

  let currentRenderList: Any = null;
  let currentRenderState: Any = null;

  // render() can be called from within a callback triggered by another render.
  // We track this so that the nested render call gets its list and state isolated from the parent render call.
  const renderListStack: Any[] = [];
  const renderStateStack: Any[] = [];

  // internal properties

  let _isContextLost = false;

  // internal state cache

  let _outputColorSpace: ColorSpace = "srgb";

  let _currentActiveCubeFace = 0;
  let _currentActiveMipmapLevel = 0;
  let _currentRenderTarget: Any = null;
  let _currentMaterialId = -1;

  let _currentCamera: Any = null;

  const _currentViewport = new Vector4();
  const _currentScissor = new Vector4();
  let _currentScissorTest: boolean | null = null;

  const _currentClearColor = new Color(0x000000);
  let _currentClearAlpha = 0;

  //

  let _width = canvas.width;
  let _height = canvas.height;

  let _pixelRatio = 1;
  let _opaqueSort: Any = null;
  let _transparentSort: Any = null;

  const _viewport = new Vector4(0, 0, _width, _height);
  const _scissor = new Vector4(0, 0, _width, _height);
  let _scissorTest = false;

  // frustum

  const _frustum = new Frustum();

  // clipping

  let _clippingEnabled = false;
  let _localClippingEnabled = false;

  // camera matrices cache

  const _projScreenMatrix = new Matrix4();

  const _vector3 = new Vector3();

  const _vector4 = new Vector4();

  const _emptyScene = { background: null, fog: null, environment: null, overrideMaterial: null, isScene: true };

  let _renderBackground = false;

  function getTargetPixelRatio(): number {
    return _currentRenderTarget === null ? _pixelRatio : 1;
  }

  // initialize

  let _gl: WebGL2RenderingContext = context as WebGL2RenderingContext;

  function getContext(contextName: "webgl2", contextAttributes?: WebGLContextAttributes): WebGL2RenderingContext | null {
    return canvas.getContext(contextName, contextAttributes) as WebGL2RenderingContext | null;
  }

  try {
    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      depth,
      stencil,
      antialias,
      premultipliedAlpha,
      preserveDrawingBuffer,
      powerPreference,
      failIfMajorPerformanceCaveat,
    };

    // OffscreenCanvas does not have setAttribute, see #22811
    if ("setAttribute" in canvas) canvas.setAttribute("data-engine", "keel/lit (three.js r180)");

    // event listeners must be registered before WebGL context is created, see #12753
    canvas.addEventListener("webglcontextlost", onContextLost as EventListener, false);
    canvas.addEventListener("webglcontextrestored", onContextRestore, false);
    canvas.addEventListener("webglcontextcreationerror", onContextCreationError as EventListener, false);

    if (_gl === null) {
      const contextName = "webgl2";

      _gl = getContext(contextName, contextAttributes)!;

      if (_gl === null) {
        if (getContext(contextName)) {
          throw new Error("Error creating WebGL context with your selected attributes.");
        } else {
          throw new Error("Error creating WebGL context.");
        }
      }
    }
  } catch (error) {
    console.error("keel/lit renderer: " + (error as Error).message);
    throw error;
  }

  let extensions: Any, capabilities: Any, state: Any, info: Any;
  let properties: Any, textures: Any, cubemaps: Any, cubeuvmaps: Any, attributes: Any, geometries: Any, objects: Any;
  let programCache: Any, materials: Any, renderLists: Any, renderStates: Any, clipping: Any, shadowMap: Any;
  let background: Any, bufferRenderer: Any, indexedBufferRenderer: Any;
  let utils: Any, bindingStates: Any;

  // (the renderer object; its members are assigned below, in r180's order)
  const _this = {} as Any as LitRenderer & Record<string, Any>;

  function initGLContext(): void {
    extensions = createExtensions(_gl);
    extensions.init();

    utils = createUtils(_gl, extensions);

    capabilities = createCapabilities(_gl, extensions, parameters, utils);

    state = createState(_gl, extensions);

    if (capabilities.reversedDepthBuffer && reversedDepthBuffer) {
      state.buffers.depth.setReversed(true);
    }

    info = createInfo(_gl);
    properties = createProperties();
    textures = createTextures(_gl, extensions, state, properties, capabilities, utils, info);
    cubemaps = createCubeMaps(_this);
    cubeuvmaps = createCubeUVMaps(_this);
    attributes = createAttributes(_gl);
    bindingStates = createBindingStates(_gl, attributes);
    geometries = createGeometries(_gl, attributes, info, bindingStates);
    objects = createObjects(_gl, geometries, attributes, info);
    clipping = createClipping(properties);
    programCache = createPrograms(_this, cubemaps, cubeuvmaps, extensions, capabilities, bindingStates, clipping);
    materials = createMaterials(_this, properties);
    renderLists = createRenderLists();
    renderStates = createRenderStates(extensions);
    background = createBackground(_this, cubemaps, cubeuvmaps, state, objects, _alpha, premultipliedAlpha);
    shadowMap = createShadowMap(_this, objects, capabilities);

    bufferRenderer = createBufferRenderer(_gl, extensions, info);
    indexedBufferRenderer = createIndexedBufferRenderer(_gl, extensions, info);

    info.programs = programCache.programs;

    _this.capabilities = capabilities;
    _this.extensions = extensions;
    _this.properties = properties;
    _this.renderLists = renderLists;
    _this.shadowMap = shadowMap;
    _this.state = state;
    _this.info = info;
  }

  // public properties (r180 sets these before the context; nothing reads them in between)

  Object.assign(_this, {
    isLitRenderer: true,
    isWebGLRenderer: true,
    domElement: canvas,
    debug: {
      checkShaderErrors: true,
      onShaderError: null,
    },

    // clearing

    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,

    // scene graph

    sortObjects: true,

    // user-defined clipping

    clippingPlanes: [],
    localClippingEnabled: false,

    // tone mapping

    toneMapping: "none",
    toneMappingExposure: 1.0,

    // transmission

    transmissionResolutionScale: 1.0,
  });

  Object.defineProperties(_this, {
    coordinateSystem: { get: () => "webgl", enumerable: true },
    outputColorSpace: {
      enumerable: true,
      get: () => _outputColorSpace,
      set: (colorSpace: ColorSpace) => {
        _outputColorSpace = colorSpace;

        const gl = _gl as Any;
        gl.drawingBufferColorSpace = colorManagement._getDrawingBufferColorSpace(colorSpace);
        gl.unpackColorSpace = colorManagement._getUnpackColorSpace();
      },
    },
  });

  initGLContext();

  _this.getContext = function () {
    return _gl;
  };

  _this.getContextAttributes = function () {
    return _gl.getContextAttributes();
  };

  _this.forceContextLoss = function () {
    const extension = extensions.get("WEBGL_lose_context");
    if (extension) extension.loseContext();
  };

  _this.forceContextRestore = function () {
    const extension = extensions.get("WEBGL_lose_context");
    if (extension) extension.restoreContext();
  };

  _this.getPixelRatio = function () {
    return _pixelRatio;
  };

  _this.setPixelRatio = function (value) {
    if (value === undefined) return;

    _pixelRatio = value;

    this.setSize(_width, _height, false);
  };

  _this.getSize = function (target) {
    return target.set(_width, _height) as Any;
  };

  _this.setSize = function (width, height, updateStyle = true) {
    _width = width;
    _height = height;

    canvas.width = Math.floor(width * _pixelRatio);
    canvas.height = Math.floor(height * _pixelRatio);

    if (updateStyle === true) {
      (canvas as HTMLCanvasElement).style.width = width + "px";
      (canvas as HTMLCanvasElement).style.height = height + "px";
    }

    this.setViewport(0, 0, width, height);
  };

  _this.getDrawingBufferSize = function (target) {
    return target.set(_width * _pixelRatio, _height * _pixelRatio).floor() as Any;
  };

  _this.setDrawingBufferSize = function (width, height, pixelRatio) {
    _width = width;
    _height = height;

    _pixelRatio = pixelRatio;

    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);

    this.setViewport(0, 0, width, height);
  };

  _this.getCurrentViewport = function (target) {
    return target.copy(_currentViewport);
  };

  _this.getViewport = function (target) {
    return target.copy(_viewport);
  };

  _this.setViewport = function (x, y, width, height) {
    if (typeof x === "object" && x.isVector4) {
      _viewport.set(x.x, x.y, x.z, x.w);
    } else {
      _viewport.set(x as number, y!, width!, height!);
    }

    state.viewport(_currentViewport.copy(_viewport).multiplyScalar(_pixelRatio).round());
  };

  _this.getScissor = function (target) {
    return target.copy(_scissor);
  };

  _this.setScissor = function (x, y, width, height) {
    if (typeof x === "object" && x.isVector4) {
      _scissor.set(x.x, x.y, x.z, x.w);
    } else {
      _scissor.set(x as number, y!, width!, height!);
    }

    state.scissor(_currentScissor.copy(_scissor).multiplyScalar(_pixelRatio).round());
  };

  _this.getScissorTest = function () {
    return _scissorTest;
  };

  _this.setScissorTest = function (boolean) {
    state.setScissorTest((_scissorTest = boolean));
  };

  _this.setOpaqueSort = function (method) {
    _opaqueSort = method;
  };

  _this.setTransparentSort = function (method) {
    _transparentSort = method;
  };

  // Clearing

  _this.getClearColor = function (target) {
    return target.copy(background.getClearColor());
  };

  _this.setClearColor = function (...args: [ColorRepresentation, number?]) {
    background.setClearColor(...args);
  };

  _this.getClearAlpha = function () {
    return background.getClearAlpha();
  };

  _this.setClearAlpha = function (...args: [number]) {
    background.setClearAlpha(...args);
  };

  _this.clear = function (color = true, depth = true, stencil = true) {
    let bits = 0;

    if (color) {
      // check if we're trying to clear an integer target
      let isIntegerFormat = false;
      if (_currentRenderTarget !== null) {
        const targetFormat = _currentRenderTarget.texture.format;
        isIntegerFormat = INTEGER_FORMATS.has(targetFormat);
      }

      // use the appropriate clear functions to clear the target if it's a signed
      // or unsigned integer target
      if (isIntegerFormat) {
        const targetType = _currentRenderTarget.texture.type;
        const isUnsignedType = UNSIGNED_TYPES.has(targetType);

        const clearColor = background.getClearColor();
        const a = background.getClearAlpha();
        const r = clearColor.r;
        const g = clearColor.g;
        const b = clearColor.b;

        if (isUnsignedType) {
          uintClearColor[0] = r;
          uintClearColor[1] = g;
          uintClearColor[2] = b;
          uintClearColor[3] = a;
          _gl.clearBufferuiv(_gl.COLOR, 0, uintClearColor);
        } else {
          intClearColor[0] = r;
          intClearColor[1] = g;
          intClearColor[2] = b;
          intClearColor[3] = a;
          _gl.clearBufferiv(_gl.COLOR, 0, intClearColor);
        }
      } else {
        bits |= _gl.COLOR_BUFFER_BIT;
      }
    }

    if (depth) {
      bits |= _gl.DEPTH_BUFFER_BIT;
    }

    if (stencil) {
      bits |= _gl.STENCIL_BUFFER_BIT;
      this.state.buffers.stencil.setMask(0xffffffff);
    }

    _gl.clear(bits);
  };

  _this.clearColor = function () {
    this.clear(true, false, false);
  };

  _this.clearDepth = function () {
    this.clear(false, true, false);
  };

  _this.clearStencil = function () {
    this.clear(false, false, true);
  };

  _this.dispose = function () {
    canvas.removeEventListener("webglcontextlost", onContextLost as EventListener, false);
    canvas.removeEventListener("webglcontextrestored", onContextRestore, false);
    canvas.removeEventListener("webglcontextcreationerror", onContextCreationError as EventListener, false);

    background.dispose();
    renderLists.dispose();
    renderStates.dispose();
    properties.dispose();
    cubemaps.dispose();
    cubeuvmaps.dispose();
    objects.dispose();
    bindingStates.dispose();
    programCache.dispose();

    animation.stop();
  };

  // Events

  function onContextLost(event: Event): void {
    event.preventDefault();

    console.log("keel/lit renderer: Context Lost.");

    _isContextLost = true;
  }

  function onContextRestore(/* event */): void {
    console.log("keel/lit renderer: Context Restored.");

    _isContextLost = false;

    const infoAutoReset = info.autoReset;
    const shadowMapEnabled = shadowMap.enabled;
    const shadowMapAutoUpdate = shadowMap.autoUpdate;
    const shadowMapNeedsUpdate = shadowMap.needsUpdate;
    const shadowMapType = shadowMap.type;

    initGLContext();

    info.autoReset = infoAutoReset;
    shadowMap.enabled = shadowMapEnabled;
    shadowMap.autoUpdate = shadowMapAutoUpdate;
    shadowMap.needsUpdate = shadowMapNeedsUpdate;
    shadowMap.type = shadowMapType;
  }

  function onContextCreationError(event: Event & { statusMessage?: string }): void {
    console.error("keel/lit renderer: A WebGL context could not be created. Reason: ", event.statusMessage);
  }

  function onMaterialDispose(event: Any): void {
    const material = event.target;

    material.removeEventListener("dispose", onMaterialDispose);

    deallocateMaterial(material);
  }

  // Buffer deallocation

  function deallocateMaterial(material: Any): void {
    releaseMaterialProgramReferences(material);

    properties.remove(material);
  }

  function releaseMaterialProgramReferences(material: Any): void {
    const programs = properties.get(material).programs;

    if (programs !== undefined) {
      programs.forEach(function (program: Any) {
        programCache.releaseProgram(program);
      });

      if (material.isShaderMaterial) {
        programCache.releaseShaderCache(material);
      }
    }
  }

  // Buffer rendering

  _this.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (scene === null) scene = _emptyScene; // renderBufferDirect second parameter used to be fog (could be null)

    const frontFaceCW = object.isMesh && object.matrixWorld.determinant() < 0;

    const program = setProgram(camera, scene, geometry, material, object);

    state.setMaterial(material, frontFaceCW);

    //

    let index = geometry.index;
    let rangeFactor = 1;

    if (material.wireframe === true) {
      index = geometries.getWireframeAttribute(geometry);

      if (index === undefined) return;

      rangeFactor = 2;
    }

    //

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

    //

    bindingStates.setup(object, material, program, geometry, index);

    let attribute;
    let renderer = bufferRenderer;

    if (index !== null) {
      attribute = attributes.get(index);

      renderer = indexedBufferRenderer;
      renderer.setIndex(attribute);
    }

    //

    if (object.isMesh) {
      if (material.wireframe === true) {
        state.setLineWidth(material.wireframeLinewidth * getTargetPixelRatio());
        renderer.setMode(_gl.LINES);
      } else {
        renderer.setMode(_gl.TRIANGLES);
      }
    } else if (object.isSprite) {
      renderer.setMode(_gl.TRIANGLES);
    }

    if (object.isInstancedMesh) {
      renderer.renderInstances(drawStart, drawCount, object.count);
    } else if (geometry.isInstancedBufferGeometry) {
      const maxInstanceCount = geometry._maxInstanceCount !== undefined ? geometry._maxInstanceCount : Infinity;
      const instanceCount = Math.min(geometry.instanceCount, maxInstanceCount);

      renderer.renderInstances(drawStart, drawCount, instanceCount);
    } else {
      renderer.render(drawStart, drawCount);
    }
  };

  // Compile

  function prepareMaterial(material: Any, scene: Any, object: Any): void {
    if (material.transparent === true && material.side === "both" && material.forceSinglePass === false) {
      material.side = "back";
      material.needsUpdate = true;
      getProgram(material, scene, object);

      material.side = "front";
      material.needsUpdate = true;
      getProgram(material, scene, object);

      material.side = "both";
    } else {
      getProgram(material, scene, object);
    }
  }

  _this.compile = function (scene, camera, targetScene = null) {
    if (targetScene === null) targetScene = scene;

    currentRenderState = renderStates.get(targetScene);
    currentRenderState.init(camera);

    renderStateStack.push(currentRenderState);

    // gather lights from both the target scene and the new object that will be added to the scene.

    targetScene.traverseVisible(function (object: Any) {
      if (object.isLight && object.layers.test(camera.layers)) {
        currentRenderState.pushLight(object);

        if (object.castShadow) {
          currentRenderState.pushShadow(object);
        }
      }
    });

    if (scene !== targetScene) {
      scene.traverseVisible(function (object: Any) {
        if (object.isLight && object.layers.test(camera.layers)) {
          currentRenderState.pushLight(object);

          if (object.castShadow) {
            currentRenderState.pushShadow(object);
          }
        }
      });
    }

    currentRenderState.setupLights();

    // Only initialize materials in the new scene, not the targetScene.

    const materials = new Set<Any>();

    scene.traverse(function (object: Any) {
      if (!(object.isMesh || object.isPoints || object.isLine || object.isSprite)) {
        return;
      }

      const material = object.material;

      if (material) {
        if (Array.isArray(material)) {
          for (let i = 0; i < material.length; i++) {
            const material2 = material[i];

            prepareMaterial(material2, targetScene, object);
            materials.add(material2);
          }
        } else {
          prepareMaterial(material, targetScene, object);
          materials.add(material);
        }
      }
    });

    currentRenderState = renderStateStack.pop();

    return materials;
  };

  // compileAsync

  _this.compileAsync = function (scene, camera, targetScene = null) {
    const materials = this.compile(scene, camera, targetScene);

    // Wait for all the materials in the new object to indicate that they're
    // ready to be used before resolving the promise.

    return new Promise((resolve) => {
      function checkMaterialsReady(): void {
        materials.forEach(function (material) {
          const materialProperties = properties.get(material);
          const program = materialProperties.currentProgram;

          if (program.isReady()) {
            // remove any programs that report they're ready to use from the list
            materials.delete(material);
          }
        });

        // once the list of compiling materials is empty, call the callback

        if (materials.size === 0) {
          resolve(scene);
          return;
        }

        // if some materials are still not ready, wait a bit and check again

        setTimeout(checkMaterialsReady, 10);
      }

      if (extensions.get("KHR_parallel_shader_compile") !== null) {
        // If we can check the compilation status of the materials without
        // blocking then do so right away.

        checkMaterialsReady();
      } else {
        // Otherwise start by waiting a bit to give the materials we just
        // initialized a chance to finish.

        setTimeout(checkMaterialsReady, 10);
      }
    });
  };

  // Animation Loop

  let onAnimationFrameCallback: AnimationLoop | null = null;

  function onAnimationFrame(time: number): void {
    if (onAnimationFrameCallback) onAnimationFrameCallback(time);
  }

  const animation = createAnimation();
  animation.setAnimationLoop(onAnimationFrame);

  if (typeof self !== "undefined") animation.setContext(self);

  _this.setAnimationLoop = function (callback) {
    onAnimationFrameCallback = callback;

    callback === null ? animation.stop() : animation.start();
  };

  // Rendering

  _this.render = function (scene, camera) {
    if (camera !== undefined && camera.isCamera !== true) {
      console.error("keel/lit renderer.render: camera is not a Camera.");
      return;
    }

    if (_isContextLost === true) return;

    // update scene graph

    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();

    // update camera matrices and frustum

    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();

    //
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
      currentRenderList.sort(_opaqueSort, _transparentSort);
    }

    _renderBackground = true;
    if (_renderBackground) {
      background.addToRenderList(currentRenderList, scene);
    }

    //

    this.info.render.frame++;

    if (_clippingEnabled === true) clipping.beginShadows();

    const shadowsArray = currentRenderState.state.shadowsArray;

    shadowMap.render(shadowsArray, scene, camera);

    if (_clippingEnabled === true) clipping.endShadows();

    //

    if (this.info.autoReset === true) this.info.reset();

    // render scene

    const transmissiveObjects = currentRenderList.transmissive;

    currentRenderState.setupLights();

    if (transmissiveObjects.length > 0) {
      // (keel/lit has no transmissive materials; r180 would draw a transmission pass here)
      console.warn("keel/lit renderer: transmissive objects are not drawn by keel/lit.");
    }

    if (_renderBackground) background.render(scene);

    renderScene(currentRenderList, scene, camera);

    //

    if (_currentRenderTarget !== null && _currentActiveMipmapLevel === 0) {
      // resolve multisample renderbuffers to a single-sample texture if necessary
      textures.updateMultisampleRenderTarget(_currentRenderTarget);

      // Generate mipmap if we're using any kind of mipmap filtering
      textures.updateRenderTargetMipmap(_currentRenderTarget);
    }

    //

    if (scene.isScene === true) scene.onAfterRender(_this, scene, camera);

    // _gl.finish();

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

  function projectObject(object: Any, camera: Any, groupOrder: number, sortObjects: boolean): void {
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
      } else if (object.isMesh) {
        if (!object.frustumCulled || _frustum.intersectsObject(object)) {
          const geometry = objects.update(object);
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

  function renderScene(currentRenderList: Any, scene: Any, camera: Any, viewport?: Vector4): void {
    const opaqueObjects = currentRenderList.opaque;
    const transmissiveObjects = currentRenderList.transmissive;
    const transparentObjects = currentRenderList.transparent;

    currentRenderState.setupLightsView(camera);

    if (_clippingEnabled === true) clipping.setGlobalState(_this.clippingPlanes, camera);

    if (viewport) state.viewport(_currentViewport.copy(viewport));

    if (opaqueObjects.length > 0) renderObjects(opaqueObjects, scene, camera);
    if (transmissiveObjects.length > 0) renderObjects(transmissiveObjects, scene, camera);
    if (transparentObjects.length > 0) renderObjects(transparentObjects, scene, camera);

    // Ensure depth buffer writing is enabled so it can be cleared on next render

    state.buffers.depth.setTest(true);
    state.buffers.depth.setMask(true);
    state.buffers.color.setMask(true);

    state.setPolygonOffset(false);
  }

  function renderObjects(renderList: Any[], scene: Any, camera: Any): void {
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

  function renderObject(object: Any, scene: Any, camera: Any, geometry: Any, material: Any, group: Any): void {
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

  function getProgram(material: Any, scene: Any, object: Any): Any {
    if (scene.isScene !== true) scene = _emptyScene; // scene could be a Mesh, Line, Points, ...

    const materialProperties = properties.get(material);

    const lights = currentRenderState.state.lights;
    const shadowsArray = currentRenderState.state.shadowsArray;

    const lightsStateVersion = lights.state.version;

    const parameters = programCache.getParameters(material, lights.state, shadowsArray, scene, object);
    const programCacheKey = programCache.getProgramCacheKey(parameters);

    let programs = materialProperties.programs;

    // always update environment and fog - changing these trigger an getProgram call, but it's possible that the program doesn't change

    materialProperties.environment = material.isMeshStandardMaterial ? scene.environment : null;
    materialProperties.fog = scene.fog;
    materialProperties.envMap = (material.isMeshStandardMaterial ? cubeuvmaps : cubemaps).get(material.envMap || materialProperties.environment);
    materialProperties.envMapRotation = materialProperties.environment !== null && material.envMap === null ? scene.environmentRotation : material.envMapRotation;

    if (programs === undefined) {
      // new material

      material.addEventListener("dispose", onMaterialDispose);

      programs = new Map();
      materialProperties.programs = programs;
    }

    let program = programs.get(programCacheKey);

    if (program !== undefined) {
      // early out if program and light state is identical

      if (materialProperties.currentProgram === program && materialProperties.lightsStateVersion === lightsStateVersion) {
        updateCommonMaterialProperties(material, parameters);

        return program;
      }
    } else {
      parameters.uniforms = programCache.getUniforms(material);

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

    // store the light setup it was created for

    materialProperties.needsLights = materialNeedsLights(material);
    materialProperties.lightsStateVersion = lightsStateVersion;

    if (materialProperties.needsLights) {
      // wire up the material to this renderer's lighting state

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
      // TODO (abelnation): add area lights shadow info to uniforms
    }

    materialProperties.currentProgram = program;
    materialProperties.uniformsList = null;

    return program;
  }

  function getUniformList(materialProperties: Any): Any {
    if (materialProperties.uniformsList === null) {
      const progUniforms = materialProperties.currentProgram.getUniforms();
      materialProperties.uniformsList = seqWithValue(progUniforms.seq, materialProperties.uniforms);
    }

    return materialProperties.uniformsList;
  }

  function updateCommonMaterialProperties(material: Any, parameters: Any): void {
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

  function setProgram(camera: Any, scene: Any, geometry: Any, material: Any, object: Any): Any {
    if (scene.isScene !== true) scene = _emptyScene; // scene could be a Mesh, Line, Points, ...

    textures.resetTextureUnits();

    const fog = scene.fog;
    const environment = material.isMeshStandardMaterial ? scene.environment : null;
    const colorSpace = _currentRenderTarget === null ? _this.outputColorSpace : _currentRenderTarget.isXRRenderTarget === true ? _currentRenderTarget.texture.colorSpace : "linear";
    const envMap = (material.isMeshStandardMaterial ? cubeuvmaps : cubemaps).get(material.envMap || environment);
    const vertexAlphas = material.vertexColors === true && !!geometry.attributes.color && geometry.attributes.color.itemSize === 4;
    const vertexTangents = !!geometry.attributes.tangent && (!!material.normalMap || material.anisotropy > 0);
    const morphTargets = !!geometry.morphAttributes.position;
    const morphNormals = !!geometry.morphAttributes.normal;
    const morphColors = !!geometry.morphAttributes.color;

    let toneMapping: ToneMapping = "none";

    if (material.toneMapped) {
      if (_currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true) {
        toneMapping = _this.toneMapping;
      }
    }

    const morphAttribute = geometry.morphAttributes.position || geometry.morphAttributes.normal || geometry.morphAttributes.color;
    const morphTargetsCount = morphAttribute !== undefined ? morphAttribute.length : 0;

    const materialProperties = properties.get(material);
    const lights = currentRenderState.state.lights;

    if (_clippingEnabled === true) {
      if (_localClippingEnabled === true || camera !== _currentCamera) {
        const useCache = camera === _currentCamera && material.id === _currentMaterialId;

        // we might want to call this function with some ClippingGroup
        // object instead of the material, once it becomes feasible
        // (#8465, #8379)
        clipping.setState(material, camera, useCache);
      }
    }

    //

    let needsProgramChange = false;

    if (material.version === materialProperties.__version) {
      if (materialProperties.needsLights && materialProperties.lightsStateVersion !== lights.state.version) {
        needsProgramChange = true;
      } else if (materialProperties.outputColorSpace !== colorSpace) {
        needsProgramChange = true;
      } else if (materialProperties.batching === true) {
        needsProgramChange = true;
      } else if (object.isInstancedMesh && materialProperties.instancing === false) {
        needsProgramChange = true;
      } else if (!object.isInstancedMesh && materialProperties.instancing === true) {
        needsProgramChange = true;
      } else if (materialProperties.skinning === true) {
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
      } else if (
        materialProperties.numClippingPlanes !== undefined &&
        (materialProperties.numClippingPlanes !== clipping.numPlanes || materialProperties.numIntersection !== clipping.numIntersection)
      ) {
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

    //

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
      // common camera uniforms

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

      // consider moving isOrthographic to UniformLib and WebGLMaterials, see https://github.com/mrdoob/three.js/pull/26467#issuecomment-1645185067

      if (
        material.isMeshPhongMaterial ||
        material.isMeshToonMaterial ||
        material.isMeshLambertMaterial ||
        material.isMeshBasicMaterial ||
        material.isMeshStandardMaterial ||
        material.isShaderMaterial
      ) {
        p_uniforms.setValue(_gl, "isOrthographic", camera.isOrthographicCamera === true);
      }

      if (_currentCamera !== camera) {
        _currentCamera = camera;

        // lighting uniforms depend on the camera so enforce an update
        // now, in case this material supports lights - or later, when
        // the next material that does gets activated:

        refreshMaterial = true; // set to true on material change
        refreshLights = true; // remains set until update done
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
        // the current material requires lighting info

        // note: all lighting uniforms are always set correctly
        // they simply reference the renderer's state for their
        // values
        //
        // use the current material's .needsUpdate flags to set
        // the GL state when required

        markUniformsLightsNeedsUpdate(m_uniforms, refreshLights);
      }

      // refresh uniforms common to several materials

      if (fog && material.fog === true) {
        materials.refreshFogUniforms(m_uniforms, fog);
      }

      materials.refreshMaterialUniforms(m_uniforms, material, _pixelRatio, _height, currentRenderState.state.transmissionRenderTarget[camera.id]);

      upload(_gl, getUniformList(materialProperties), m_uniforms, textures);
    }

    if (material.isShaderMaterial && material.uniformsNeedUpdate === true) {
      upload(_gl, getUniformList(materialProperties), m_uniforms, textures);
      material.uniformsNeedUpdate = false;
    }

    if (material.isSpriteMaterial) {
      p_uniforms.setValue(_gl, "center", object.center);
    }

    // common matrices

    p_uniforms.setValue(_gl, "modelViewMatrix", object.modelViewMatrix);
    p_uniforms.setValue(_gl, "normalMatrix", object.normalMatrix);
    p_uniforms.setValue(_gl, "modelMatrix", object.matrixWorld);

    // UBOs

    if (material.isShaderMaterial && material.uniformsGroups.length > 0) {
      // (keel/lit has no uniform buffer groups)
      console.warn("keel/lit renderer: CustomMaterial.uniformsGroups is not supported.");
    }

    return program;
  }

  // If uniforms are marked as clean, they don't need to be loaded to the GPU.

  function markUniformsLightsNeedsUpdate(uniforms: Any, value: boolean): void {
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

  function materialNeedsLights(material: Any): boolean {
    return (
      material.isMeshLambertMaterial ||
      material.isMeshToonMaterial ||
      material.isMeshPhongMaterial ||
      material.isMeshStandardMaterial ||
      material.isShadowMaterial ||
      (material.isShaderMaterial && material.lights === true)
    );
  }

  _this.getActiveCubeFace = function () {
    return _currentActiveCubeFace;
  };

  _this.getActiveMipmapLevel = function () {
    return _currentActiveMipmapLevel;
  };

  _this.getRenderTarget = function () {
    return _currentRenderTarget;
  };

  const _scratchFrameBuffer = _gl.createFramebuffer();

  _this.setRenderTarget = function (renderTarget, activeCubeFace = 0, activeMipmapLevel = 0) {
    _currentRenderTarget = renderTarget;
    _currentActiveCubeFace = activeCubeFace;
    _currentActiveMipmapLevel = activeMipmapLevel;

    let useDefaultFramebuffer = true;
    let framebuffer = null;
    let isCube = false;
    let isRenderTarget3D = false;

    if (renderTarget) {
      const rt = renderTarget as Any;
      const renderTargetProperties = properties.get(rt);

      if (renderTargetProperties.__useDefaultFramebuffer !== undefined) {
        // We need to make sure to rebind the framebuffer.
        state.bindFramebuffer(_gl.FRAMEBUFFER, null);
        useDefaultFramebuffer = false;
      } else if (renderTargetProperties.__webglFramebuffer === undefined) {
        textures.setupRenderTarget(rt);
      } else if (renderTargetProperties.__hasExternalTextures) {
        // Color and depth texture must be rebound in order for the swapchain to update.
        textures.rebindTextures(rt, properties.get(rt.texture).__webglTexture, properties.get(rt.depthTexture).__webglTexture);
      } else if (rt.depthBuffer) {
        // check if the depth texture is already bound to the frame buffer and that it's been initialized
        const depthTexture = rt.depthTexture;
        if (renderTargetProperties.__boundDepthTexture !== depthTexture) {
          // check if the depth texture is compatible
          if (depthTexture !== null && properties.has(depthTexture) && (rt.width !== depthTexture.image.width || rt.height !== depthTexture.image.height)) {
            throw new Error("RenderTarget: Attached DepthTexture is initialized to the incorrect size.");
          }

          // Swap the depth buffer to the currently attached one
          textures.setupDepthRenderbuffer(rt);
        }
      }

      const texture = rt.texture;

      if (texture.isData3DTexture || texture.isDataArrayTexture || texture.isCompressedArrayTexture) {
        isRenderTarget3D = true;
      }

      const __webglFramebuffer = properties.get(rt).__webglFramebuffer;

      if (rt.isWebGLCubeRenderTarget) {
        if (Array.isArray(__webglFramebuffer[activeCubeFace])) {
          framebuffer = __webglFramebuffer[activeCubeFace][activeMipmapLevel];
        } else {
          framebuffer = __webglFramebuffer[activeCubeFace];
        }

        isCube = true;
      } else if (rt.samples > 0 && textures.useMultisampledRTT(rt) === false) {
        framebuffer = properties.get(rt).__webglMultisampledFramebuffer;
      } else {
        if (Array.isArray(__webglFramebuffer)) {
          framebuffer = __webglFramebuffer[activeMipmapLevel];
        } else {
          framebuffer = __webglFramebuffer;
        }
      }

      _currentViewport.copy(rt.viewport);
      _currentScissor.copy(rt.scissor);
      _currentScissorTest = rt.scissorTest;
    } else {
      _currentViewport.copy(_viewport).multiplyScalar(_pixelRatio).floor();
      _currentScissor.copy(_scissor).multiplyScalar(_pixelRatio).floor();
      _currentScissorTest = _scissorTest;
    }

    // Use a scratch frame buffer if rendering to a mip level to avoid depth buffers
    // being bound that are different sizes.
    if (activeMipmapLevel !== 0) {
      framebuffer = _scratchFrameBuffer;
    }

    const framebufferBound = state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);

    if (framebufferBound && useDefaultFramebuffer) {
      state.drawBuffers(renderTarget as Any, framebuffer);
    }

    state.viewport(_currentViewport);
    state.scissor(_currentScissor);
    state.setScissorTest(_currentScissorTest!);

    if (isCube) {
      const textureProperties = properties.get((renderTarget as Any).texture);
      _gl.framebufferTexture2D(_gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_CUBE_MAP_POSITIVE_X + activeCubeFace, textureProperties.__webglTexture, activeMipmapLevel);
    } else if (isRenderTarget3D) {
      const layer = activeCubeFace;
      const rt = renderTarget as Any;

      for (let i = 0; i < rt.textures.length; i++) {
        const textureProperties = properties.get(rt.textures[i]);

        _gl.framebufferTextureLayer(_gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, textureProperties.__webglTexture, activeMipmapLevel, layer);
      }
    } else if (renderTarget !== null && activeMipmapLevel !== 0) {
      // Only bind the frame buffer if we are using a scratch frame buffer to render to a mipmap.
      // If we rebind the texture when using a multi sample buffer then an error about inconsistent samples will be thrown.
      const textureProperties = properties.get((renderTarget as Any).texture);
      _gl.framebufferTexture2D(_gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, textureProperties.__webglTexture, activeMipmapLevel);
    }

    _currentMaterialId = -1; // reset current material to ensure correct uniform bindings
  };

  _this.readRenderTargetPixels = function (renderTarget, x, y, width, height, buffer, activeCubeFaceIndex, textureIndex = 0) {
    const rt = renderTarget as Any;

    if (!(rt && rt.isWebGLRenderTarget)) {
      console.error("keel/lit renderer.readRenderTargetPixels: renderTarget is not a RenderTarget.");
      return;
    }

    let framebuffer = properties.get(rt).__webglFramebuffer;

    if (rt.isWebGLCubeRenderTarget && activeCubeFaceIndex !== undefined) {
      framebuffer = framebuffer[activeCubeFaceIndex];
    }

    if (framebuffer) {
      state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);

      try {
        const texture = rt.textures[textureIndex];
        const textureFormat = texture.format;
        const textureType = texture.type;

        if (!capabilities.textureFormatReadable(textureFormat)) {
          console.error("keel/lit renderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");
          return;
        }

        if (!capabilities.textureTypeReadable(textureType)) {
          console.error("keel/lit renderer.readRenderTargetPixels: renderTarget is not in u8 or implementation defined type.");
          return;
        }

        // the following if statement ensures valid read requests (no out-of-bounds pixels, see #8604)

        if (x >= 0 && x <= rt.width - width && y >= 0 && y <= rt.height - height) {
          // when using MRT, select the correct color buffer for the subsequent read command

          if (rt.textures.length > 1) _gl.readBuffer(_gl.COLOR_ATTACHMENT0 + textureIndex);

          _gl.readPixels(x, y, width, height, utils.convert(textureFormat), utils.convert(textureType), buffer);
        }
      } finally {
        // restore framebuffer of current render target if necessary

        const framebuffer = _currentRenderTarget !== null ? properties.get(_currentRenderTarget).__webglFramebuffer : null;
        state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);
      }
    }
  };

  _this.copyFramebufferToTexture = function (texture, position = null, level = 0) {
    const levelScale = Math.pow(2, -level);
    const width = Math.floor(texture.image.width * levelScale);
    const height = Math.floor(texture.image.height * levelScale);

    const x = position !== null ? position.x : 0;
    const y = position !== null ? position.y : 0;

    textures.setTexture2D(texture, 0);

    _gl.copyTexSubImage2D(_gl.TEXTURE_2D, level, 0, 0, x, y, width, height);

    state.unbindTexture();
  };

  _this.initRenderTarget = function (target) {
    if (properties.get(target).__webglFramebuffer === undefined) {
      textures.setupRenderTarget(target);
    }
  };

  _this.initTexture = function (texture) {
    if (texture.isCubeTexture) {
      textures.setTextureCube(texture, 0);
    } else if (texture.isData3DTexture) {
      textures.setTexture3D(texture, 0);
    } else if (texture.isDataArrayTexture || texture.isCompressedArrayTexture) {
      textures.setTexture2DArray(texture, 0);
    } else {
      textures.setTexture2D(texture, 0);
    }

    state.unbindTexture();
  };

  _this.resetState = function () {
    _currentActiveCubeFace = 0;
    _currentActiveMipmapLevel = 0;
    _currentRenderTarget = null;

    state.reset();
    bindingStates.reset();
  };

  return _this;
}
