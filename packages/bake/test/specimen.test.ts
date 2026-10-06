import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expandPrimitivePattern,specimenParts,compileObject,type SpecimenPart,type SpecimenProgram} from '../src/index.ts';
import {SPECIMEN_PROGRAM_NATIVE as SPECIMEN_PROGRAM,encode,decode,type Infer} from '@keel-engine/codec';
const part:SpecimenPart={kind:'capsule',a:[.2,0,.1],b:[.4,.2,.1],r:.05,tone:1,material:0,joint:'root'};
test('shared primitive patterns create coherent mirrored, linear and radial geometry',()=>{
 const mirror=expandPrimitivePattern({part,repeat:{kind:'mirror',axis:2}});assert.equal(mirror.length,2);assert.equal(mirror[1]!.kind,'capsule');assert.deepEqual((mirror[1] as typeof part).a,[.2,0,-.1]);assert.equal(mirror[1]!.joint,'root');
 const row=expandPrimitivePattern({part,repeat:{kind:'line',count:4,step:[.1,0,0]}});assert.equal(row.length,4);assert.equal((row[3] as typeof part).a[0],.5);
 const ring=expandPrimitivePattern({part,repeat:{kind:'ring',count:4,center:[0,0,0]}});assert.equal(ring.length,4);assert.ok(Math.abs((ring[2] as typeof part).a[0]+.2)<1e-12);
 assert.throws(()=>expandPrimitivePattern({part,repeat:{kind:'line',count:13,step:[0,0,0]}}));assert.throws(()=>specimenParts({parts:Array(63).fill(part),patterns:[{part,repeat:{kind:'mirror',axis:0}}]}));assert.equal(specimenParts({parts:Array(62).fill(part),patterns:[{part,repeat:{kind:'mirror',axis:0}}]}).length,64);
});
test('compact shared recipes preserve exact construction, seeded meshes and closed motion',()=>{
 const p:SpecimenProgram={version:2,hue:180,variation:.04,parts:[part],patterns:[{part,repeat:{kind:'ring',count:4,center:[0,0,0]}}],materials:[{finish:'metal',screen:'bayer4',pattern:'none'}],joints:[],motion:{action:'Rigid wheel',period:1.6,tracks:[]},emitters:[],dynamics:[]};
 const bytes=encode(SPECIMEN_PROGRAM,p as Infer<typeof SPECIMEN_PROGRAM>),q=decode(SPECIMEN_PROGRAM,bytes) as SpecimenProgram;assert.deepEqual(q,p);assert.ok(bytes.length<JSON.stringify(p).length/2);
 const a=compileObject(p,'9'),b=compileObject(q,'9');assert.deepEqual(a.meshes[0],b.meshes[0]);assert.deepEqual(a.meshes[0],a.meshes[15]);assert.notDeepEqual(a.meshes[0]!.positions,compileObject(p,'10').meshes[0]!.positions);
});
