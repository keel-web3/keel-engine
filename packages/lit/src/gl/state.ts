// Ported from Three.js r180's renderers/webgl/WebGLState.js (MIT, see
// packages/lit/NOTICE): the GL state the renderer sets, cached so each change
// reaches GL once. The same calls with the same arguments in the same order as
// r180, branch for branch.
//
// keel/lit's constants are strings (side "both", blending "normal", depthFunc
// "less-equal", stencilFunc "always"...); each lands on the GL enum r180 uses
// for its number. The caches compare the strings where r180 compares numbers,
// which is the same test.

import { COMPARE_FUNC, STENCIL_OP } from "../constants.ts";
import type { BlendEquation, BlendFactor, Blending, CompareFunction, CullFace, Side, StencilOp } from "../constants.ts";
import { Color } from "../math/Color.ts";
import { Vector4 } from "../math/Vector4.ts";
import type { Extensions } from "./extensions.ts";

const reversedFuncs: Readonly<Record<CompareFunction, CompareFunction>> = {
  never: "always",
  less: "greater",
  equal: "not-equal",
  "less-equal": "greater-equal",

  always: "never",
  greater: "less",
  "not-equal": "equal",
  "greater-equal": "less-equal",
};

/** The material fields setMaterial reads (r180's Material). */
export interface StateMaterial {
  side: Side;
  blending: Blending;
  transparent: boolean;
  blendEquation: BlendEquation;
  blendSrc: BlendFactor;
  blendDst: BlendFactor;
  blendEquationAlpha: BlendEquation | null;
  blendSrcAlpha: BlendFactor | null;
  blendDstAlpha: BlendFactor | null;
  blendColor: Color;
  blendAlpha: number;
  premultipliedAlpha: boolean;
  depthFunc: CompareFunction;
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
  stencilWrite: boolean;
  stencilWriteMask: number;
  stencilFunc: CompareFunction;
  stencilRef: number;
  stencilFuncMask: number;
  stencilFail: StencilOp;
  stencilZFail: StencilOp;
  stencilZPass: StencilOp;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  alphaToCoverage: boolean;
}

/** What drawBuffers reads of a render target. */
export interface StateRenderTarget {
  textures: readonly unknown[];
}

/** A uniforms group (r180's UniformsGroup), as the block binding reads it. */
export interface StateUniformsGroup {
  name: string;
  __bindingPointIndex?: number;
}

export interface ColorBuffer {
  setMask(colorMask: boolean): void;
  setLocked(lock: boolean): void;
  setClear(r: number, g: number, b: number, a: number, premultipliedAlpha?: boolean): void;
  reset(): void;
}

export interface DepthBuffer {
  setReversed(reversed: boolean): void;
  getReversed(): boolean;
  setTest(depthTest: boolean): void;
  setMask(depthMask: boolean): void;
  setFunc(depthFunc: CompareFunction): void;
  setLocked(lock: boolean): void;
  setClear(depth: number | null): void;
  reset(): void;
}

export interface StencilBuffer {
  setTest(stencilTest: boolean): void;
  setMask(stencilMask: number): void;
  setFunc(stencilFunc: CompareFunction, stencilRef: number, stencilMask: number): void;
  setOp(stencilFail: StencilOp, stencilZFail: StencilOp, stencilZPass: StencilOp): void;
  setLocked(lock: boolean): void;
  setClear(stencil: number): void;
  reset(): void;
}

// (the texture upload wrappers pass their arguments straight through, as r180's do)
type Passthrough = (...args: any[]) => void;

/** r180's WebGLState. */
export interface State {
  buffers: { color: ColorBuffer; depth: DepthBuffer; stencil: StencilBuffer };

  enable(id: number): void;
  disable(id: number): void;

  bindFramebuffer(target: number, framebuffer: WebGLFramebuffer | null | undefined): boolean;
  drawBuffers(renderTarget: StateRenderTarget | null | undefined, framebuffer: WebGLFramebuffer | null | undefined): void;

  useProgram(program: WebGLProgram | null): boolean;

  setBlending(
    blending: Blending,
    blendEquation?: BlendEquation,
    blendSrc?: BlendFactor,
    blendDst?: BlendFactor,
    blendEquationAlpha?: BlendEquation | null,
    blendSrcAlpha?: BlendFactor | null,
    blendDstAlpha?: BlendFactor | null,
    blendColor?: Color,
    blendAlpha?: number,
    premultipliedAlpha?: boolean,
  ): void;
  setMaterial(material: StateMaterial, frontFaceCW?: boolean): void;

  setFlipSided(flipSided: boolean): void;
  setCullFace(cullFace: CullFace): void;

  setLineWidth(width: number): void;
  setPolygonOffset(polygonOffset: boolean, factor?: number, units?: number): void;

  setScissorTest(scissorTest: boolean): void;

  activeTexture(webglSlot?: number): void;
  bindTexture(webglType: number, webglTexture: WebGLTexture | null | undefined, webglSlot?: number): void;
  unbindTexture(): void;
  compressedTexImage2D: Passthrough;
  compressedTexImage3D: Passthrough;
  texImage2D: Passthrough;
  texImage3D: Passthrough;

  updateUBOMapping(uniformsGroup: StateUniformsGroup, program: WebGLProgram): void;
  uniformBlockBinding(uniformsGroup: StateUniformsGroup, program: WebGLProgram): void;

  texStorage2D: Passthrough;
  texStorage3D: Passthrough;
  texSubImage2D: Passthrough;
  texSubImage3D: Passthrough;
  compressedTexSubImage2D: Passthrough;
  compressedTexSubImage3D: Passthrough;

  scissor(scissor: Vector4): void;
  viewport(viewport: Vector4): void;

  reset(): void;
}

export function createState(gl: WebGL2RenderingContext, extensions: Extensions): State {
  function ColorBuffer(): ColorBuffer {
    let locked = false;

    const color = new Vector4();
    let currentColorMask: boolean | null = null;
    const currentColorClear = new Vector4(0, 0, 0, 0);

    return {
      setMask: function (colorMask: boolean): void {
        if (currentColorMask !== colorMask && !locked) {
          gl.colorMask(colorMask, colorMask, colorMask, colorMask);
          currentColorMask = colorMask;
        }
      },

      setLocked: function (lock: boolean): void {
        locked = lock;
      },

      setClear: function (r: number, g: number, b: number, a: number, premultipliedAlpha?: boolean): void {
        if (premultipliedAlpha === true) {
          r *= a; g *= a; b *= a;
        }

        color.set(r, g, b, a);

        if (currentColorClear.equals(color) === false) {
          gl.clearColor(r, g, b, a);
          currentColorClear.copy(color);
        }
      },

      reset: function (): void {
        locked = false;

        currentColorMask = null;
        currentColorClear.set(- 1, 0, 0, 0); // set to invalid state
      },
    };
  }

  function DepthBuffer(): DepthBuffer {
    let locked = false;

    let currentReversed = false;
    let currentDepthMask: boolean | null = null;
    let currentDepthFunc: CompareFunction | null = null;
    let currentDepthClear: number | null = null;

    return {
      setReversed: function (reversed: boolean): void {
        if (currentReversed !== reversed) {
          const ext = extensions.get("EXT_clip_control");

          if (reversed) {
            ext.clipControlEXT(ext.LOWER_LEFT_EXT, ext.ZERO_TO_ONE_EXT);
          } else {
            ext.clipControlEXT(ext.LOWER_LEFT_EXT, ext.NEGATIVE_ONE_TO_ONE_EXT);
          }

          currentReversed = reversed;

          const oldDepth = currentDepthClear;
          currentDepthClear = null;
          this.setClear(oldDepth);
        }
      },

      getReversed: function (): boolean {
        return currentReversed;
      },

      setTest: function (depthTest: boolean): void {
        if (depthTest) {
          enable(gl.DEPTH_TEST);
        } else {
          disable(gl.DEPTH_TEST);
        }
      },

      setMask: function (depthMask: boolean): void {
        if (currentDepthMask !== depthMask && !locked) {
          gl.depthMask(depthMask);
          currentDepthMask = depthMask;
        }
      },

      setFunc: function (depthFunc: CompareFunction): void {
        if (currentReversed) depthFunc = reversedFuncs[depthFunc];

        if (currentDepthFunc !== depthFunc) {
          switch (depthFunc) {
            case "never":
              gl.depthFunc(gl.NEVER);
              break;

            case "always":
              gl.depthFunc(gl.ALWAYS);
              break;

            case "less":
              gl.depthFunc(gl.LESS);
              break;

            case "less-equal":
              gl.depthFunc(gl.LEQUAL);
              break;

            case "equal":
              gl.depthFunc(gl.EQUAL);
              break;

            case "greater-equal":
              gl.depthFunc(gl.GEQUAL);
              break;

            case "greater":
              gl.depthFunc(gl.GREATER);
              break;

            case "not-equal":
              gl.depthFunc(gl.NOTEQUAL);
              break;

            default:
              gl.depthFunc(gl.LEQUAL);
          }

          currentDepthFunc = depthFunc;
        }
      },

      setLocked: function (lock: boolean): void {
        locked = lock;
      },

      // (r180 passes null through here from setReversed before any clear depth is set: GL reads it as 0)
      setClear: function (depth: number | null): void {
        if (currentDepthClear !== depth) {
          if (currentReversed) {
            depth = 1 - (depth as number);
          }

          gl.clearDepth(depth as number);
          currentDepthClear = depth;
        }
      },

      reset: function (): void {
        locked = false;

        currentDepthMask = null;
        currentDepthFunc = null;
        currentDepthClear = null;
        currentReversed = false;
      },
    };
  }

  function StencilBuffer(): StencilBuffer {
    let locked = false;

    let currentStencilMask: number | null = null;
    let currentStencilFunc: CompareFunction | null = null;
    let currentStencilRef: number | null = null;
    let currentStencilFuncMask: number | null = null;
    let currentStencilFail: StencilOp | null = null;
    let currentStencilZFail: StencilOp | null = null;
    let currentStencilZPass: StencilOp | null = null;
    let currentStencilClear: number | null = null;

    return {
      setTest: function (stencilTest: boolean): void {
        if (!locked) {
          if (stencilTest) {
            enable(gl.STENCIL_TEST);
          } else {
            disable(gl.STENCIL_TEST);
          }
        }
      },

      setMask: function (stencilMask: number): void {
        if (currentStencilMask !== stencilMask && !locked) {
          gl.stencilMask(stencilMask);
          currentStencilMask = stencilMask;
        }
      },

      setFunc: function (stencilFunc: CompareFunction, stencilRef: number, stencilMask: number): void {
        if (currentStencilFunc !== stencilFunc ||
          currentStencilRef !== stencilRef ||
          currentStencilFuncMask !== stencilMask) {
          gl.stencilFunc(COMPARE_FUNC[stencilFunc], stencilRef, stencilMask);

          currentStencilFunc = stencilFunc;
          currentStencilRef = stencilRef;
          currentStencilFuncMask = stencilMask;
        }
      },

      setOp: function (stencilFail: StencilOp, stencilZFail: StencilOp, stencilZPass: StencilOp): void {
        if (currentStencilFail !== stencilFail ||
          currentStencilZFail !== stencilZFail ||
          currentStencilZPass !== stencilZPass) {
          gl.stencilOp(STENCIL_OP[stencilFail], STENCIL_OP[stencilZFail], STENCIL_OP[stencilZPass]);

          currentStencilFail = stencilFail;
          currentStencilZFail = stencilZFail;
          currentStencilZPass = stencilZPass;
        }
      },

      setLocked: function (lock: boolean): void {
        locked = lock;
      },

      setClear: function (stencil: number): void {
        if (currentStencilClear !== stencil) {
          gl.clearStencil(stencil);
          currentStencilClear = stencil;
        }
      },

      reset: function (): void {
        locked = false;

        currentStencilMask = null;
        currentStencilFunc = null;
        currentStencilRef = null;
        currentStencilFuncMask = null;
        currentStencilFail = null;
        currentStencilZFail = null;
        currentStencilZPass = null;
        currentStencilClear = null;
      },
    };
  }

  //

  const colorBuffer = ColorBuffer();
  const depthBuffer = DepthBuffer();
  const stencilBuffer = StencilBuffer();

  const uboBindings = new WeakMap<WebGLProgram, number>();
  const uboProgramMap = new WeakMap<WebGLProgram, WeakMap<StateUniformsGroup, number>>();

  let enabledCapabilities: Record<number, boolean> = {};

  let currentBoundFramebuffers: Record<number, WebGLFramebuffer | null | undefined> = {};
  let currentDrawbuffers = new WeakMap<WebGLFramebuffer, number[]>();
  let defaultDrawbuffers: number[] = [];

  let currentProgram: WebGLProgram | null = null;

  let currentBlendingEnabled = false;
  let currentBlending: Blending | null = null;
  let currentBlendEquation: BlendEquation | null | undefined = null;
  let currentBlendSrc: BlendFactor | null | undefined = null;
  let currentBlendDst: BlendFactor | null | undefined = null;
  let currentBlendEquationAlpha: BlendEquation | null | undefined = null;
  let currentBlendSrcAlpha: BlendFactor | null | undefined = null;
  let currentBlendDstAlpha: BlendFactor | null | undefined = null;
  let currentBlendColor = new Color(0, 0, 0);
  let currentBlendAlpha: number | undefined = 0;
  let currentPremultipledAlpha: boolean | undefined = false;

  let currentFlipSided: boolean | null = null;
  let currentCullFace: CullFace | null = null;

  let currentLineWidth: number | null = null;

  let currentPolygonOffsetFactor: number | null | undefined = null;
  let currentPolygonOffsetUnits: number | null | undefined = null;

  const maxTextures = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number;

  let lineWidthAvailable = false;
  let version = 0;
  const glVersion = gl.getParameter(gl.VERSION) as string;

  if (glVersion.indexOf("WebGL") !== - 1) {
    version = parseFloat(/^WebGL (\d)/.exec(glVersion)![1]!);
    lineWidthAvailable = (version >= 1.0);
  } else if (glVersion.indexOf("OpenGL ES") !== - 1) {
    version = parseFloat(/^OpenGL ES (\d)/.exec(glVersion)![1]!);
    lineWidthAvailable = (version >= 2.0);
  }

  let currentTextureSlot: number | null = null;
  let currentBoundTextures: Record<number, { type: number | undefined; texture: WebGLTexture | null | undefined }> = {};

  const scissorParam = gl.getParameter(gl.SCISSOR_BOX) as ArrayLike<number>;
  const viewportParam = gl.getParameter(gl.VIEWPORT) as ArrayLike<number>;

  const currentScissor = new Vector4().fromArray(scissorParam);
  const currentViewport = new Vector4().fromArray(viewportParam);

  function createTexture(type: number, target: number, count: number, dimensions?: number): WebGLTexture {
    const data = new Uint8Array(4); // 4 is required to match default unpack alignment of 4.
    const texture = gl.createTexture();

    gl.bindTexture(type, texture);
    gl.texParameteri(type, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(type, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    for (let i = 0; i < count; i++) {
      if (type === gl.TEXTURE_3D || type === gl.TEXTURE_2D_ARRAY) {
        gl.texImage3D(target, 0, gl.RGBA, 1, 1, dimensions as number, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else {
        gl.texImage2D(target + i, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      }
    }

    return texture;
  }

  const emptyTextures: Record<number, WebGLTexture> = {};
  emptyTextures[gl.TEXTURE_2D] = createTexture(gl.TEXTURE_2D, gl.TEXTURE_2D, 1);
  emptyTextures[gl.TEXTURE_CUBE_MAP] = createTexture(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_CUBE_MAP_POSITIVE_X, 6);
  emptyTextures[gl.TEXTURE_2D_ARRAY] = createTexture(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_2D_ARRAY, 1, 1);
  emptyTextures[gl.TEXTURE_3D] = createTexture(gl.TEXTURE_3D, gl.TEXTURE_3D, 1, 1);

  // init

  colorBuffer.setClear(0, 0, 0, 1);
  depthBuffer.setClear(1);
  stencilBuffer.setClear(0);

  enable(gl.DEPTH_TEST);
  depthBuffer.setFunc("less-equal");

  setFlipSided(false);
  setCullFace("back");
  enable(gl.CULL_FACE);

  setBlending("none");

  //

  function enable(id: number): void {
    if (enabledCapabilities[id] !== true) {
      gl.enable(id);
      enabledCapabilities[id] = true;
    }
  }

  function disable(id: number): void {
    if (enabledCapabilities[id] !== false) {
      gl.disable(id);
      enabledCapabilities[id] = false;
    }
  }

  function bindFramebuffer(target: number, framebuffer: WebGLFramebuffer | null | undefined): boolean {
    if (currentBoundFramebuffers[target] !== framebuffer) {
      gl.bindFramebuffer(target, framebuffer as WebGLFramebuffer | null);

      currentBoundFramebuffers[target] = framebuffer;

      // gl.DRAW_FRAMEBUFFER is equivalent to gl.FRAMEBUFFER

      if (target === gl.DRAW_FRAMEBUFFER) {
        currentBoundFramebuffers[gl.FRAMEBUFFER] = framebuffer;
      }

      if (target === gl.FRAMEBUFFER) {
        currentBoundFramebuffers[gl.DRAW_FRAMEBUFFER] = framebuffer;
      }

      return true;
    }

    return false;
  }

  function drawBuffers(renderTarget: StateRenderTarget | null | undefined, framebuffer: WebGLFramebuffer | null | undefined): void {
    let drawBuffers = defaultDrawbuffers;

    let needsUpdate = false;

    if (renderTarget) {
      drawBuffers = currentDrawbuffers.get(framebuffer as WebGLFramebuffer) as number[];

      if (drawBuffers === undefined) {
        drawBuffers = [];
        currentDrawbuffers.set(framebuffer as WebGLFramebuffer, drawBuffers);
      }

      const textures = renderTarget.textures;

      if (drawBuffers.length !== textures.length || drawBuffers[0] !== gl.COLOR_ATTACHMENT0) {
        for (let i = 0, il = textures.length; i < il; i++) {
          drawBuffers[i] = gl.COLOR_ATTACHMENT0 + i;
        }

        drawBuffers.length = textures.length;

        needsUpdate = true;
      }
    } else {
      if (drawBuffers[0] !== gl.BACK) {
        drawBuffers[0] = gl.BACK;

        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      gl.drawBuffers(drawBuffers);
    }
  }

  function useProgram(program: WebGLProgram | null): boolean {
    if (currentProgram !== program) {
      gl.useProgram(program);

      currentProgram = program;

      return true;
    }

    return false;
  }

  const equationToGL: Record<BlendEquation, number> = {
    add: gl.FUNC_ADD,
    subtract: gl.FUNC_SUBTRACT,
    "reverse-subtract": gl.FUNC_REVERSE_SUBTRACT,
    min: gl.MIN,
    max: gl.MAX,
  };

  const factorToGL: Record<BlendFactor, number> = {
    zero: gl.ZERO,
    one: gl.ONE,
    "src-color": gl.SRC_COLOR,
    "src-alpha": gl.SRC_ALPHA,
    "src-alpha-saturate": gl.SRC_ALPHA_SATURATE,
    "dst-color": gl.DST_COLOR,
    "dst-alpha": gl.DST_ALPHA,
    "one-minus-src-color": gl.ONE_MINUS_SRC_COLOR,
    "one-minus-src-alpha": gl.ONE_MINUS_SRC_ALPHA,
    "one-minus-dst-color": gl.ONE_MINUS_DST_COLOR,
    "one-minus-dst-alpha": gl.ONE_MINUS_DST_ALPHA,
    "constant-color": gl.CONSTANT_COLOR,
    "one-minus-constant-color": gl.ONE_MINUS_CONSTANT_COLOR,
    "constant-alpha": gl.CONSTANT_ALPHA,
    "one-minus-constant-alpha": gl.ONE_MINUS_CONSTANT_ALPHA,
  };

  function setBlending(
    blending: Blending,
    blendEquation?: BlendEquation,
    blendSrc?: BlendFactor,
    blendDst?: BlendFactor,
    blendEquationAlpha?: BlendEquation | null,
    blendSrcAlpha?: BlendFactor | null,
    blendDstAlpha?: BlendFactor | null,
    blendColor?: Color,
    blendAlpha?: number,
    premultipliedAlpha?: boolean,
  ): void {
    if (blending === "none") {
      if (currentBlendingEnabled === true) {
        disable(gl.BLEND);
        currentBlendingEnabled = false;
      }

      return;
    }

    if (currentBlendingEnabled === false) {
      enable(gl.BLEND);
      currentBlendingEnabled = true;
    }

    if (blending !== "custom") {
      if (blending !== currentBlending || premultipliedAlpha !== currentPremultipledAlpha) {
        if (currentBlendEquation !== "add" || currentBlendEquationAlpha !== "add") {
          gl.blendEquation(gl.FUNC_ADD);

          currentBlendEquation = "add";
          currentBlendEquationAlpha = "add";
        }

        if (premultipliedAlpha) {
          switch (blending) {
            case "normal":
              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              break;

            case "add":
              gl.blendFunc(gl.ONE, gl.ONE);
              break;

            case "subtract":
              gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
              break;

            case "multiply":
              gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
              break;

            default:
              console.error("keel/lit State: Invalid blending: ", blending);
              break;
          }
        } else {
          switch (blending) {
            case "normal":
              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              break;

            case "add":
              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
              break;

            case "subtract":
              console.error("keel/lit State: subtract blending requires material.premultipliedAlpha = true");
              break;

            case "multiply":
              console.error("keel/lit State: multiply blending requires material.premultipliedAlpha = true");
              break;

            default:
              console.error("keel/lit State: Invalid blending: ", blending);
              break;
          }
        }

        currentBlendSrc = null;
        currentBlendDst = null;
        currentBlendSrcAlpha = null;
        currentBlendDstAlpha = null;
        currentBlendColor.set(0, 0, 0);
        currentBlendAlpha = 0;

        currentBlending = blending;
        currentPremultipledAlpha = premultipliedAlpha;
      }

      return;
    }

    // custom blending

    blendEquationAlpha = blendEquationAlpha || blendEquation;
    blendSrcAlpha = blendSrcAlpha || blendSrc;
    blendDstAlpha = blendDstAlpha || blendDst;

    if (blendEquation !== currentBlendEquation || blendEquationAlpha !== currentBlendEquationAlpha) {
      gl.blendEquationSeparate(equationToGL[blendEquation!], equationToGL[blendEquationAlpha!]);

      currentBlendEquation = blendEquation;
      currentBlendEquationAlpha = blendEquationAlpha;
    }

    if (blendSrc !== currentBlendSrc || blendDst !== currentBlendDst || blendSrcAlpha !== currentBlendSrcAlpha || blendDstAlpha !== currentBlendDstAlpha) {
      gl.blendFuncSeparate(factorToGL[blendSrc!], factorToGL[blendDst!], factorToGL[blendSrcAlpha!], factorToGL[blendDstAlpha!]);

      currentBlendSrc = blendSrc;
      currentBlendDst = blendDst;
      currentBlendSrcAlpha = blendSrcAlpha;
      currentBlendDstAlpha = blendDstAlpha;
    }

    if (blendColor!.equals(currentBlendColor) === false || blendAlpha !== currentBlendAlpha) {
      gl.blendColor(blendColor!.r, blendColor!.g, blendColor!.b, blendAlpha!);

      currentBlendColor.copy(blendColor!);
      currentBlendAlpha = blendAlpha;
    }

    currentBlending = blending;
    currentPremultipledAlpha = false;
  }

  function setMaterial(material: StateMaterial, frontFaceCW?: boolean): void {
    material.side === "both"
      ? disable(gl.CULL_FACE)
      : enable(gl.CULL_FACE);

    let flipSided = (material.side === "back");
    if (frontFaceCW) flipSided = !flipSided;

    setFlipSided(flipSided);

    (material.blending === "normal" && material.transparent === false)
      ? setBlending("none")
      : setBlending(material.blending, material.blendEquation, material.blendSrc, material.blendDst, material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha, material.blendColor, material.blendAlpha, material.premultipliedAlpha);

    depthBuffer.setFunc(material.depthFunc);
    depthBuffer.setTest(material.depthTest);
    depthBuffer.setMask(material.depthWrite);
    colorBuffer.setMask(material.colorWrite);

    const stencilWrite = material.stencilWrite;
    stencilBuffer.setTest(stencilWrite);
    if (stencilWrite) {
      stencilBuffer.setMask(material.stencilWriteMask);
      stencilBuffer.setFunc(material.stencilFunc, material.stencilRef, material.stencilFuncMask);
      stencilBuffer.setOp(material.stencilFail, material.stencilZFail, material.stencilZPass);
    }

    setPolygonOffset(material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits);

    material.alphaToCoverage === true
      ? enable(gl.SAMPLE_ALPHA_TO_COVERAGE)
      : disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  }

  //

  function setFlipSided(flipSided: boolean): void {
    if (currentFlipSided !== flipSided) {
      if (flipSided) {
        gl.frontFace(gl.CW);
      } else {
        gl.frontFace(gl.CCW);
      }

      currentFlipSided = flipSided;
    }
  }

  function setCullFace(cullFace: CullFace): void {
    if (cullFace !== "none") {
      enable(gl.CULL_FACE);

      if (cullFace !== currentCullFace) {
        if (cullFace === "back") {
          gl.cullFace(gl.BACK);
        } else if (cullFace === "front") {
          gl.cullFace(gl.FRONT);
        } else {
          gl.cullFace(gl.FRONT_AND_BACK);
        }
      }
    } else {
      disable(gl.CULL_FACE);
    }

    currentCullFace = cullFace;
  }

  function setLineWidth(width: number): void {
    if (width !== currentLineWidth) {
      if (lineWidthAvailable) gl.lineWidth(width);

      currentLineWidth = width;
    }
  }

  function setPolygonOffset(polygonOffset: boolean, factor?: number, units?: number): void {
    if (polygonOffset) {
      enable(gl.POLYGON_OFFSET_FILL);

      if (currentPolygonOffsetFactor !== factor || currentPolygonOffsetUnits !== units) {
        gl.polygonOffset(factor as number, units as number);

        currentPolygonOffsetFactor = factor;
        currentPolygonOffsetUnits = units;
      }
    } else {
      disable(gl.POLYGON_OFFSET_FILL);
    }
  }

  function setScissorTest(scissorTest: boolean): void {
    if (scissorTest) {
      enable(gl.SCISSOR_TEST);
    } else {
      disable(gl.SCISSOR_TEST);
    }
  }

  // texture

  function activeTexture(webglSlot?: number): void {
    if (webglSlot === undefined) webglSlot = gl.TEXTURE0 + maxTextures - 1;

    if (currentTextureSlot !== webglSlot) {
      gl.activeTexture(webglSlot);
      currentTextureSlot = webglSlot;
    }
  }

  function bindTexture(webglType: number, webglTexture: WebGLTexture | null | undefined, webglSlot?: number): void {
    if (webglSlot === undefined) {
      if (currentTextureSlot === null) {
        webglSlot = gl.TEXTURE0 + maxTextures - 1;
      } else {
        webglSlot = currentTextureSlot;
      }
    }

    let boundTexture = currentBoundTextures[webglSlot];

    if (boundTexture === undefined) {
      boundTexture = { type: undefined, texture: undefined };
      currentBoundTextures[webglSlot] = boundTexture;
    }

    if (boundTexture.type !== webglType || boundTexture.texture !== webglTexture) {
      if (currentTextureSlot !== webglSlot) {
        gl.activeTexture(webglSlot);
        currentTextureSlot = webglSlot;
      }

      gl.bindTexture(webglType, webglTexture || emptyTextures[webglType]!);

      boundTexture.type = webglType;
      boundTexture.texture = webglTexture;
    }
  }

  function unbindTexture(): void {
    const boundTexture = currentBoundTextures[currentTextureSlot as number];

    if (boundTexture !== undefined && boundTexture.type !== undefined) {
      gl.bindTexture(boundTexture.type, null);

      boundTexture.type = undefined;
      boundTexture.texture = undefined;
    }
  }

  // (each wrapper calls its GL method with whatever it was given, as r180's spread of `arguments` does)
  const call = gl as unknown as Record<string, (...args: unknown[]) => void>;

  function compressedTexImage2D(...args: unknown[]): void {
    try {
      call.compressedTexImage2D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function compressedTexImage3D(...args: unknown[]): void {
    try {
      call.compressedTexImage3D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function texSubImage2D(...args: unknown[]): void {
    try {
      call.texSubImage2D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function texSubImage3D(...args: unknown[]): void {
    try {
      call.texSubImage3D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function compressedTexSubImage2D(...args: unknown[]): void {
    try {
      call.compressedTexSubImage2D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function compressedTexSubImage3D(...args: unknown[]): void {
    try {
      call.compressedTexSubImage3D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function texStorage2D(...args: unknown[]): void {
    try {
      call.texStorage2D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function texStorage3D(...args: unknown[]): void {
    try {
      call.texStorage3D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function texImage2D(...args: unknown[]): void {
    try {
      call.texImage2D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  function texImage3D(...args: unknown[]): void {
    try {
      call.texImage3D!(...args);
    } catch (error) {
      console.error("keel/lit State:", error);
    }
  }

  //

  function scissor(scissor: Vector4): void {
    if (currentScissor.equals(scissor) === false) {
      gl.scissor(scissor.x, scissor.y, scissor.z, scissor.w);
      currentScissor.copy(scissor);
    }
  }

  function viewport(viewport: Vector4): void {
    if (currentViewport.equals(viewport) === false) {
      gl.viewport(viewport.x, viewport.y, viewport.z, viewport.w);
      currentViewport.copy(viewport);
    }
  }

  function updateUBOMapping(uniformsGroup: StateUniformsGroup, program: WebGLProgram): void {
    let mapping = uboProgramMap.get(program);

    if (mapping === undefined) {
      mapping = new WeakMap();

      uboProgramMap.set(program, mapping);
    }

    let blockIndex = mapping.get(uniformsGroup);

    if (blockIndex === undefined) {
      blockIndex = gl.getUniformBlockIndex(program, uniformsGroup.name);

      mapping.set(uniformsGroup, blockIndex);
    }
  }

  function uniformBlockBinding(uniformsGroup: StateUniformsGroup, program: WebGLProgram): void {
    const mapping = uboProgramMap.get(program)!;
    const blockIndex = mapping.get(uniformsGroup) as number;

    if (uboBindings.get(program) !== blockIndex) {
      // bind shader specific block index to global block point
      gl.uniformBlockBinding(program, blockIndex, uniformsGroup.__bindingPointIndex as number);

      uboBindings.set(program, blockIndex);
    }
  }

  //

  function reset(): void {
    // reset state

    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);

    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO);
    gl.blendColor(0, 0, 0, 0);

    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);

    gl.depthMask(true);
    gl.depthFunc(gl.LESS);

    depthBuffer.setReversed(false);

    gl.clearDepth(1);

    gl.stencilMask(0xffffffff);
    gl.stencilFunc(gl.ALWAYS, 0, 0xffffffff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.clearStencil(0);

    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    gl.polygonOffset(0, 0);

    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    gl.useProgram(null);

    gl.lineWidth(1);

    gl.scissor(0, 0, gl.canvas.width, gl.canvas.height);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // reset internals

    enabledCapabilities = {};

    currentTextureSlot = null;
    currentBoundTextures = {};

    currentBoundFramebuffers = {};
    currentDrawbuffers = new WeakMap();
    defaultDrawbuffers = [];

    currentProgram = null;

    currentBlendingEnabled = false;
    currentBlending = null;
    currentBlendEquation = null;
    currentBlendSrc = null;
    currentBlendDst = null;
    currentBlendEquationAlpha = null;
    currentBlendSrcAlpha = null;
    currentBlendDstAlpha = null;
    currentBlendColor = new Color(0, 0, 0);
    currentBlendAlpha = 0;
    currentPremultipledAlpha = false;

    currentFlipSided = null;
    currentCullFace = null;

    currentLineWidth = null;

    currentPolygonOffsetFactor = null;
    currentPolygonOffsetUnits = null;

    currentScissor.set(0, 0, gl.canvas.width, gl.canvas.height);
    currentViewport.set(0, 0, gl.canvas.width, gl.canvas.height);

    colorBuffer.reset();
    depthBuffer.reset();
    stencilBuffer.reset();
  }

  return {
    buffers: {
      color: colorBuffer,
      depth: depthBuffer,
      stencil: stencilBuffer,
    },

    enable: enable,
    disable: disable,

    bindFramebuffer: bindFramebuffer,
    drawBuffers: drawBuffers,

    useProgram: useProgram,

    setBlending: setBlending,
    setMaterial: setMaterial,

    setFlipSided: setFlipSided,
    setCullFace: setCullFace,

    setLineWidth: setLineWidth,
    setPolygonOffset: setPolygonOffset,

    setScissorTest: setScissorTest,

    activeTexture: activeTexture,
    bindTexture: bindTexture,
    unbindTexture: unbindTexture,
    compressedTexImage2D: compressedTexImage2D,
    compressedTexImage3D: compressedTexImage3D,
    texImage2D: texImage2D,
    texImage3D: texImage3D,

    updateUBOMapping: updateUBOMapping,
    uniformBlockBinding: uniformBlockBinding,

    texStorage2D: texStorage2D,
    texStorage3D: texStorage3D,
    texSubImage2D: texSubImage2D,
    texSubImage3D: texSubImage3D,
    compressedTexSubImage2D: compressedTexSubImage2D,
    compressedTexSubImage3D: compressedTexSubImage3D,

    scissor: scissor,
    viewport: viewport,

    reset: reset,
  };
}
