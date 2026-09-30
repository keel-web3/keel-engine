/** Deterministic, lossless glTF asset-to-reconstruction-code compiler.
 * This preserves residual geometry. It does not claim primitive inference.
 * Buffer predictors are selected by encoded cost, with exact raw fallbacks.
 */
import { encodeBuffer, decodeBuffer } from './asset-buffer-codec.ts';
export const COMPILER_VERSION = 'keel-asset-compiler-0.1.0';
const MAX_BYTES = 256 * 1024 * 1024;
const te = new TextEncoder(), td = new TextDecoder('utf-8', { fatal: true });
type J = Record<string, any>;
export interface AssetFile { name: string; data: Uint8Array }
export interface CompileAssetInput { files: AssetFile[]; entry: string; mode?: 'lossless' }
function fail(m: string): never { throw new Error(`Asset compiler: ${m}`); }
function int(x: any, label: string, max = MAX_BYTES): number { if (!Number.isSafeInteger(x) || x < 0 || x > max) fail(`invalid ${label}`); return x; }
function path(s: string): string {
  if (typeof s !== 'string' || !s || /[\x00-\x1f\\]/.test(s) || s.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(s)) fail('unsafe resource path');
  const a: string[] = []; for (const p of s.split('/')) { if (!p || p === '.') continue; if (p === '..') { if (!a.length) fail('resource path escapes upload'); a.pop(); } else a.push(p); }
  if (!a.length) fail('empty resource path'); return a.join('/');
}
function uriPath(base: string, uri: string): string {
  if (/[?#]/.test(uri)) fail('query or fragment in resource URI is unsupported');
  let decoded: string; try { decoded = decodeURIComponent(uri); } catch { return fail('invalid resource URI encoding'); }
  if (decoded.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || /[\x00-\x1f\\]/.test(decoded)) fail('external or absolute resource URI unsupported');
  return path(base + decoded);
}
const sha = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b)))).map(x => x.toString(16).padStart(2, '0')).join('');
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function b64(b: Uint8Array): string { let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); }
function unb64(s: string): Uint8Array { if (typeof s !== 'string' || s.length > MAX_BYTES * 1.4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) fail('invalid base64 payload'); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function stable(x: any): string { if (x === null || typeof x !== 'object') return JSON.stringify(x); if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'; return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'; }
function dataUri(uri: string): Uint8Array {
  const m = /^data:([^,]*),(.*)$/s.exec(uri); if (!m) return fail('invalid data URI'); const header = m[1]!, body = m[2]!;
  if (header.endsWith(';base64')) return unb64(body);
  const result: number[] = []; for (let i = 0; i < body.length; i++) { if (body[i] === '%') { const s = body.slice(i + 1, i + 3); if (!/^[a-f\d]{2}$/i.test(s)) fail('invalid data URI escape'); result.push(parseInt(s, 16)); i += 2; } else { if (body.charCodeAt(i) > 127) fail('non-ASCII data URI must be escaped'); result.push(body.charCodeAt(i)); } } return new Uint8Array(result);
}
interface Span { start: number; end: number; role: string; stride?: number | undefined; componentBytes?: number | undefined }
function inspect(entry: AssetFile, files: Map<string, AssetFile>) {
  const spans = new Map<string, Span[]>(), bytes = entry.data, dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const glb = bytes.length >= 4 && dv.getUint32(0, true) === 0x46546c67;
  let json: J, binary: { data: Uint8Array; start: number } | undefined;
  const add = (file: string, s: Span) => { const f = files.get(file)!; if (s.start < 0 || s.end < s.start || s.end > f.data.length) fail('segment outside resource'); const a = spans.get(file) ?? []; a.push(s); spans.set(file, a); };
  if (glb) {
    if (bytes.length < 20 || dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== bytes.length) fail('invalid GLB header or declared length');
    add(entry.name, { start: 0, end: 12, role: 'glb-header' }); let off = 12, jsonCount = 0; json = {};
    while (off < bytes.length) {
      if (off + 8 > bytes.length) fail('truncated GLB chunk header'); const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), start = off + 8;
      if (len % 4 || start + len > bytes.length) fail('invalid GLB chunk extent'); add(entry.name, { start: off, end: start, role: 'chunk-header' });
      if (type === 0x4e4f534a) { if (jsonCount++ || off !== 12) fail('GLB JSON chunk must be first and unique'); try { json = JSON.parse(td.decode(bytes.subarray(start, start + len))); } catch { fail('invalid glTF JSON'); } add(entry.name, { start, end: start + len, role: 'scene-json' }); }
      else if (type === 0x004e4942) { if (binary) fail('multiple GLB BIN chunks unsupported'); binary = { data: bytes.subarray(start, start + len), start }; }
      else add(entry.name, { start, end: start + len, role: 'unknown-chunk-exact-residual' }); off = start + len;
    }
    if (!jsonCount) fail('missing GLB JSON');
  } else { try { json = JSON.parse(td.decode(bytes)); } catch { return fail('input is neither GLB nor valid glTF JSON'); } add(entry.name, { start: 0, end: bytes.length, role: 'scene-json' }); }
  if (!json || typeof json !== 'object' || !json.asset || json.asset.version !== '2.0') fail('only glTF 2.0 is supported');
  const base = entry.name.slice(0, entry.name.lastIndexOf('/') + 1), buffers: Array<{ bytes: Uint8Array; file?: string; start: number }> = [];
  const resource = (uri: any) => { if (typeof uri !== 'string') return fail('invalid resource URI'); if (uri.startsWith('data:')) return { bytes: dataUri(uri), start: 0 }; const name = uriPath(base, uri), f = files.get(name); if (!f) return fail(`missing resource: ${name}`); return { bytes: f.data, file: name, start: 0 }; };
  for (const [i, b] of (json.buffers ?? []).entries()) {
    const declared = int(b.byteLength, 'buffer byteLength'); let r;
    if (b.uri !== undefined) r = resource(b.uri); else { if (i !== 0 || !binary) fail('missing binary buffer'); r = { bytes: binary!.data, file: entry.name, start: binary!.start }; }
    if (declared > r.bytes.length) fail('buffer shorter than declared byteLength'); buffers.push(r);
  }
  const componentSize: J = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, components: J = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const views = json.bufferViews ?? [];
  for (const [i, v] of views.entries()) {
    const bi = int(v.buffer, 'buffer index', buffers.length - 1), b = buffers[bi]; if (!b) fail('missing buffer'); const start = int(v.byteOffset ?? 0, 'bufferView offset'), length = int(v.byteLength, 'bufferView length');
    if (start + length > b.bytes.length || start + length > json.buffers[bi].byteLength) fail('bufferView exceeds buffer');
    const accessors = (json.accessors ?? []).filter((a: J) => a.bufferView === i), widths = [...new Set(accessors.map((a: J) => componentSize[a.componentType]))];
    const stride = v.byteStride ?? (accessors.length === 1 ? componentSize[accessors[0].componentType] * components[accessors[0].type] : undefined);
    if (b.file) add(b.file, { start: b.start + start, end: b.start + start + length, role: (json.images ?? []).some((x: J) => x.bufferView === i) ? 'image-exact-residual' : accessors.length ? 'accessor-buffer' : 'compressed-or-extension-residual', stride: stride && int(stride, 'stride', 2048), componentBytes: widths.length === 1 ? widths[0] as number : undefined });
  }
  for (const a of json.accessors ?? []) {
    const n = int(a.count, 'accessor count'), w = componentSize[a.componentType], c = components[a.type]; if (!w || !c) fail('invalid accessor type');
    if (a.bufferView !== undefined) { const v = views[int(a.bufferView, 'accessor view', views.length - 1)]; if (!v) fail('missing accessor view'); const off = int(a.byteOffset ?? 0, 'accessor offset'), stride = v.byteStride ?? w * c; if (off + (n ? (n - 1) * stride + w * c : 0) > v.byteLength) fail('accessor exceeds bufferView'); }
    if (a.sparse) {
      const s = a.sparse, count = int(s.count, 'sparse count', n);
      if (!s.indices || !s.values || ![5121, 5123, 5125].includes(s.indices.componentType)) fail('invalid sparse index type');
      const matrixSize = /^MAT([234])$/.exec(a.type), elementBytes = matrixSize ? Number(matrixSize[1]) * Math.ceil(Number(matrixSize[1]) * w / 4) * 4 : w * c;
      for (const [part, width] of [[s.indices, componentSize[s.indices.componentType]], [s.values, elementBytes]] as const) {
        const view = views[int(part.bufferView, 'sparse bufferView', views.length - 1)]; if (!view) fail('invalid sparse accessor');
        const off = int(part.byteOffset ?? 0, 'sparse offset'); if (off + count * width > view.byteLength) fail('sparse accessor exceeds bufferView');
      }
    }
  }
  for (const image of json.images ?? []) { if (image.uri !== undefined) resource(image.uri); else if (!views[image.bufferView]) fail('missing image bufferView'); }
  const required: string[] = json.extensionsRequired ?? [], used: string[] = json.extensionsUsed ?? [];
  const features = { container: glb ? 'glb' : 'gltf', meshes: (json.meshes ?? []).length, primitives: (json.meshes ?? []).reduce((n: number, m: J) => n + (m.primitives ?? []).length, 0), nodes: (json.nodes ?? []).length, materials: (json.materials ?? []).length, images: (json.images ?? []).length, skins: (json.skins ?? []).length, joints: (json.skins ?? []).reduce((n: number, s: J) => n + s.joints.length, 0), animations: (json.animations ?? []).length, animationChannels: (json.animations ?? []).reduce((n: number, a: J) => n + a.channels.length, 0), morphTargets: (json.meshes ?? []).reduce((n: number, m: J) => n + (m.primitives ?? []).reduce((n: number, p: J) => n + (p.targets ?? []).length, 0), 0), extensionsRequired: required, extensionsUsed: used };
  return { spans, features, glb, warnings: ['This compiler preserves residual mesh data; it does not infer geometric primitives.', ...required.map(e => `${e}: preserved byte-exact; rendering requires a compatible external decoder.`)] };
}
export async function compileAsset(input: CompileAssetInput) {
  if (input.mode !== undefined && input.mode !== 'lossless') fail('only strict lossless mode is implemented');
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 4096) fail('invalid file list');
  let total = 0; const files = new Map<string, AssetFile>();
  for (const f of input.files) { if (!(f.data instanceof Uint8Array)) fail('file data must be Uint8Array'); const name = path(f.name); if (files.has(name)) fail('duplicate file path'); total += f.data.length; if (total > MAX_BYTES) fail('upload exceeds 256 MiB limit'); files.set(name, { name, data: f.data }); }
  const sourceEntry = path(input.entry), entry = files.get(sourceEntry); if (!entry) fail('entry file missing');
  const info = inspect(entry!, files), canonicalEntry = info.glb && files.size === 1 ? 'asset.glb' : sourceEntry;
  const blocks: J[] = [], resources: J[] = [], known = new Map<string, number>(), passCounts: J = {}; let reusedBytes = 0;
  for (const f of [...files.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const ss = info.spans.get(f.name) ?? [], cuts = [...new Set([0, f.data.length, ...ss.flatMap(s => [s.start, s.end])])].sort((a, b) => a - b), segments: J[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const start = cuts[i], end = cuts[i + 1]; if (end === start) continue;
      const hint = ss.find(s => s.start === start && s.end === end), raw = f.data.subarray(start, end), h = await sha(raw); let block = known.get(h);
      if (block === undefined) { const encoded = encodeBuffer(raw, hint ? { ...(hint.stride !== undefined ? {stride: hint.stride} : {}), ...(hint.componentBytes !== undefined ? {componentBytes: hint.componentBytes} : {}) } : undefined); block = blocks.length; known.set(h, block); blocks.push({ codec: encoded.codec, data: b64(encoded.data), parameters: encoded.parameters, sourceLength: raw.length, sha256: h }); passCounts[encoded.codec] = (passCounts[encoded.codec] ?? 0) + 1; }
      else reusedBytes += raw.length;
      segments.push({ offset: start, length: raw.length, role: hint?.role ?? 'uninterpreted-exact-residual', block });
    }
    resources.push({ name: f.name === sourceEntry ? canonicalEntry : f.name, byteLength: f.data.length, sha256: await sha(f.data), segments });
  }
  const recipe = { format: 'KEEL-LOSSLESS-ASSET', compilerVersion: COMPILER_VERSION, mode: 'lossless', entry: canonicalEntry, resources, blocks };
  const packageBytes = te.encode(stable(recipe)); const decoded = await reconstructAsset(recipe);
  for (const f of decoded.files) { const original = files.get(f.name === canonicalEntry ? sourceEntry : f.name); if (!original || !equal(original.data, f.data)) fail('internal byte-exact validation failed'); }
  const previewFile = decoded.files.find(f => f.name === decoded.entry)!;
  const manifest = { compilerVersion: COMPILER_VERSION, mode: 'lossless', sourceBytes: total, packageBytes: packageBytes.length, sourceSha256: await sha(entry!.data), outputSha256: await sha(previewFile.data), packageSha256: await sha(packageBytes), features: info.features, passes: { codecs: passCounts, duplicateBytesReused: reusedBytes, blocks: blocks.length }, warnings: info.warnings, validation: { resourceBytesExact: true, resourceCount: files.size }, runtime: { required: 'asset-decoder.mjs', includedInPackageBytes: false }, limits: { maxBytes: MAX_BYTES, qualityMode: false, primitiveInference: false } };
  const program = `// Generated by ${COMPILER_VERSION}. Residual mesh data is explicit.\nimport {reconstructAsset} from './asset-decoder.mjs';\nexport const recipe=${stable(recipe)};\nexport const build=()=>reconstructAsset(recipe);\n`;
  return { packageBytes, program, manifest, preview: { name: previewFile.name, data: previewFile.data, files: decoded.files } };
}
export async function reconstructAsset(recipe: any): Promise<{ entry: string; files: AssetFile[] }> {
  if (!recipe || recipe.format !== 'KEEL-LOSSLESS-ASSET' || recipe.compilerVersion !== COMPILER_VERSION || recipe.mode !== 'lossless') fail('unknown asset package version or mode');
  if (!Array.isArray(recipe.blocks) || !Array.isArray(recipe.resources) || recipe.resources.length > 4096 || recipe.blocks.length > 1000000) fail('invalid package arrays');
  let bytes = 0; for (const r of recipe.resources) { bytes += int(r.byteLength, 'resource length'); if (bytes > MAX_BYTES) fail('decoded asset exceeds limit'); }
  let blockTotal = 0; const blocks: Uint8Array[] = [];
  for (const b of recipe.blocks) { blockTotal += int(b.sourceLength, 'block length'); if (blockTotal > MAX_BYTES) fail('decoded blocks exceed limit'); const data = decodeBuffer({ codec: b.codec, parameters: b.parameters, sourceLength: b.sourceLength, data: unb64(b.data), candidates: [] }, MAX_BYTES); if (data.length !== b.sourceLength || await sha(data) !== b.sha256) fail('block checksum mismatch'); blocks.push(data); }
  const names = new Set<string>(), files: AssetFile[] = [];
  for (const r of recipe.resources) {
    const name = path(r.name); if (names.has(name)) fail('duplicate decoded resource'); names.add(name); if (!Array.isArray(r.segments)) fail('invalid segment list'); const data = new Uint8Array(r.byteLength); let offset = 0;
    for (const s of r.segments) { if (s.offset !== offset) fail('non-contiguous asset segments'); const b = blocks[int(s.block, 'block index', blocks.length - 1)]; if (!b || s.length !== b.length || offset + b.length > data.length) fail('invalid segment extent'); data.set(b, offset); offset += b.length; }
    if (offset !== data.length || await sha(data) !== r.sha256) fail('resource checksum mismatch'); files.push({ name, data });
  }
  const entry = path(recipe.entry); if (!names.has(entry)) fail('decoded entry missing'); return { entry, files };
}
export async function decodePackage(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES * 2) fail('invalid package bytes'); let recipe; try { recipe = JSON.parse(td.decode(bytes)); } catch { return fail('invalid package JSON'); } return reconstructAsset(recipe);
}
