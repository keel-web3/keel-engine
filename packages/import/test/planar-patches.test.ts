import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizePlanarPatches} from '../src/optimization/planar-patches.ts';

import {planarGridFixture as grid} from './planar-patches-fixture.ts';
test('convex grid reduces to four byte-exact records and a two-triangle fill',()=>{
 const source=grid(8),before=structuredClone(source),result=optimizePlanarPatches(source);assert.equal(result.report.patchCount,1);assert.equal(result.report.outputTriangles,2);assert.equal(result.report.outputVertices,4);assert.deepEqual(source,before);
 const patch=result.report.patches[0]!;assert(patch.fieldProof.affine.includes('morph0.POSITION'));assert(patch.fieldProof.constant.includes('morph0.NORMAL'));assert(patch.fieldProof.scalarIdentities>0);
 for(const key of['nodes','skins','materials','meshes']){if(key==='meshes')continue;assert.deepEqual(result.normalized.json[key],source.json[key]);}
 for(const[id,a]of source.accessors.entries()){if(a.type==='SCALAR')continue;const b=result.normalized.accessors[id]!,w=a.array.length/a.count;assert.equal(b.count,4);for(let i=0;i<4;i++)assert.deepEqual(b.array.slice(patch.outputBoundary[i]!*w,(patch.outputBoundary[i]!+1)*w),a.array.slice(patch.sourceBoundary[i]!*w,(patch.sourceBoundary[i]!+1)*w));}
});
test('non-affine UV, off-plane center, varying normals, skin or morph fields reject the center fan',()=>{
 for(const field of['POSITION','TEXCOORD_0','NORMAL','TANGENT','JOINTS_0','WEIGHTS_0','morphPosition','morphNormal']){const source=grid(2),p=source.json.meshes[0].primitives[0];source.accessors[p.indices]!.array=Uint16Array.from([0,2,4,2,8,4,8,6,4,6,0,4]);source.accessors[p.indices]!.count=12;
  // Remove unreferenced edge records first; a compact fan has four corners and center.
  const keep=[0,2,4,6,8];for(const id of new Set<number>([...Object.values(p.attributes),...Object.values(p.targets[0])]as number[])){const a=source.accessors[id]!,w=a.array.length/a.count;a.array=new(a.array.constructor as any)(keep.flatMap(v=>Array.from(a.array.slice(v*w,(v+1)*w))));a.count=5;}
  source.accessors[p.indices]!.array=Uint16Array.from([0,1,2,1,4,2,4,3,2,3,0,2]);
  const id=field==='morphPosition'?p.targets[0].POSITION:field==='morphNormal'?p.targets[0].NORMAL:p.attributes[field],a=source.accessors[id]!,w=a.array.length/a.count;const at=2*w+(field==='POSITION'?2:0);a.array[at]=a.array[at]!+(field==='JOINTS_0'?1:.125);
  assert.equal(optimizePlanarPatches(source).report.patchCount,0,field);
 }
});
test('holes, transparency, observers, unsupported fields and accessor aliases stay intact',()=>{
 for(const kind of['hole','blend','mask','extras','extension','unknown','alias','clipalias']){const source=grid(kind==='hole'?3:2,kind==='hole'),p=source.json.meshes[0].primitives[0];if(kind==='blend')source.json.materials[0].alphaMode='BLEND';if(kind==='mask')source.json.materials[0].alphaMode='MASK';if(kind==='extras')p.extras={vertexIds:[4]};if(kind==='extension')source.json.extensionsUsed=['TEST'];if(kind==='unknown')p.attributes._CUSTOM=p.attributes.POSITION;if(kind==='alias')source.json.meshes.push(structuredClone(source.json.meshes[0]));if(kind==='clipalias')source.json.animations=[{samplers:[{input:p.attributes.POSITION,output:p.attributes.NORMAL}],channels:[]}];
  const result=optimizePlanarPatches(source);assert.equal(result.report.patchCount,0,kind);assert.deepEqual(result.normalized.json,source.json,kind);assert.deepEqual(result.normalized.accessors,source.accessors,kind);
 }
});
test('internal semantic aliases survive compaction and source asset attribution is inert',()=>{const source=grid(4),p=source.json.meshes[0].primitives[0];p.attributes.TEXCOORD_1=p.attributes.TEXCOORD_0;source.json.asset.extras={author:'Example',license:'CC0'};const r=optimizePlanarPatches(source);assert.equal(r.report.patchCount,1);assert.equal(r.normalized.json.meshes[0].primitives[0].attributes.TEXCOORD_0,r.normalized.json.meshes[0].primitives[0].attributes.TEXCOORD_1);assert.deepEqual(r.normalized.json.asset,source.json.asset);});
test('intervening triangles split a planar component into contiguous order-preserving runs',()=>{const source=grid(4),p=source.json.meshes[0].primitives[0],a=source.accessors[p.indices]!,old=Array.from(a.array);a.array=Uint16Array.from([...old.slice(0,6),0,0,0,...old.slice(6)]);a.count=a.array.length;const r=optimizePlanarPatches(source);assert(r.report.patches.every(p=>p.startTriangle+p.sourceTriangles<=2||p.startTriangle>=3));const out=r.normalized.accessors[p.indices]!.array;assert(out.some((v,i)=>i%3===0&&out[i+1]===v&&out[i+2]===v));});
test('deterministic bounded optimizer leaves unreferenced bounds records unchanged',()=>{const a=grid(4);assert.deepEqual(optimizePlanarPatches(a),optimizePlanarPatches(a));const p=a.json.meshes[0].primitives[0],ix=a.accessors[p.indices]!;ix.array=Uint16Array.from([0,1,6]);ix.count=3;assert.equal(optimizePlanarPatches(a).report.patchCount,0);});
test('smallest Float32 off-plane displacement is not rounded into a planar patch',()=>{const a=grid(2),p=a.json.meshes[0].primitives[0];a.accessors[p.attributes.POSITION]!.array[4*3+2]=2**-149;assert.equal(optimizePlanarPatches(a).report.patchCount,0);});
test('conservative vertex bounds survive while remapped index extrema remain valid',()=>{const a=grid(4),p=a.json.meshes[0].primitives[0];a.json.accessors[p.attributes.POSITION].min=[-100,-100,-100];a.json.accessors[p.attributes.POSITION].max=[100,100,100];a.json.accessors[p.indices].min=[0];a.json.accessors[p.indices].max=[24];const r=optimizePlanarPatches(a);assert.equal(r.report.patchCount,1);assert.deepEqual(r.normalized.json.accessors[p.attributes.POSITION].min,[-100,-100,-100]);assert.deepEqual(r.normalized.json.accessors[p.attributes.POSITION].max,[100,100,100]);assert.deepEqual(r.normalized.json.accessors[p.indices].max,[3]);});
