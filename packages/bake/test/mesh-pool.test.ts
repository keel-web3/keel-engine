import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeshPool } from '../src/mesh-pool.ts';
import { meshDetailReport } from '../src/mesh-detail.ts';
import { lookMesh } from '../src/mesh.ts';
const world={capsules:[{a:[0,0,0],b:[0,.2,0],r:.03}]};
test('shared geometry acquires once across differing looks/transforms and releases its candidate with its owner',()=>{
 const uploads:any[]=[];let generated=0;
 const pool=createMeshPool((key,mesh)=>uploads.push([key,mesh]));
 for(let i=0;i<100;i++)assert.equal(pool.acquire('geometry',()=>{generated++;return lookMesh(world);}), 'geometry');
 assert.equal(generated,1);assert.equal(uploads.length,1);assert.equal(pool.stats.references,100);
 assert.equal(pool.stats.shaderCandidates,1);assert.ok(pool.stats.preparedGeometryBytes>0);
 for(let i=0;i<99;i++)pool.release('geometry');assert.equal(uploads.length,1);
 pool.release('geometry');assert.deepEqual(uploads[1],['geometry',null]);assert.equal(pool.stats.preparedGeometryBytes,0);
 assert.throws(()=>pool.release('geometry'),/without acquire/);
});
test('pool acquisition/upload errors do not publish phantom residency and clear releases each key once',()=>{
 const calls:string[]=[];let fail=true;
 const pool=createMeshPool((key,mesh)=>{if(fail)throw Error('upload');calls.push(key+':'+!!mesh);});
 assert.throws(()=>pool.acquire('a',()=>lookMesh(world)));assert.equal(pool.stats.meshes,0);
 fail=false;assert.throws(()=>pool.acquire('a',()=>{throw Error('recipe');}));assert.equal(pool.stats.meshes,0);
 pool.acquire('a',()=>lookMesh(world));pool.acquire('a',()=>lookMesh(world));pool.acquire('b',()=>lookMesh(world));
 pool.clear();assert.deepEqual(calls,['a:true','b:true','a:false','b:false']);assert.equal(pool.stats.references,0);
});
test('mesh report counts canonical/candidate buffers and distinguishes geometry savings from extra residency',()=>{
 const m=lookMesh(world), report=meshDetailReport(m);
 assert.ok(report.shader);assert.ok(report.shader!.triangleSaving>.75);
 assert.equal(report.shader!.capsules,1);assert.equal(report.shader!.candidate.triangles,12);
 const raw=lookMesh(world,{shaderLod:false});assert.deepEqual(meshDetailReport(raw),{full:report.full});
 assert.equal(meshDetailReport(lookMesh({})).full.triangles,0);
});
