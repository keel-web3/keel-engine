import { lookMesh, meshBounds, type LookMesh } from './mesh.ts';
import type { BakeWorld, BakeBox, BakeCapsule } from './bake.ts';
import { VolumeInstances } from './volumes.ts';
import { stream,createRoll,normalizeSeed } from '@keel-engine/core/rng';
import { poseSkeleton,boneToWorld,apply,type Rig,type Bone,type Skeleton } from '@keel-engine/entity';
import { createParticles,type Recipe,type ParticleView } from '@keel-engine/particles/basic';
import { matterFrame } from './specimen-matter.ts';
import {specimenParts} from './primitive-patterns.ts';
import {SPECIMEN_MOTION_FRAMES as MOTION_FRAMES,type SpecimenProgram as ObjectProgram,type SpecimenV3 as V3,type SpecimenPart as Part,type SpecimenPoseKey as PoseKey,type SpecimenEmitter as Emitter} from './specimen-types.ts';
const wrap=(n:number)=>((n%MOTION_FRAMES)+MOTION_FRAMES)%MOTION_FRAMES;
const cached=new WeakMap<ObjectProgram,Map<string,CompiledObject>>();
export interface CompiledObject {meshes:LookMesh[];particles:ParticleView[][];center:number[];radius:number;skeletons:Skeleton[];volumes:VolumeInstances[]}
export function objectScale(program:ObjectProgram,seed:string):V3 {const r=stream(createRoll(normalizeSeed(seed)),0);return [r.between(1-program.variation,1+program.variation),r.between(1-program.variation,1+program.variation),r.between(1-program.variation,1+program.variation)];}
const scaled=(p:readonly number[],s:V3):V3=>[p[0]!*s[0],p[1]!*s[1],p[2]!*s[2]];
function worldOf(parts:Part[],scale:V3):BakeWorld {
 const boxes:BakeBox[]=[],wedges:BakeBox[]=[],capsules:BakeCapsule[]=[];
 for(const p of parts){const mat=(p.material??0)*3+(p.tone??0);if(p.kind==='capsule')capsules.push({a:scaled(p.a,scale),b:scaled(p.b,scale),r:p.r*(scale[0]+scale[2])/2,mat});else{const b={c:scaled(p.c,scale),h:scaled(p.h,scale),yaw:p.yaw,lo:p.lo,mat};if(p.kind==='wedge')wedges.push(b);else boxes.push(b);}}
 return {boxes,wedges,capsules};
}
/** Legacy generic animation names are deliberately inert. An explicit rig or effect is required. */
export function objectWorld(program:ObjectProgram,seed:string,_phase=0):BakeWorld{return worldOf(specimenParts(program),objectScale(program,seed));}
function keyAt(keys:PoseKey[],at:number,easing='smooth'):{rot:V3;off:V3}{
 const next=keys.findIndex(k=>k.at>at),i=next<0?keys.length-2:Math.max(0,next-1),a=keys[i]!,b=keys[i+1]!;
 const t=(at-a.at)/(b.at-a.at),q=easing==='linear'?t:t*t*(3-2*t);
 return {rot:a.rot.map((v,j)=>v+(b.rot[j]!-v)*q) as V3,off:a.off.map((v,j)=>v+(b.off[j]!-v)*q) as V3};
}
function skeletonAt(program:ObjectProgram,scale:V3,at:number):Skeleton {
 const pivots:Record<string,V3>={root:[0,0,0]},bones:Bone[]=[{name:'root',parent:null,off:[0,0,0]}],rot:Record<string,V3>={};
 const keyed=Object.fromEntries((program.motion?.tracks??[]).map(t=>[t.joint,keyAt(t.keys,at,t.easing)]));
 for(const j of program.joints??[]){pivots[j.name]=scaled(j.pivot,scale);const a=pivots[j.name]!,b=pivots[j.parent]!,key=keyed[j.name];bones.push({name:j.name,parent:j.parent,off:a.map((v,i)=>v-b[i]!+(key?.off[i]??0)*scale[i]!) as V3});if(key)rot[j.name]=key.rot;}
 // KEEL's forward-kinematics solver operates on this arbitrary bone tree;
 // the Plan tag is metadata and no humanoid geometry or body generator is used.
 const index=Object.fromEntries(bones.map((b,i)=>[b.name,i])),children:Record<string,string[]>=Object.fromEntries(bones.map(b=>[b.name,[]]));for(const b of bones)if(b.parent)children[b.parent]!.push(b.name);
 const rig:Rig<unknown,'humanoid'>={plan:'humanoid',bones,index,children,chains:{},body:{},top:'root'};
 return poseSkeleton(rig,{rot});
}
const physics:Record<Emitter['kind'],{speed:number;up:number;gravity:number;drag:number;size:number;light:number}>={
 ember:{speed:.10,up:.62,gravity:-.12,drag:.6,size:.065,light:1},smoke:{speed:.07,up:.35,gravity:-.08,drag:1.2,size:.10,light:.65},
 rain:{speed:.015,up:-.6,gravity:1.2,drag:0,size:.035,light:.92},splash:{speed:.32,up:.42,gravity:1.3,drag:.3,size:.04,light:.9},
 spark:{speed:.42,up:.25,gravity:.8,drag:.3,size:.035,light:1},dust:{speed:.12,up:.09,gravity:0,drag:1,size:.035,light:.7},bubble:{speed:.015,up:.32,gravity:-.08,drag:.3,size:.05,light:1}
};
/** Periodic emission schedule: reconstruct each particle's true age through KEEL physics.
 * Seed and source pose are tied to its birth, so the loop is deterministic and closes. */
function particlesAt(program:ObjectProgram,seed:string,scale:V3,at:number):ParticleView[]{
 const period=program.motion?.period??1.6,output:ParticleView[]=[];
 for(const [id,e] of (program.emitters??[]).entries()){
  const p=physics[e.kind],life=period*.58,recipe:Recipe={life:[life,life],speed:[p.speed*.5,p.speed],up:[p.up*.85,p.up],gravity:p.gravity,drag:p.drag,size:[p.size*.7,p.size],light:[p.light,p.light],fade:.65,ramp:e.kind};
  for(let birth=0;birth<5;birth++){
   const age=((at-birth/5+1)%1)*period;if(age>=life)continue;
   const S=stream(createRoll(normalizeSeed(seed)),31+id*8+birth),pool=createParticles(3,{recipes:{effect:recipe}}),joint=(program.joints??[]).find(j=>j.name===e.joint),pivot=joint?.pivot??[0,0,0];
   const skeleton=skeletonAt(program,scale,birth/5),local=scaled(e.at.map((v,i)=>v-pivot[i]!) as V3,scale),source=boneToWorld(skeleton,e.joint,local);
   pool.emit('effect',source,{count:e.count,S,vel:apply(skeleton.bones[e.joint]!.m,e.velocity),spread:e.spread});
   // Fixed integration step, with a final remainder; independent of requested frame order.
   for(let t=0;t<age-1e-9;){const dt=Math.min(1/120,age-t);pool.step(dt);t+=dt;}
   for(const p of pool.list()){const q=age/life,envelope=Math.min(1,q/.12,(1-q)/.12);output.push({...p,size:p.size*envelope,light:p.light*envelope});}
  }
 }
 return output;
}
export function compileObject(program:ObjectProgram,seed:string):CompiledObject {
 let map=cached.get(program);if(!map){map=new Map();cached.set(program,map);}const hit=map.get(seed);if(hit)return hit;
 const scale=objectScale(program,seed),groups=new Map<string,Part[]>();for(const p of specimenParts(program)){const name=p.joint??'root';groups.set(name,[...(groups.get(name)??[]),p]);}
 const rest=[...groups].map(([name,parts])=>({name,mesh:lookMesh(worldOf(parts,scale),{around:10,rings:3}),pivot:scaled((program.joints??[]).find(j=>j.name===name)?.pivot??[0,0,0],scale)}));
 const meshes:LookMesh[]=[],particles:ParticleView[][]=[],skeletons:Skeleton[]=[],volumes:VolumeInstances[]=[],matterBounds:number[]=[];
 for(let frame=0;frame<MOTION_FRAMES;frame++){
  const skel=skeletonAt(program,scale,frame/MOTION_FRAMES);skeletons.push(skel);const ps:number[]=[],ns:number[]=[],attrs:number[]=[],body:number[]=[],indices:number[]=[];
  for(const {name,mesh,pivot} of rest){const base=ps.length/3;for(let v=0;v<mesh.positions.length;v+=3){ps.push(...boneToWorld(skel,name,[mesh.positions[v]!-pivot[0],mesh.positions[v+1]!-pivot[1],mesh.positions[v+2]!-pivot[2]]));ns.push(...apply(skel.bones[name]!.m,[mesh.normals[v]!,mesh.normals[v+1]!,mesh.normals[v+2]!]));}attrs.push(...mesh.attrs);body.push(...mesh.bodies);indices.push(...Array.from(mesh.indices,i=>i+base));}
  const volumeFrame=new VolumeInstances(128);
  for(const node of program.dynamics??[]){
   const field=matterFrame(node,seed,frame/MOTION_FRAMES*(program.motion?.period??1.6),program.motion?.period??1.6),pivot=(program.joints??[]).find(j=>j.name===node.joint)?.pivot??[0,0,0];
   const point=(p:ArrayLike<number>)=>boneToWorld(skel,node.joint,scaled(Array.from(p,(v,i)=>v-pivot[i]!),scale));
   for(const m of field.meshes){const base=ps.length/3;for(let v=0;v<m.positions.length;v+=3){ps.push(...point(m.positions.subarray(v,v+3)));ns.push(...apply(skel.bones[node.joint]!.m,[m.normals[v]!,m.normals[v+1]!,m.normals[v+2]!]));}attrs.push(...m.attrs);body.push(...m.bodies);indices.push(...Array.from(m.indices,i=>i+base));}
   for(let i=0;i<field.volumes.count;i++){const d=field.volumes.data,o=i*10,p=point(d.subarray(o,o+3));volumeFrame.push(...p,d[o+3]!*(scale[0]+scale[2])/2,d[o+4]!,d[o+5]!,d[o+6]!,d[o+7]!,d[o+8]!,d[o+9]!);}
   for(const p of field.points)matterBounds.push(...point(p));
  }
  volumes.push(volumeFrame);
  meshes.push({positions:new Float32Array(ps),normals:new Float32Array(ns),attrs:new Float32Array(attrs),bodies:new Float32Array(body),indices:new Uint32Array(indices)});particles.push(particlesAt(program,seed,scale,frame/MOTION_FRAMES));
 }
 // One camera for every phase and every direction. Animated geometry never auto-centres or zooms.
 const all=[...meshes.flatMap(m=>Array.from(m.positions)),...matterBounds];for(const frame of particles)for(const p of frame)for(const sign of [-1,1])all.push(p.p[0]+sign*p.size,p.p[1]+sign*p.size,p.p[2]+sign*p.size);
 const bounds=meshBounds(new Float32Array(all)),center=[(bounds[0]+bounds[3])/2,(bounds[1]+bounds[4])/2,(bounds[2]+bounds[5])/2];let radius=.05;
 for(let angle=0;angle<16;angle++){const c=Math.cos(angle*Math.PI/8),s=Math.sin(angle*Math.PI/8);for(let i=0;i<all.length;i+=3){const x=all[i]!-center[0]!,y=all[i+1]!-center[1]!,z=all[i+2]!-center[2]!;radius=Math.max(radius,Math.abs(x*c+z*s),Math.abs(y*.98-(-x*s+z*c)*.2));}}
 const compiled={meshes,particles,center,radius,skeletons,volumes};if(map.size>=4)map.delete(map.keys().next().value!);map.set(seed,compiled);return compiled;
}
export const posedMesh=(program:ObjectProgram,seed:string,phase:number)=>compileObject(program,seed).meshes[wrap(phase)]!;
export const posedParticles=(program:ObjectProgram,seed:string,phase:number)=>compileObject(program,seed).particles[wrap(phase)]!;
