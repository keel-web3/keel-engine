import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packBankRecords } from '../src/rom-banks.ts';
test('pack bank records without changing IDs, bytes or caller data', () => {
 const records = [6,6,4,4].map((n,id) => new Uint8Array(n).fill(id+1));
 const packed=packBankRecords(records,10);
 assert.equal(packed.banks.length,2);assert.equal(packed.paddingBytes,0);
 records.forEach((r,id)=>{const {bank,offset}=packed.locations[id]!;assert.deepEqual(packed.banks[bank]!.slice(offset,offset+r.length),r);});
 assert.deepEqual(packBankRecords(records,10),packed);
 packed.banks[0]!.fill(0);assert.equal(records[0]![0],1);
});
test('support GBC 16KiB and NES 8KiB boundaries without mapper assumptions', () => {
 for(const size of [8192,16384]) {
  const records=[size,size-1,1].map(n=>new Uint8Array(n).fill(173)),p=packBankRecords(records,size);
  assert.equal(p.banks.length,2);assert.equal(p.payloadBytes,2*size);
  p.locations.forEach((at,i)=>assert.ok(at.offset+records[i]!.length<=size));
 }
 assert.deepEqual(packBankRecords([],8192).banks,[]);
 for(const n of [0,-1,1.5,NaN])assert.throws(()=>packBankRecords([],n));
 assert.throws(()=>packBankRecords([new Uint8Array(8193)],8192));
 assert.throws(()=>packBankRecords([new Uint8Array(0)],8192));
});
