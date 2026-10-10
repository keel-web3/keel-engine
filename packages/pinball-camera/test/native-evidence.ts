import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPinballCameraRig} from '../src/camera.ts';
import {decodeArenaReplay,createArenaReplayPlayer} from '@keel-engine/pinball-replay';
const root=process.env.CAMERA_EVIDENCE_ROOT!;
assert(root,'Run with CAMERA_EVIDENCE_ROOT pointing at a frozen native checkpoint');
const tapeName=process.env.CAMERA_EVIDENCE_TAPE!,bytes=readFileSync(root+'/qualification/'+tapeName+'.kpr'),tape=decodeArenaReplay(bytes),player=createArenaReplayPlayer(tape),rig=createPinballCameraRig(tape.world,tape.players[0]!.ownerId),sparse=createPinballCameraRig(tape.world,tape.players[0]!.ownerId);
const viewports=[{width:320,height:480,safeInsets:{left:14,right:14,top:28,bottom:106}},{width:320,height:800,safeInsets:{left:14,right:14,top:28,bottom:106}},{width:512,height:320,safeInsets:{left:14,right:14,top:24,bottom:59}},{width:720,height:320,safeInsets:{left:14,right:14,top:24,bottom:80}}] as const;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),summary:any={tapeSha256:createHash('sha256').update(bytes).digest('hex'),world:tape.world.sha256,authority:tape.authority,kernel:tape.kernel,frames:0,samples:0,retained:0,travel:0,bridges:0,minScale:Infinity,maxScale:0,minBallPixels:Infinity,nearPairSamples:0,discontinuities:0};
const observed:any[]=[],expected:string[]=[];
while(!player.complete){const frame=player.step(),before=hash(frame);observed.push(frame);rig.observe(frame);sparse.observe(frame);const samples=viewports.map(v=>rig.sample(v));expected.push(hash(samples.map(v=>v.framing)));for(const [i,c]of samples.entries()){
 const v=viewports[i]!;summary.samples++;summary.minScale=Math.min(summary.minScale,c.scale);summary.maxScale=Math.max(summary.maxScale,c.scale);summary.minBallPixels=Math.min(summary.minBallPixels,c.framing.ballDiameterPixels);assert(c.framing.usefulZoom,'useful follow scale');if(c.framing.ballInSafeArea!==null)assert(c.framing.ballInSafeArea,'actual ball visible at '+frame.tick);assert.equal(c.body,frame.balls[0]);assert(Math.abs(c.elevationScale/c.scale-.8)<1e-12);assert(c.framing.cachedFrames<=1);if(c.framing.sourceDiscontinuity)summary.discontinuities++;
 const x=c.project(100,0,0),y=c.project(0,100,0),origin=c.project(0,0,0);assert(Math.abs((x[0]-origin[0])+(y[1]-origin[1]))<=1,'uniform XY');
 if(c.retainPair){summary.retained++;summary.nearPairSamples++;for(const p of frame.flippers.filter(f=>f.arenaId===c.field.id&&c.station.flipperIds.includes(f.id)))for(const q of[c.project(p.pivotX,p.pivotY,p.elevation),c.project(p.tipX,p.tipY,p.elevation)]){assert(q[0]-p.radius*c.scale>=v.safeInsets.left&&q[0]+p.radius*c.scale<=v.width-v.safeInsets.right,'blade horizontal safety');assert(q[1]-p.radius*c.scale>=v.safeInsets.top&&q[1]+p.radius*c.scale<=v.height-v.safeInsets.bottom,'blade vertical safety');}}
 if(c.body.active&&c.body.stationId===null){summary.travel++;assert(!c.retainPair,'remote travel releases pair');}if(c.transportBridge)summary.bridges++;
 // Extra renders, overview and resizes cannot perturb the next follow render.
 rig.sample({width:900,height:900,mode:'overview'});assert.deepEqual(rig.sample(v).framing,c.framing);
 if(frame.tick%11===0)assert.deepEqual(sparse.sample(v).framing,c.framing,'render cadence independence');
 }assert.equal(hash(frame),before,'source immutability');summary.frames++;}
rig.reset();for(const [i,f]of observed.entries()){rig.observe(f);assert.equal(hash(viewports.map(v=>rig.sample(v).framing)),expected[i],'replay reset reproducibility');}
rig.observe(observed[2]);assert(rig.sample(viewports[0]).framing.sourceDiscontinuity,'rewind resets');rig.reset(observed[2]);assert(!rig.sample(viewports[0]).framing.sourceDiscontinuity);
assert.throws(()=>rig.sample({...viewports[0],width:NaN}));assert.throws(()=>rig.sample({...viewports[0],safeInsets:{left:200,right:200,top:0,bottom:0}}));assert.throws(()=>rig.observe({...observed[3],balls:[{...observed[3].balls[0],x:NaN}]}));assert.throws(()=>createPinballCameraRig(tape.world,0,{scale:Infinity}));
// Enlarging distant geometry must not alter follow framing.
const huge=structuredClone(tape.world);(huge.arenas[0]!.surfaces[0]!.polygon as any).push({x:65000,y:65000});const large=createPinballCameraRig(huge,tape.players[0]!.ownerId);large.observe(observed[0]);rig.reset(observed[0]);assert.deepEqual(large.sample(viewports[0]).framing,rig.sample(viewports[0]).framing);
assert(summary.nearPairSamples>0);summary.scope='Exact frozen authority tape replay and deterministic camera assertions; no device, art or whole-game approval';writeFileSync(process.env.CAMERA_EVIDENCE_OUT!,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
