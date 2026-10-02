import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAsset } from '../src/asset-compiler-v6.ts';
import { compileAnimatedVoxels } from '../src/animated-voxel.ts';
import { compileAnimatedVoxelStyledAsset } from '../src/styled-asset-compiler.ts';
import { buildAnimatedVoxelAsset } from '../src/animated-voxel-replay.ts';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { createStyledAsset, createAnimatedVoxelStyledAsset, importStyledAsset, styledAssetJson } from '../src/styled-asset.ts';
import { encodeBuffer, decodeBuffer } from '../src/asset-buffer-codec.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { MORPH_VOXEL_FORMAT } from '../src/animated-voxel-replay.ts';
import { encodeVoxelSnapshot, replayVoxelSnapshot } from '../src/styled-voxel-codec.ts';
import { normalizeAsset } from '../src/asset-normalize-v3.ts';
const I = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture(skinned = true, interpolation = 'LINEAR') {
  const arrays = [new Float32Array([0,0,0, 1,0,0, 0,1,0]), new Uint16Array([0,1,2]), new Uint16Array([0,1,0,0,0,1,0,0,0,1,0,0]), new Float32Array([.5,.5,0,0,.5,.5,0,0,.5,.5,0,0]), new Float32Array([...I,...I]), new Float32Array([0,1]), new Float32Array(interpolation==='CUBICSPLINE'?[0,0,0,0,0,0,1,0,0,1,0,0,2,0,0,0,0,0]:[0,0,0,2,0,0])];
  const json:any={asset:{version:'2.0',copyright:'fixture'},accessors:[{componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,0]},{componentType:5123,type:'SCALAR',count:3},{componentType:5123,type:'VEC4',count:3},{componentType:5126,type:'VEC4',count:3},{componentType:5126,type:'MAT4',count:2},{componentType:5126,type:'SCALAR',count:2,min:[0],max:[1]},{componentType:5126,type:'VEC3',count:interpolation==='CUBICSPLINE'?6:2}],meshes:[{primitives:[{attributes:{POSITION:0,...(skinned?{JOINTS_0:2,WEIGHTS_0:3}:{})},indices:1}]}],nodes:[{name:'parent',translation:[3,4,5],scale:[2,1,.5],children:[1,2,3]},{name:'mesh',mesh:0,...(skinned?{skin:0}:{})},{name:'bone0'},{name:'bone1'}],skins:skinned?[{joints:[2,3],inverseBindMatrices:4}]:[],animations:[{name:interpolation,channels:[{sampler:0,target:{node:skinned?3:1,path:'translation'}}],samplers:[{input:5,output:6,interpolation}]}],scenes:[{nodes:[0]}],scene:0};
  return {json,arrays,glb:()=>writeNativeGlb(json,arrays,[])};
}
async function native(f=fixture()) { const glb=f.glb();return compileAsset({entry:'model.glb',files:[{name:'model.glb',data:glb}],mode:'lossless'}); }

test('animated cubes retain exact blended rig and all keyframes with transformed parents',async()=>{
  const f=fixture(),n=await native(f),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});
  assert.ok(r.cubes>0);assert.ok(r.restMaxError<1e-5);assert.equal(r.report.maxDiscardedWeight,0);
  assert.deepEqual(r.scene.json.nodes.map((n:any)=>n.translation),f.json.nodes.map((n:any)=>n.translation));
  assert.equal(r.scene.json.animations[0].name,'LINEAR');assert.equal(r.scene.json.skins[0].joints.length,2);
  assert.deepEqual(r.accessors[0],f.arrays[4]);assert.deepEqual(r.accessors[1],f.arrays[5]);assert.deepEqual(r.accessors[2],f.arrays[6]);
  assert.equal(r.scene.json.images,undefined);assert.equal(r.images.length,0);
  const p=r.scene.json.meshes[0].primitives[0],weights=r.accessors[p.attributes.WEIGHTS_0];assert.equal(weights[0],.5);assert.equal(weights[1],.5);
  assert.deepEqual((await buildAnimatedVoxelAsset(r.recipe)).glb,r.glb);
});

test('rigid clips and STEP/CUBICSPLINE samplers retain original node graph and values',async()=>{
  for(const interpolation of ['STEP','CUBICSPLINE']){const f=fixture(false,interpolation),n=await native(f),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});assert.equal(r.scene.json.skins.length,0);assert.equal(r.scene.json.animations[0].samplers[0].interpolation,interpolation);assert.deepEqual(r.accessors[1],f.arrays[6]);assert.equal(r.scene.json.meshes[0].primitives[0].attributes.JOINTS_0,undefined);assert.ok(r.restMaxError<1e-5);}
});

test('full binary/readable v4 assets repeat and replay the same animated geometry',async()=>{
 const f=fixture();f.json.nodes[0].rotation=[0,-0,0,1];const n=await native(f),input={packageBytes:n.packageBytes,voxels:8};const a=await compileAnimatedVoxelStyledAsset(input),b=await compileAnimatedVoxelStyledAsset(input);assert.deepEqual(a.assetBytes,b.assetBytes);assert.equal(a.imported.version,4);assert.deepEqual(a.imported.animation,{mode:'preserved',clips:1,skins:1});assert.equal(a.imported.voxelCount,a.report.cubes);assert.equal(a.report.assetBytes,a.assetBytes.length);assert.deepEqual((await importStyledAsset(new TextEncoder().encode(styledAssetJson(a.assetBytes)))).glb,a.imported.glb);const e=unpackAsset(a.assetBytes);assert.equal(e.native.byteLength,0);assert.equal(e.native.dracoRequired,false);assert.equal(e.animatedVoxel.scene.meshes,undefined);
});

test('animated sources cannot silently use static snapshot export',async()=>{
 const n=await native();await assert.rejects(createStyledAsset({packageBytes:n.packageBytes,style:{kind:'voxel',pixelSize:1,toneLevels:8,screen:'bayer4'},voxel:{}}),/staticPose/);
});

test('extended influences, masking, and singular rest transforms fail explicitly',async()=>{
 for(const change of [(f:any)=>{f.json.meshes[0].primitives[0].attributes.JOINTS_1=2},(f:any)=>{f.json.materials=[{alphaMode:'MASK'}];f.json.meshes[0].primitives[0].material=0},(f:any)=>{f.json.nodes[0].scale=[0,1,1]}]){const f=fixture();change(f);const n=await native(f);await assert.rejects(compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8}));}
});

function morphFixture(skinned = true, interpolation = 'LINEAR') {
 const f=fixture(skinned); const add=(array:Float32Array,type:string)=>{const id=f.arrays.length;f.arrays.push(array as any);f.json.accessors.push({componentType:5126,type,count:array.length/(type==='VEC3'?3:1)});return id;};
 const x=add(new Float32Array([1,0,0,1,0,0,1,0,0]),'VEC3'),y=add(new Float32Array([0,2,0,0,2,0,0,2,0]),'VEC3');
 f.json.meshes[0].primitives[0].targets=[{POSITION:x},{POSITION:y}];f.json.meshes[0].weights=[.25,.5];f.json.meshes[0].extras={targetNames:['x','y']};f.json.nodes[1].weights=[.4,-.1];
 const values=interpolation==='CUBICSPLINE'?[0,0,0,0,1,2,1,2,1,2,0,0]:[0,0,1,2];
 const output=add(new Float32Array(values),'SCALAR');f.json.animations[0].channels.push({sampler:1,target:{node:1,path:'weights'}});f.json.animations[0].samplers.push({input:5,output,interpolation});return f;
}

test('mixed skeletal and morph tracks retain all samplers, defaults and sampled displacement',async()=>{
 for(const skinned of [false,true])for(const interpolation of ['LINEAR','STEP','CUBICSPLINE']) {
  const f=morphFixture(skinned,interpolation),n=await native(f),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});
  assert.equal(r.recipe.format,MORPH_VOXEL_FORMAT);assert.equal(r.recipe.version,2);assert.equal(r.report.morphAnimationSupported,true);
  const primitive=r.scene.json.meshes[0].primitives[0],mesh=r.scene.json.meshes[0];assert.equal(primitive.targets.length,2);assert.deepEqual(mesh.weights,[.4,-.1]);assert.deepEqual(mesh.extras.targetNames,['x','y']);
  assert.deepEqual(r.accessors[r.scene.json.animations[0].samplers[1].output],f.arrays.at(-1));assert.equal(r.scene.json.animations[0].samplers[1].interpolation,interpolation);
  for(const target of primitive.targets)assert.equal(r.accessors[target.POSITION].length,r.accessors[primitive.attributes.POSITION].length);
  // Uniform source deltas survive nonuniform transformed parents and skinning.
  for(let vertex=0;vertex<r.accessors[primitive.attributes.POSITION].length;vertex+=3) {
   const x=r.accessors[primitive.targets[0].POSITION],y=r.accessors[primitive.targets[1].POSITION];
   assert.ok(Math.abs(x[vertex]-1)<1e-6);assert.ok(Math.abs(x[vertex+1])<1e-6);assert.ok(Math.abs(y[vertex+1]-2)<1e-6);
  }
  assert.ok(r.restMaxError<1e-5);assert.deepEqual((await buildAnimatedVoxelAsset(r.recipe)).glb,r.glb);
 }
});

test('unused morph targets remain usable and binary/readable morph exports replay deterministically',async()=>{
 const f=morphFixture();f.json.animations[0].channels.pop();f.json.animations[0].samplers.pop();
 const n=await native(f),input={packageBytes:n.packageBytes,voxels:8},a=await compileAnimatedVoxelStyledAsset(input),b=await compileAnimatedVoxelStyledAsset(input);
 assert.deepEqual(a.assetBytes,b.assetBytes);assert.equal(a.imported.envelope.dependencies.runtime,'keel-styled-asset-6.0.0');assert.equal(a.imported.nativeScene.json.meshes[0].primitives[0].targets.length,2);
 assert.deepEqual((await importStyledAsset(new TextEncoder().encode(styledAssetJson(a.assetBytes)))).glb,a.imported.glb);
});

test('morph-only clips, shared mesh instances and normal-only targets preserve weights independently',async()=>{
 const f=morphFixture(false);f.json.animations[0].channels.shift();f.json.meshes[0].primitives[0].targets[1]={NORMAL:0};
 f.json.nodes.push({mesh:0,weights:[.8,.3],translation:[2,0,0]});f.json.nodes[0].children.push(4);
 const n=await native(f),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});
 assert.deepEqual(r.scene.json.meshes.map((mesh:any)=>mesh.weights),[[.4,-.1],[.8,.3]]);
 const primitive=r.scene.json.meshes[0].primitives[0];assert.ok(r.accessors[primitive.targets[1].POSITION].every((v:number)=>v===0));assert.equal(r.scene.json.animations[0].channels[0].target.path,'weights');
});

test('hostile morph recipes fail closed and V1 cannot masquerade as morph capable',async()=>{
 const n=await native(morphFixture()),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});
 for(const change of [(e:any)=>{e.format='KEEL-RIGGED-VOXEL-V1';e.version=1},(e:any)=>e.parts[0].morphs.pop(),(e:any)=>e.parts[0].morphWeights=[NaN,0],(e:any)=>e.parts[0].morphs[0].sourceLength=0,(e:any)=>e.parts[0].morphTargetNames=['x'],(e:any)=>e.scene.animations[0].channels[1].target.node=2,(e:any)=>e.motion[e.scene.animations[0].samplers[1].output].count=1]) {
  const e=unpackAsset(packAsset(r.recipe));change(e);await assert.rejects(buildAnimatedVoxelAsset(e));
 }
});

test('hostile rig recipes reject invalid bindings, graphs and motion before playback',async()=>{
 const n=await native(),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});
 for(const change of [(e:any)=>e.scene.nodes[0].children.push(0),(e:any)=>e.scene.images=[],(e:any)=>e.parts[0].node=999999,(e:any)=>e.motion[0].count=2**40,(e:any)=>e.scene.skins[0].joints=[99999],(e:any)=>e.scene.animations[0].channels[0].target.path='weights',(e:any)=>e.parts[0].weights.sourceLength=0,(e:any)=>e.scene.nodes[0].matrix=I,(e:any)=>e.scene.scenes[0].nodes=[999],(e:any)=>e.scene.animations[0].samplers[0].input='1',(e:any)=>{const p=e.parts[0],raw=decodeBuffer(p.joints,p.joints.sourceLength),j=new Uint16Array(raw.buffer);j[3]=65535;const r=encodeBuffer(new Uint8Array(j.buffer),{stride:8,componentBytes:2});p.joints={codec:r.codec,parameters:r.parameters,sourceLength:r.sourceLength,data:r.data};}]){const e=unpackAsset(packAsset(r.recipe));change(e);await assert.rejects(buildAnimatedVoxelAsset(e));}
});

for (const maxCubes of [1, 2, 5]) test(`target-first voxel cap ${maxCubes} is global across skinned morph parts`, async () => {
  const f = morphFixture();
  f.json.nodes.push({ name: 'second mesh', mesh: 0, skin: 0, weights: [.2, .3] }); f.json.nodes[0].children.push(4);
  f.json.animations[0].channels.push({ sampler: 1, target: { node: 4, path: 'weights' } });
  const n = await native(f), input = { packageBytes: n.packageBytes, voxels: 128, maxCubes, budgetPolicy: 'force-target' as const }, r = await compileAnimatedVoxels(input);
  assert(r.cubes > 0 && r.cubes <= maxCubes); assert.equal(r.report.budget.achievedCubes, r.cubes); assert.equal(r.report.budget.requestedGrid, 128); assert.equal(r.report.budget.cubeTargetMet, true);
  assert.equal(r.report.budget.parts.reduce((sum, part) => sum + part.achievedCubes, 0), r.cubes);
  assert.equal(r.report.sourceMotionAccessorBytesExact, true);
  if (maxCubes === 1) { assert.equal(r.report.budget.removedWeightChannels.length, 1); assert.equal(r.report.rigAndClipDataExact, false); assert(r.report.budget.parts.some(part => part.targetCubes === 0)); }
  else { assert.equal(r.report.budget.removedWeightChannels.length, 0); assert.equal(r.report.rigAndClipDataExact, true); }
  const rebuilt = await normalizeAsset({ entry: 'voxel.glb', files: [{ name: 'voxel.glb', data: r.glb }] });
  assert.equal(rebuilt.json.animations.length, 1); assert.equal(rebuilt.json.skins.length, 1);
  assert.deepEqual((await buildAnimatedVoxelAsset(r.recipe)).glb, r.glb);
  const styled = await compileAnimatedVoxelStyledAsset(input), readable = await importStyledAsset(new TextEncoder().encode(styledAssetJson(styled.assetBytes)));
  assert.deepEqual(readable.glb, r.glb); assert.deepEqual((await compileAnimatedVoxels(input)).packageBytes, r.packageBytes);
});

test('target-first adapts only when memory requires it; preservation reports exact requirements', async () => {
  const n = await native(morphFixture()), input = { packageBytes: n.packageBytes, voxels: 128, maxCubes: 1, memoryBudgetBytes: 64 * 1024 };
  await assert.rejects(compileAnimatedVoxels({ ...input, budgetPolicy: 'preserve-quality' }), (error: any) => error.code === 'VOXEL_RESOURCE_LIMIT' && error.requirements.requestedGrid === 128 && error.requirements.estimatedWorkingBytes > input.memoryBudgetBytes);
  const forced = await compileAnimatedVoxels({ ...input, budgetPolicy: 'force-target' });
  assert(forced.report.budget.achievedGrid < 128); assert.equal(forced.report.budget.gridReduced, true); assert.equal(forced.cubes, 1);
  assert(forced.report.budget.estimatedWorkingBytes <= input.memoryBudgetBytes);
  await assert.rejects(compileAnimatedVoxels({ packageBytes: n.packageBytes, voxels: 8, maxCubes: 1 }), (error: any) => error.code === 'VOXEL_RESOURCE_LIMIT' && error.requirements.requiredCubesAtLeast > 1);
  const hugeRequest = await compileAnimatedVoxels({ ...input, voxels: Number.MAX_SAFE_INTEGER, budgetPolicy: 'force-target' });
  assert.equal(hugeRequest.cubes, 1); assert(hugeRequest.report.budget.achievedGrid < 128);
  const oneCell = await compileAnimatedVoxels({ packageBytes: n.packageBytes, voxels: 1, maxCubes: Number.MAX_SAFE_INTEGER, budgetPolicy: 'force-target' });
  assert.equal(oneCell.cubes, 1); assert.equal(oneCell.report.budget.achievedGrid, 1); assert.equal(oneCell.report.budget.requestedMaxCubes, Number.MAX_SAFE_INTEGER);
});

test('pruned morph-only clips are named explicitly and every original motion array remains stored', async () => {
  const f = morphFixture(); f.json.nodes.push({ mesh: 0, skin: 0 }); f.json.nodes[0].children.push(4);
  f.json.animations.push({ name: 'Pruned mouth', samplers: structuredClone(f.json.animations[0].samplers), channels: [{ sampler: 1, target: { node: 4, path: 'weights' } }] });
  const n = await native(f), r = await compileAnimatedVoxels({ packageBytes: n.packageBytes, voxels: 8, maxCubes: 1, budgetPolicy: 'force-target' });
  assert.equal(r.report.sourceClips, 2); assert.equal(r.report.outputClips, 1); assert.deepEqual(r.report.budget.removedClips, [{ clip: 1, name: 'Pruned mouth' }]);
  assert.equal(r.report.budget.removedWeightChannels[0]!.node, 4); assert.equal(r.report.rigAndClipDataExact, false);
  const sourceMotion = [...new Set<number>([4, ...f.json.animations.flatMap((a: any) => a.samplers.flatMap((s: any) => [s.input, s.output]))])].sort((a, b) => a - b);
  sourceMotion.forEach((id, i) => assert.deepEqual(r.accessors[i], f.arrays[id]));
});

test('sparse snapshots support grids beyond one million cells without dense reconstruction', () => {
  const source = { version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static', size: [2000, 2000, 1], origin: [0, 0, 0], unit: 1, indices: [0, 3_999_999], colors: [1, 0, 0, 0, 1, 0] };
  const encoded = encodeVoxelSnapshot(source), replayed = replayVoxelSnapshot(encoded.recipe);
  assert.equal(encoded.report.gridCells, 4_000_000); assert.deepEqual(replayed.indices, source.indices); assert.deepEqual(replayed.colors, source.colors);
});

test('expanded replay accepts over 20,000 cubes and honors a larger explicit host memory budget', async () => {
  const count = 30000, snapshot = encodeVoxelSnapshot({ version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static', size: [count, 1, 1], origin: [0, 0, 0], unit: 1, indices: Array.from({ length: count }, (_, i) => i), colors: Array.from({ length: count * 3 }, () => .5) }).recipe;
  const recipe = { format: 'KEEL-RIGGED-VOXEL-V1', version: 1, scene: { asset: { version: '2.0' }, nodes: [{}], scenes: [{ nodes: [0] }], scene: 0, skins: [], animations: [] }, motion: [], parts: [{ node: 0, snapshot }] };
  await assert.rejects(buildAnimatedVoxelAsset(recipe), (error: any) => error.code === 'VOXEL_RESOURCE_LIMIT' && error.requirements.estimatedWorkingBytes > 256 * 1024 * 1024);
  const r = await buildAnimatedVoxelAsset(recipe, { maxWorkingBytes: 512 * 1024 * 1024 }); assert.equal(r.cubes, count); assert.equal(r.scene.json.accessors[0].count, count * 24);
});

test('v7 sparse voxel envelopes propagate host budgets without saving machine settings into assets', async () => {
  const snapshot = encodeVoxelSnapshot({ version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static', size: [2000, 2000, 1], origin: [0, 0, 0], unit: 1, indices: [0, 3_999_999], colors: [1, 0, 0, 0, 1, 0] }).recipe;
  const recipe = { format: 'KEEL-RIGGED-VOXEL-V1', version: 1, scene: { asset: { version: '2.0' }, nodes: [{}], scenes: [{ nodes: [0] }], scene: 0, skins: [], animations: [] }, motion: [], parts: [{ node: 0, snapshot }] };
  const a = await createAnimatedVoxelStyledAsset({ recipe, maxWorkingBytes: 64 * 1024 }), b = await createAnimatedVoxelStyledAsset({ recipe, maxWorkingBytes: 512 * 1024 * 1024 });
  assert.deepEqual(a, b); assert.equal(unpackAsset(a).dependencies.runtime, 'keel-styled-asset-7.0.0');
  await assert.rejects(importStyledAsset(a, { maxWorkingBytes: 1024 }), (error: any) => error.code === 'VOXEL_RESOURCE_LIMIT');
  const imported = await importStyledAsset(a, { maxWorkingBytes: 64 * 1024 }); assert.ok('voxelCount' in imported); assert.equal(imported.voxelCount, 2);
  const wrong = unpackAsset(a); wrong.dependencies.runtime = 'keel-styled-asset-4.0.0'; await assert.rejects(importStyledAsset(packAsset(wrong)), /dependency/);
  for (const maxWorkingBytes of [0, -1, NaN, Infinity, .5]) await assert.rejects(buildAnimatedVoxelAsset(recipe, { maxWorkingBytes }), /positive safe integer/);
});

test('snapshot occupied counts above the legacy 50,000 follow an explicit host budget', () => {
  const count = 50001, input = { version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static', size: [count, 1, 1], origin: [0, 0, 0], unit: 1, indices: Array.from({ length: count }, (_, i) => i), colors: Array.from({ length: count * 3 }, () => .5) };
  assert.throws(() => encodeVoxelSnapshot(input), /cube count/);
  const options = { maxWorkingBytes: 16 * 1024 * 1024 }, encoded = encodeVoxelSnapshot(input, options), rebuilt = replayVoxelSnapshot(encoded.recipe, options);
  assert.equal(rebuilt.indices.length, count); assert.deepEqual(rebuilt.indices, input.indices); assert.deepEqual(rebuilt.colors, input.colors);
});
