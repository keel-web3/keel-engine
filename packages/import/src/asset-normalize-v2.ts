/**
 * glTF 2.0 -> decoded, indexed native-scene IR. No renderer or glTF loader is used.
 *
 * `json` retains every source object/index, but removes storage and Draco encoding
 * descriptions. Its accessor indices address `accessors`; image indices address
 * `images`. `sourceJson` retains the complete source JSON for provenance, not for
 * rendering. No source buffers or GLB are stored in the result. All mesh, skin,
 * animation and morph data comes from the typed arrays, including unused accessors.
 *
 * Draco is an optional, externally supplied draco3dgltf decoder module, e.g.
 * `await draco3d.createDecoderModule()`. The normalizer has no runtime dependencies
 * or ambient network access and works in Node and browser ESM. A host must account
 * for the decoder JS/WASM transfer, initialization time and WASM memory separately;
 * the decoder is needed at import time only, never to replay normalized scenes.
 * Draco source quantization is not undone: decoded values are the reference truth.
 *
 * Specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
 * Draco: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_draco_mesh_compression
 */

import { TEXTURE_TRANSFORM, TEXTURE_INFO_PATH, readTextureTransform, materialTextureInfos } from './texture-transform.ts';

export type NativeArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;
export type GltfJSON = Record<string, any>;
export interface NormalizedAccessor {
  /** Original accessor index, or -1 for generated Draco connectivity. */
  sourceIndex: number;
  type: string;
  componentType: number;
  normalized: boolean;
  count: number;
  /** Raw components. Normalized integer attributes are NOT converted to float. */
  array: NativeArray;
}
export interface NormalizedImage { sourceIndex: number; mimeType: string; data: Uint8Array }
/** Structural boundary intentionally avoids a required draco3dgltf package import. */
export type DracoDecoderModule = Record<string, any>;
export interface NormalizeAssetInput {
  files: Array<{ name: string; data: Uint8Array }>;
  entry: string;
  dracoDecoder?: DracoDecoderModule | Promise<DracoDecoderModule>;
}
export interface NormalizedAsset {
  format: 'KEEL-NATIVE-SCENE';
  version: 2;
  json: GltfJSON;
  sourceJson: GltfJSON;
  accessors: NormalizedAccessor[];
  images: NormalizedImage[];
  source: {
    entry: string;
    container: 'glb' | 'gltf';
    files: Array<{ name: string; byteLength: number; sha256: string }>;
  };
  validation: {
    accessorCount: number;
    sourceAccessorCount: number;
    decodedBytes: number;
    dracoPrimitives: number;
    meshPrimitives: number;
    imageBytes: number;
    preservedSourceIndices: true;
    decodedReference: 'source-accessor-values';
    warnings: string[];
  };
  runtime: {
    dependencies: string[];
    dracoRequiredForReplay: false;
    decoderCostIncluded: false;
    decoderNote: string;
  };
}

const MAX_BYTES = 256 * 1024 * 1024;
const DRACO = 'KHR_draco_mesh_compression';
const utf8 = new TextDecoder('utf-8', { fatal: true });
type ArrayConstructor = { new(length: number): NativeArray; new(buffer: ArrayBuffer, offset: number, length: number): NativeArray; BYTES_PER_ELEMENT: number };
const constructors: Record<number, ArrayConstructor> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const arities: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const fail = (message: string): never => { throw new Error(`Asset normalizer v2: ${message}`); };
function integer(value: any, label: string, max = MAX_BYTES): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`invalid ${label}`);
  return value;
}
function object(value: any, label: string): GltfJSON {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid ${label}`);
  return value;
}
function list(value: any, label: string): any[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`invalid ${label}`);
  return value;
}
function reference<T>(array: T[], index: any, label: string): T {
  const value = array[integer(index, `${label} index`, array.length - 1)];
  if (value === undefined) fail(`missing ${label}`);
  return value!;
}
function safePath(value: any): string {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\\]/.test(value) || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) fail('unsafe upload path');
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) fail('resource escapes upload root'); parts.pop(); }
    else parts.push(part);
  }
  if (!parts.length) fail('empty upload path');
  return parts.join('/');
}
function resolvePath(base: string, uri: string): string {
  if (/[?#]/.test(uri)) fail('resource query/fragment unsupported');
  let decoded: string;
  try { decoded = decodeURIComponent(uri); } catch { return fail('invalid resource URI encoding'); }
  if (decoded.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || /[\x00-\x1f\\]/.test(decoded)) fail('external/absolute resource URI unsupported');
  return safePath(base + decoded);
}
function dataURI(uri: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^,]*),(.*)$/s.exec(uri);
  if (!match) return fail('invalid data URI');
  const header = match[1]!, body = match[2]!;
  let bytes: Uint8Array;
  if (header.endsWith(';base64')) {
    if (body.length > MAX_BYTES * 1.4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)) fail('invalid base64 data URI');
    bytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  } else {
    const values: number[] = [];
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '%') {
        const hex = body.slice(i + 1, i + 3);
        if (!/^[a-f\d]{2}$/i.test(hex)) fail('invalid data URI escape');
        values.push(parseInt(hex, 16)); i += 2;
      } else { const code = body.charCodeAt(i); if (code > 127) fail('data URI must percent-encode non-ASCII bytes'); values.push(code); }
    }
    bytes = new Uint8Array(values);
  }
  return { bytes, mimeType: header.split(';')[0]! };
}
async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(x => x.toString(16).padStart(2, '0')).join('');
}
function equalArrays(a: NativeArray, b: NativeArray): boolean {
  if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return x.every((value, i) => value === y[i]);
}
function parseEntry(bytes: Uint8Array): { json: GltfJSON; binary?: Uint8Array; container: 'glb' | 'gltf' } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json: any, binary: Uint8Array | undefined;
  const container = bytes.length >= 4 && view.getUint32(0, true) === 0x46546c67 ? 'glb' : 'gltf';
  if (container === 'gltf') {
    try { json = JSON.parse(utf8.decode(bytes)); } catch { fail('invalid glTF JSON'); }
  } else {
    if (bytes.length < 20 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) fail('invalid GLB header');
    let offset = 12;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) fail('truncated GLB chunk header');
      const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), start = offset + 8;
      if (length % 4 || start + length > bytes.length) fail('invalid GLB chunk extent');
      if (type === 0x4e4f534a) {
        if (offset !== 12 || json !== undefined) fail('GLB JSON must be first and unique');
        try { json = JSON.parse(utf8.decode(bytes.subarray(start, start + length))); } catch { fail('invalid GLB JSON'); }
      } else if (type === 0x004e4942) {
        if (json === undefined || binary !== undefined) fail('invalid GLB BIN chunk ordering');
        binary = bytes.subarray(start, start + length);
      } else fail(`unsupported GLB chunk 0x${type.toString(16)}; refusing to discard it`);
      offset = start + length;
    }
  }
  object(json, 'root JSON');
  if (json.asset?.version !== '2.0' || (json.asset.minVersion !== undefined && json.asset.minVersion !== '2.0')) fail('only glTF 2.0 is supported');
  return { json, ...(binary ? { binary } : {}), container };
}
function validateExtensions(json: GltfJSON): void {
  for (const key of ['extensionsRequired', 'extensionsUsed']) {
    for (const extension of list(json[key], key)) if (extension !== DRACO && extension !== TEXTURE_TRANSFORM) fail(`unsupported ${key === 'extensionsRequired' ? 'required' : 'optional'} extension ${String(extension)}; refusing to discard it`);
  }
  const walk = (value: any, path: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((child, i) => walk(child, `${path}/${i}`)); return; }
    if (value.extensions !== undefined) {
      for (const key of Object.keys(object(value.extensions, `${path}/extensions`))) {
        if (key === TEXTURE_TRANSFORM) {
          if (!TEXTURE_INFO_PATH.test(path)) fail(`${TEXTURE_TRANSFORM} at unsupported location ${path}`);
          readTextureTransform(value.extensions[key], fail);
        } else if (key === DRACO) {
          if (!/^\/meshes\/\d+\/primitives\/\d+$/.test(path)) fail(`Draco extension at unsupported location ${path}`);
        } else fail(`unsupported extension ${key} at ${path}; refusing to discard it`);
      }
    }
    // Extras is application metadata, not another glTF schema object.
    for (const [key, child] of Object.entries(value)) if (key !== 'extras' && key !== 'extensions') walk(child, `${path}/${key}`);
  };
  walk(json, '');
}
function matrixLayout(type: string, width: number): { elementBytes: number; offsets: number[] } {
  const dimension = /^MAT([234])$/.exec(type);
  if (!dimension) return { elementBytes: arities[type]! * width, offsets: Array.from({ length: arities[type]! }, (_, i) => i * width) };
  const n = Number(dimension[1]), columnBytes = Math.ceil(n * width / 4) * 4;
  return { elementBytes: n * columnBytes, offsets: Array.from({ length: n * n }, (_, i) => Math.floor(i / n) * columnBytes + (i % n) * width) };
}
function component(view: DataView, offset: number, type: number): number {
  switch (type) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: return fail('invalid componentType');
  }
}

export async function normalizeAsset(input: NormalizeAssetInput): Promise<NormalizedAsset> {
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 4096) fail('invalid file list');
  const files = new Map<string, Uint8Array>();
  let uploadedBytes = 0;
  for (const file of input.files) {
    const name = safePath(file.name);
    if (!(file.data instanceof Uint8Array) || files.has(name)) fail('invalid or duplicate uploaded file');
    uploadedBytes += file.data.byteLength;
    if (uploadedBytes > MAX_BYTES) fail('upload exceeds 256 MiB limit');
    files.set(name, file.data.slice());
  }
  const entry = safePath(input.entry), entryBytes = files.get(entry);
  if (!entryBytes) fail('entry file missing');
  const parsed = parseEntry(entryBytes!), sourceJson = parsed.json;
  validateExtensions(sourceJson);
  const json: GltfJSON = structuredClone(sourceJson);
  const base = entry.slice(0, entry.lastIndexOf('/') + 1);
  const resource = (uri: any): { bytes: Uint8Array; mimeType: string } => {
    if (typeof uri !== 'string') return fail('invalid resource URI');
    if (uri.startsWith('data:')) return dataURI(uri);
    const name = resolvePath(base, uri), bytes = files.get(name);
    if (!bytes) return fail(`missing resource ${name}`);
    return { bytes, mimeType: '' };
  };
  let resolvedBytes = 0;
  const buffers = list(sourceJson.buffers, 'buffers').map((definition, i) => {
    object(definition, `buffer ${i}`);
    const length = integer(definition.byteLength, 'buffer byteLength');
    const bytes = definition.uri !== undefined ? resource(definition.uri).bytes : i === 0 && parsed.binary ? parsed.binary : fail(`missing binary buffer ${i}`);
    if (length > bytes.byteLength) fail(`buffer ${i} shorter than declared length`);
    if (definition.uri === undefined && bytes.byteLength - length > 3) fail('GLB BIN padding exceeds 3 bytes');
    resolvedBytes += length;
    if (resolvedBytes > MAX_BYTES) fail('resolved buffers exceed 256 MiB limit');
    return bytes.subarray(0, length);
  });
  const views = list(sourceJson.bufferViews, 'bufferViews');
  const viewBytes = views.map((definition, i) => {
    object(definition, `bufferView ${i}`);
    const buffer = reference(buffers, definition.buffer, 'buffer'), offset = integer(definition.byteOffset ?? 0, 'bufferView byteOffset'), length = integer(definition.byteLength, 'bufferView byteLength');
    if (offset + length > buffer.byteLength) fail(`bufferView ${i} exceeds buffer`);
    if (definition.byteStride !== undefined && (integer(definition.byteStride, 'byteStride', 252) < 4 || definition.byteStride % 4)) fail('invalid byteStride');
    return buffer.subarray(offset, offset + length);
  });
  let decodedBytes = 0;
  const reserve = (bytes: number): void => { decodedBytes += bytes; if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_BYTES) fail('decoded arrays/images exceed 256 MiB limit'); };
  const definitions = list(sourceJson.accessors, 'accessors');
  const accessors: NormalizedAccessor[] = definitions.map((definition, i) => {
    object(definition, `accessor ${i}`);
    const Ctor = constructors[definition.componentType], arity = arities[definition.type];
    if (!Ctor || !arity) fail(`invalid accessor ${i} componentType/type`);
    const count = integer(definition.count, 'accessor count');
    if (definition.normalized !== undefined && typeof definition.normalized !== 'boolean') fail('invalid normalized flag');
    if (definition.normalized && ![5120, 5121, 5122, 5123].includes(definition.componentType)) fail('invalid normalized componentType');
    reserve(count * arity! * Ctor!.BYTES_PER_ELEMENT);
    return { sourceIndex: i, type: definition.type, componentType: definition.componentType, normalized: definition.normalized ?? false, count, array: new Ctor!(count * arity!) };
  });
  const decoded = new Set<number>();
  const install = (id: any, array: NativeArray): void => {
    const target = reference(accessors, id, 'Draco accessor');
    if (target.array.constructor !== array.constructor || target.array.length !== array.length) fail(`Draco accessor ${id} type/count mismatch`);
    if (decoded.has(id) && !equalArrays(target.array, array)) fail(`conflicting Draco data for accessor ${id}`);
    target.array = array; decoded.add(id);
  };
  let dracoPrimitives = 0;
  let decoderModule: DracoDecoderModule | undefined;
  for (const [meshIndex, mesh] of list(json.meshes, 'meshes').entries()) {
    for (const [primitiveIndex, primitive] of list(mesh.primitives, `mesh ${meshIndex} primitives`).entries()) {
      const compressed = primitive.extensions?.[DRACO];
      if (!compressed) continue;
      object(compressed, 'Draco extension');
      if ((primitive.mode ?? 4) !== 4) fail('Draco TRIANGLE_STRIP topology is not supported; refusing to reinterpret it');
      decoderModule ??= input.dracoDecoder ? await input.dracoDecoder : fail('KHR_draco_mesh_compression requires an injected draco3dgltf decoder module');
      const mod = decoderModule!;
      if (typeof mod.Decoder !== 'function' || typeof mod.destroy !== 'function') fail('invalid draco3dgltf decoder module');
      const decoder = new mod.Decoder(), buffer = new mod.DecoderBuffer(), meshData = new mod.Mesh();
      let status: any;
      try {
        const bytes = reference(viewBytes, compressed.bufferView, 'Draco bufferView');
        buffer.Init(bytes, bytes.length);
        if (decoder.GetEncodedGeometryType(buffer) !== mod.TRIANGULAR_MESH) fail('Draco geometry is not a triangular mesh');
        status = decoder.DecodeBufferToMesh(buffer, meshData);
        if (!status.ok() || !meshData.ptr) fail(`Draco decode failed: ${status.error_msg?.() ?? 'invalid mesh'}`);
        const points = integer(meshData.num_points(), 'Draco point count');
        for (const [semantic, uniqueId] of Object.entries(object(compressed.attributes, 'Draco attributes'))) {
          const id = object(primitive.attributes, 'primitive attributes')[semantic], accessor = reference(accessors, id, 'Draco attribute');
          if (accessor.count !== points) fail(`Draco ${semantic} count differs from source accessor`);
          const attribute = decoder.GetAttributeByUniqueId(meshData, integer(uniqueId, 'Draco attribute unique ID'));
          if (!attribute?.ptr || attribute.num_components() !== arities[accessor.type]) fail(`Draco ${semantic} missing or has incompatible arity`);
          const dataTypes: Record<number, number> = { 5120: mod.DT_INT8, 5121: mod.DT_UINT8, 5122: mod.DT_INT16, 5123: mod.DT_UINT16, 5125: mod.DT_UINT32, 5126: mod.DT_FLOAT32 };
          const Ctor = constructors[accessor.componentType]!, length = accessor.array.length, byteLength = accessor.array.byteLength;
          const pointer = mod._malloc(Math.max(1, byteLength));
          if (!pointer) fail('Draco allocation failed');
          try {
            if (!decoder.GetAttributeDataArrayForAllPoints(meshData, attribute, dataTypes[accessor.componentType], byteLength, pointer)) fail(`Draco failed decoding ${semantic}`);
            install(id, new Ctor(mod.HEAPU8.buffer, pointer, length).slice() as NativeArray);
          } finally { mod._free(pointer); }
        }
        const count = integer(meshData.num_faces(), 'Draco face count') * 3;
        let indexId = primitive.indices;
        if (indexId === undefined) {
          // Non-indexed glTF can still carry indexed Draco connectivity. Make that
          // connectivity explicit without changing any existing source index.
          const componentType = points <= 65535 ? 5123 : 5125, Ctor = constructors[componentType]!;
          reserve(count * Ctor.BYTES_PER_ELEMENT); indexId = accessors.length;
          accessors.push({ sourceIndex: -1, type: 'SCALAR', componentType, normalized: false, count, array: new Ctor(count) });
          (json.accessors ??= []).push({ componentType, type: 'SCALAR', count });
          primitive.indices = indexId;
        }
        const indices = reference(accessors, indexId, 'Draco indices');
        if (indices.type !== 'SCALAR' || indices.normalized || ![5121, 5123, 5125].includes(indices.componentType) || indices.count !== count) fail('Draco index accessor mismatch');
        const face = new mod.DracoInt32Array(), output = new constructors[indices.componentType]!(count);
        try {
          for (let i = 0; i < count / 3; i++) {
            if (!decoder.GetFaceFromMesh(meshData, i, face)) fail('Draco face decode failed');
            for (let c = 0; c < 3; c++) {
              const value = integer(face.GetValue(c), 'Draco vertex index', points - 1);
              output[i * 3 + c] = value;
              if (output[i * 3 + c] !== value) fail('Draco index overflows source componentType');
            }
          }
        } finally { mod.destroy(face); }
        install(indexId, output); dracoPrimitives++;
      } finally {
        if (status) mod.destroy(status);
        mod.destroy(meshData); mod.destroy(buffer); mod.destroy(decoder);
      }
      delete primitive.extensions[DRACO];
      if (!Object.keys(primitive.extensions).length) delete primitive.extensions;
      void primitiveIndex;
    }
  }
  const readElements = (target: NativeArray, definition: GltfJSON, viewId: any, byteOffset: any, count: number, destination?: number[]): void => {
    const bytes = reference(viewBytes, viewId, 'accessor bufferView'), viewDefinition = views[viewId]!;
    const width = constructors[definition.componentType]!.BYTES_PER_ELEMENT, layout = matrixLayout(definition.type, width), offset = integer(byteOffset ?? 0, 'accessor byteOffset');
    const stride = viewDefinition.byteStride ?? layout.elementBytes;
    if (offset % width || ((viewDefinition.byteOffset ?? 0) + offset) % width || stride < layout.elementBytes || stride % width) fail('misaligned accessor or invalid stride');
    if (/^MAT/.test(definition.type) && ((viewDefinition.byteOffset ?? 0) + offset) % 4) fail('matrix columns must be 4-byte aligned');
    const extent = count ? offset + (count - 1) * stride + layout.offsets[layout.offsets.length - 1]! + width : offset;
    if (extent > bytes.length) fail('accessor exceeds bufferView');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), arity = arities[definition.type]!;
    for (let i = 0; i < count; i++) for (let c = 0; c < arity; c++) target[(destination?.[i] ?? i) * arity + c] = component(view, offset + i * stride + layout.offsets[c]!, definition.componentType);
  };
  for (const [id, definition] of definitions.entries()) {
    const target = accessors[id]!;
    if (!decoded.has(id) && definition.bufferView !== undefined) readElements(target.array, definition, definition.bufferView, definition.byteOffset, target.count);
    else if (!decoded.has(id) && definition.byteOffset !== undefined && definition.byteOffset !== 0) fail('accessor byteOffset without bufferView');
    if (definition.sparse !== undefined) {
      const sparse = object(definition.sparse, 'sparse accessor'), count = integer(sparse.count, 'sparse count', target.count);
      object(sparse.indices, 'sparse indices'); object(sparse.values, 'sparse values');
      if (![5121, 5123, 5125].includes(sparse.indices.componentType)) fail('invalid sparse index componentType');
      const sparseIndicesView = reference(views, sparse.indices.bufferView, 'sparse index view'), sparseValuesView = reference(views, sparse.values.bufferView, 'sparse values view');
      if (sparseIndicesView.byteStride !== undefined || sparseValuesView.byteStride !== undefined) fail('sparse views must be tightly packed');
      const indices = new constructors[sparse.indices.componentType]!(count);
      readElements(indices, { type: 'SCALAR', componentType: sparse.indices.componentType }, sparse.indices.bufferView, sparse.indices.byteOffset, count);
      let previous = -1;
      for (const value of indices) { if (value <= previous || value >= target.count) fail('sparse indices must increase strictly within accessor'); previous = value; }
      readElements(target.array, definition, sparse.values.bufferView, sparse.values.byteOffset, count, Array.from(indices));
    }
    if (target.componentType === 5126) for (const value of target.array) if (!Number.isFinite(value)) fail(`accessor ${id} contains non-finite values`);
  }
  const images: NormalizedImage[] = list(sourceJson.images, 'images').map((definition, sourceIndex) => {
    object(definition, `image ${sourceIndex}`);
    if ((definition.uri !== undefined) === (definition.bufferView !== undefined)) fail('image must define exactly one URI or bufferView');
    const resolved = definition.uri !== undefined ? resource(definition.uri) : { bytes: reference(viewBytes, definition.bufferView, 'image bufferView'), mimeType: '' };
    const bytes = resolved.bytes;
    const sniffed = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 ? 'image/png' : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : '';
    const mimeType = definition.mimeType ?? (resolved.mimeType || sniffed);
    if (!['image/png', 'image/jpeg'].includes(mimeType) || sniffed !== mimeType) fail(`image ${sourceIndex} is not a supported PNG/JPEG image`);
    reserve(bytes.length);
    delete json.images[sourceIndex].uri; delete json.images[sourceIndex].bufferView;
    json.images[sourceIndex].mimeType = mimeType;
    return { sourceIndex, mimeType, data: bytes.slice() };
  });
  const warnings = validateScene(json, accessors, images);
  for (const definition of json.accessors ?? []) { delete definition.bufferView; delete definition.byteOffset; delete definition.sparse; }
  delete json.buffers; delete json.bufferViews;
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (json[key] !== undefined) { json[key] = json[key].filter((value: string) => value !== DRACO); if (!json[key].length) delete json[key]; }
  }
  const identities = await Promise.all([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(async ([name, bytes]) => ({ name, byteLength: bytes.length, sha256: await sha256(bytes) })));
  return {
    format: 'KEEL-NATIVE-SCENE', version: 2, json, sourceJson, accessors, images,
    source: { entry, container: parsed.container, files: identities },
    validation: { accessorCount: accessors.length, sourceAccessorCount: definitions.length, decodedBytes, dracoPrimitives, meshPrimitives: list(json.meshes, 'meshes').reduce((sum, mesh) => sum + mesh.primitives.length, 0), imageBytes: images.reduce((sum, image) => sum + image.data.byteLength, 0), preservedSourceIndices: true, decodedReference: 'source-accessor-values', warnings },
    runtime: { dependencies: dracoPrimitives ? ['externally injected draco3dgltf decoder (import only)'] : [], dracoRequiredForReplay: false, decoderCostIncluded: false, decoderNote: 'Host must report decoder JS/WASM transfer, startup and memory separately. Core normalization has no external dependencies.' },
  };
}

/** Validate cross-object references before downstream replay can silently drop one. */
function validateScene(json: GltfJSON, accessors: NormalizedAccessor[], images: NormalizedImage[]): string[] {
  const warnings: string[] = [], checkedTimeAccessors = new Set<number>();
  const meshes = list(json.meshes, 'meshes'), nodes = list(json.nodes, 'nodes'), materials = list(json.materials, 'materials'), skins = list(json.skins, 'skins'), cameras = list(json.cameras, 'cameras');
  const samplers = list(json.samplers, 'samplers'), textures = list(json.textures, 'textures'), scenes = list(json.scenes, 'scenes');
  const morphCount = (mesh: GltfJSON): number => mesh.primitives.find((primitive: GltfJSON) => primitive.targets?.length)?.targets.length ?? 0;
  if (json.scene !== undefined) reference(scenes, json.scene, 'default scene');
  for (const texture of textures) { object(texture, 'texture'); reference(images, texture.source, 'texture source'); if (texture.sampler !== undefined) reference(samplers, texture.sampler, 'texture sampler'); }
  for (const material of materials) {
    object(material, 'material');
    for (const info of materialTextureInfos(material)) {
      if (info !== undefined) { object(info, 'texture info'); reference(textures, info.index, 'material texture'); if (info.texCoord !== undefined) integer(info.texCoord, 'texture coordinate set'); }
    }
  }
  for (const mesh of meshes) {
    object(mesh, 'mesh'); const primitives = list(mesh.primitives, 'primitives');
    if (!primitives.length) fail('mesh has no primitives');
    let targetCount: number | undefined;
    for (const primitive of primitives) {
      object(primitive, 'primitive'); const mode = primitive.mode ?? 4;
      if (!Number.isInteger(mode) || mode < 0 || mode > 6) fail('invalid primitive mode');
      const attributes = object(primitive.attributes, 'primitive attributes'), position = reference(accessors, attributes.POSITION, 'POSITION');
      if (position.type !== 'VEC3' || position.componentType !== 5126 || position.normalized) fail('POSITION must be float VEC3 without unsupported quantization extensions');
      for (const [semantic, id] of Object.entries(attributes)) {
        const accessor = reference(accessors, id, `attribute ${semantic}`);
        if (accessor.count !== position.count) fail(`attribute ${semantic} vertex count mismatch`);
      }
      if (primitive.indices !== undefined) {
        const indices = reference(accessors, primitive.indices, 'primitive indices');
        if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType) || indices.normalized) fail('invalid primitive index accessor');
        for (const value of indices.array) if (value >= position.count) fail('primitive index out of bounds');
      }
      if (primitive.material !== undefined) reference(materials, primitive.material, 'primitive material');
      for (const info of materialTextureInfos(materials[primitive.material])) {
        if (info.extensions?.[TEXTURE_TRANSFORM] === undefined) continue;
        const transform = readTextureTransform(info.extensions[TEXTURE_TRANSFORM], fail), set = transform.texCoord ?? info.texCoord ?? 0;
        const uv = reference(accessors, attributes[`TEXCOORD_${set}`], `${TEXTURE_TRANSFORM} TEXCOORD_${set}`);
        if (uv.type !== 'VEC2' || !(uv.componentType === 5126 && !uv.normalized || [5121, 5123].includes(uv.componentType) && uv.normalized)) fail(`invalid ${TEXTURE_TRANSFORM} TEXCOORD_${set} accessor`);
      }
      const targets = list(primitive.targets, 'morph targets');
      if (targets.length) {
        targetCount ??= targets.length;
        if (targetCount !== targets.length) fail('mesh primitives have different morph target counts');
      }
      for (const target of targets) for (const [semantic, id] of Object.entries(object(target, 'morph target'))) {
        const accessor = reference(accessors, id, `morph ${semantic}`);
        if (accessor.count !== position.count || accessor.type !== 'VEC3' || accessor.componentType !== 5126) fail(`invalid morph ${semantic} accessor`);
        if (!['POSITION', 'NORMAL', 'TANGENT'].includes(semantic)) fail(`unsupported morph semantic ${semantic}`);
      }
    }
    if (mesh.weights !== undefined && list(mesh.weights, 'mesh weights').length !== (targetCount ?? 0)) fail('mesh morph weight count mismatch');
  }
  const parents = new Map<number, number>();
  for (const [i, node] of nodes.entries()) {
    object(node, 'node');
    if (node.mesh !== undefined) reference(meshes, node.mesh, 'node mesh');
    if (node.skin !== undefined) reference(skins, node.skin, 'node skin');
    if (node.camera !== undefined) reference(cameras, node.camera, 'node camera');
    if (node.matrix !== undefined && ['translation', 'rotation', 'scale'].some(key => node[key] !== undefined)) fail('node mixes matrix and TRS');
    for (const [key, count] of [['matrix', 16], ['translation', 3], ['rotation', 4], ['scale', 3]] as const) {
      if (node[key] !== undefined && (!Array.isArray(node[key]) || node[key].length !== count || !node[key].every((v: any) => typeof v === 'number' && Number.isFinite(v)))) fail(`invalid node ${key}`);
    }
    for (const child of list(node.children, 'node children')) { reference(nodes, child, 'node child'); if (parents.has(child)) fail('node has multiple parents or duplicate child reference'); parents.set(child, i); }
    if (node.weights !== undefined) {
      const mesh = reference(meshes, node.mesh, 'morph node mesh');
      if (list(node.weights, 'node morph weights').length !== morphCount(mesh)) fail('node morph weight count mismatch');
    }
  }
  const visited = new Set<number>(), visiting = new Set<number>();
  const visit = (id: number): void => {
    if (visiting.has(id)) fail('node hierarchy contains a cycle');
    if (visited.has(id)) return;
    visiting.add(id); for (const child of nodes[id]!.children ?? []) visit(child); visiting.delete(id); visited.add(id);
  };
  nodes.forEach((_, id) => visit(id));
  for (const scene of scenes) for (const root of list(scene.nodes, 'scene nodes')) { reference(nodes, root, 'scene root'); if (parents.has(root)) fail('scene root is not a root node'); }
  for (const skin of skins) {
    object(skin, 'skin'); const joints = list(skin.joints, 'skin joints');
    if (!joints.length || new Set(joints).size !== joints.length) fail('skin requires unique ordered joints');
    joints.forEach(joint => reference(nodes, joint, 'skin joint'));
    if (skin.skeleton !== undefined) reference(nodes, skin.skeleton, 'skin skeleton');
    if (skin.inverseBindMatrices !== undefined) {
      const matrices = reference(accessors, skin.inverseBindMatrices, 'inverse bind matrices');
      if (matrices.type !== 'MAT4' || matrices.componentType !== 5126 || matrices.count < joints.length) fail('inverse bind matrix type/count mismatch');
    }
  }
  for (const animation of list(json.animations, 'animations')) {
    object(animation, 'animation'); const animationSamplers = list(animation.samplers, 'animation samplers');
    for (const sampler of animationSamplers) {
      object(sampler, 'animation sampler');
      const times = reference(accessors, sampler.input, 'animation input'); reference(accessors, sampler.output, 'animation output');
      if (times.type !== 'SCALAR' || times.componentType !== 5126 || times.normalized) fail('animation times must be float SCALAR');
      let previous = -1, duplicateTimes = 0;
      for (const value of times.array) { if (value < 0 || value < previous) fail('animation times must be nondecreasing and nonnegative'); if (value === previous) duplicateTimes++; previous = value; }
      if (duplicateTimes && !checkedTimeAccessors.has(sampler.input)) warnings.push(`Animation input accessor ${sampler.input} has ${duplicateTimes} duplicate times; retained unchanged, although glTF requires strictly increasing times`);
      checkedTimeAccessors.add(sampler.input);
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.interpolation ?? 'LINEAR')) fail('unsupported animation interpolation');
    }
    const targets = new Set<string>();
    for (const channel of list(animation.channels, 'animation channels')) {
      object(channel, 'animation channel'); object(channel.target, 'animation target');
      const sampler = reference(animationSamplers, channel.sampler, 'animation sampler');
      if (channel.target.node === undefined) continue; // Inert channel per glTF 2.0; retained verbatim.
      const node = reference(nodes, channel.target.node, 'animation target node'), path = channel.target.path;
      const key = `${channel.target.node}/${path}`;
      if (targets.has(key)) fail('duplicate animation channel target'); targets.add(key);
      if (!['translation', 'rotation', 'scale', 'weights'].includes(path)) fail(`unsupported animation target ${String(path)}`);
      if (node.matrix !== undefined && path !== 'weights') fail('TRS animation targets a matrix node');
      const input = accessors[sampler.input]!, output = accessors[sampler.output]!, multiplier = sampler.interpolation === 'CUBICSPLINE' ? 3 : 1;
      const weights = path === 'weights' ? morphCount(reference(meshes, node.mesh, 'animated morph mesh')) : 1;
      const outputType = path === 'weights' ? 'SCALAR' : path === 'rotation' ? 'VEC4' : 'VEC3';
      const validComponents = output.componentType === 5126 || (['rotation', 'weights'].includes(path) && output.normalized && [5120, 5121, 5122, 5123].includes(output.componentType));
      if (!weights || output.type !== outputType || !validComponents || output.count !== input.count * multiplier * weights) fail('animation output type/count mismatch');
    }
  }
  return warnings;
}
