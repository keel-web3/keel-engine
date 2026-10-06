import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lowerRasterMask,lowerRasterMaskFrames,fitTargetTones} from '../src/target-raster.ts';
test('area filtering conserves ink for non-integer target footprints',()=>{
 const out=lowerRasterMask({width:3,height:1,pixels:Uint8Array.of(255,0,255)},{width:2,height:1});
 assert.ok(out.coverage.every(v=>Math.abs(v-2/3)<1e-6));
 assert.deepEqual([...out.pixels],[1,1]);
 const enlarged=lowerRasterMask({width:2,height:1,pixels:Uint8Array.of(255,0)},{width:3,height:1});
 assert.deepEqual([...enlarged.coverage],[1,.5,0]);
});
test('one or two family tones use legal native codes and keep a contrasting stroke',()=>{
 const palette=[{code:0,rgb:[0,0,0] as const},{code:1,rgb:[255,255,255] as const},{code:3,rgb:[0,80,190] as const},{code:7,rgb:[90,160,255] as const}];
 const source={stroke:[20,10,30] as const,tones:[[0,75,185] as const,[90,155,250] as const]};
 const target={palette,background:[240,128,128] as const,toneCount:2 as const};
 const a=fitTargetTones(source,target),b=fitTargetTones(source,{...target,palette:[...palette].reverse()});
 assert.deepEqual(a,b);assert.equal(a.stroke.code,0);assert.deepEqual(a.tones.map(p=>p.code),[3,7]);assert.equal(a.contrastMet,true);
 assert.equal(fitTargetTones(source,{...target,toneCount:1}).tones.length,1);
 assert.deepEqual(fitTargetTones(source,target),a); // Another object/family cannot perturb this ramp.
});
test('impossible native contrast is reported and malformed palettes are rejected',()=>{
 const source={stroke:[128,128,128] as const,tones:[[128,128,128] as const]};
 const target={palette:[{code:2,rgb:[130,130,130] as const}],background:[128,128,128] as const,toneCount:1 as const};
 assert.equal(fitTargetTones(source,target).contrastMet,false);
 assert.throws(()=>fitTargetTones(source,{...target,palette:[...target.palette,...target.palette]}),/unique/);
 assert.throws(()=>fitTargetTones(source,{...target,palette:[{code:2,rgb:[300,0,0]}]}),/RGB/);
});
test('thin structural marks survive an explicit device threshold without filling empty holes',()=>{
 const pixels=new Uint8Array(16);pixels[0]=255;pixels[15]=255;
 const out=lowerRasterMask({width:8,height:2,pixels},{width:2,height:2,threshold:.25,pixelAspect:[4,1]});
 assert.deepEqual([...out.pixels],[1,0,0,1]);assert.deepEqual([...out.packed],[128,64]);assert.deepEqual(out.pixelAspect,[4,1]);
});
test('ordered monochrome material shading is deterministic and never lights the background',()=>{
 const source={width:8,height:8,pixels:new Uint8Array(64).fill(128)},target={width:8,height:8,dither:'ordered' as const};
 const a=lowerRasterMask(source,target),b=lowerRasterMask(source,target);
 assert.deepEqual(a.packed,b.packed);assert.equal(a.pixels.reduce((n,v)=>n+v,0),32);
 assert.equal(lowerRasterMask({...source,pixels:new Uint8Array(64)},target).packed.some(Boolean),false);
});
test('generator feature priority retains a contour before texture at the same resolution',()=>{
 const source={width:4,height:1,pixels:Uint8Array.of(255,128,0,0)},target={width:1,height:1,threshold:.75};
 assert.equal(lowerRasterMask(source,target).pixels[0],0);
 assert.equal(lowerRasterMask({...source,importance:Uint8Array.of(255,0,0,0)},target).pixels[0],1);
});
test('frame batches have stable native strides and reject malformed or unbounded inputs',()=>{
 const result=lowerRasterMaskFrames(Uint8Array.of(255,0,0,255),{width:2,height:1},{width:2,height:1});
 assert.deepEqual([...result],[128,64]);
 assert.throws(()=>lowerRasterMaskFrames(Uint8Array.of(255),{width:2,height:1},{width:2,height:1}),/truncated/);
 assert.throws(()=>lowerRasterMask({width:1,height:1,pixels:[-1]},{width:1,height:1}),/Coverage/);
 assert.throws(()=>lowerRasterMask({width:1,height:1,pixels:[255]},{width:1e9,height:1}),/budget/);
 assert.throws(()=>lowerRasterMask({width:1,height:1,pixels:[255]},{width:1,height:1,pixelAspect:[0,1]}),/aspect/);
});

test('target contours preserve hollow forms while material dither stays inside their occupancy',()=>{
 const shape=new Uint8Array(49),material=new Uint8Array(49);
 for(let y=1;y<6;y++)for(let x=1;x<6;x++)shape[y*7+x]=255;
 shape[3*7+3]=0;material.fill(30);
 const out=lowerRasterMask({width:7,height:7,pixels:material,silhouette:shape},{width:7,height:7,dither:'ordered',outline:'inner'});
 for(let y=0;y<7;y++)for(let x=0;x<7;x++){
  const at=y*7+x;
  if(!shape[at])assert.equal(out.pixels[at],0,'dither must not fill background or the counter');
  if(shape[at]&&(x===1||x===5||y===1||y===5||Math.abs(x-3)+Math.abs(y-3)===1))assert.equal(out.pixels[at],1,'both exterior and counter contours survive');
 }
 assert.throws(()=>lowerRasterMask({width:7,height:7,pixels:material},{width:7,height:7,outline:'inner'}),/silhouette channel/);
 assert.throws(()=>lowerRasterMaskFrames(material,{width:7,height:7,silhouette:new Uint8Array(2)},{width:7,height:7}),/silhouette batch/);
});
import {rasterRelief} from '../src/target-raster.ts';

test('relief preserves faces and counters, clips offsets and fits a one-colour-per-row text kernel',()=>{
 const mask=Uint8Array.from([0,1,1,1,0, 0,1,0,1,0, 0,1,1,1,0]);
 const relief=rasterRelief({width:5,height:3,pixels:mask},[1,1]);
 assert.deepEqual(relief.face,mask);assert.equal(relief.pixels[7],1);
 assert.ok(relief.face.every((v,i)=>!v||relief.depth[i]===0));
 assert.ok(relief.depth.some(Boolean));assert.deepEqual(rasterRelief({width:5,height:3,pixels:mask},[5,0]).depth,new Uint8Array(15));
 const scanlines=new Uint8Array(5*9);
 for(let y=0;y<3;y++)for(let x=0;x<5;x++)if(mask[y*5+x])scanlines[y*15+x]=scanlines[y*15+5+x]=1;
 const native=rasterRelief({width:5,height:9,pixels:scanlines},[1,2],{scanlineTones:[2,2,1]});
 for(let y=0;y<9;y++)assert.ok(new Set([...native.pixels.subarray(y*5,y*5+5)].filter(Boolean)).size<=1,'one TIA playfield colour per scanline');
 for(const offset of [[.5,1],[0,NaN]])assert.throws(()=>rasterRelief({width:5,height:3,pixels:mask},offset as [number,number]),/offset/);
 assert.throws(()=>rasterRelief({width:1,height:1,pixels:[255]}),/binary/);
});
