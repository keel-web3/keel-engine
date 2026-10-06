import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gbdkData} from '../tools/gbdk-data.mjs';
test('binary adapter preserves literal bytes, C padding, bank and BANKREF',()=>{
 const a=gbdkData('#pragma bank 508\n#include <gb/gb.h>\nBANKREF(table)\nconst uint8_t table[6]={3,1,255};\n');
 assert.deepEqual([...a.data],[3,1,255,0,0,0]);
 assert.match(a.source('/tmp/art bytes.bin'),/#pragma bank 508/);
 assert.match(a.source('/tmp/art bytes.bin'),/INCBIN\(table, "\/tmp\/art bytes.bin"\)/);
 assert.doesNotMatch(a.source('/tmp/art bytes.bin'),/BANKREF\(/);
 assert.throws(()=>a.source('/tmp/bad".bin'));
});
test('code, expressions and unsupported declarations keep the C compiler path',()=>{
 assert.equal(gbdkData('#pragma bank 255\nvoid game(void){}'),null);
 assert.equal(gbdkData('#pragma bank 255\n#include <gb/gb.h>\nconst uint8_t a[2]={1+2,0};'),null);
 assert.equal(gbdkData('#pragma bank 255\n#include <gb/gb.h>\nBANKREF(other)\nconst uint8_t a[2]={1,0};'),null);
 assert.throws(()=>gbdkData('#pragma bank 255\n#include <gb/gb.h>\nconst uint8_t a[1]={256};'));
 assert.throws(()=>gbdkData('#pragma bank 255\n#include <gb/gb.h>\nconst uint8_t a[1]={1,2};'));
});
