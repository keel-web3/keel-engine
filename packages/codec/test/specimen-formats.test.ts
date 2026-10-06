import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SPECIMEN_PROGRAM,SPECIMEN_PROGRAM_LEGACY,SPECIMEN_PROGRAM_NATIVE,SPECIMEN_PROGRAM_NATIVE_PRE_TIER,SPECIMEN_PROGRAM_PLACEMENT,createRegistry,decode,encode,encodeRaw,readDocument,registerEngineSchemas,schemaId} from '../src/index.ts';
const original=JSON.parse(readFileSync(new URL('./old-main-specimen.golden.json',import.meta.url),'utf8'));
const native=JSON.parse(readFileSync(new URL('../../bake/test/specimen-detail.golden.json',import.meta.url),'utf8'));
const hex=(bytes:Uint8Array)=>Buffer.from(bytes).toString('hex');
const registry=()=>{const r=createRegistry();registerEngineSchemas(r);return r;};
test('original main specimen layout and stored bytes retain their historical default identity',()=>{
 assert.equal(createHash('sha256').update(readFileSync(new URL('../src/schemas/specimen-legacy.ts',import.meta.url))).digest('hex'),original.sourceSha256);
 assert.equal(SPECIMEN_PROGRAM,SPECIMEN_PROGRAM_LEGACY);
 assert.equal(schemaId(SPECIMEN_PROGRAM),original.schemaId);
 assert.equal(hex(encodeRaw(SPECIMEN_PROGRAM,original.program)),original.raw);
 assert.equal(hex(encode(SPECIMEN_PROGRAM,original.program)),original.document);
 const r=registry();registerEngineSchemas(r);
 assert.equal(r.get('keel/bake/specimen')!.id,original.schemaId);
 assert.equal(r.get('keel/bake/specimen@1')!.id,original.schemaId);
 const document=readDocument(Uint8Array.from(Buffer.from(original.document,'hex')),{registry:r});
 assert.equal(document.id,original.schemaId);assert.deepEqual(document.value,original.program);
});
test('native pre-tier published catalogue documents resolve their own layout without replacing the main default',()=>{
 const r=registry();assert.equal(schemaId(SPECIMEN_PROGRAM_NATIVE_PRE_TIER),native.schemaId);
 assert.equal(r.get('keel/bake/specimen/native-pre-tier')!.id,native.schemaId);
 assert.equal(r.get('keel/bake/specimen/native')!.id,schemaId(SPECIMEN_PROGRAM_NATIVE));
 for(const {program,raw,concept} of native.programs){
  const stored=Uint8Array.from(Buffer.from('b1'+native.schemaId.slice(0,8)+raw,'hex'));
  assert.equal(hex(encode(SPECIMEN_PROGRAM_NATIVE_PRE_TIER,program)),hex(stored),concept);
  assert.deepEqual(readDocument(stored,{registry:r}).value,program,concept);
  assert.deepEqual(decode(SPECIMEN_PROGRAM_NATIVE,stored,{registry:r}),program,concept);
 }
 assert.equal(r.get('keel/bake/specimen@1')!.id,original.schemaId);
});
test('placement @2 round-trips color, new screens, real flow, tiers and lift through registry discovery',()=>{
 const p={...native.programs[0].program,displayLift:.14789,
  parts:[...native.programs[0].program.parts,{...native.programs[0].program.parts[0],detail:2}],
  materials:[{finish:'water',screen:'stipple',pattern:'none'}],
  dynamics:[{kind:'liquid',joint:'root',at:[0,0,0],size:.3,material:0,flow:'jet',detail:1}]};
 const r=registry(),stored=encode(SPECIMEN_PROGRAM_PLACEMENT,p),got=readDocument(stored,{registry:r});
 assert.equal(r.get('keel/bake/specimen@2')!.id,schemaId(SPECIMEN_PROGRAM_PLACEMENT));
 assert.equal(got.id,schemaId(SPECIMEN_PROGRAM_PLACEMENT));assert.deepEqual(got.value,p);
 assert.ok(stored.length<JSON.stringify(p).length/2);
 assert.equal(r.get('keel/bake/specimen@1')!.id,original.schemaId);
});
