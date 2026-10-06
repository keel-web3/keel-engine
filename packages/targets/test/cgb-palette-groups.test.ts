import {test} from 'node:test';import assert from 'node:assert/strict';
import {packPaletteGroups,unpackPaletteGroup} from '../src/cgb/palette-groups.ts';
test('palette groups preserve every tint, duplicate RGB word and little-endian pair',()=>{
 const a=[[[0,1,31,992],[0,1,31744,31],[0,1,31,992],[0,1,1,0]],[[0,2,31,992],[0,2,31744,31],[0,2,31,992],[0,2,1,0]],[[0,1,31,992],[0,1,31744,31],[0,1,31,992],[0,1,1,0]]];
 const p=packPaletteGroups(a);assert.equal(p.groups.length,1);assert.equal(p.pairs.length,3);assert.equal(p.prefixes.length,2);assert.equal(p.references[0],p.references[2]);assert.notEqual(p.references[0],p.references[1]);
 a.forEach((t,i)=>t.forEach((v,k)=>assert.deepEqual(unpackPaletteGroup(p,p.references[i]!,k),v)));
 const reverse=packPaletteGroups([...a].reverse());assert.deepEqual(reverse.bytes,p.bytes);assert.deepEqual(reverse.prefixes,p.prefixes);assert.deepEqual([...reverse.references].reverse(),[...p.references]);
 assert.equal(p.layout,'direct');assert.deepEqual([...p.bytes.subarray(0,4)],[31,0,224,3]);
 const b=[a[0]!,[[0,1,31,992],[0,1,1,0],[0,1,31744,31],[0,1,31,992]]],dictionary=packPaletteGroups(b);assert.equal(dictionary.layout,'dictionary');b.forEach((t,i)=>t.forEach((v,k)=>assert.deepEqual(unpackPaletteGroup(dictionary,dictionary.references[i]!,k),v)));
});
test('palette dictionary rejects silent recoloring and resource overflow',()=>{
 assert.throws(()=>packPaletteGroups([[[0,1,2,3],[0,2,2,3],[0,1,2,3],[0,1,2,3]]]),/prefix changes/);
 assert.throws(()=>packPaletteGroups([[[0,1,2,32768],[0,1,2,3],[0,1,2,3],[0,1,2,3]]]),/invalid RGB555/);
 const p=packPaletteGroups([Array.from({length:4},()=>[0,1,2,3])]);assert.throws(()=>unpackPaletteGroup(p,1,0),/unknown/);assert.throws(()=>unpackPaletteGroup(p,0,4),/invalid/);
 const large=Array.from({length:8200},(_,i)=>Array.from({length:4},(_,v)=>[0,1,i,v]));assert.throws(()=>packPaletteGroups(large),/address budget/);
});
