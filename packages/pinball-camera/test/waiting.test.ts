import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballCameraRig,type PinballCameraOptions,type PinballCameraViewport,type PinballCameraSample} from '../src/camera.ts';
import type {ArenaWorldDefinition,ArenaFrame} from '@keel-engine/pinball-arena';

const world={arenas:[{id:'a',stations:[{id:'bank',x:0,y:80,layer:0,elevation:0,launchX:320,launchY:130,flipperIds:['left','right']}],flippers:[{id:'left',pivotX:-60,pivotY:80,length:64,radius:6},{id:'right',pivotX:60,pivotY:80,length:64,radius:6}],surfaces:[{id:'bed',height:0,polygon:[{x:-300,y:0},{x:400,y:0},{x:400,y:1800},{x:-300,y:1800}]}],rails:[],pinball:{ports:[{id:'exit',x:0,y:140,elevation:0}],paths:[]}}]}as unknown as ArenaWorldDefinition;
const frame=(tick:number,active=false,x=320,owned=false):ArenaFrame=>({tick,balls:[{id:'body',ownerId:0,arenaId:'a',stationId:owned?'bank':null,x,y:130,layer:0,elevation:0,vx:0,vy:0,radius:16,active,eliminated:false,transport:null}],stations:[{id:'bank',arenaId:'a',ownerId:owned?0:null}],flippers:[{id:'left',arenaId:'a',ownerId:owned?0:-1,layer:0,pivotX:-60,pivotY:80,tipX:-4,tipY:110,elevation:0,radius:6},{id:'right',arenaId:'a',ownerId:owned?0:-1,layer:0,pivotX:60,pivotY:80,tipX:4,tipY:110,elevation:0,radius:6}]}as unknown as ArenaFrame);
const options:PinballCameraOptions={framing:'adaptive',fitMaximumScale:.75,readability:{ballDiameterPixels:16,ballDiameterCssPixels:20,bladeLengthPixels:32,bladeLengthCssPixels:40,bladeThicknessPixels:4,bladeThicknessCssPixels:6}};
const portrait:PinballCameraViewport={width:320,height:693,cssPixelsPerPixel:1.2178932178932178,safeInsets:{left:12,right:12,top:75,bottom:225}};
function legacyShape(sample:PinballCameraSample){const {waitingPairPreview:_preview,sourceWaitingStationId:_station,...framing}=sample.framing;return JSON.stringify({...sample,framing});}
function history(preview:boolean){const rig=createPinballCameraRig(world,0,{...options,waitingStationPreview:preview});rig.observe(frame(0));rig.observe(frame(1,true));rig.observe(frame(2));return rig;}
function completeBounds(sample:PinballCameraSample,source:ArenaFrame,viewport:PinballCameraViewport){const safe=viewport.safeInsets!;for(const p of source.flippers)for(const point of[[p.pivotX,p.pivotY],[p.tipX,p.tipY]]as const){const [x,y]=sample.project(point[0],point[1],p.elevation),r=p.radius*sample.scale;assert(x-r>=safe.left&&x+r<=viewport.width-safe.right&&y-r>=safe.top&&y+r<=viewport.height-safe.bottom);}const [x,y]=sample.project(320,130,0);assert(x>=safe.left&&x<=viewport.width-safe.right&&y>=safe.top&&y<=viewport.height-safe.bottom);}
test('unleased waiting preview frames complete observed blades and launch origin without native ownership or a visible ball',()=>{
 const before=JSON.stringify(world),native=frame(2),nativeBefore=JSON.stringify(native),rig=history(true),sample=rig.sample(portrait);assert(sample.framing.waitingPairPreview);assert.equal(sample.framing.sourceWaitingStationId,'bank');assert.equal(sample.framing.ballInSafeArea,null);assert.equal(sample.framing.pairApplicable,false);assert.equal(sample.framing.retainedPair,false);assert.equal(sample.retainPair,false);assert.equal(sample.body.active,false);completeBounds(sample,native,portrait);
 const old=history(false).sample(portrait),left=old.project(-60,80,0);assert(left[0]-6*old.scale<portrait.safeInsets!.left,'fixture exposes the original cut left blade');assert.equal(JSON.stringify(world),before);assert.equal(JSON.stringify(native),nativeBefore);
 const [x,y]=sample.project(0,130,0),[xx]=sample.project(20,130,0),[,yy]=sample.project(0,150,0);assert(Math.abs(xx-x+yy-y)<=1,'one uniform XY ground-plane scale');
});
test('initial prelaunch, explicit overview and active owned pair retain their legacy geometry',()=>{
 for(const introTicks of[0,96]){const a=createPinballCameraRig(world,0,{...options,introTicks}),b=createPinballCameraRig(world,0,{...options,introTicks,waitingStationPreview:true});a.observe(frame(0));b.observe(frame(0));assert.equal(legacyShape(b.sample(portrait)),legacyShape(a.sample(portrait)));assert.equal(b.sample(portrait).framing.waitingPairPreview,false);}
 const a=history(false),b=history(true),overview={...portrait,mode:'overview' as const};assert.equal(legacyShape(a.sample(overview)),legacyShape(b.sample(overview)));assert.equal(b.sample(overview).framing.waitingPairPreview,false);
 const active=frame(3,true,0,true);a.observe(active);b.observe(active);const c=b.sample(portrait);assert(c.framing.pairApplicable&&c.retainPair);assert.equal(c.framing.waitingPairPreview,false);assert.equal(legacyShape(c),legacyShape(a.sample(portrait)));
});
test('late waiting joins are supported; cramped, incomplete or different-layer pairs are not admitted',()=>{
 const rig=createPinballCameraRig(world,0,{...options,introTicks:96,waitingStationPreview:true});rig.reset(frame(300));assert(rig.sample(portrait).framing.waitingPairPreview);assert(rig.sample(portrait).framing.introSkipped);
 const small={width:128,height:128,cssPixelsPerPixel:1};assert.equal(rig.sample(small).framing.waitingPairPreview,false);
 for(const native of[{...frame(301),flippers:frame(301).flippers.slice(0,1)},{...frame(302),balls:frame(302).balls.map(b=>({...b,layer:1}))}]){rig.reset(native);assert.equal(rig.sample(portrait).framing.waitingPairPreview,false);}
});
test('eliminated and native transport frames never become waiting pair previews',()=>{
 const rig=createPinballCameraRig(world,0,{...options,waitingStationPreview:true});const dead={...frame(300),balls:frame(300).balls.map(b=>({...b,eliminated:true}))};rig.reset(dead);assert.equal(rig.sample(portrait).framing.waitingPairPreview,false);assert.equal(rig.sample(portrait).framing.sourceWaitingStationId,null);
 const base=frame(3),transport={phase:'captured',phaseTick:2,entryTick:1,plannedReleaseTick:100,exitArenaId:'a',exitPortId:'exit',mechanismId:'capture'};rig.reset({...base,balls:base.balls.map(b=>({...b,transport}))}as unknown as ArenaFrame);const c=rig.sample(portrait);assert.equal(c.framing.waitingPairPreview,false);assert.equal(c.framing.sourceWaitingStationId,null);assert.equal(c.framing.ballInSafeArea,null);
});
test('waiting sampling, resize and overview cadence never advance native camera history',()=>{
 const a=history(true),b=history(true),before=JSON.stringify(frame(2));for(let i=0;i<20;i++){a.sample(portrait);a.sample({...portrait,width:768,height:432,cssPixelsPerPixel:5/3,safeInsets:{left:12,right:12,top:47,bottom:94}});a.sample({...portrait,mode:'overview'});}assert.equal(legacyShape(a.sample(portrait)),legacyShape(b.sample(portrait)));assert.equal(a.tick,2);assert.equal(JSON.stringify(frame(2)),before);
 for(const invalid of[null,1,'true',{}])assert.throws(()=>createPinballCameraRig(world,0,{...options,waitingStationPreview:invalid as boolean}),/waiting station preview/);
});
