import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAsset, buildAsset } from '../src/asset-compiler-v4.ts';
import { unpackAsset } from '../src/asset-binary-v3.ts';
import { replayAffineHint, encodeAffineHint } from '../src/optimization/draco-transforms.ts';
import { encodeExactBuffer, encodeSurface } from '../src/optimization/exact-encoding.ts';
import { encodeExactIndexSequence } from '../src/optimization/index-codec.ts';
import { replaySurface } from '../src/asset-native-surface-v3.ts';

const input = { entry: 'empty.gltf', files: [{ name: 'empty.gltf', data: new TextEncoder().encode('{"asset":{"version":"2.0"}}') }] };
async function affineFixture() {
  const r: any = unpackAsset((await compileAsset(input)).packageBytes), base = r.native.base;
  base.json.accessors = [{ componentType: 5126, count: 1, type: 'SCALAR' }];
  base.descriptors = [{ componentType: 5126, count: 1, type: 'SCALAR', normalized: false }];
  base.residualAccessors = [{ kind: 'v4-affine', accessor: 0 }];
  r.affine = [{ kind: 'float-affine', accessor: 0, count: 1, width: 1, minimum: [0], scale: 1, codeWidth: 2, codes: { codec: 'raw', parameters: { version: 1 }, sourceLength: 2, data: new Uint8Array([3, 0]) } }];
  return r;
}

test('v4 defaults to native lossless, requires explicit lossy settings, and never accepts source passthrough', async () => {
  const result = await compileAsset(input);
  assert.equal(result.manifest.mode, 'lossless');
  assert.equal(result.manifest.representation, 'native-code');
  assert.match(result.program, /buildFromPackage/);
  await assert.rejects(compileAsset({ ...input, mode: 'bounded-lossy' }), /explicit/);
  await assert.rejects(compileAsset({ ...input, mode: 'unknown' }), /mode/);
});

test('screened shared position reuse preserves hostile Float32 words and sign bits across all axes', () => {
  let state = 195337;
  const random = () => state = (Math.imul(state,1664525)+1013904223) >>> 0;
  for(let axis=0;axis<3;axis++) {
    const base = Uint32Array.from({length:128*3},()=>random());
    for(let row=0;row<128;row++)base[row*3+axis]! &= 0x7fffffff;
    base[axis]=0; base[3+axis]=0x7f800001; base[6+axis]=0x7fc12345;
    const words = new Uint32Array(4096*3);
    for(let i=0;i<4096;i++){const row=(random()>>>8)%128;words.set(base.subarray(row*3,row*3+3),i*3);if(random()&0x100)words[i*3+axis]! ^= 0x80000000;}
    const result = encodeSurface({positions:new Float32Array(words.buffer),indices:null,mode:0});
    assert.equal(result.recipe.positions.kind,'mirror');
    assert.deepEqual(new Uint32Array(replaySurface(result.recipe).positions.buffer),words);
    assert(result.metrics.recipeBytes<=result.metrics.residualRecipeBytes);
  }
});

test('source-affine encoding is word-exact and declines signed-zero and nonfinite substitutions', () => {
  const encode = (bytes: Uint8Array, hints?: any) => encodeExactBuffer(bytes, hints).recipe;
  for (const width of [1, 2, 3, 4]) for (const bits of [8, 16, 20]) {
    const scale = Math.fround(.000123), minimum = Array.from({ length: width }, (_, i) => Math.fround(-3.25 + i));
    const array = Float32Array.from({ length: 400 * width }, (_, i) => Math.fround(Math.fround((i * 133 % (2 ** bits - 1)) * scale) + minimum[i % width]!));
    const a: any = { sourceIndex: 0, type: width === 1 ? 'SCALAR' : 'VEC' + width, componentType: 5126, count: 400, normalized: false, array };
    const recipe = encodeAffineHint(0, a, { kind: 'float-affine', bits, width, scale, minimum }, encode);
    assert(recipe); assert.deepEqual(new Uint8Array(replayAffineHint(recipe).buffer), new Uint8Array(array.buffer));
  }
  for (const value of [-0, NaN, Infinity, -Infinity]) {
    const a: any = { sourceIndex: 0, type: 'SCALAR', componentType: 5126, count: 1, normalized: false, array: new Float32Array([value]) };
    assert.equal(encodeAffineHint(0, a, { kind: 'float-affine', bits: 8, width: 1, scale: 1, minimum: [0] }, encode), null);
  }
});

test('affine rejects malformed descriptors, extents, repeated targets, and mismatched markers', async () => {
  const good = await affineFixture(); assert.equal((await buildAsset(good)).accessors[0][0], 3);
  const mutations: Array<(r: any) => void> = [
    r => r.affine.push(structuredClone(r.affine[0])),
    r => r.affine[0].count = 1e12,
    r => r.affine[0].width = 3,
    r => r.affine[0].accessor = -1,
    r => r.affine[0].minimum = [Infinity],
    r => r.affine[0].scale = NaN,
    r => r.affine[0].codes.sourceLength = 2e9,
    r => r.affine[0].codes.data = new Uint8Array(0),
    r => r.native.base.residualAccessors[0] = null,
    r => r.native.base.residualAccessors[0].accessor = 99,
  ];
  for (const mutate of mutations) { const bad = structuredClone(good); mutate(bad); await assert.rejects(buildAsset(bad), mutate.toString()); }
});

test('v4 must reject the aggregate decoded budget before allocating affine output', async () => {
  const recipe = await affineFixture();
  recipe.native.base.images = Array.from({ length: 8 }, () => ({ mimeType: 'image/png', data: null }));
  recipe.native.images = recipe.native.base.images.map((_: unknown, image: number) => ({ image, recipe: { version: 3, codec: 'rgba-zlib', width: 4096, height: 4096, decodedLength: 1, data: new Uint8Array() } }));
  const original = globalThis.Float32Array;
  let allocations = 0;
  globalThis.Float32Array = new Proxy(original, { construct(target, args) { allocations++; return Reflect.construct(target, args); } }) as Float32ArrayConstructor;
  try { await assert.rejects(buildAsset(recipe), /aggregate decoded budget/); }
  finally { globalThis.Float32Array = original; }
  assert.equal(allocations, 0, 'affine output was allocated before the whole-recipe preflight');
});

test('v4 exact-index integration rejects bad owners, markers, duplicate targets and invalid decoded indices', async () => {
  const r: any = unpackAsset((await compileAsset(input)).packageBytes), base = r.native.base;
  const position = new Float32Array([0,0,0,1,0,0,1,1,0,0,1,0]), index = new Uint16Array([0,1,2,0,2,3]);
  base.json.accessors = [{componentType:5126,count:4,type:'VEC3'},{componentType:5123,count:6,type:'SCALAR'}];
  base.descriptors = base.json.accessors.map((d: any) => ({...d,normalized:false}));
  base.json.meshes = [{primitives:[{attributes:{POSITION:0},indices:1}]}];
  base.residualAccessors = [null,null];
  base.surfaces = [{mesh:0,primitive:0,positionAccessor:0,indexAccessor:1,recipe:{version:2,vertexCount:4,mode:4,indexType:5123,indexCount:6,positions:{kind:'residual',buffer:{codec:'raw',parameters:{version:1},sourceLength:position.byteLength,data:new Uint8Array(position.buffer)}},topology:{kind:'v4-index',accessor:1}}}];
  r.indices = [{accessor:1,recipe:(await encodeExactIndexSequence(index,{compress:true})).recipe}];
  const built = await buildAsset(r); assert.deepEqual(built.accessors[1],index); assert.deepEqual(built.accessors[0],position);
  const mutations: Array<(r:any)=>void> = [
    r => r.indices.push(structuredClone(r.indices[0])),
    r => r.indices[0].accessor = 0,
    r => r.indices[0].recipe.count = 1e12,
    r => r.indices[0].recipe.data.sourceLength = 1e12,
    r => r.indices[0].recipe.data.data = new Uint8Array(),
    r => r.native.base.surfaces[0].recipe.topology.accessor = 99,
    r => r.native.base.surfaces[0].recipe.topology.kind = 'residual',
    r => r.native.base.residualAccessors[1] = {codec:'raw'},
    r => r.native.base.surfaces = [],
  ];
  for(const mutate of mutations){const bad=structuredClone(r);mutate(bad);await assert.rejects(buildAsset(bad),mutate.toString());}
  const range = structuredClone(r); range.indices[0].recipe=(await encodeExactIndexSequence(new Uint16Array([0,1,2,0,2,4]))).recipe; await assert.rejects(buildAsset(range),/range/);
});

test('compiler integration remaps all attributes and simultaneous morphs consistently while preserving every rig and clip word', async () => {
  const arrays: any[] = [], views: any[] = [], descriptors: any[] = [], chunks: Uint8Array[] = [];
  let length = 0;
  const add = (array: any, type: string, componentType = 5126) => {
    const pad = (4 - length % 4) % 4; chunks.push(new Uint8Array(pad)); length += pad;
    views.push({ buffer: 0, byteOffset: length, byteLength: array.byteLength });
    const raw = new Uint8Array(array.buffer, array.byteOffset, array.byteLength); chunks.push(raw); length += raw.length;
    descriptors.push({ bufferView: arrays.length, componentType, type, count: array.length / ({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16} as any)[type] });
    arrays.push(array); return arrays.length - 1;
  };
  const size = 12, count = (size + 1) ** 2, positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uv = new Float32Array(count * 2), ids = new Uint16Array(count), joints = new Uint8Array(count * 4), weights = new Float32Array(count * 4), morphA = new Float32Array(count * 3), morphB = new Float32Array(count * 3), indices: number[] = [];
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
    const v = y * (size + 1) + x; positions.set([x / size, y / size, 0], v * 3); normals[v * 3 + 2] = 1; uv.set([x / size,y / size],v * 2); ids[v] = v; weights[v * 4] = 1; morphA[v * 3 + 2] = x / size * .02; morphB[v * 3 + 2] = y / size * .03;
    if (x < size && y < size) { const b = v + 1, c = v + size + 1, d = c + 1; indices.push(v,b,d,v,d,c); }
  }
  const attributes = { POSITION: add(positions,'VEC3'), NORMAL: add(normals,'VEC3'), TEXCOORD_0: add(uv,'VEC2'), JOINTS_0: add(joints,'VEC4',5121), WEIGHTS_0: add(weights,'VEC4'), _AUDIT: add(ids,'SCALAR',5123) };
  const primitive = { attributes, indices: add(new Uint16Array(indices),'SCALAR',5123), targets: [{ POSITION:add(morphA,'VEC3') },{ POSITION:add(morphB,'VEC3') }], material:0 };
  const inverseBindMatrices = add(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),'MAT4');
  const time = add(new Float32Array([0,1]),'SCALAR'), translation = add(new Float32Array([0,0,0,0,.1,0]),'VEC3'), rotation = add(new Float32Array([0,0,0,1,0,0,.1,Math.sqrt(.99)]),'VEC4'), scale = add(new Float32Array([1,1,1,1,1,1.1]),'VEC3'), morphWeights = add(new Float32Array([.2,.5,.7,.3]),'SCALAR');
  const animations = [{name:'Move',samplers:[{input:time,output:translation}],channels:[{sampler:0,target:{node:1,path:'translation'}}]},{name:'Rotate and scale',samplers:[{input:time,output:rotation},{input:time,output:scale}],channels:[{sampler:0,target:{node:1,path:'rotation'}},{sampler:1,target:{node:1,path:'scale'}}]},{name:'Both morphs',samplers:[{input:time,output:morphWeights}],channels:[{sampler:0,target:{node:0,path:'weights'}}]}];
  const json = { asset:{version:'2.0'},buffers:[{uri:'data.bin',byteLength:length}],bufferViews:views,accessors:descriptors,meshes:[{weights:[.25,.75],primitives:[primitive]}],nodes:[{mesh:0,skin:0},{name:'joint'}],skins:[{joints:[1],inverseBindMatrices}],animations,materials:[{name:'PBR',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.2,.3,.4,.9],roughnessFactor:.3,metallicFactor:.6}}],scenes:[{nodes:[0,1]}],scene:0 };
  const data = new Uint8Array(length); let at = 0; for(const c of chunks){data.set(c,at);at+=c.length;}
  const result = await compileAsset({files:[{name:'model.gltf',data:new TextEncoder().encode(JSON.stringify(json))},{name:'data.bin',data}],entry:'model.gltf',mode:'bounded-lossy',geometry:{targetRatio:.5,maxError:.01}});
  assert.equal(result.manifest.passes.geometry.changedPrimitives,1); assert(result.manifest.passes.geometry.outputTriangles < indices.length / 3);
  const built = await buildAsset(unpackAsset(result.packageBytes)), output = built.scene.json, p = output.meshes[0].primitives[0], map = built.accessors[p.attributes._AUDIT];
  for(const key of ['nodes','skins','animations','materials','scenes','scene'])assert.deepEqual(output[key],(json as any)[key]);
  for(const id of [inverseBindMatrices,time,translation,rotation,scale,morphWeights])assert.deepEqual(new Uint8Array(built.accessors[id].buffer),new Uint8Array(arrays[id].buffer));
  for(const [before,after] of [[primitive.attributes,p.attributes],...primitive.targets.map((target,i)=>[target,p.targets[i]])])for(const semantic of Object.keys(before)) {
    const source = arrays[before[semantic]], candidate = built.accessors[after[semantic]], width = source.length / count;
    for(let v=0;v<map.length;v++)assert.deepEqual(new Uint8Array(candidate.buffer,candidate.byteOffset+v*width*candidate.BYTES_PER_ELEMENT,width*candidate.BYTES_PER_ELEMENT),new Uint8Array(source.buffer,source.byteOffset+map[v]*width*source.BYTES_PER_ELEMENT,width*source.BYTES_PER_ELEMENT),semantic+' vertex '+v);
  }
});
test('bounded geometry preserves absent accessor tables in valid empty scenes',async()=>{
 const bytes=new TextEncoder().encode('{"asset":{"version":"2.0"}}');
 const result=await compileAsset({files:[{name:'empty.gltf',data:bytes}],entry:'empty.gltf',mode:'bounded-lossy',geometry:{targetRatio:.5,maxError:.01,samplesPerClip:5,maxSurfaceSamples:2048}});
 const glb=result.preview.data,view=new DataView(glb.buffer,glb.byteOffset,glb.byteLength),json=JSON.parse(new TextDecoder().decode(glb.subarray(20,20+view.getUint32(12,true))));
 assert.equal(Object.hasOwn(json,'accessors'),false);assert.equal(Object.hasOwn(json,'images'),false);assert.equal(Object.hasOwn(json,'buffers'),false);
});
