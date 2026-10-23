import test from "node:test";
import assert from "node:assert/strict";
import { ROBOT_FAMILIES, createRobotGenome, createRobotDesign, robotIdentityKey, robotPaint } from "../../../packs/pinball-robots/src/index.ts";
import { admitArenaBodyVisuals, type ArenaBodyVisual } from "../src/body-visuals.ts";

function visual(ownerId=0, family=ROBOT_FAMILIES[0]!.id, seed="cafe"): ArenaBodyVisual {
  const genome=createRobotGenome(seed,{family});
  return {ownerId,identity:robotIdentityKey(genome),mesh:createRobotDesign(genome).mesh("rolled"),paint:JSON.parse(JSON.stringify(robotPaint(genome)))};
}
test("every rolled family retains its actual bounded native mesh and paint identity",()=>{
  for(const family of ROBOT_FAMILIES)for(let seed=1;seed<=32;seed++){
    const v=visual(0,family.id,seed.toString(16)),[a]=admitArenaBodyVisuals([v]);
    assert.deepEqual(a!.mesh,v.mesh);assert.deepEqual(a!.paint,v.paint);assert.equal(a!.identity,v.identity);
    assert.equal(a!.meshId,`body:owner/0/${v.identity}`);
    assert.ok(Object.isFrozen(a)&&Object.isFrozen(a!.paint));
  }
});
test("admission copies geometry and paint before the caller can edit them",()=>{
  const v=visual(),[a]=admitArenaBodyVisuals([v]),before=a!.mesh.positions[0],color=a!.paint[7]!.look.hue;
  v.mesh.positions[0]=99;v.mesh.indices[0]=65535;(v.paint[7]!.look as any).hue=99;
  assert.equal(a!.mesh.positions[0],before);assert.notEqual(a!.mesh.indices[0],65535);assert.equal(a!.paint[7]!.look.hue,color);
});
test("owner mapping is exact and bounded without changing physical bodies",()=>{
  const a=admitArenaBodyVisuals([visual(0),visual(1)]);assert.notEqual(a[0]!.meshId,a[1]!.meshId);
  assert.throws(()=>admitArenaBodyVisuals([visual(),visual()]));assert.throws(()=>admitArenaBodyVisuals([visual(65536)]));
  assert.deepEqual(admitArenaBodyVisuals(),[]);assert.throws(()=>admitArenaBodyVisuals(Array.from({length:101},(_,i)=>visual(i))));
  assert.throws(()=>admitArenaBodyVisuals([{...visual(),identity:"../unbounded identity"}]));
});
test("nonfinite, missing, oversized, inward and unpainted geometry fails closed",()=>{
  const edits=[(v:any)=>v.mesh.positions[0]=NaN,(v:any)=>v.mesh.positions[0]=1.5,(v:any)=>v.mesh.normals[0]=4,(v:any)=>v.mesh.indices[0]=60000,(v:any)=>v.mesh.indices=new Uint32Array(6003),(v:any)=>v.mesh.indices.fill(0),(v:any)=>v.mesh.attrs[0]=32,(v:any)=>v.mesh.attrs[0]=.5,(v:any)=>v.mesh.attrs[1]=Infinity,(v:any)=>v.mesh.bodies[0]=-1,(v:any)=>v.mesh.normals=new Float32Array(0),(v:any)=>v.paint[v.mesh.attrs[0]]=null,(v:any)=>{for(let i=0;i<v.mesh.indices.length;i+=3)[v.mesh.indices[i+1],v.mesh.indices[i+2]]=[v.mesh.indices[i+2],v.mesh.indices[i+1]];}];
  for(const edit of edits){const v=visual();edit(v);assert.throws(()=>admitArenaBodyVisuals([v]));}
  const unfolded=createRobotDesign(createRobotGenome("cafe")).mesh("unfolded");assert.throws(()=>admitArenaBodyVisuals([{...visual(),mesh:unfolded}]));
});
test("paint and descriptor admission rejects hidden code, invalid roles and sparse input",()=>{
  for(const edit of [(v:any)=>v.paint[7].look.light=NaN,(v:any)=>v.paint[7].look.finish="unknown",(v:any)=>v.paint[7].look.pattern.kind="noise",(v:any)=>v.paint[7].mirror=2,(v:any)=>v.paint[7].detail={material:"stone",scale:3},(v:any)=>v.extra=true,(v:any)=>Object.defineProperty(v,"identity",{get:()=>"getter"}),(v:any)=>v[Symbol("hidden")]=true]){const v=visual();edit(v);assert.throws(()=>admitArenaBodyVisuals([v]));}
  const sparse=[] as any[];sparse.length=1;assert.throws(()=>admitArenaBodyVisuals(sparse));
  const v=visual(),positions=new Float32Array(new SharedArrayBuffer(v.mesh.positions.byteLength));positions.set(v.mesh.positions);assert.throws(()=>admitArenaBodyVisuals([{...v,mesh:{...v.mesh,positions}}]));
});
test("bounded body decals are copied and cannot reference unavailable inks",()=>{
  const v=visual(),texels=new Uint8Array([1,128,255,255]),slot=v.paint[7]!;
  const decal={decal:{width:1,height:1,texels},rect:[0,0,1,1] as const,inks:[slot.look]},paint=[...v.paint];paint[7]={...slot,decal};
  const [a]=admitArenaBodyVisuals([{...v,paint}]);texels[0]=4;assert.equal(a!.paint[7]!.decal!.decal.texels[0],1);
  assert.throws(()=>admitArenaBodyVisuals([{...v,paint}]));
  const inverted=[...paint];inverted[7]={...slot,decal:{...decal,rect:[1,0,0,1]}};assert.throws(()=>admitArenaBodyVisuals([{...v,paint:inverted}]));
});
