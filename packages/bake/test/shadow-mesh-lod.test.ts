import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shadowMeshError} from '../src/shadow-mesh-lod.ts';
import {meshMatrix} from '../src/mesh.ts';
test('shadow error bounds transformed point displacement for scales, shear and reflection',()=>{
 const light=[.02,0,0,0,0,.03,0,0,0,0,.004,0,0,0,0,1],lo=[-1,-2,-3],hi=[1,2,3],error=.02,size=1024;
 for(const scale of [.5,1,-2]){
  const model=meshMatrix({x:500,y:20,z:400,yaw:.2,roll:.3,scale});model[4]!+=.1;
  const bound=shadowMeshError(light,model,lo,hi,error,size);
  const project=(p:number[])=>[0,1,2].map(row=>{
   const world=[0,1,2].map(r=>model[r]!*p[0]!+model[r+4]!*p[1]!+model[r+8]!*p[2]!+model[r+12]!);
   return light[row]!*world[0]!+light[row+4]!*world[1]!+light[row+8]!*world[2]!+light[row+12]!;
  });
  for(let i=0;i<100;i++){
   const theta=i*2.399963229728653,y=2*i/99-1,r=Math.sqrt(1-y*y),a=project([1,2,3]),b=project([1+error*r*Math.cos(theta),2+error*y,3+error*r*Math.sin(theta)]);
   assert.ok(size*.5*Math.max(Math.abs(a[0]!-b[0]!),Math.abs(a[1]!-b[1]!))<=bound.pixels);
   assert.ok(.5*Math.abs(a[2]!-b[2]!)<=bound.depth);
  }
 }
});
test('shadow budgets tighten with map resolution and fail closed for invalid inputs and large coordinate rounding',()=>{
 const light=[.02,0,0,0,0,.02,0,0,0,0,.004,0,0,0,0,1],lo=[-1,-1,-1],hi=[1,1,1],m=meshMatrix({});
 const b=shadowMeshError(light,m,lo,hi,.01,1024),large=shadowMeshError(light,m,lo,hi,.01,4096);
 assert.ok(b.pixels<.25);assert.ok(large.pixels>.25);assert.ok(b.depth<.00012);
 assert.ok(shadowMeshError(light,meshMatrix({x:1e6}),lo,hi,.01,1024).pixels>.25);
 assert.equal(shadowMeshError(light,m,lo,hi,NaN,1024).pixels,Infinity);
});

test('invalid bounds and non-affine models cannot select a shadow replacement',()=>{
 const light=meshMatrix({}),model=meshMatrix({});model[3]=.01;
 assert.equal(shadowMeshError(light,model,[-1,-1,-1],[1,1,1],.01,1024).pixels,Infinity);
 assert.equal(shadowMeshError(light,light,[NaN,-1,-1],[1,1,1],.01,1024).pixels,Infinity);
 assert.equal(shadowMeshError(light,light,[2,-1,-1],[1,1,1],.01,1024).pixels,Infinity);
 assert.equal(shadowMeshError(light,light,[-1,-1,-1],[1,1,1],.01,Infinity).pixels,Infinity);
});
