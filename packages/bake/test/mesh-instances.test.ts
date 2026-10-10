import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatibleMeshInstances } from '../src/mesh-instances.ts';
import { lookMesh, meshMatrix } from '../src/mesh.ts';
import { projectionOf } from '../src/project.ts';
import { createMeshPass } from '../src/draw-mesh.ts';
import { standIn } from '../../render/test/gl-stand-in.ts';
import type { MeshDraw } from '../src/sprite-shaders.ts';
const view=projectionOf({kind:'persp',eye:[0,0,0],target:[0,0,80],fov:1.05},640,360,500);
const world={capsules:[{a:[0,0,0],b:[0,.2,0],r:.03}]};
function fixture(reject=false){
 const f=standIn({width:640,height:360}),gl=f.gl as unknown as WebGL2RenderingContext,t={} as WebGLTexture, links:string[]=[];
 const p=createMeshPass({gl,size:()=>[640,360],pages:()=>[null,null],looks:()=>({palette:t,looks:t,paints:t,places:t,decals:t}),link:(_v,_f,name)=>{links.push(name);if(reject&&name.startsWith('Instanced'))throw Error('driver');return gl.createProgram()!;}});
 p.prepareInstances();p.setMesh('shared',lookMesh(world));p.setMesh('other',lookMesh({boxes:[{c:[0,0,0],h:[.1,.1,.1]}]}));
 const draws:MeshDraw[]=Array.from({length:8},(_,i)=>({mesh:'shared',matrix:meshMatrix({x:i*.1,z:80}),look:i,anchor:[i*.1,0,80]}));
 return {p,f,draws,links};
}
test('adjacent repeated geometry batches transforms and differing looks without losing logical IDs or triangles',()=>{
 const {p,f,draws}=fixture();p.draw(view,draws,{shadows:false,bloom:0,meshInstances:true,shaderLod:true});
 assert.equal(p.stats.drawn,8);assert.equal(p.stats.submissions,1);assert.equal(p.stats.instanced,8);assert.equal(p.stats.triangles,96);
 const upload=f.calls.filter(([name])=>name==='texSubImage2D').at(-1)!;
 const rows=(upload[1].at(-1) as any).Float32Array as number[];
 for(let i=0;i<8;i++){assert.equal(rows[i*24+16],i);assert.equal(rows[i*24+17],i);assert.equal(rows[i*24+12],Math.fround(i*.1));}
 assert.ok(f.calls.some(([name,args])=>name==='drawElementsInstanced'&&args[4]===8));
});
test('intervening geometry keeps order and shared seam IDs survive batch boundaries',()=>{
 const {p,f,draws}=fixture();const input=[...draws.slice(0,4).map(d=>({...d,seam:5})),{mesh:'other',matrix:meshMatrix({z:80}),look:0},...draws.slice(4).map(d=>({...d,seam:5}))];
 p.draw(view,input,{shadows:false,bloom:0,meshInstances:true,shaderLod:true});assert.equal(p.stats.submissions,3);
 const uploads=f.calls.filter(([n])=>n==='texSubImage2D');for(const [,args] of uploads){const a=(args.at(-1) as any).Float32Array as number[];for(let i=0;i<a.length/24;i++)assert.equal(a[i*24+17],0);}
});
test('posed/ranged and incompatible paint/emission state split batches, while shadows retain the original geometry',()=>{
 const {p,draws}=fixture();p.draw(view,draws,{bloom:0,meshInstances:true,shadows:true,shaderLod:true});
 assert.equal(p.stats.shadowDrawn,8);assert.ok(p.stats.shadowTriangles>p.stats.triangles);
 const a=draws[0]!;for(const delta of [{parts:meshMatrix({})},{range:[0,3] as const},{owner:1},{light:.5},{fade:.5},{fadeInvert:true},{marked:true},{glow:new Float32Array(32)},{snow:.5},{chunk:2},{wipe:[.5,1] as const}])assert.equal(compatibleMeshInstances(a,{...a,...delta}),false);
});
test('small runs and compiler rejection use existing submissions; owned table releases when its last mesh drops',()=>{
 for(const reject of [false,true]){
  const {p,draws,links}=fixture(reject);p.draw(view,draws.slice(0,reject?8:3),{bloom:0,shadows:false,meshInstances:true});
  assert.equal(p.stats.instanced,0);assert.equal(p.stats.submissions,reject?8:3);
  if(reject)assert.equal(p.stats.instanceBytes,0);
  const count=links.length;p.draw(view,draws,{bloom:0,shadows:false,meshInstances:true});assert.equal(links.length,count);
  p.setMesh('shared',null);p.setMesh('other',null);assert.equal(p.stats.meshBytes,0);assert.equal(p.stats.instanceBytes,0);
 }
});

test('repeated geometry reuses vertex bindings independently of instancing, while keeping each draw',()=>{
 const {p,f,draws}=fixture();const begin=f.calls.length;
 p.draw(view,draws,{shadows:true,bloom:0,meshInstances:false});
 assert.equal(p.stats.submissions,8);assert.equal(p.stats.instanced,0);
 const binds=f.calls.slice(begin).filter(([n,args])=>n==='bindVertexArray'&&args[0]!==null);
 // One full caster binding, one camera candidate binding, then the composite fullscreen triangle.
 assert.equal(binds.length,3);assert.equal(p.stats.shadowDrawn,8);
});

test('optional batching adds no program, CPU table or GPU residency before explicit preparation',()=>{
 const f=standIn(),gl=f.gl as unknown as WebGL2RenderingContext,links:string[]=[];
 const p=createMeshPass({gl,size:()=>[640,360],pages:()=>[null,null],looks:()=>null,link:(_v,_f,name)=>{links.push(name);return gl.createProgram()!;}});
 p.setMesh('ordinary',lookMesh({boxes:[{c:[0,0,0],h:[1,1,1]}]}));
 assert.equal(p.stats.instanceBytes,0);assert.ok(!links.some(n=>n.startsWith('Instanced')));
 p.prepareInstances();assert.equal(p.stats.instanceBytes,24576);assert.equal(links.filter(n=>n==='Instanced mesh').length,1);
 p.prepareInstances();assert.equal(links.filter(n=>n==='Instanced mesh').length,1);
 p.setMesh('ordinary',null);assert.equal(p.stats.instanceBytes,0);
});

test('vertex-binding diagnostic repeats bindings while preserving draw counts and original shadows',()=>{
 const {p,f,draws}=fixture();const begin=f.calls.length;
 p.draw(view,draws,{shadows:true,bloom:0,meshInstances:false,vertexBindings:false});
 assert.equal(p.stats.submissions,8);assert.equal(p.stats.shadowDrawn,8);
 assert.equal(f.calls.slice(begin).filter(([n,args])=>n==='bindVertexArray'&&args[0]!==null).length,17);
});
