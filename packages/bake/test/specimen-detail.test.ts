// Detail tiers: one program, a cut-down object at level 0 (the cartridge), more at 1 and 2. A program without tiers must
// compile and pack exactly as it did before tiers existed; a level must be the program with the entries above it deleted.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileObject,readSpecimen,specimenAtDetail,specimenDetail,emitterSlots,objectWorld,type SpecimenProgram} from '../src/index.ts';
import {SPECIMEN_PROGRAM_NATIVE as SPECIMEN_PROGRAM,SPECIMEN_PROGRAM_NATIVE_PRE_TIER as NATIVE_PRE_TIER,compatibility,createRegistry,decode,decodeRaw,encode,encodeRaw,type Infer} from '@keel-engine/codec';
const golden=JSON.parse(readFileSync(new URL('./specimen-detail.golden.json',import.meta.url),'utf8')) as {programs:{concept:string;program:SpecimenProgram;compiled:Record<string,string>;raw:string}[]};
/** A stable digest of any compiled value: typed arrays by their bytes, numbers as float64, keys sorted. (The golden's.) */
function digestValue(v:unknown):string{
 const h=createHash('sha256'),f=new Float64Array(1),b=new Uint8Array(f.buffer);
 const walk=(x:unknown):void=>{
  if(x===null||x===undefined){h.update(x===null?'n':'u');return;}
  if(ArrayBuffer.isView(x)){h.update(`t${x.constructor.name}${(x as Uint8Array).byteLength}:`);h.update(new Uint8Array(x.buffer,x.byteOffset,x.byteLength));return;}
  if(typeof x==='number'){f[0]=x;h.update('d');h.update(b);return;}
  if(typeof x==='string'){h.update(`s${x.length}:`);h.update(x);return;}
  if(typeof x==='boolean'){h.update(x?'T':'F');return;}
  if(Array.isArray(x)){h.update(`a${x.length}[`);for(const y of x)walk(y);h.update(']');return;}
  if(x instanceof Map){h.update('M');walk([...x.entries()]);return;}
  const o=x as Record<string,unknown>,keys=Object.keys(o).sort();h.update(`o${keys.length}{`);for(const k of keys){h.update(k);walk(o[k]);}h.update('}');
 };
 walk(v);return h.digest('hex');
}
const hex=(b:Uint8Array)=>Buffer.from(b).toString('hex');
const key=(rot:[number,number,number],at:number)=>({at,rot,off:[0,0,0] as [number,number,number]});
/** Every kind of tiered entry, with higher tiers placed BEFORE tier-0 ones (where a shared stream would shift). */
export const MIXED:SpecimenProgram={version:2,hue:30,variation:.04,
 materials:[{finish:'metal',screen:'bayer4',pattern:'none'},{finish:'glow',screen:'auto',pattern:'none'}],
 joints:[{name:'arm',parent:'root',pivot:[0,.4,0]},{name:'tip',parent:'arm',pivot:[.3,.5,0]}],
 parts:[
  {kind:'box',c:[0,.2,0],h:[.2,.2,.2],yaw:0,lo:0,tone:1,material:0,joint:'root',detail:2},
  {kind:'box',c:[0,.1,0],h:[.3,.1,.3],yaw:0,lo:0,tone:0,material:0,joint:'root'},
  {kind:'capsule',a:[0,.4,0],b:[.3,.5,0],r:.05,tone:1,material:1,joint:'arm',detail:1},
  {kind:'wedge',c:[.3,.5,0],h:[.05,.05,.05],yaw:.3,lo:.2,tone:2,material:0,joint:'tip'},
  {kind:'capsule',a:[-.2,.1,0],b:[-.3,.3,0],r:.04,tone:0,material:1,joint:'root',detail:2},
 ],
 patterns:[
  {part:{kind:'box',c:[.25,0,.25],h:[.03,.03,.03],yaw:0,lo:0,tone:0,material:0,joint:'root'},repeat:{kind:'ring',count:4,center:[0,0,0]},detail:1},
  {part:{kind:'capsule',a:[.1,.3,.1],b:[.1,.35,.1],r:.02,tone:1,material:0,joint:'root'},repeat:{kind:'mirror',axis:0}},
  {part:{kind:'box',c:[-.1,.05,-.2],h:[.02,.02,.02],yaw:0,lo:0,tone:2,material:1,joint:'root',detail:2},repeat:{kind:'line',count:3,step:[.05,0,0]}},
 ],
 motion:{action:'Test arm',period:1.6,tracks:[
  {joint:'arm',keys:[key([0,0,0],0),key([0,0,.4],.5),key([0,0,0],1)],easing:'smooth',detail:1},
  {joint:'tip',keys:[key([0,0,0],0),key([.3,0,0],.5),key([0,0,0],1)],easing:'smooth'},
 ]},
 emitters:[
  {kind:'spark',joint:'root',at:[0,.5,0],velocity:[0,.2,0],count:2,spread:.1,detail:2},
  {kind:'ember',joint:'root',at:[0,.3,0],velocity:[0,.1,0],count:3,spread:.2},
  {kind:'smoke',joint:'tip',at:[.3,.5,0],velocity:[0,.1,0],count:1,spread:.1,detail:1},
 ],
 dynamics:[
  {kind:'combustion',joint:'root',at:[0,.2,0],size:.4,material:1,detail:1},
  {kind:'liquid',joint:'root',at:[0,0,.2],size:.3,material:0,flow:'pour'},
 ]};
/** The program with every entry above `d` deleted, written independently of specimenAtDetail. */
function deleted(p:SpecimenProgram,d:number):SpecimenProgram{
 const q=structuredClone(p),drop=(list:{detail?:number}[]|undefined)=>{if(list)for(let i=list.length-1;i>=0;i--)if((list[i]!.detail??0)>d)list.splice(i,1);};
 drop(q.parts);drop(q.motion?.tracks);drop(q.emitters);drop(q.dynamics);
 if(q.patterns)for(let i=q.patterns.length-1;i>=0;i--)if((q.patterns[i]!.detail??0)>d||(q.patterns[i]!.part.detail??0)>d)q.patterns.splice(i,1);
 return q;
}
test('native catalogue vectors retain the explicit pre-tier layout and compiled artwork at every level',()=>{
 assert.ok(golden.programs.length>=8);
 for(const {concept,program,compiled,raw} of golden.programs){
  const read=readSpecimen(program);assert.equal(specimenDetail(read),0,concept);
  for(const d of [0,1,2] as const){assert.equal(specimenAtDetail(read,d),read,`${concept}: untouched at ${d}`);for(const [seed,want] of Object.entries(compiled))assert.equal(digestValue(compileObject(structuredClone(read),seed,d)),want,`${concept} seed ${seed} detail ${d}`);}
  for(const [seed,want] of Object.entries(compiled))assert.equal(digestValue(compileObject(structuredClone(read),seed)),want,`${concept} seed ${seed}`);
  assert.equal(hex(encodeRaw(SPECIMEN_PROGRAM,program as Infer<typeof SPECIMEN_PROGRAM>)),raw,`${concept}: packed bits`);
  assert.equal(hex(encodeRaw(SPECIMEN_PROGRAM,read as Infer<typeof SPECIMEN_PROGRAM>)),hex(encodeRaw(SPECIMEN_PROGRAM,program as Infer<typeof SPECIMEN_PROGRAM>)),`${concept}: read packs the same`);
 }
});
test('a level is the program with every entry above it deleted: joints stay, tracks go with their tier',()=>{
 const p=readSpecimen(MIXED);assert.equal(specimenDetail(p),2);
 for(const d of [0,1,2] as const)for(const seed of ['1','0x5eed']){
  const at=compileObject(structuredClone(p),seed,d),cut=compileObject(deleted(p,d),seed);
  assert.equal(digestValue(at),digestValue(cut),`detail ${d} seed ${seed}`);
  assert.deepEqual(specimenAtDetail(p,d),deleted(p,d));
  for(const s of at.skeletons)assert.deepEqual(Object.keys(s.bones).sort(),['arm','root','tip']);
 }
 // The tier-0 object stands alone: no tier field left in it, so it is a plain program of the kind that existed before.
 assert.equal(JSON.stringify(deleted(p,0)).includes('detail'),false);
 assert.equal(digestValue(compileObject(p,'1')),digestValue(compileObject(p,'1',2)));
 assert.notEqual(digestValue(compileObject(p,'1',0)),digestValue(compileObject(p,'1',1)));
 // The arm's track is tier 1: still at 0, moving at 1. The tip's (tier 0) moves at every level.
 const bone=(d:0|1|2,f:number,j:string)=>Array.from(compileObject(p,'1',d).skeletons[f]!.bones[j]!.m as ArrayLike<number>);
 assert.deepEqual(bone(0,0,'arm'),bone(0,4,'arm'));assert.notDeepEqual(bone(1,0,'arm'),bone(1,4,'arm'));
 for(const d of [0,1,2] as const)assert.notDeepEqual(bone(d,0,'tip'),bone(d,4,'tip'));
 // Parts: the level's own specimenParts order; the cartridge gets the tier-0 box, wedge and mirrored pair.
 const counts=[0,1,2].map(d=>new Set(Array.from(compileObject(p,'1',d as 0).meshes[0]!.parts).filter(i=>i<1000)).size);assert.deepEqual(counts,[4,9,14]);
 const world=objectWorld(p,'1',0,0);assert.equal((world.boxes?.length??0)+(world.wedges?.length??0)+(world.capsules?.length??0),4);
});
test('seeded randomness never moves between levels: an emitter draws the same numbers wherever it is drawn',()=>{
 const p=readSpecimen(MIXED);
 assert.deepEqual(emitterSlots(p),[2031,31,1031]);assert.deepEqual(emitterSlots(deleted(p,0)),[31]);assert.deepEqual(emitterSlots(deleted(p,1)),[31,1031]);
 const embers=(d:0|1|2)=>compileObject(p,'0x5eed',d).particles.map(f=>f.filter(q=>q.ramp==='ember'));
 assert.ok(embers(0).some(f=>f.length));assert.deepEqual(embers(2),embers(0));assert.deepEqual(embers(1),embers(0));
 const smoke=(d:1|2)=>compileObject(p,'0x5eed',d).particles.map(f=>f.filter(q=>q.ramp==='smoke'));assert.ok(smoke(1).some(f=>f.length));assert.deepEqual(smoke(2),smoke(1));
 // Without tiers every emitter is tier 0, numbered as it always was.
 assert.deepEqual(emitterSlots({...p,emitters:p.emitters!.map(({detail:_,...e})=>e)}),[31,39,47]);
});
test('the reader keeps tiers above 0, drops an explicit 0, and bounds lists by the whole program',()=>{
 const p=readSpecimen(MIXED);
 assert.equal(p.parts[0]!.detail,2);assert.equal('detail' in p.parts[1]!,false);assert.equal(p.patterns![0]!.detail,1);assert.equal(p.patterns![2]!.part.detail,2);
 assert.equal(p.motion!.tracks[0]!.detail,1);assert.equal(p.emitters![2]!.detail,1);assert.equal(p.dynamics![0]!.detail,1);
 const zero=readSpecimen({...MIXED,parts:MIXED.parts.map(x=>({...x,detail:0}))});for(const x of zero.parts)assert.equal('detail' in x,false);
 assert.throws(()=>readSpecimen({...MIXED,parts:[{...MIXED.parts[1]!,detail:3 as 2}]}),/outside bounds/);
 assert.throws(()=>readSpecimen({...MIXED,parts:[{...MIXED.parts[1]!,detail:.5 as 2}]}),/integer required/);
 assert.throws(()=>readSpecimen({...MIXED,parts:MIXED.parts.map(x=>({...x,detail:1 as const})),patterns:[]}),/detail 0 needs a part/);
 assert.doesNotThrow(()=>readSpecimen({...MIXED,parts:MIXED.parts.map(x=>({...x,detail:1 as const}))}),'a tier-0 pattern is a part');
 const box=MIXED.parts[1]!,many=(n:number)=>Array.from({length:n},(_,i)=>({...box,c:[0,i/100,0] as [number,number,number],...(i>=24?{detail:2 as const}:{})}));
 assert.equal(readSpecimen({...MIXED,parts:many(64),patterns:[]}).parts.length,64);assert.throws(()=>readSpecimen({...MIXED,parts:many(65),patterns:[]}),/part budget/);
 const joints=Array.from({length:16},(_,i)=>({name:`j${i}`,parent:'root',pivot:[0,0,0] as [number,number,number]}));
 assert.equal(readSpecimen({...MIXED,joints:[...MIXED.joints!,...joints.slice(2)]}).joints!.length,16);
 assert.throws(()=>readSpecimen({...MIXED,joints:[...MIXED.joints!,...joints.slice(1)]}),/exceeds budget/);
 assert.equal(readSpecimen({...MIXED,emitters:[...MIXED.emitters!,...MIXED.emitters!,...MIXED.emitters!.slice(0,2)]}).emitters!.length,8);
 assert.equal(readSpecimen({...MIXED,dynamics:[...MIXED.dynamics!,...MIXED.dynamics!]}).dynamics!.length,4);
 const [p0,p1,p2]=MIXED.patterns!;assert.equal(readSpecimen({...MIXED,patterns:[p0!,p1!,p2!,p0!,p2!,p0!,p2!,p1!]}).patterns!.length,8);
});
test('the detail-0 object keeps the cartridge\'s limits, so an untiered program reads exactly as before',()=>{
 const flat=deleted(MIXED,0),box=flat.parts[0]!,at=(i:number):[number,number,number]=>[0,i/100,0];
 const parts=(n:number,tiered=0)=>[...Array.from({length:n},(_,i)=>({...box,c:at(i)})),...Array.from({length:tiered},(_,i)=>({...box,c:at(i+n),detail:2 as const}))];
 assert.throws(()=>readSpecimen({...flat,parts:parts(25),patterns:[]}),/part budget/);assert.equal(readSpecimen({...flat,parts:parts(24,40),patterns:[]}).parts.length,64);
 // Expanded: 23 untiered parts and a tier-0 mirror is 25 at level 0 (the old message); a tier-1 mirror is not drawn there.
 const mirror={part:{...box,c:[.3,0,0] as [number,number,number]},repeat:{kind:'mirror' as const,axis:0 as const}};
 assert.throws(()=>readSpecimen({...flat,parts:parts(23),patterns:[mirror]}),/expanded specimen part budget 1\.\.24/);
 assert.equal(readSpecimen({...flat,parts:parts(23),patterns:[{...mirror,detail:1}]}).patterns!.length,1);
 assert.throws(()=>readSpecimen({...flat,patterns:Array(5).fill(flat.patterns![0])}),/exceeds budget/);assert.equal(readSpecimen({...flat,patterns:[...Array(4).fill(flat.patterns![0]),{...mirror,detail:2}]}).patterns!.length,5);
 const dyn=flat.dynamics![0]!;
 assert.throws(()=>readSpecimen({...flat,dynamics:[dyn,dyn,dyn]}),/exceeds budget/);assert.equal(readSpecimen({...flat,dynamics:[dyn,dyn,{...dyn,detail:1}]}).dynamics!.length,3);
 const em=flat.emitters![0]!;
 assert.throws(()=>readSpecimen({...flat,emitters:Array(5).fill(em)}),/exceeds budget/);assert.equal(readSpecimen({...flat,emitters:[...Array(4).fill(em),{...em,detail:2}]}).emitters!.length,5);
 // Joints belong to every level: 8 unless some entry is tiered, 16 when one is.
 const joints=Array.from({length:9},(_,i)=>({name:`j${i}`,parent:'root',pivot:[0,0,0] as [number,number,number]}));
 assert.throws(()=>readSpecimen({...flat,joints:[...flat.joints!,...joints.slice(2)]}),/exceeds budget/);
 assert.equal(readSpecimen({...flat,joints:[...flat.joints!,...joints.slice(2)],emitters:[...flat.emitters!,{...em,detail:1}]}).joints!.length,9);
 // Tracks: 8 untiered (one a joint), 16 in all.
 const track=flat.motion!.tracks[0]!,many=Array.from({length:12},(_,i)=>({name:`j${i}`,parent:'root',pivot:[0,0,0] as [number,number,number]}));
 const withTracks=(n:number,tiered:number)=>({...flat,joints:many,parts:[...flat.parts.map(x=>({...x,joint:'root'})),{...box,detail:1 as const}],motion:{...flat.motion!,tracks:many.slice(0,n+tiered).map((j,i)=>({...track,joint:j.name,...(i>=n?{detail:1 as const}:{})}))}});
 assert.throws(()=>readSpecimen(withTracks(9,0)),/exceeds budget/);assert.equal(readSpecimen(withTracks(8,4)).motion!.tracks.length,12);
 // And every catalogue program the golden holds still reads to itself.
 for(const {program} of golden.programs)assert.deepEqual(readSpecimen(readSpecimen(program)),readSpecimen(program));
});
test('native packing: tiers round-trip and native pre-tier documents keep their body bits',()=>{
 const L=NATIVE_PRE_TIER as unknown as typeof SPECIMEN_PROGRAM;
 for(const {concept,program,raw} of golden.programs){
  assert.equal(hex(encodeRaw(L,program as never)),raw,`${concept}: the explicit native pre-tier schema wrote the golden`);
  const old=encode(L,program as never),now=encode(SPECIMEN_PROGRAM,program as never);
  assert.equal(hex(old.subarray(5)),hex(now.subarray(5)),`${concept}: the body is the same; only the schema id in the header moved`);
  const registry=createRegistry();registry.register(L);assert.deepEqual(decode(SPECIMEN_PROGRAM,old,{registry}),program,`${concept}: an old document reads`);
 }
 assert.equal(compatibility(L,SPECIMEN_PROGRAM).ok,true);assert.equal(compatibility(SPECIMEN_PROGRAM,L).ok,true);assert.ok(compatibility(SPECIMEN_PROGRAM,L).warnings.length>0);
 const round=(p:SpecimenProgram)=>{const b=encode(SPECIMEN_PROGRAM,p as Infer<typeof SPECIMEN_PROGRAM>),q=decode(SPECIMEN_PROGRAM,b) as SpecimenProgram;assert.deepEqual(q,p);return b;};
 const mixed=readSpecimen(MIXED),bytes=round(mixed);round(MIXED);assert.deepEqual(readSpecimen(decode(SPECIMEN_PROGRAM,bytes)),mixed);
 assert.ok(bytes.length<JSON.stringify(mixed).length/2);
 // Explicit zeros are kept by the codec (canonical JSON, and so a hash, sees the key); the reader drops them.
 round({...MIXED,parts:MIXED.parts.map(x=>({...x,detail:0}))});
 // Past the old limits, untiered: the grown layout, which the old schema could not write at all.
 const box=MIXED.parts[1]!,wide={...deleted(MIXED,0),parts:Array.from({length:40},(_,i)=>({...box,c:[0,i/100,0] as [number,number,number]}))};
 round(wide);assert.throws(()=>encode(L,wide as never),/max is 24/);assert.throws(()=>decode(L,encode(SPECIMEN_PROGRAM,wide as never),{registry:(()=>{const r=createRegistry();r.register(SPECIMEN_PROGRAM);return r;})()}),/max is 24/);
 // A tier-0 program with exactly the old limits packs as the old schema did.
 const full={...deleted(MIXED,0),patterns:[],parts:Array.from({length:24},(_,i)=>({...box,c:[0,i/100,0] as [number,number,number]}))};assert.equal(hex(encodeRaw(L,full as never)),hex(encodeRaw(SPECIMEN_PROGRAM,full as never)));
 assert.deepEqual(decodeRaw(SPECIMEN_PROGRAM,encodeRaw(SPECIMEN_PROGRAM,readSpecimen(full) as never)),readSpecimen(full));
});
