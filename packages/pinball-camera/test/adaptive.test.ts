import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballCameraRig} from '../src/camera.ts';
import type {ArenaWorldDefinition,ArenaFrame} from '../../pinball-arena/src/types.ts';
const world=(height:number)=>({arenas:[{id:'a',stations:[{id:'bank',x:0,y:80,elevation:0,flipperIds:['left','right']}],flippers:[{id:'left',pivotX:-60,pivotY:80,length:64,radius:6},{id:'right',pivotX:60,pivotY:80,length:64,radius:6}],surfaces:[{id:'bed',height:0,polygon:[{x:-180,y:0},{x:180,y:0},{x:180,y:height},{x:-180,y:height}]}],rails:[]}]} as unknown as ArenaWorldDefinition);
const frame=(tick:number,y=140,x=0):ArenaFrame=>({tick,balls:[{id:'body',ownerId:0,arenaId:'a',stationId:'bank',x,y,elevation:0,vx:0,vy:0,radius:16,active:true,eliminated:false,transport:null}],stations:[{id:'bank',arenaId:'a',ownerId:0}],flippers:[{id:'left',arenaId:'a',ownerId:0,pivotX:-60,pivotY:80,tipX:-4,tipY:110,elevation:0,radius:6},{id:'right',arenaId:'a',ownerId:0,pivotX:60,pivotY:80,tipX:4,tipY:110,elevation:0,radius:6}]} as unknown as ArenaFrame);
const wide={width:768,height:720,cssPixelsPerPixel:1.5};
test('readable complete court stays fixed after launch and as the ball traverses it',()=>{
 const rig=createPinballCameraRig(world(1000),0,{framing:'adaptive',introTicks:96});rig.observe(frame(0));const first=rig.sample(wide);
 assert.equal(first.framing.mode,'fit');assert(first.framing.ballDiameterPixels>=8);assert(first.framing.ballDiameterCssPixels>=12);
 for(let tick=1;tick<=200;tick++){rig.observe(frame(tick,140+tick*4));const next=rig.sample(wide);assert.equal(next.framing.mode,'fit');assert.equal(next.scale,first.scale);assert.equal(next.left,first.left);assert.equal(next.top,first.top);assert(next.framing.ballInSafeArea);}
});
test('small screens follow a long court without compressing the whole court into its height',()=>{
 const rig=createPinballCameraRig(world(2400),0,{framing:'adaptive'});rig.observe(frame(0));const small=rig.sample({width:320,height:480,cssPixelsPerPixel:1.4});
 assert.equal(small.framing.mode,'follow');assert(small.scale>small.framing.fitScale*1.8);assert(small.framing.ballInSafeArea);assert(small.retainPair);
 const tall=rig.sample({width:768,height:1600,cssPixelsPerPixel:1.5});assert.equal(tall.framing.mode,'fit');
});
test('CSS readability can require follow even if logical raster pixels fit',()=>{
 const rig=createPinballCameraRig(world(1000),0,{framing:'adaptive'});rig.observe(frame(0));assert.equal(rig.sample(wide).framing.mode,'fit');
 const downsampled=rig.sample({...wide,cssPixelsPerPixel:.6});assert.equal(downsampled.framing.mode,'follow');assert(downsampled.framing.ballDiameterCssPixels>=12);
});
test('off-envelope travel safely follows without changing the cached playfield envelope',()=>{
 const rig=createPinballCameraRig(world(1000),0,{framing:'adaptive'});rig.observe(frame(0));const initial=rig.sample(wide);
 rig.observe(frame(1,3000,4000));const far=rig.sample(wide);assert.equal(far.framing.mode,'follow');assert(far.framing.ballInSafeArea);assert.deepEqual(far.framing.playfieldBounds,initial.framing.playfieldBounds);
 rig.observe(frame(2));const back=rig.sample(wide);assert.equal(back.framing.mode,'fit');assert.equal(back.left,initial.left);assert.equal(back.top,initial.top);
});
test('manual overview and invalid adaptive inputs retain explicit boundaries',()=>{
 const rig=createPinballCameraRig(world(2400),0,{framing:'adaptive'});rig.observe(frame(0));assert.equal(rig.sample({...wide,mode:'overview'}).framing.mode,'overview');
 assert.throws(()=>rig.sample({...wide,cssPixelsPerPixel:NaN}));assert.throws(()=>createPinballCameraRig(world(1000),0,{framing:'bad' as any}));
});
const arcade={ballDiameterPixels:16,ballDiameterCssPixels:20,bladeLengthPixels:32,bladeLengthCssPixels:40,bladeThicknessPixels:4,bladeThicknessCssPixels:6};
test('arcade readability follows at HUD-constrained height but fits when the complete field is legible',()=>{
 const rig=createPinballCameraRig(world(1260),0,{framing:'adaptive',readability:arcade,fitMaximumScale:.75});rig.observe(frame(0));
 const short=rig.sample({width:768,height:432,cssPixelsPerPixel:1.5,safeInsets:{left:12,right:12,top:24,bottom:100}});
 assert.equal(short.framing.mode,'follow');assert(short.framing.usefulZoom);assert(short.framing.ballDiameterPixels>=16);assert(short.framing.minimumBladeLengthPixels>=32);assert(short.framing.minimumBladeThicknessCssPixels>=6);assert(short.framing.ballInSafeArea);assert(short.retainPair);
 const full=rig.sample({width:768,height:960,cssPixelsPerPixel:1.5});assert.equal(full.framing.mode,'fit');assert(full.scale>.4375,'independent fit ceiling permits a readable whole table');assert(full.framing.fullPlayfieldReadable);assert(full.framing.ballInSafeArea);
});
test('arcade profile preserves ground-plane proportions and reports constrained safety instead of false readability',()=>{
 const rig=createPinballCameraRig(world(1260),0,{framing:'adaptive',readability:arcade,fitMaximumScale:.75});rig.observe(frame(0));
 const portrait=rig.sample({width:320,height:693,cssPixelsPerPixel:1.2,safeInsets:{left:12,right:12,top:80,bottom:200}});assert.equal(portrait.framing.mode,'follow');assert(portrait.framing.ballInSafeArea);assert(portrait.retainPair);assert(portrait.framing.usefulZoom);
 const [x,y]=portrait.project(0,140,0),[xx]=portrait.project(20,140,0),[,yy]=portrait.project(0,160,0);assert(Math.abs((xx-x)+(yy-y))<=1);
 const cramped=rig.sample({width:320,height:200,cssPixelsPerPixel:1.2,safeInsets:{left:12,right:12,top:80,bottom:72}});assert(cramped.framing.ballInSafeArea);assert.equal(cramped.framing.usefulZoom,false);assert.equal(cramped.framing.fullPlayfieldReadable,false);
 assert.throws(()=>createPinballCameraRig(world(1260),0,{readability:{ballDiameterPixels:NaN}}));assert.throws(()=>createPinballCameraRig(world(1260),0,{fitMaximumScale:0}));
});
