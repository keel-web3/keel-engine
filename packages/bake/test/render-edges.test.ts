import { test } from "node:test";
import assert from "node:assert/strict";
import { lookMesh, meshMatrix } from "../src/mesh.ts";
import { partBounds, posedBounds, transformedBounds } from "../src/draw-bounds.ts";
import type { Bounds } from "../src/draw-bounds.ts";
import { shadowView } from "../src/shadow-view.ts";
import { axesOf, projectionOf } from "../src/project.ts";
import { frustumOf, visible } from "../src/cull.ts";
import { prepareMeshDetail } from "../src/lod-mesh.ts";

test("vertical and coincident camera targets retain orthonormal finite axes", () => {
  for (const target of [[0, 1, 0], [0, -1, 0], [1e-12, 1, 0], [0, 0, 0]] as const) {
    const axes = Object.values(axesOf({kind: "persp", eye: [0,0,0], target, fov: 1}));
    for (const a of axes) assert.ok(Math.abs(Math.hypot(...a)-1)<1e-8);
    for (let i=0;i<3;i++) for(let j=i+1;j<3;j++) assert.ok(Math.abs(axes[i]!.reduce((s,v,k)=>s+v*axes[j]![k]!,0))<1e-8);
  }
});

test("animated parts crossing into the frustum are bounded, including in-place pose updates", () => {
  const mesh = lookMesh({boxes:[{c:[30,0,0],h:[1,1,1],mat:0},{c:[40,0,0],h:[1,1,1],mat:0}]});
  const parts = partBounds(mesh), pose = new Float32Array(32);
  pose.set(meshMatrix({x:-30,z:6}),0); pose.set(meshMatrix({x:-40,z:6}),16);
  const box = posedBounds(parts,pose), planes = frustumOf(projectionOf({kind:"persp",eye:[0,0,0],target:[0,0,1],fov:1},640,360));
  assert.ok(visible(planes,box.slice(0,3),box.slice(3),meshMatrix()));
  assert.ok(!visible(planes,[29,-1,-1],[41,1,1],meshMatrix()));
  pose[12]! += 10;
  assert.equal(posedBounds(parts,pose)[3],11);
});

test("affine support bounds contain all corners under reflection, shear and non-uniform scale", () => {
  const b: Bounds = [-2,-1,-3,4,6,2], m = meshMatrix({x:5,y:-4,z:10,scale:-1.4,yaw:.7}); m[4]! += .6; m[10]! *= 2;
  const result = transformedBounds(b,m);
  for(let c=0;c<8;c++) for(let a=0;a<3;a++) {
    const q=m[a]! * b[c&1?3:0]+m[a+4]! * b[c&2?4:1]+m[a+8]! * b[c&4?5:2]+m[a+12]!;
    assert.ok(q>=result[a]!-1e-8 && q<=result[a+3]!+1e-8);
  }
});

test("off-camera upstream shadow casters survive; disjoint and downstream boxes are rejected", () => {
  const bounds: Bounds = [-1,-1,-1,1,1,1], item=(x:number,y:number,z:number)=>({bounds,matrix:meshMatrix({x,y,z})});
  const receiver=item(0,0,8), caster=item(0,30,8), side=item(30,30,8), downstream=item(0,-30,8);
  const source=[receiver,caster,side,downstream], fitted=shadowView([receiver],source,[0,1,0],1024)!;
  assert.deepEqual(fitted.casters,[receiver,caster]);
  const all=shadowView([receiver],source,[0,1,0],1024,false)!;
  assert.deepEqual(fitted.matrix,all.matrix); assert.equal(all.casters.length,4);
  const planes=frustumOf(projectionOf({kind:"persp",eye:[0,0,0],target:[0,0,1],fov:1},640,360));
  assert.equal(visible(planes,bounds.slice(0,3),bounds.slice(3),caster.matrix),false);
  assert.equal(shadowView([],source,[0,1,0],1024),null);
  assert.equal(shadowView([receiver],source,[0,0,0],1024),null);
});

test("partial cache eviction rebuilds identical coarse paint coordinates and never reruns a hit factory", () => {
  const world={capsules:[{a:[0,0,0],b:[.3,1,.5],r:.09,mat:4}]};
  const cache=new Map<string,ReturnType<typeof lookMesh>>();let poses=0;
  const hold=(key:string,make:()=>ReturnType<typeof lookMesh>)=>{if(!cache.has(key))cache.set(key,make());return key;};
  const make=()=>prepareMeshDetail("partial",()=>{poses++;return world;},hold,.01);
  const detail=make(), expected=cache.get(detail.lod.mesh)!;
  cache.delete(detail.lod.mesh); make(); assert.deepEqual(cache.get(detail.lod.mesh),expected);
  cache.delete(detail.mesh); make(); assert.equal(poses,3);
  make(); assert.equal(poses,3);
});
