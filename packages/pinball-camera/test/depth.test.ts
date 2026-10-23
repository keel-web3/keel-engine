import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballCameraRig} from '../src/camera.ts';
import type {ArenaWorldDefinition,ArenaFrame} from '../../pinball-arena/src/types.ts';

const world={arenas:[{id:'a',stations:[{id:'bank',x:0,y:0,elevation:80,flipperIds:['left','right']}],flippers:[{id:'left',pivotX:-90,pivotY:0,length:96,radius:8},{id:'right',pivotX:90,pivotY:0,length:96,radius:8}],surfaces:[{height:80,polygon:[{x:-288,y:-120},{x:288,y:-120},{x:288,y:1600},{x:-288,y:1600}]}],rails:[]}]} as unknown as ArenaWorldDefinition;
const frame=(tick:number,x:number,y:number):ArenaFrame=>({tick,balls:[{id:'body',ownerId:0,arenaId:'a',stationId:'bank',x,y,elevation:80,vx:3,vy:4,radius:16,active:true,eliminated:false,transport:null}],stations:[{id:'bank',arenaId:'a',ownerId:0}],flippers:[{id:'left',arenaId:'a',ownerId:0,pivotX:-90,pivotY:0,tipX:-2,tipY:32,elevation:80,radius:8},{id:'right',arenaId:'a',ownerId:0,pivotX:90,pivotY:0,tipX:2,tipY:32,elevation:80,radius:8}]} as unknown as ArenaFrame);
const view={width:320,height:692,cssPixelsPerPixel:1.21875,safeInsets:{left:12,right:12,top:34,bottom:68}};
test('depth changes one common orthographic view; actual balls, blades and inverse remain aligned',()=>{
 const rig=createPinballCameraRig(world,0,{framing:'adaptive',depthMotion:{}});
 for(let tick=0;tick<240;tick++){
  const f=frame(tick,Math.sin(tick/40)*180,120+tick*3),digest=JSON.stringify(f);rig.observe(f);
  const c=rig.sample(view),d=c.framing.depthMotion!;
  assert(c.framing.ballInSafeArea);
  assert(Math.abs(d.elevationRatio-.8)<=.020000001);
  assert(Math.abs(d.translation[0]!)<=6.000000001&&Math.abs(d.translation[1]!)<=3.000000001);
  for(const point of [{x:f.balls[0]!.x,y:f.balls[0]!.y,z:80},...f.flippers.map(p=>({x:p.tipX,y:p.tipY,z:p.elevation})),{x:50,y:300,z:240}]){
   const p=c.project(point.x,point.y,point.z),back=c.viewToPlane(p[0],p[1],point.z);
   assert(Math.abs(back[0]-point.x)<=.500001/c.scale&&Math.abs(back[1]-point.y)<=.500001/c.scale);
   assert.deepEqual(p,[Math.round(point.x*c.scale-c.left),Math.round(-point.y*c.scale-point.z*c.elevationScale-c.top)]);
  }
  assert.equal(JSON.stringify(f),digest);
 }
});
test('native clock depth reproduces across replay and repeated sampling never advances it',()=>{
 const a=createPinballCameraRig(world,0,{depthMotion:{}}),b=createPinballCameraRig(world,0,{depthMotion:{}});
 const frames=Array.from({length:80},(_,i)=>frame(i,i*2,200+i*4));
 for(const f of frames){a.observe(f);a.sample(view);a.sample({...view,width:768,height:640});b.observe(f);}
 assert.deepEqual(a.sample(view).framing,b.sample(view).framing);
 a.reset();for(const f of frames)a.observe(f);
 assert.deepEqual(a.sample(view).framing,b.sample(view).framing);
});
test('a displayed sample retains its projection and inverse after later native observations and resets',()=>{
 const rig=createPinballCameraRig(world,0,{depthMotion:{}});rig.observe(frame(0,0,200));
 const c=rig.sample(view),point=c.project(120,600,240),inverse=c.viewToPlane(100,200,80),metadata=JSON.stringify(c.framing);
 for(let i=1;i<80;i++)rig.observe(frame(i,200,1400));
 assert.deepEqual(c.project(120,600,240),point);assert.deepEqual(c.viewToPlane(100,200,80),inverse);assert.equal(JSON.stringify(c.framing),metadata);
 rig.reset(frame(0,-100,-50));assert.deepEqual(c.project(120,600,240),point);assert.deepEqual(c.viewToPlane(100,200,80),inverse);
});
test('disabled depth keeps the legacy presentation; malformed or excessive motion fails before observation',()=>{
 const a=createPinballCameraRig(world,0),b=createPinballCameraRig(world,0,{depthMotion:{maximumTranslationPixels:0,maximumElevationRatioDelta:0}});
 for(let i=0;i<40;i++){const f=frame(i,i,200+i);a.observe(f);b.observe(f);}
 const x=a.sample(view),y=b.sample(view);for(const key of ['scale','elevationScale','left','top'] as const)assert.equal(x[key],y[key]);
 assert.deepEqual(x.project(123,456,240),y.project(123,456,240));assert.equal(x.framing.depthMotion,undefined);
 for(const depthMotion of [{maximumTranslationPixels:9},{maximumElevationRatioDelta:.021},{dampingTicks:0},{maximumTranslationPixels:NaN}])assert.throws(()=>createPinballCameraRig(world,0,{depthMotion}));
});
test('rejected native transport never partially advances depth or replay history',()=>{
 const a=createPinballCameraRig(world,0,{depthMotion:{}}),b=createPinballCameraRig(world,0,{depthMotion:{}}),f=frame(0,0,200);
 a.observe(f);b.observe(f);const before=a.sample(view).framing;
 const invalid=frame(1,240,1300);(invalid.balls[0] as any).transport={phaseTick:2,entryTick:1};
 assert.throws(()=>a.observe(invalid));assert.equal(a.tick,0);assert.deepEqual(a.sample(view).framing,before);
 const valid=frame(1,240,1300);a.observe(valid);b.observe(valid);assert.deepEqual(a.sample(view).framing,b.sample(view).framing);
});
