// Ported from Three.js r180's renderers/webgl/WebGLUniforms.js (MIT, see
// packages/lit/NOTICE).
//
// A program's active uniforms, parsed from the names GL reports into r180's
// tree (plain uniforms, pure arrays "name[0]", structs and arrays of structs
// such as "directionalLights[0].direction"), each with r180's setter for its GL
// type and r180's per-uniform cache (a value equal to the cached one makes no
// GL call). `createUniforms(gl, program)` is r180's `new WebGLUniforms(gl,
// program)`; r180's statics are `upload` and `seqWithValue` here.
//
// Dropped: keel/lit has no CubeTexture, Data3DTexture or DataArrayTexture, so
// the cube, 3D and 2D-array sampler setters hand `textures` what they are
// given (r180's empty stand-ins for those kinds are plain empty textures here)
// and call the textures module's setter only when it has one.

import { Texture } from "../texture/Texture.ts";
import { DepthTexture } from "../texture/DepthTexture.ts";

/** What the sampler setters need of the textures module (r180's WebGLTextures). */
export interface UniformTextures {
  allocateTextureUnit(): number;
  setTexture2D(texture: unknown, slot: number): void;
  setTexture3D?(texture: unknown, slot: number): void;
  setTextureCube?(texture: unknown, slot: number): void;
  setTexture2DArray?(texture: unknown, slot: number): void;
}

/** What GL reports of an active uniform. */
export interface ActiveInfo {
  readonly name: string;
  readonly type: number;
  readonly size: number;
}

/** A uniform's value as r180's setters read it: numbers, vectors, matrices, colours, textures, arrays of those. */
// (deliberately loose: r180's setters branch on the value's shape at run time)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;

type Setter<T> = (this: T, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures) => void;

const emptyTexture = /*@__PURE__*/ new Texture();

const emptyShadowTexture = /*@__PURE__*/ new DepthTexture(1, 1);

// (keel/lit has no array, 3D or cube textures: see the header)
const emptyArrayTexture = /*@__PURE__*/ new Texture();
const empty3dTexture = /*@__PURE__*/ new Texture();
const emptyCubeTexture = /*@__PURE__*/ new Texture();

// --- Utilities ---

// Array Caches (provide typed arrays for temporary by size)

const arrayCacheF32: (Float32Array | undefined)[] = [];
const arrayCacheI32: (Int32Array | undefined)[] = [];

// Float32Array caches used for uploading Matrix uniforms

const mat4array = new Float32Array(16);
const mat3array = new Float32Array(9);
const mat2array = new Float32Array(4);

// Flattening for arrays of vectors and matrices

function flatten(array: Value, nBlocks: number, blockSize: number): Value {
  const firstElem = array[0];

  if (firstElem <= 0 || firstElem > 0) return array;
  // unoptimized: ! isNaN( firstElem )
  // see http://jacksondunstan.com/articles/983

  const n = nBlocks * blockSize;
  let r = arrayCacheF32[n];

  if (r === undefined) {
    r = new Float32Array(n);
    arrayCacheF32[n] = r;
  }

  if (nBlocks !== 0) {
    firstElem.toArray(r, 0);

    for (let i = 1, offset = 0; i !== nBlocks; ++i) {
      offset += blockSize;
      array[i].toArray(r, offset);
    }
  }

  return r;
}

function arraysEqual(a: ArrayLike<unknown>, b: ArrayLike<unknown>): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0, l = a.length; i < l; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function copyArray(a: unknown[], b: ArrayLike<unknown>): void {
  for (let i = 0, l = b.length; i < l; i++) {
    a[i] = b[i];
  }
}

// Texture unit allocation

function allocTexUnits(textures: UniformTextures, n: number): Int32Array {
  let r = arrayCacheI32[n];

  if (r === undefined) {
    r = new Int32Array(n);
    arrayCacheI32[n] = r;
  }

  for (let i = 0; i !== n; ++i) {
    r[i] = textures.allocateTextureUnit();
  }

  return r;
}

// --- Setters ---

interface Leaf {
  readonly addr: WebGLUniformLocation | null;
  readonly cache: unknown[];
  readonly type: number;
}

interface ArrayLeaf extends Leaf {
  readonly size: number;
}

// Single scalar

function setValueV1f(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (cache[0] === v) return;

  gl.uniform1f(this.addr, v);

  cache[0] = v;
}

// Single float vector (from flat array or THREE.VectorN)

function setValueV2f(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y) {
      gl.uniform2f(this.addr, v.x, v.y);

      cache[0] = v.x;
      cache[1] = v.y;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform2fv(this.addr, v);

    copyArray(cache, v);
  }
}

function setValueV3f(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z) {
      gl.uniform3f(this.addr, v.x, v.y, v.z);

      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
    }
  } else if (v.r !== undefined) {
    if (cache[0] !== v.r || cache[1] !== v.g || cache[2] !== v.b) {
      gl.uniform3f(this.addr, v.r, v.g, v.b);

      cache[0] = v.r;
      cache[1] = v.g;
      cache[2] = v.b;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform3fv(this.addr, v);

    copyArray(cache, v);
  }
}

function setValueV4f(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z || cache[3] !== v.w) {
      gl.uniform4f(this.addr, v.x, v.y, v.z, v.w);

      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
      cache[3] = v.w;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform4fv(this.addr, v);

    copyArray(cache, v);
  }
}

// Single matrix (from flat array or THREE.MatrixN)

function setValueM2(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;
  const elements = v.elements;

  if (elements === undefined) {
    if (arraysEqual(cache, v)) return;

    gl.uniformMatrix2fv(this.addr, false, v);

    copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements)) return;

    mat2array.set(elements);

    gl.uniformMatrix2fv(this.addr, false, mat2array);

    copyArray(cache, elements);
  }
}

function setValueM3(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;
  const elements = v.elements;

  if (elements === undefined) {
    if (arraysEqual(cache, v)) return;

    gl.uniformMatrix3fv(this.addr, false, v);

    copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements)) return;

    mat3array.set(elements);

    gl.uniformMatrix3fv(this.addr, false, mat3array);

    copyArray(cache, elements);
  }
}

function setValueM4(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;
  const elements = v.elements;

  if (elements === undefined) {
    if (arraysEqual(cache, v)) return;

    gl.uniformMatrix4fv(this.addr, false, v);

    copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements)) return;

    mat4array.set(elements);

    gl.uniformMatrix4fv(this.addr, false, mat4array);

    copyArray(cache, elements);
  }
}

// Single integer / boolean

function setValueV1i(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (cache[0] === v) return;

  gl.uniform1i(this.addr, v);

  cache[0] = v;
}

// Single integer / boolean vector (from flat array or THREE.VectorN)

function setValueV2i(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y) {
      gl.uniform2i(this.addr, v.x, v.y);

      cache[0] = v.x;
      cache[1] = v.y;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform2iv(this.addr, v);

    copyArray(cache, v);
  }
}

function setValueV3i(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z) {
      gl.uniform3i(this.addr, v.x, v.y, v.z);

      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform3iv(this.addr, v);

    copyArray(cache, v);
  }
}

function setValueV4i(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z || cache[3] !== v.w) {
      gl.uniform4i(this.addr, v.x, v.y, v.z, v.w);

      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
      cache[3] = v.w;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform4iv(this.addr, v);

    copyArray(cache, v);
  }
}

// Single unsigned integer

function setValueV1ui(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (cache[0] === v) return;

  gl.uniform1ui(this.addr, v);

  cache[0] = v;
}

// Single unsigned integer vector (from flat array or THREE.VectorN)

function setValueV2ui(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y) {
      gl.uniform2ui(this.addr, v.x, v.y);

      cache[0] = v.x;
      cache[1] = v.y;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform2uiv(this.addr, v);

    copyArray(cache, v);
  }
}

function setValueV3ui(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z) {
      gl.uniform3ui(this.addr, v.x, v.y, v.z);

      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform3uiv(this.addr, v);

    copyArray(cache, v);
  }
}

function setValueV4ui(this: Leaf, gl: WebGL2RenderingContext, v: Value): void {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z || cache[3] !== v.w) {
      gl.uniform4ui(this.addr, v.x, v.y, v.z, v.w);

      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
      cache[3] = v.w;
    }
  } else {
    if (arraysEqual(cache, v)) return;

    gl.uniform4uiv(this.addr, v);

    copyArray(cache, v);
  }
}

// Single texture (2D / Cube)

function setValueT1(this: Leaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;
  const unit = textures.allocateTextureUnit();

  if (cache[0] !== unit) {
    gl.uniform1i(this.addr, unit);
    cache[0] = unit;
  }

  let emptyTexture2D;

  if (this.type === gl.SAMPLER_2D_SHADOW) {
    emptyShadowTexture.compareFunction = "less-equal"; // #28670
    emptyTexture2D = emptyShadowTexture;
  } else {
    emptyTexture2D = emptyTexture;
  }

  textures.setTexture2D(v || emptyTexture2D, unit);
}

function setValueT3D1(this: Leaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;
  const unit = textures.allocateTextureUnit();

  if (cache[0] !== unit) {
    gl.uniform1i(this.addr, unit);
    cache[0] = unit;
  }

  textures.setTexture3D?.(v || empty3dTexture, unit);
}

function setValueT6(this: Leaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;
  const unit = textures.allocateTextureUnit();

  if (cache[0] !== unit) {
    gl.uniform1i(this.addr, unit);
    cache[0] = unit;
  }

  textures.setTextureCube?.(v || emptyCubeTexture, unit);
}

function setValueT2DArray1(this: Leaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;
  const unit = textures.allocateTextureUnit();

  if (cache[0] !== unit) {
    gl.uniform1i(this.addr, unit);
    cache[0] = unit;
  }

  textures.setTexture2DArray?.(v || emptyArrayTexture, unit);
}

// Helper to pick the right setter for the singular case

function getSingularSetter(type: number): Setter<Leaf> | undefined {
  switch (type) {
    case 0x1406: return setValueV1f; // FLOAT
    case 0x8b50: return setValueV2f; // _VEC2
    case 0x8b51: return setValueV3f; // _VEC3
    case 0x8b52: return setValueV4f; // _VEC4

    case 0x8b5a: return setValueM2; // _MAT2
    case 0x8b5b: return setValueM3; // _MAT3
    case 0x8b5c: return setValueM4; // _MAT4

    case 0x1404: case 0x8b56: return setValueV1i; // INT, BOOL
    case 0x8b53: case 0x8b57: return setValueV2i; // _VEC2
    case 0x8b54: case 0x8b58: return setValueV3i; // _VEC3
    case 0x8b55: case 0x8b59: return setValueV4i; // _VEC4

    case 0x1405: return setValueV1ui; // UINT
    case 0x8dc6: return setValueV2ui; // _VEC2
    case 0x8dc7: return setValueV3ui; // _VEC3
    case 0x8dc8: return setValueV4ui; // _VEC4

    case 0x8b5e: // SAMPLER_2D
    case 0x8d66: // SAMPLER_EXTERNAL_OES
    case 0x8dca: // INT_SAMPLER_2D
    case 0x8dd2: // UNSIGNED_INT_SAMPLER_2D
    case 0x8b62: // SAMPLER_2D_SHADOW
      return setValueT1;

    case 0x8b5f: // SAMPLER_3D
    case 0x8dcb: // INT_SAMPLER_3D
    case 0x8dd3: // UNSIGNED_INT_SAMPLER_3D
      return setValueT3D1;

    case 0x8b60: // SAMPLER_CUBE
    case 0x8dcc: // INT_SAMPLER_CUBE
    case 0x8dd4: // UNSIGNED_INT_SAMPLER_CUBE
    case 0x8dc5: // SAMPLER_CUBE_SHADOW
      return setValueT6;

    case 0x8dc1: // SAMPLER_2D_ARRAY
    case 0x8dcf: // INT_SAMPLER_2D_ARRAY
    case 0x8dd7: // UNSIGNED_INT_SAMPLER_2D_ARRAY
    case 0x8dc4: // SAMPLER_2D_ARRAY_SHADOW
      return setValueT2DArray1;
  }

  return undefined;
}

// Array of scalars

function setValueV1fArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform1fv(this.addr, v);
}

// Array of vectors (from flat array or array of THREE.VectorN)

function setValueV2fArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  const data = flatten(v, this.size, 2);

  gl.uniform2fv(this.addr, data);
}

function setValueV3fArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  const data = flatten(v, this.size, 3);

  gl.uniform3fv(this.addr, data);
}

function setValueV4fArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  const data = flatten(v, this.size, 4);

  gl.uniform4fv(this.addr, data);
}

// Array of matrices (from flat array or array of THREE.MatrixN)

function setValueM2Array(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  const data = flatten(v, this.size, 4);

  gl.uniformMatrix2fv(this.addr, false, data);
}

function setValueM3Array(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  const data = flatten(v, this.size, 9);

  gl.uniformMatrix3fv(this.addr, false, data);
}

function setValueM4Array(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  const data = flatten(v, this.size, 16);

  gl.uniformMatrix4fv(this.addr, false, data);
}

// Array of integer / boolean

function setValueV1iArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform1iv(this.addr, v);
}

// Array of integer / boolean vectors (from flat array)

function setValueV2iArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform2iv(this.addr, v);
}

function setValueV3iArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform3iv(this.addr, v);
}

function setValueV4iArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform4iv(this.addr, v);
}

// Array of unsigned integer

function setValueV1uiArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform1uiv(this.addr, v);
}

// Array of unsigned integer vectors (from flat array)

function setValueV2uiArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform2uiv(this.addr, v);
}

function setValueV3uiArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform3uiv(this.addr, v);
}

function setValueV4uiArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value): void {
  gl.uniform4uiv(this.addr, v);
}

// Array of textures (2D / 3D / Cube / 2DArray)

function setValueT1Array(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;

  const n = v.length;

  const units = allocTexUnits(textures, n);

  if (!arraysEqual(cache, units)) {
    gl.uniform1iv(this.addr, units);

    copyArray(cache, units);
  }

  for (let i = 0; i !== n; ++i) {
    textures.setTexture2D(v[i] || emptyTexture, units[i]!);
  }
}

function setValueT3DArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;

  const n = v.length;

  const units = allocTexUnits(textures, n);

  if (!arraysEqual(cache, units)) {
    gl.uniform1iv(this.addr, units);

    copyArray(cache, units);
  }

  for (let i = 0; i !== n; ++i) {
    textures.setTexture3D?.(v[i] || empty3dTexture, units[i]!);
  }
}

function setValueT6Array(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;

  const n = v.length;

  const units = allocTexUnits(textures, n);

  if (!arraysEqual(cache, units)) {
    gl.uniform1iv(this.addr, units);

    copyArray(cache, units);
  }

  for (let i = 0; i !== n; ++i) {
    textures.setTextureCube?.(v[i] || emptyCubeTexture, units[i]!);
  }
}

function setValueT2DArrayArray(this: ArrayLeaf, gl: WebGL2RenderingContext, v: Value, textures: UniformTextures): void {
  const cache = this.cache;

  const n = v.length;

  const units = allocTexUnits(textures, n);

  if (!arraysEqual(cache, units)) {
    gl.uniform1iv(this.addr, units);

    copyArray(cache, units);
  }

  for (let i = 0; i !== n; ++i) {
    textures.setTexture2DArray?.(v[i] || emptyArrayTexture, units[i]!);
  }
}

// Helper to pick the right setter for a pure (bottom-level) array

function getPureArraySetter(type: number): Setter<ArrayLeaf> | undefined {
  switch (type) {
    case 0x1406: return setValueV1fArray; // FLOAT
    case 0x8b50: return setValueV2fArray; // _VEC2
    case 0x8b51: return setValueV3fArray; // _VEC3
    case 0x8b52: return setValueV4fArray; // _VEC4

    case 0x8b5a: return setValueM2Array; // _MAT2
    case 0x8b5b: return setValueM3Array; // _MAT3
    case 0x8b5c: return setValueM4Array; // _MAT4

    case 0x1404: case 0x8b56: return setValueV1iArray; // INT, BOOL
    case 0x8b53: case 0x8b57: return setValueV2iArray; // _VEC2
    case 0x8b54: case 0x8b58: return setValueV3iArray; // _VEC3
    case 0x8b55: case 0x8b59: return setValueV4iArray; // _VEC4

    case 0x1405: return setValueV1uiArray; // UINT
    case 0x8dc6: return setValueV2uiArray; // _VEC2
    case 0x8dc7: return setValueV3uiArray; // _VEC3
    case 0x8dc8: return setValueV4uiArray; // _VEC4

    case 0x8b5e: // SAMPLER_2D
    case 0x8d66: // SAMPLER_EXTERNAL_OES
    case 0x8dca: // INT_SAMPLER_2D
    case 0x8dd2: // UNSIGNED_INT_SAMPLER_2D
    case 0x8b62: // SAMPLER_2D_SHADOW
      return setValueT1Array;

    case 0x8b5f: // SAMPLER_3D
    case 0x8dcb: // INT_SAMPLER_3D
    case 0x8dd3: // UNSIGNED_INT_SAMPLER_3D
      return setValueT3DArray;

    case 0x8b60: // SAMPLER_CUBE
    case 0x8dcc: // INT_SAMPLER_CUBE
    case 0x8dd4: // UNSIGNED_INT_SAMPLER_CUBE
    case 0x8dc5: // SAMPLER_CUBE_SHADOW
      return setValueT6Array;

    case 0x8dc1: // SAMPLER_2D_ARRAY
    case 0x8dcf: // INT_SAMPLER_2D_ARRAY
    case 0x8dd7: // UNSIGNED_INT_SAMPLER_2D_ARRAY
    case 0x8dc4: // SAMPLER_2D_ARRAY_SHADOW
      return setValueT2DArrayArray;
  }

  return undefined;
}

// --- Uniform Classes ---

/** A uniform, struct or array the tree holds: its id (member name or array index) and its setter. */
export interface UniformNode {
  readonly id: string | number;
  setValue(gl: WebGL2RenderingContext, value: Value, textures?: UniformTextures): void;
}

export class SingleUniform implements UniformNode, Leaf {
  id: string | number;
  addr: WebGLUniformLocation | null;
  cache: unknown[];
  type: number;
  setValue: Setter<Leaf>;

  constructor(id: string | number, activeInfo: ActiveInfo, addr: WebGLUniformLocation | null) {
    this.id = id;
    this.addr = addr;
    this.cache = [];
    this.type = activeInfo.type;
    this.setValue = getSingularSetter(activeInfo.type)!;

    // this.path = activeInfo.name; // DEBUG
  }
}

export class PureArrayUniform implements UniformNode, ArrayLeaf {
  id: string | number;
  addr: WebGLUniformLocation | null;
  cache: unknown[];
  type: number;
  size: number;
  setValue: Setter<ArrayLeaf>;

  constructor(id: string | number, activeInfo: ActiveInfo, addr: WebGLUniformLocation | null) {
    this.id = id;
    this.addr = addr;
    this.cache = [];
    this.type = activeInfo.type;
    this.size = activeInfo.size;
    this.setValue = getPureArraySetter(activeInfo.type)!;

    // this.path = activeInfo.name; // DEBUG
  }
}

/** A tree node: r180's StructuredUniform and the root share seq and map. */
export interface UniformContainer {
  seq: UniformNode[];
  map: Record<string, UniformNode>;
}

export class StructuredUniform implements UniformNode, UniformContainer {
  id: string | number;
  seq: UniformNode[];
  map: Record<string, UniformNode>;

  constructor(id: string | number) {
    this.id = id;

    this.seq = [];
    this.map = {};
  }

  setValue(gl: WebGL2RenderingContext, value: Value, textures?: UniformTextures): void {
    const seq = this.seq;

    for (let i = 0, n = seq.length; i !== n; ++i) {
      const u = seq[i]!;
      u.setValue(gl, value[u.id], textures);
    }
  }
}

// --- Top-level ---

// Parser - builds up the property tree from the path strings

const RePathPart = /(\w+)(\])?(\[|\.)?/g;

// extracts
// 	- the identifier (member name or array index)
//  - followed by an optional right bracket (found when array index)
//  - followed by an optional left bracket or dot (type of subscript)
//
// Note: These portions can be read in a non-overlapping fashion and
// allow straightforward parsing of the hierarchy that WebGL encodes
// in the uniform names.

function addUniform(container: UniformContainer, uniformObject: UniformNode): void {
  container.seq.push(uniformObject);
  container.map[uniformObject.id] = uniformObject;
}

function parseUniform(activeInfo: ActiveInfo, addr: WebGLUniformLocation | null, container: UniformContainer): void {
  const path = activeInfo.name,
    pathLength = path.length;

  // reset RegExp object, because of the early exit of a previous run
  RePathPart.lastIndex = 0;

  while (true) {
    const match = RePathPart.exec(path)!,
      matchEnd = RePathPart.lastIndex;

    let id: string | number = match[1]!;
    const idIsIndex = match[2] === "]",
      subscript = match[3];

    if (idIsIndex) id = (id as unknown as number) | 0; // convert to integer

    if (subscript === undefined || (subscript === "[" && matchEnd + 2 === pathLength)) {
      // bare name or "pure" bottom-level array "[0]" suffix

      addUniform(container, subscript === undefined ?
        new SingleUniform(id, activeInfo, addr) :
        new PureArrayUniform(id, activeInfo, addr));

      break;
    } else {
      // step into inner node / create it in case it doesn't exist

      const map = container.map;
      let next = map[id] as StructuredUniform | undefined;

      if (next === undefined) {
        next = new StructuredUniform(id);
        addUniform(container, next);
      }

      container = next;
    }
  }
}

// Root Container

/** A program's uniforms (r180's WebGLUniforms instance). */
export interface ProgramUniforms extends UniformContainer {
  setValue(gl: WebGL2RenderingContext, name: string, value: Value, textures?: UniformTextures): void;
  setOptional(gl: WebGL2RenderingContext, object: Record<string, unknown>, name: string): void;
}

/** r180's `new WebGLUniforms( gl, program )`. */
export function createUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): ProgramUniforms {
  const self: ProgramUniforms = {
    seq: [],
    map: {},

    setValue(gl, name, value, textures) {
      const u = self.map[name];

      if (u !== undefined) u.setValue(gl, value, textures);
    },

    setOptional(gl, object, name) {
      const v = object[name];

      if (v !== undefined) self.setValue(gl, name, v);
    },
  };

  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;

  for (let i = 0; i < n; ++i) {
    const info = gl.getActiveUniform(program, i)!,
      addr = gl.getUniformLocation(program, info.name);

    parseUniform(info, addr, self);
  }

  return self;
}

/** A material's uniform, as upload reads it. */
export interface UploadUniform {
  value: unknown;
  needsUpdate?: boolean;
}

/** r180's WebGLUniforms.upload. */
export function upload(gl: WebGL2RenderingContext, seq: readonly UniformNode[], values: Record<string | number, UploadUniform>, textures: UniformTextures): void {
  for (let i = 0, n = seq.length; i !== n; ++i) {
    const u = seq[i]!,
      v = values[u.id]!;

    if (v.needsUpdate !== false) {
      // note: always updating when .needsUpdate is undefined
      u.setValue(gl, v.value, textures);
    }
  }
}

/** r180's WebGLUniforms.seqWithValue. */
export function seqWithValue(seq: readonly UniformNode[], values: Record<string | number, unknown>): UniformNode[] {
  const r: UniformNode[] = [];

  for (let i = 0, n = seq.length; i !== n; ++i) {
    const u = seq[i]!;
    if (u.id in values) r.push(u);
  }

  return r;
}
