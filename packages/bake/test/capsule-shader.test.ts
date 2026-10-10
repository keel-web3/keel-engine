import { prepareShaderMeshDetail } from '../src/shader-mesh-detail.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capsuleShaderMesh, capsuleSurfaceError } from '../src/capsule-shader-mesh.ts';
import { lookMesh, meshMatrix, mergeMeshes } from '../src/mesh.ts';
import type { LookMesh } from '../src/mesh.ts';
import { shaderLodEligible } from '../src/shader-lod.ts';
import { projectionOf } from '../src/project.ts';
import { createMeshPass } from '../src/draw-mesh.ts';
import { standIn } from '../../render/test/gl-stand-in.ts';

const world = { boxes: [{ c: [0,0,0], h: [.1,.1,.1], mat: 3 }], capsules: [
  { a: [0,0,0], b: [0,.2,0], r: .03, mat: 5 },
  { a: [0,0,0], b: [.1,.2,.3], r: 1, mat: 9 },
  { a: [.2,0,0], b: [.2,0,0], r: .02, mat: 7 },
] };
test('generator converts only eligible capsules and preserves canonical material/part IDs and recipe bytes', () => {
  const input = JSON.stringify(world), a = capsuleShaderMesh(world, .01), b = capsuleShaderMesh(world, .01);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(world), input);
  assert.equal(a.capsuleShader?.capsules, 2);
  const parts = new Map<number, Set<number>>();
  for (let v=0; v<a.attrs.length; v+=4) {
    const part=a.attrs[v+3]!, slot=a.attrs[v]!;
    if (!parts.has(part)) parts.set(part, new Set()); parts.get(part)!.add(slot);
  }
  assert.deepEqual([...parts].sort((a,b)=>a[0]-b[0]), [[0,new Set([3])],[1,new Set([5])],[2,new Set([9])],[3,new Set([7])]]);
  assert.deepEqual(a.capsuleShader!.bounds, b.capsuleShader!.bounds);
  assert.equal(a.capsuleShader!.a.length, a.positions.length/3*4);
  assert.throws(()=>mergeMeshes([a]), /combined recipe/);
});
test('empty, box-only and large rounded recipes stay on their existing geometry; invalid tolerances fail closed', () => {
  for (const w of [{}, { boxes: world.boxes }, { capsules: [world.capsules[1]!] }]) {
    assert.deepEqual(capsuleShaderMesh(w,.01), lookMesh(w,{shaderLod:false}));
  }
  for(const e of [0,-1,NaN,Infinity]) assert.throws(()=>capsuleShaderMesh(world,e));
  assert.equal(capsuleSurfaceError(.1,3,1),Infinity);
});
test('analytic prisms reduce triangle and geometry-byte cost against existing polygon LOD', () => {
  const w = { capsules: [world.capsules[0]!] }, a = capsuleShaderMesh(w,.01), coarse=lookMesh(w,{chordError:.01});
  const bytes = (m:LookMesh) => m.positions.byteLength+m.normals.byteLength+m.attrs.byteLength+m.bodies.byteLength+m.indices.byteLength
    +(m.capsuleShader ? m.capsuleShader.a.byteLength+m.capsuleShader.b.byteLength : 0);
  assert.equal(a.indices.length/3,12); assert.ok(a.indices.length < coarse.indices.length*.75);
  assert.ok(bytes(a)<bytes(coarse));
});
const view = projectionOf({kind:'persp',eye:[0,0,0],target:[0,0,1],fov:1.05},640,360,500);
test('selector rejects close, big, reflected, sheared, non-uniform, posed-range and malformed inputs', () => {
  const lo=[-.2,0,-.2], hi=[.2,.4,.2], m=meshMatrix({z:80,yaw:.5,roll:.4,scale:2});
  assert.ok(shaderLodEligible(view,lo,hi,m,.01));
  for(const error of [-1e-9,NaN,Infinity])assert.equal(shaderLodEligible(view,lo,hi,m,error),false);
  assert.ok(!shaderLodEligible(view,lo,hi,meshMatrix({z:.1}),.01));
  assert.ok(!shaderLodEligible(view,lo,hi,m,.01,1));
  for(const mutation of [(m:Float32Array)=>m[4]!+=.2,(m:Float32Array)=>m[0]!*=2,(m:Float32Array)=>m[0]=NaN,(m:Float32Array)=>m[15]=0]) {
    const bad=m.slice(); mutation(bad); assert.ok(!shaderLodEligible(view,lo,hi,bad,.01));
  }
  assert.ok(!shaderLodEligible(view,lo,hi,meshMatrix({z:80,scale:-1}),.01));
  const ortho=projectionOf({kind:'ortho',center:[0,0,0],yaw:0,pitch:.5,k:40},640,360,500);
  assert.equal(shaderLodEligible(ortho,lo,hi,m,.01),false);
});
function fixture(rejectAnalytic = false) {
  const fake=standIn({width:640,height:360}), gl=fake.gl as unknown as WebGL2RenderingContext, texture={} as WebGLTexture;
  const links:string[]=[];
  const pass=createMeshPass({gl,link:(_v,_f,name)=>{links.push(name);if(rejectAnalytic && name==='Analytic capsule mesh')throw Error('driver unsupported');return gl.createProgram()!;},size:()=>[640,360],pages:()=>[null,null],
    looks:()=>({palette:texture,looks:texture,paints:texture,places:texture,decals:texture})});
  const meshes=new Map<string,LookMesh>(), hold=(key:string,make:()=>LookMesh)=>{if(!meshes.has(key)){const m=make();meshes.set(key,m);pass.setMesh(key,m);}return key;};
  const recipe={capsules:[world.capsules[0]!]};
  const detail=prepareShaderMeshDetail('round',()=>recipe,hold,.01), draw={mesh:detail.mesh,lod:detail.lod,matrix:meshMatrix({z:80}),look:0};
  return {fake,links,pass,meshes,detail,draw,hold,recipe};
}
test('real mesh pass opts into a resident shader only when it beats polygon LOD; compilation happens during candidate preparation', () => {
  const f=fixture(), style={shadows:false,bloom:0,mirror:0,shaderLod:false};
  f.pass.draw(view,[f.draw],style); assert.equal(f.pass.stats.shaderReduced,0); assert.equal(f.links.filter(n=>n==='Analytic capsule mesh').length,1);
  f.pass.draw(view,[f.draw],{...style,shaderLod:true}); assert.equal(f.pass.stats.shaderReduced,1); assert.equal(f.pass.stats.triangles,12);
  assert.equal(f.links.filter(n=>n==='Analytic capsule mesh').length,1);
  for(const draw of [{...f.draw,range:[0,3] as const},{...f.draw,parts:meshMatrix({})},{...f.draw,matrix:meshMatrix({z:1})}]) {
    f.pass.draw(view,[draw],{...style,shaderLod:true});assert.equal(f.pass.stats.shaderReduced,0);
  }
  f.pass.draw(view,[f.draw],{...style,shaderLod:true,lod:false});assert.equal(f.pass.stats.reduced,0);
  f.pass.setMesh(f.detail.lod.shader!.mesh,null);
  f.pass.draw(view,[f.draw],{...style,shaderLod:true});assert.equal(f.pass.stats.shaderReduced,0);assert.equal(f.pass.stats.reduced,1);
});
test('shader camera LOD preserves original shadow geometry, program state, and complete cache release', () => {
  const f=fixture(), full=f.meshes.get(f.draw.mesh)!;
  const { lod: _lod, ...plain } = f.draw;
  f.pass.draw(view,[f.draw,{...plain,matrix:meshMatrix({x:1,z:80})}],{shaderLod:true,bloom:0,mirror:0,shadows:true});
  assert.equal(f.pass.stats.shaderReduced,1);
  assert.equal(f.pass.stats.shadowTriangles,2*full.indices.length/3);
  const uniformModels=f.fake.calls.filter(([n,a])=>n==='uniformMatrix4fv'&&String(a[0]).endsWith(':uModel'));
  assert.ok(uniformModels.length>=4,'models must be rebound on shader/mesh switches');
  for(const key of f.meshes.keys()) f.pass.setMesh(key,null);
  assert.equal(f.pass.stats.meshBytes,0);assert.equal(f.pass.stats.meshes,0);
});

test('optional shader compiler failure falls back to cached polygons and never retries each frame', () => {
  const f=fixture(true);
  for(let i=0;i<3;i++) {
    f.pass.draw(view,[f.draw],{shaderLod:true,shadows:false,bloom:0,mirror:0});
    assert.equal(f.pass.stats.shaderReduced,0);assert.equal(f.pass.stats.reduced,1);
  }
  assert.equal(f.links.filter(n=>n==='Analytic capsule mesh').length,1);
});

test('ordinary mesh preparation never compiles the opt-in analytic program', () => {
  const fake=standIn(),gl=fake.gl as unknown as WebGL2RenderingContext,links:string[]=[];
  const pass=createMeshPass({gl,link:(_v,_f,name)=>{links.push(name);return gl.createProgram()!;},size:()=>[640,360],pages:()=>[null,null],looks:()=>null});
  pass.setMesh('plain',lookMesh(world,{shaderLod:false}));
  assert.ok(!links.includes('Analytic capsule mesh'));
});

test('large-coordinate Float32 rounding is included in automatic capsule eligibility', () => {
  const cap={a:[1_000_000,0,0],b:[1_000_000,.2,0],r:.03};
  const world={capsules:[cap]};
  assert.deepEqual(capsuleShaderMesh(world,.01),lookMesh(world,{shaderLod:false}));
  assert.ok(capsuleShaderMesh(world,.1).capsuleShader);
});


test('automatic recipes share one GPU candidate per key, preserve shadows and release all owned buffers', () => {
  const f=fixture(), m=lookMesh(f.recipe), plain={mesh:'auto',matrix:meshMatrix({z:80}),look:0};
  assert.ok(m.shaderDetail); assert.deepEqual(structuredClone(m),m);
  f.pass.setMesh('auto',m); const bytes=f.pass.stats.meshBytes, resident=f.pass.stats.meshes;
  f.pass.draw(view,[plain,{...plain,matrix:meshMatrix({x:1,z:80})}],{shaderLod:true,bloom:0,mirror:0,shadows:true});
  assert.equal(f.pass.stats.shaderReduced,2); assert.equal(f.pass.stats.triangles,24);
  assert.equal(f.pass.stats.shadowTriangles,m.indices.length/3*2);
  assert.equal(f.pass.stats.meshBytes,bytes); assert.equal(f.pass.stats.meshes,resident);
  f.pass.draw(view,[plain],{shaderLod:false,bloom:0,mirror:0,shadows:false}); assert.equal(f.pass.stats.shaderReduced,0);
  f.pass.setMesh('auto',m); assert.equal(f.pass.stats.meshBytes,bytes);
  for(const key of [...f.meshes.keys(),'auto'])f.pass.setMesh(key,null);
  assert.equal(f.pass.stats.meshBytes,0);assert.equal(f.pass.stats.meshes,0);
});
test('automatic recipes retain canonical buffers and reject unprofitable mixtures',()=>{
  const full=lookMesh(world,{shaderLod:false}), auto=lookMesh(world);
  for(const key of ['positions','normals','attrs','bodies','indices'] as const)assert.deepEqual(auto[key],full[key]);
  assert.ok(auto.shaderDetail);
  const cheap={boxes:Array.from({length:100},()=>world.boxes[0]!),capsules:[world.capsules[0]!]};
  assert.equal(lookMesh(cheap).shaderDetail,undefined);
  assert.equal(lookMesh(world,{chordError:.01}).shaderDetail,undefined);
  assert.equal(lookMesh(world,{around:4,rings:2}).shaderDetail,undefined);
});
test('layered automatic candidate preserves run part order and worker transfers every owned buffer', async()=>{
  const {layeredMesh}=await import('../src/lod-mesh.ts');
  const {serveMeshWorker}=await import('../src/mesh-worker.ts');
  const runs=[{capsules:[{...world.capsules[0]!,mat:3}]},{boxes:world.boxes,capsules:[{...world.capsules[2]!,mat:7}]}];
  const m=layeredMesh(runs);assert.ok(m.shaderDetail);
  const ids=(mesh:LookMesh)=>new Map(Array.from({length:mesh.attrs.length/4},(_,i)=>[mesh.attrs[i*4+3]!,mesh.attrs[i*4]!]));
  assert.deepEqual([...ids(m.shaderDetail!.mesh)].sort((a,b)=>a[0]-b[0]),[...ids(m)].sort((a,b)=>a[0]-b[0]));
  const g=globalThis as any, old=g.postMessage, oldMessage=g.onmessage;let received:any;
  g.postMessage=(data:any,transfer:any)=>received={data,transfer};
  try{serveMeshWorker();g.onmessage({data:{id:1,runs,options:{}}});
    const candidate=received.data.mesh.shaderDetail.mesh;
    assert.ok(received.transfer.includes(candidate.capsuleShader.a.buffer));
    assert.ok(received.transfer.includes(candidate.indices.buffer));
    assert.equal(received.transfer.length,new Set(received.transfer).size);
  }finally{g.postMessage=old;g.onmessage=oldMessage;}
});

test('tiny detail far from the world origin reserves Float32 transform error before selecting a shader',()=>{
 const lo=[-.1,-.1,-.1],hi=[.1,.1,.1];
 for(const offset of [0,600]){
  const camera=projectionOf({kind:'persp',eye:[offset,0,0],target:[offset,0,80],fov:.4},1920,1080,500);
  assert.ok(shaderLodEligible(camera,lo,hi,meshMatrix({x:offset,z:80}),.001));
 }
 const offset=1_000_000,camera=projectionOf({kind:'persp',eye:[offset,0,0],target:[offset,0,80],fov:.4},1920,1080,500);
 assert.equal(shaderLodEligible(camera,lo,hi,meshMatrix({x:offset,z:80}),.001),false);
});

test('Float32-zero radii and numerically unsafe world extents retain polygon geometry',()=>{
 for(const radius of [1e-50,1e-40]){
  const tiny={capsules:[{a:[0,0,0],b:[0,0,0],r:radius}]};
  assert.deepEqual(capsuleShaderMesh(tiny,.01),lookMesh(tiny,{shaderLod:false}));
  assert.equal(lookMesh(tiny).shaderDetail,undefined);
 }
 const ortho=projectionOf({kind:'ortho',center:[0,0,0],yaw:0,pitch:0,k:1000},640,360,500);
 assert.equal(shaderLodEligible(ortho,[-.1,-.1,-.1],[.1,.1,.1],meshMatrix({scale:1e-4}),.001),false);
 const distant=projectionOf({kind:'persp',eye:[0,0,0],target:[0,0,1e15],fov:1.05},640,360,1e16);
 assert.equal(shaderLodEligible(distant,[-1e11,-1e11,-1e11],[1e11,1e11,1e11],meshMatrix({z:1e15}),1e9),false);
});

test('automatic detail amortizes pipeline switches and preserves polygon LOD for short mixed runs',async()=>{
 const {generateCar,carDesigns}=await import('../../../packs/vehicles/src/index.ts');
 const f=fixture();const dense=carDesigns(generateCar('shader:run-policy')).wheels[0].pose('spin',0);f.pass.setMesh('auto',lookMesh(dense));f.pass.setMesh('box',lookMesh({boxes:[{c:[0,0,0],h:[.1,.1,.1]}]}));
 const cap={mesh:'auto',matrix:meshMatrix({z:80}),look:0},box={...cap,mesh:'box'};
 const style={bloom:0,mirror:0,shadows:false};
 f.pass.draw(view,[...Array(4).fill(cap),box,...Array(4).fill(cap)],style);
 assert.equal(f.pass.stats.shaderReduced,0);assert.equal(f.pass.stats.drawn,9);
 f.pass.draw(view,Array(8).fill(cap),style);assert.equal(f.pass.stats.shaderReduced,8);
 f.pass.draw(view,[cap],style);assert.equal(f.pass.stats.shaderReduced,0);
 f.pass.draw(view,[cap],{...style,shaderLod:true});assert.equal(f.pass.stats.shaderReduced,1);
});

test('scene opt-out uploads only canonical geometry and never compiles analytic programs',()=>{
 const fake=standIn(),gl=fake.gl as unknown as WebGL2RenderingContext,links:string[]=[];
 const pass=createMeshPass({gl,shaderLod:false,link:(_v,_f,name)=>{links.push(name);return gl.createProgram()!;},size:()=>[640,360],pages:()=>[null,null],looks:()=>null});
 const mesh=lookMesh(world);assert.ok(mesh.shaderDetail);pass.setMesh('plain',mesh);
 const bytes=mesh.positions.byteLength+mesh.normals.byteLength+mesh.attrs.byteLength+mesh.bodies.byteLength+mesh.indices.byteLength;
 assert.equal(pass.stats.meshBytes,bytes);assert.ok(!links.some(n=>n.includes('Analytic')||n.startsWith('Instanced')));
 pass.setMesh('plain',null);assert.equal(pass.stats.meshBytes,0);
});

test('nearly uniform transforms reserve their residual distortion at the pixel-error boundary',()=>{
 const ortho=projectionOf({kind:'ortho',center:[0,0,0],yaw:0,pitch:0,k:20},640,360,500),lo=[-.1,-.1,-.1],hi=[.1,.1,.1];
 const uniform=Array.from(meshMatrix({})),nearUniform=[...uniform];nearUniform[5]=1.000004;
 assert.equal(shaderLodEligible(ortho,lo,hi,uniform,.0124995),true);
 assert.equal(shaderLodEligible(ortho,lo,hi,nearUniform,.0124995),false);
});

test('automatic detail retains inexpensive polygons even for a long compatible run',()=>{
 const f=fixture();f.pass.setMesh('small',lookMesh(f.recipe));const d={mesh:'small',matrix:meshMatrix({z:80}),look:0};
 f.pass.draw(view,Array(128).fill(d),{bloom:0,mirror:0,shadows:false});assert.equal(f.pass.stats.shaderReduced,0);
 f.pass.draw(view,Array(128).fill(d),{bloom:0,mirror:0,shadows:false,shaderLod:true});assert.equal(f.pass.stats.shaderReduced,128);
});

test('shadow LOD independently selects resident polygons and preserves original caster membership',()=>{
 const f=fixture(),full=f.meshes.get(f.draw.mesh)!,coarse=f.meshes.get(f.draw.lod.mesh)!;
 // A broad receiver makes the light map's texels large, independently of camera distance.
 f.hold('receiver',()=>lookMesh({boxes:[{c:[0,-1,80],h:[100,.1,100]}]},{shaderLod:false}));
 const receiver={mesh:'receiver',matrix:meshMatrix({}),look:0};
 const style={shaderLod:false,bloom:0,mirror:0,shadows:true};
 const draws=[f.draw,receiver];
 f.pass.draw(view,draws,style);const base={...f.pass.stats};
 f.pass.draw(view,draws,{...style,shadowLod:true});
 assert.equal(f.pass.stats.shadowDrawn,base.shadowDrawn);
 assert.equal(f.pass.stats.shadowReduced,1);
 assert.equal(f.pass.stats.shadowTriangles,base.shadowTriangles-(full.indices.length-coarse.indices.length)/3);
 assert.equal(f.pass.stats.triangles,base.triangles);
 for(const d of [{...f.draw,range:[0,3] as const},{...f.draw,parts:meshMatrix({})}]){
  f.pass.draw(view,[d,receiver],{...style,shadowLod:true});assert.equal(f.pass.stats.shadowReduced,0);
 }
 f.pass.setMesh(f.draw.lod.mesh,null);
 f.pass.draw(view,draws,{...style,shadowLod:true});assert.equal(f.pass.stats.shadowReduced,0);
});
