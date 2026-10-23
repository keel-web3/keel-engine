import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePinballGraphics,createPinballGraphicsGovernor} from '../src/index.ts';
const viewport={width:1440,height:900,pixelRatio:2},device={webgl2:true,maxTextureSize:4096,maxRenderbufferSize:4096,logicalCores:12,deviceMemoryGb:16};
test('pixel art style retains independently selectable rich geometry and lighting',()=>{
 const low=resolvePinballGraphics({viewport,device,quality:'low',style:'pixel'}),high=resolvePinballGraphics({viewport,device,quality:'ultra',style:'pixel'});
 assert.equal(low.style,high.style);assert.equal(low.art.dither,0);assert.equal(high.art.dither,0);
 assert.equal(low.height,240);assert.equal(high.height,640);assert.ok(high.mesh.around*high.mesh.rings>=10*low.mesh.around*low.mesh.rings);
 assert.equal(low.shadows.enabled,false);assert.equal(high.shadows.size,2048);assert.equal(high.lighting.pointLights,16);assert.equal(high.target.hardware,null);
});
test('portrait and landscape fit actual GL caps without changing the requested style',()=>{
 for(const [width,height]of ([[360,800],[800,360],[7680,4320],[640,480]] as const))for(const style of ['pixel','dither','arcade','realistic','cartoon'] as const){
  const plan=resolvePinballGraphics({quality:'ultra',style,viewport:{width,height,pixelRatio:3},device:{...device,maxTextureSize:512,maxRenderbufferSize:256}});
  assert.ok(plan.width<=256&&plan.height<=256);assert.ok(plan.shadows.size<=256);assert.ok(plan.art.textureSize<=512);
  assert.ok(Math.abs(plan.width/plan.height-width/height)<.06);assert.equal(plan.style,style);
 }
});
test('auto is conservative and memory hints cap explicit expensive requests',()=>{
 assert.equal(resolvePinballGraphics({viewport}).quality,'balanced');
 assert.equal(resolvePinballGraphics({viewport,quality:'ultra',device:{...device,deviceMemoryGb:2}}).quality,'low');
 assert.equal(resolvePinballGraphics({viewport,quality:'ultra',device:{...device,logicalCores:4}}).quality,'balanced');
 assert.equal(resolvePinballGraphics({viewport,quality:'auto',device:{...device,saveData:true}}).quality,'low');
 assert.equal(resolvePinballGraphics({viewport,quality:'ultra',device:{...device,saveData:true}}).quality,'ultra');
});
test('reduced motion leaves static high graphics intact and removes moving budgets',()=>{
 const normal=resolvePinballGraphics({viewport,device,quality:'high',style:'dither'}),reduced=resolvePinballGraphics({viewport,device,quality:'high',style:'dither',reducedMotion:true});
 assert.equal(reduced.effects.particles,0);assert.equal(reduced.effects.pulses,0);assert.equal(reduced.effects.movingFoliage,0);
 assert.deepEqual(reduced.mesh,normal.mesh);assert.deepEqual(reduced.shadows,normal.shadows);assert.equal(reduced.targetPlan.quality.particles,0);assert.equal(reduced.art.dither,.9);
});
test('resident cabinet prints obey aggregate atlas memory and actual GL dimensions',()=>{
 for(const quality of ['low','balanced','high','ultra'] as const)for(const cap of [16,256,512,1024,2048,16384]){
  const p=resolvePinballGraphics({viewport,quality,device:{...device,maxTextureSize:cap}}),a=p.art;
  assert.ok(a.atlasMaxHeight<=cap);assert.equal(a.atlasBytes,1024*a.atlasMaxHeight*4);
  assert.ok(a.atlasBytes<=16*1024*1024);assert.ok(a.residentCabinets*a.textureSize**2*4<=a.atlasBytes);
  if(cap<1024){assert.equal(a.residentCabinets,0);assert.equal(a.atlasBytes,0);}
 }
 const low=resolvePinballGraphics({viewport,quality:'low',device}),high=resolvePinballGraphics({viewport,quality:'high',device});
 assert.equal(low.mesh.cacheMeshes,512);assert.equal(low.mesh.cacheBytes,12*1024*1024);
 assert.equal(high.mesh.cacheMeshes,1024);assert.equal(high.mesh.cacheBytes,48*1024*1024);
});
test('plans are immutable and exact repeated inputs reproduce',()=>{
 const a=resolvePinballGraphics({viewport,device,quality:'high',style:'realistic'}),b=resolvePinballGraphics({viewport,device,quality:'high',style:'realistic'});
 assert.equal(JSON.stringify(a),JSON.stringify(b));assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.mesh)&&Object.isFrozen(a.targetPlan.quality));
 assert.throws(()=>{(a.mesh as {around:number}).around=100;});assert.equal(a.lighting.mirror,96);
});
test('malformed numbers, omitted capabilities and lossy objects are rejected before renderer allocation',()=>{
 for(const bad of [NaN,Infinity,-1,0,65537])assert.throws(()=>resolvePinballGraphics({viewport,device:{...device,maxTextureSize:bad}}));
 for(const width of [NaN,0,-1,Infinity])assert.throws(()=>resolvePinballGraphics({viewport:{width,height:900}}));
 assert.throws(()=>resolvePinballGraphics({viewport,device:{...device,webgl2:false}}),/requires WebGL2/);
 assert.throws(()=>resolvePinballGraphics({viewport,device:{webgl2:true} as never}));
 assert.throws(()=>resolvePinballGraphics({viewport,quality:'garbage' as never}));
 let touched=false;const accessor={get viewport(){touched=true;return viewport;}};assert.throws(()=>resolvePinballGraphics(accessor));assert.equal(touched,false);
 assert.throws(()=>resolvePinballGraphics({viewport,[Symbol('extra')]:1} as never));
});
test('measured active slow frames lower automatic presentation with hysteresis',()=>{
 const g=createPinballGraphicsGovernor({initial:'high',automatic:true});let changed;
 for(let n=0;n<150;n++){const r=g.observe(32);if(r.changed)changed=r.changed;}
 assert.equal(g.quality,'balanced');assert.deepEqual(changed,{from:'high',to:'balanced',reason:'frame-budget'});
 for(let n=0;n<200;n++)assert.equal(g.observe(32).changed,null);
});
test('hidden intervals do not degrade graphics and manual selection remains manual',()=>{
 const auto=createPinballGraphicsGovernor({initial:'ultra',automatic:true}),manual=createPinballGraphicsGovernor({initial:'ultra',automatic:false});
 for(let n=0;n<500;n++){auto.observe(500,false);manual.observe(200);}
 assert.equal(auto.quality,'ultra');assert.equal(manual.quality,'ultra');
 assert.throws(()=>auto.observe(NaN));assert.throws(()=>auto.observe(0));
 assert.equal(auto.observe(5000,false).p95Ms,null);
 const stalled=createPinballGraphicsGovernor({initial:'high',automatic:true});for(let n=0;n<150;n++)stalled.observe(5000);assert.equal(stalled.quality,'balanced');
 const options={initial:'high' as const,automatic:false},immutable=createPinballGraphicsGovernor(options);options.automatic=true;
 for(let n=0;n<500;n++)immutable.observe(200);assert.equal(immutable.quality,'high');
});
test('sustained measured recovery cannot exceed the initially admitted quality',()=>{
 const g=createPinballGraphicsGovernor({initial:'balanced',automatic:true});for(let n=0;n<150;n++)g.observe(32);assert.equal(g.quality,'low');
 for(let n=0;n<1800;n++)g.observe(8);assert.equal(g.quality,'balanced');
 for(let n=0;n<1800;n++)assert.equal(g.observe(8).changed,null);
});
