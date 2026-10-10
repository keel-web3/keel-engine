import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileTrack} from '../src/tracks.ts';
import {inspectPinballGeometry} from '../src/admission-geometry.ts';
import {generateQualifiedPinballMachine,replayPinballReceipt,PinballGenerationError} from '../src/qualified.ts';
import {field} from '../../pinball-arena/test/fixtures.ts';
const biome={forge:1,neon:0,garden:0,glacier:0,ruins:0};
const vertex=(x:number,y:number,elevation:number,layer:number)=>({x,y,elevation,layer});
test('native ramp halves, transverse landings and referenced port support agree in both directions',()=>{
 for(const vertices of [
  [vertex(300,300,0,0),vertex(300,600,100,1)],
  [vertex(300,300,100,1),vertex(300,600,0,0)],
  [vertex(200,200,0,0),vertex(300,300,0,0),vertex(300,600,100,1),vertex(450,700,100,1)],
  [vertex(200,200,100,1),vertex(300,300,100,1),vertex(300,600,0,0),vertex(450,700,0,0)],
 ]){
  const track=compileTrack({id:'track',role:'travel',vertices,clearWidth:64,biome}),f=field({rails:track.rails,ramps:track.ramps,surfaces:track.surfaces,pinball:{paths:[track.path],ports:track.ports}});
  assert.deepEqual(inspectPinballGeometry(f,{ballRadius:12}),[]);
  const slopeIndex=vertices.findIndex((v,i)=>vertices[i+1]&&vertices[i+1]!.elevation!==v.elevation),native=track.ramps[0]!;
  assert.equal(track.rails.filter(r=>r.id.startsWith(`track.rail.${slopeIndex}.`))[0]!.layer,native.fromLayer);
  assert(track.surfaces.some(s=>s.rampId===native.id&&s.vertexElevations));
  assert(track.ports[1]!.surfaceIds.some(id=>track.surfaces.find(s=>s.id===id)?.polygon.some(p=>Math.hypot(p.x-vertices.at(-1)!.x,p.y-vertices.at(-1)!.y)<40)));
 }
});
test('real shooter, timed distinct paths and right-blade return control replay exactly',()=>{
 const c=generateQualifiedPinballMachine('0x2026',{maxAttempts:4,maxPairs:1});
 assert.equal(c.admission.baseline.events.filter(e=>e.type==='route-complete'&&!e.colliderId?.endsWith('launch.skillshot')).length,0);
 for(const receipt of [c.admission.orbit,c.admission.crossReturn,c.admission.rightControl]){assert.equal(receipt.failure,null);assert.equal(receipt.contactBudget,0);assert.equal(replayPinballReceipt(c.world,receipt).digest,receipt.digest);}
 assert(c.admission.crossReturn.events.some(e=>e.type==='ramp-enter'&&e.colliderId?.includes('cross-return')));
 assert(c.admission.crossReturn.events.some(e=>e.type==='ramp-exit'&&c.world.arenas[0]!.ramps.some(r=>r.id===e.colliderId&&r.toElevation<r.fromElevation)));
 for(const window of [c.admission.orbitWindow,c.admission.crossReturnWindow]){assert.equal(window.toTick-window.fromTick,7);assert.equal(window.holdTicks,120);assert.equal(window.witnesses.length,8);for(const [i,r] of window.witnesses.entries()){assert.deepEqual(r.inputs[1],{fromTick:window.fromTick+i,toTick:window.fromTick+i+119,bits:window.bits});assert.equal(r.failure,null);assert.equal(r.contactBudget,0);assert.equal(replayPinballReceipt(c.world,r).digest,r.digest);assert.equal(r.routeId,window.witnesses[0]!.routeId);}}
 assert.equal(c.admission.orbitWindow.bits,1);assert.equal(c.admission.crossReturnWindow.bits,3);
 assert.notDeepEqual(c.admission.orbit.inputs,c.admission.crossReturn.inputs);
 assert(c.admission.rightControl.control.vy>6&&c.admission.rightControl.control.contactTick>c.admission.crossReturn.firstCatchTick!);
 assert.equal(c.admission.rightControl.control.flipperId,'pinball-machine.catch.right');
 assert(c.admission.rightControl.control.returnTick>c.admission.rightControl.control.contactTick+8);
 assert.throws(()=>replayPinballReceipt(c.world,{ticks:Infinity,inputs:[]}),/budget/);
 assert.throws(()=>replayPinballReceipt(c.world,{ticks:10,inputs:[{fromTick:0,toTick:10,bits:4}]}),/span/);
 assert.throws(()=>replayPinballReceipt(c.world,{ticks:10,inputs:[{fromTick:1,toTick:11,bits:4}]}),/span/);
 assert.throws(()=>replayPinballReceipt(c.world,{ticks:10,inputs:[{fromTick:1,toTick:10,bits:64}]}),/span/);
});
test('bounded physical exhaustion rejects instead of publishing a fallback',()=>{
 assert.throws(()=>generateQualifiedPinballMachine('0xbeef',{maxAttempts:1,maxPairs:1}),PinballGenerationError);
 assert.throws(()=>generateQualifiedPinballMachine('0x2026',{maxAttempts:Infinity}),/budget/);
});

test('horizontal intake profile is physical and a sloped support cannot secretly widen',()=>{
 const vertices=[vertex(300,200,0,0),vertex(300,400,0,0),vertex(300,700,100,1)];
 const track=compileTrack({id:'taper',role:'cross-return',vertices,clearWidth:64,clearWidths:[160,64,64],deck:'wireform',biome});
 assert.equal(track.ports[0]!.clearWidth,160);assert.equal(track.ports[1]!.clearWidth,64);assert.equal(track.ramps[0]!.width,76);
 assert(track.surfaces.filter(s=>s.rampId||s.height>0).every(s=>s.material==='wireform-track'));
 assert.deepEqual(inspectPinballGeometry(field({rails:track.rails,ramps:track.ramps,surfaces:track.surfaces,pinball:{paths:[track.path],ports:track.ports}}),{ballRadius:12}),[]);
 assert.throws(()=>compileTrack({id:'hidden',role:'travel',vertices:vertices.slice(1),clearWidth:64,clearWidths:[160,64],biome}),/uniform/);
});
