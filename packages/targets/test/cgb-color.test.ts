import {test} from 'node:test';import assert from 'node:assert/strict';
import {rgb555,rgb555Bytes,readRgb555,tileIndices,encodeTile,palettePixel,renderMapRegion,pixelDifference} from '../src/cgb/color.ts';
import {packLosslessPalettes,paletteIndex} from '../src/cgb/palettes.ts';
test('RGB555 endian primaries, bitplanes, flips and index-zero semantics',()=>{
 assert.deepEqual([rgb555(255,0,0),rgb555(0,255,0),rgb555(0,0,255)],[31,992,31744]);assert.deepEqual([...rgb555Bytes([31,992,31744])],[31,0,224,3,0,124]);assert.deepEqual([...readRgb555(new Uint8Array([31,0,224,3,0,124]))],[31,992,31744]);
 const t=new Uint8Array(16);t[0]=128;t[1]=64;assert.deepEqual([...tileIndices(t).slice(0,3)],[1,2,0]);assert.equal(tileIndices(t,true,true)[63],1);assert.deepEqual(encodeTile(tileIndices(t)),t);
 assert.equal(palettePixel([31,992,31744,0],0).alpha,255);assert.equal(palettePixel([31,992,31744,0],0,true).alpha,0);
});
test('map-position attributes, VRAM banks and signed tile IDs select independent colors',()=>{
 const v:[Uint8Array,Uint8Array]=[new Uint8Array(8192),new Uint8Array(8192)],c=new Uint16Array(32);c[1]=31;c[5]=992;
 v[0].set(encodeTile(new Uint8Array(64).fill(1)),16);v[0][0x1800]=v[0][0x1801]=1;v[1][0x1801]=1;
 const r=renderMapRegion({vram:v,cram:c,mapOffset:0x1800,x:0,y:0,width:2,height:1,unsignedTiles:true});assert.equal(r.colors[0],31);assert.equal(r.colors[8],992);assert.equal(r.paletteIds[8],1);
 v[1].set(encodeTile(new Uint8Array(64).fill(1)),0x800);v[0][0x1800]=128;v[1][0x1800]=8;
 assert.equal(renderMapRegion({vram:v,cram:c,mapOffset:0x1800,x:0,y:0,width:1,height:1,unsignedTiles:false}).colors[0],31);
 assert.deepEqual(pixelDifference([31,992],[31,31744]),{pixels:2,changed:1,first:1,maxChannel5:31,channelAbsolute5:[0,31,31]});
});
test('lossless joint palette packing respects fixed scene slots and BG-zero priority',()=>{
 const demands=[{key:'rest',zeroColor:32767,nonzeroColors:[31,992]},{key:'turn',zeroColor:32767,nonzeroColors:[31744,31]},{key:'duplicate',zeroColor:32767,nonzeroColors:[32767]}];
 const p=packLosslessPalettes(demands,{limit:3,fixed:[{id:2,colors:[0,1,2,3]}]});assert.ok(p.ok);if(!p.ok)return;
 for(const d of demands){const colors=p.palettes[p.assignments.get(d.key)!]!;assert.equal(paletteIndex(colors,d.zeroColor,true),0);for(const c of d.nonzeroColors)assert.ok(paletteIndex(colors,c,false)>0);}
 assert.deepEqual(packLosslessPalettes([...demands].reverse(),{limit:3,fixed:[{id:2,colors:[0,1,2,3]}]}),p);
 assert.equal(packLosslessPalettes([{key:'bad',zeroColor:0,nonzeroColors:[1,2,3,4]}]).ok,false);
 assert.deepEqual(packLosslessPalettes([{key:'a',zeroColor:0,nonzeroColors:[1]},{key:'b',zeroColor:2,nonzeroColors:[1]}],{limit:1}),{ok:false,reason:'palette-capacity',nodes:2});
 const limited=packLosslessPalettes(demands,{maxSearchNodes:1});assert.ok(!limited.ok&&limited.reason==='search-limit');
});
