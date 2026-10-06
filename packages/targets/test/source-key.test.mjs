import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sourceKey} from '../tools/source-key.mjs';
test('worker and used dependency changes invalidate, unrelated pure exports do not',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'keel-worker-test-'));
 try{
  const entry=join(dir,'worker.ts'),dep=join(dir,'dep.ts');
  writeFileSync(entry,"import {pixels} from './dep.ts'; console.log(pixels(process.argv[2]));");
  writeFileSync(dep,'export const pixels=(s:string)=>s+"1"; export const packing=()=>1;');
  const a=await sourceKey(entry);assert.equal(await sourceKey(entry),a);
  writeFileSync(dep,'export const pixels=(s:string)=>s+"1"; export const packing=()=>2;');
  assert.equal(await sourceKey(entry),a);
  writeFileSync(dep,'export const pixels=(s:string)=>s+"2"; export const packing=()=>2;');
  const b=await sourceKey(entry);assert.notEqual(b,a);
  writeFileSync(entry,"import {pixels} from './dep.ts'; console.log(pixels(process.argv[2])+'.');");
  assert.notEqual(await sourceKey(entry),b);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
