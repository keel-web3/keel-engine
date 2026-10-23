import test from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch} from '@keel-engine/pinball-arena';
import {pairedFlipperWorld,player} from '../../pinball-arena/test/fixtures.ts';
import {createPinballPixelView,fitPixelViewport,type PixelFrameProvider,type PixelViewScaling} from '../src/index.ts';
import {createCanvasHarness} from './canvas-harness.ts';

const near=(a:number,b:number)=>assert(Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b)),`${a} differs from ${b}`);
test('nearest fit fills the available limiting edge at one uniform scale',()=>{
 const actual=fitPixelViewport(1280,720,768,432,1,'nearest-fit');near(actual.drawWidth,1280);near(actual.drawHeight,720);near(actual.x,0);near(actual.y,0);near(actual.scale,5/3);assert.equal(actual.integerScale,false);
 const historical=fitPixelViewport(1280,720,768,432);assert.equal(historical.scale,1);assert.deepEqual([historical.x,historical.y,historical.drawWidth,historical.drawHeight],[256,144,768,432]);
 for(const [w,h,lw,lh,dpr]of [[390,844,320,480,1],[1281,721,768,432,1],[390.25,843.75,320,480,1.25],[844,390,768,432,2],[320,240,384,448,.8],[1,1,1024,1,1]]as const){
  const v=fitPixelViewport(w,h,lw,lh,dpr,'nearest-fit');near(v.drawWidth/lw,v.drawHeight/lh);near(v.drawWidth/lw,v.scale);near(v.x*2+v.drawWidth,v.width);near(v.y*2+v.drawHeight,v.height);assert(v.drawWidth<=v.width+1e-9&&v.drawHeight<=v.height+1e-9);near(Math.max(v.drawWidth/v.width,v.drawHeight/v.height),1);
 }
});
test('nearest fit keeps the existing backing limits and reports whole-pixel replication accurately',()=>{
 for(const [w,h,dpr]of [[8000,8000,3],[32768,32768,3],[32768,4000,2],[4000,32768,1.25]]as const){const v=fitPixelViewport(w,h,768,432,dpr,'nearest-fit');assert(v.backingReduced);assert(v.width<=8192&&v.height<=8192&&v.width*v.height<=16777216);assert(v.effectiveDpr<dpr);near(v.drawWidth/768,v.drawHeight/432);}
 assert.equal(fitPixelViewport(1536,864,768,432,1,'nearest-fit').integerScale,true);
 assert.equal(fitPixelViewport(320,240,768,432,1,'nearest-fit').integerScale,false);
 for(const bad of [null,'fill','nearest',true,1,{}])assert.throws(()=>fitPixelViewport(1280,720,768,432,1,bad as PixelViewScaling),/scaling/);
});
test('invalid scaling rejects before any canvas work; failed resize retains the admitted fit',()=>{
 const provider:PixelFrameProvider=request=>({width:3,height:2,indices:new Uint8Array([0,1,0,1,0,1]),palette:[[0,0,0],[255,240,32]],worldSha256:request.world.sha256,tick:request.frame.tick});
 for(const scaling of [null,'fill',1,{}]){const h=createCanvasHarness();assert.throws(()=>createPinballPixelView(h.canvas,{ownerId:0,width:11,height:7,provider,scaling:scaling as PixelViewScaling}),/scaling/);assert.deepEqual(h.calls,[]);assert.deepEqual([h.canvas.width,h.canvas.height],[300,150]);}
 const world=pairedFlipperWorld(),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:120}),h=createCanvasHarness(),view=createPinballPixelView(h.canvas,{ownerId:0,width:11,height:7,provider,scaling:'nearest-fit'});
 view.setWorld(world);view.update(match.readFrame());view.render();assert.deepEqual(h.calls.find(call=>call[0]==='draw'),['draw',.25,0,10.5,7]);assert.equal(h.context.imageSmoothingEnabled,false);assert.deepEqual(h.style,{width:'100%',height:'100%'});
 const before=structuredClone(view.getStats()),calls=h.calls.length;assert.throws(()=>view.resize(NaN,100));assert.throws(()=>view.resize(100,100,4));assert.equal(h.calls.length,calls);assert.deepEqual(view.getStats(),before);
 view.render();assert.deepEqual(view.getStats().viewport,before.viewport);view.dispose();
});


test('the actual view presents a tall portrait provider without shrinking its logical aspect or raising its pixel cap',()=>{
 const w=pairedFlipperWorld(),match=createArenaMatch(w,{players:[player()],mode:'expedition',maxTicks:120}),h=createCanvasHarness();let invalid=false;const provider:PixelFrameProvider=r=>({width:320,height:invalid?1600:1312,indices:new Uint8Array(320*(invalid?1600:1312)),palette:[[12,24,36]],worldSha256:r.world.sha256,tick:r.frame.tick});
 const v=createPinballPixelView(h.canvas,{provider,ownerId:0,width:390,height:1600,maxPixels:491520,scaling:'nearest-fit'});v.setWorld(w);v.update(match.readFrame());v.render();assert.deepEqual(h.calls.find(call=>call[0]==='draw'),['draw',0,.5,390,1599]);assert.equal(v.getStats().logicalHeight,1312);assert.equal(v.getStats().rasterBytes,320*1312*4);assert.equal(h.context.imageSmoothingEnabled,false);
 const before=structuredClone(v.getStats()),calls=h.calls.length;invalid=true;assert.throws(()=>v.render(),/raster budget/);assert.equal(h.calls.length,calls);assert.deepEqual(v.getStats(),before);v.dispose();
});
