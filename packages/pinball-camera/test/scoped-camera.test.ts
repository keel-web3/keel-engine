import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballCameraRig} from '../src/camera.ts';
import type {ArenaWorldDefinition,ArenaFrame} from '../../pinball-arena/src/types.ts';
import type {PlayfieldFramingDefinition} from '../src/playfield-framing-v2.ts';

const bed=(id:string,x:number)=>({id,kind:'playfield',height:80,layer:0,polygon:[{x,y:0},{x:x+600,y:0},{x:x+600,y:1200},{x,y:1200}]});
const bank=(id:string,x:number)=>({id,x,y:100,layer:0,elevation:80,launchX:x,launchY:100,flipperIds:[id+'.left',id+'.right']});
const blade=(id:string,x:number)=>({id,pivotX:x,pivotY:100,layer:0,elevation:80,length:64,radius:6});
const field={id:'field',surfaces:[bed('a.bed',0),bed('b.bed',600)],rails:[],stations:[bank('a.bank',500),bank('b.bank',900)],flippers:[blade('a.bank.left',420),blade('a.bank.right',540),blade('b.bank.left',820),blade('b.bank.right',980)],pinball:{paths:[],ports:[]}};
const world={arenas:[field]} as unknown as ArenaWorldDefinition;
const scopes:PlayfieldFramingDefinition={rooms:['a','b'].map(id=>({id,arenaId:'field',bedId:id+'.bed',bankIds:[id+'.bank'],surfaceIds:[id+'.bed'],railIds:[],stationIds:[id+'.bank'],flipperIds:[id+'.bank.left',id+'.bank.right'],pathIds:[],portIds:[]}))};
function frame(x:number,y=130,stationId:string|null='a.bank',tick=0):ArenaFrame{
 return{tick,balls:[{id:'body',ownerId:0,arenaId:'field',x,y,layer:0,elevation:80,radius:16,vx:0,vy:0,active:true,eliminated:false,transport:null,rampId:null,stationId}],stations:field.stations.map(s=>({id:s.id,arenaId:'field',ownerId:s.id===stationId?0:null})),flippers:field.flippers.map(f=>({...f,arenaId:'field',ownerId:f.id.startsWith(stationId??'!')?0:null,angle:0,tipX:f.pivotX+(f.id.endsWith('left')?60:-60),tipY:f.pivotY}))} as unknown as ArenaFrame;
}
const options={framing:'adaptive' as const,fitMaximumScale:.75,readability:{ballDiameterPixels:16,ballDiameterCssPixels:20,bladeLengthPixels:32,bladeLengthCssPixels:40},playfieldFraming:scopes};

test('scoped fit never crops a still-owned bank from the adjacent native room',()=>{
 const rig=createPinballCameraRig(world,0,options);rig.observe(frame(620));const c=rig.sample({width:600,height:1000,cssPixelsPerPixel:1,safeInsets:{left:12,right:12,top:34,bottom:68}});
 assert(c.framing.fitScale>=c.framing.readableScale,'The scoped room can fit readably; only the still-owned outside pair prevents fit');
 assert(c.pair.some(p=>p.pivotX<c.framing.sourceFraming!.scopedBounds!.x0),'The actual retained pair extends outside the newly supported room');
 assert.equal(c.framing.sourceFraming!.selection!.kind,'room');assert.equal(c.framing.mode,'follow');assert(c.framing.pairApplicable);assert(c.framing.retainedPair);assert(c.framing.ballInSafeArea);
 for(const p of c.pair){const pose=frame(620).flippers.find(f=>f.id===p.id)!;for(const point of [[pose.pivotX,pose.pivotY],[pose.tipX,pose.tipY]]){const q=c.project(point[0]!,point[1]!,pose.elevation),r=pose.radius*c.scale;assert(q[0]-r>=12&&q[0]+r<=588&&q[1]-r>=34&&q[1]+r<=932);}}
});
test('tall narrow gameplay centers the fitting vertical axis at one uniform readable scale',()=>{
 const rig=createPinballCameraRig(world,0,{...options,depthMotion:{maximumTranslationPixels:4}});rig.observe(frame(500));const c=rig.sample({width:320,height:1312,cssPixelsPerPixel:1.21875,safeInsets:{left:12,right:12,top:34,bottom:68}});
 assert.equal(c.framing.mode,'follow');assert.equal(c.framing.sourceFraming!.axes!.y.fits,true);assert.equal(c.framing.sourceFraming!.axes!.x.fits,false);assert(c.framing.ballInSafeArea);assert(c.scale>=.5);
 const a=c.project(200,400,80),b=c.project(300,500,80);assert(Math.abs((b[0]-a[0])+(b[1]-a[1]))<=1);
 const first=c.project(200,400,240),inverse=c.viewToPlane(100,200,80);rig.observe(frame(520,800,'a.bank',1));assert.deepEqual(c.project(200,400,240),first);assert.deepEqual(c.viewToPlane(100,200,80),inverse);
});
test('manual overview retains the ordinary complete-world projection and defaults omit scope telemetry',()=>{
 const scoped=createPinballCameraRig(world,0,options),ordinary=createPinballCameraRig(world,0,{...options,playfieldFraming:undefined} as any);for(const r of [scoped,ordinary])r.observe(frame(900,400,'b.bank'));
 const v={width:800,height:1200,mode:'overview' as const},a=scoped.sample(v),b=ordinary.sample(v);
 assert.equal(a.scale,b.scale);assert.equal(a.left,b.left);assert.equal(a.top,b.top);assert.deepEqual(a.project(0,0,80),b.project(0,0,80));assert.equal(b.framing.sourceFraming,undefined);
});
