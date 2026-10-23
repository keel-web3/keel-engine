import test from 'node:test';
import assert from 'node:assert/strict';
import type {ArenaWorldDefinition,ArenaFrame} from '../../pinball-arena/src/types.ts';
import {createPlayfieldFramingIndex,solvePlayfieldOrigins,type FramingRoom,type FramingTransition} from '../src/playfield-framing-v2.ts';

function fixture(){
 const bed=(id:string,x:number,y:number)=>({id,kind:'playfield',height:80,layer:0,polygon:[{x,y},{x:x+600,y},{x:x+600,y:y+1200},{x,y:y+1200}]});
 const bank=(id:string,x:number,y:number)=>({id,x,y,layer:0,elevation:80,launchX:x+240,launchY:y-20,flipperIds:[id+'.blade']});
 const blade=(id:string,x:number,y:number)=>({id,pivotX:x,pivotY:y,layer:0,elevation:80,length:64,radius:6});
 const port=(id:string,x:number,y:number,bedId:string,receiverCatchId?:string)=>({id,x,y,layer:0,elevation:80,clearWidth:72,surfaceIds:[bedId],...(receiverCatchId?{receiverCatchId}:{})});
 const f={id:'field',surfaces:[bed('a.bed',0,0),bed('b.bed',1000,1400)],rails:[],flippers:[blade('a.bank.blade',240,100),blade('b.bank.blade',1240,1500)],stations:[bank('a.bank',300,100),bank('b.bank',1300,1500)],pinball:{paths:[],ports:[port('t.entry',300,1100,'a.bed'),port('t.exit',1300,1800,'b.bed','b.bank'),port('t.fallback',1360,1800,'b.bed','b.bank')]},captures:[{id:'capture',entryPortId:'t.entry',exitArenaId:'field',exitPortId:'t.exit',fallbackExitPortId:'t.fallback'}]};
 const room=(id:string):FramingRoom=>({id,arenaId:'field',bedId:id+'.bed',bankIds:[id+'.bank'],surfaceIds:[id+'.bed'],railIds:[],flipperIds:[id+'.bank.blade'],stationIds:[id+'.bank'],pathIds:[],portIds:id==='b'?['t.exit','t.fallback']:[]});
 const transition:FramingTransition={id:'t',arenaId:'field',fromRoomId:'a',toRoomId:'b',captureId:'capture',surfaceIds:[],railIds:[],flipperIds:[],stationIds:[],pathIds:[],portIds:['t.entry']};
 return{world:{arenas:[f]} as unknown as ArenaWorldDefinition,rooms:[room('a'),room('b')],transitions:[transition]};
}
const frame=(x:number,y:number,extra:Record<string,unknown>={})=>({tick:1,balls:[{ownerId:0,arenaId:'field',x,y,layer:0,elevation:80,radius:16,active:true,stationId:null,rampId:null,transport:null,...extra}]} as unknown as ArenaFrame);

test('native support chooses exact room without creating a bank lease',()=>{
 const f=fixture(),index=createPlayfieldFramingIndex(f.world,f),native=frame(1300,1800),before=JSON.stringify(native),selection=index.select(native,0);
 assert(selection.kind==='room');assert.equal(selection.roomId,'b');assert.equal(selection.reason,'native-bed-support');assert.equal(JSON.stringify(native),before);
 const outside=index.select(frame(2500,3000),0);assert.equal(outside.kind,'unscoped');
 const leased=index.select(frame(2500,3000,{stationId:'a.bank'}),0);assert(leased.kind==='room');assert.equal(leased.roomId,'a');
});
test('capture hold retains source bounds; transit returns both rooms and actual selected fallback',()=>{
 const f=fixture(),index=createPlayfieldFramingIndex(f.world,f),transport={mechanismId:'capture',phase:'captured',exitArenaId:'field',exitPortId:'t.exit'};
 const held=index.select(frame(300,1100,{active:false,transport}),0);assert(held.kind==='transition');assert.equal(held.fromRoomId,'a');assert.equal(held.toRoomId,'b');
 const a=index.bounds({kind:'room',arenaId:'field',roomId:'a',reason:'native-bed-support'},.8);assert.deepEqual(index.bounds(held,.8),a);
 const transit=index.select(frame(300,1100,{active:false,transport:{...transport,phase:'transit',exitPortId:'t.fallback'}}),0);assert(transit.kind==='transition');assert.equal(transit.exitPortId,'t.fallback');assert(index.bounds(transit,.8)!.x1>=1600);
 const released=index.select(frame(1300,1800),0);assert(released.kind==='room');assert.equal(released.roomId,'b');
});
test('manual overview remains whole world and ratios do not accumulate cached state',()=>{
 const f=fixture(),index=createPlayfieldFramingIndex(f.world,f),selection=index.select(frame(300,100),0),first=index.bounds(selection,.8)!;
 assert.equal(index.select(frame(300,100),0,'overview').kind,'world');assert(index.bounds(index.select(frame(300,100),0,'overview'),.8)!.x1>=1600);
 const tilted=index.bounds(selection,.82)!;assert(Math.abs(tilted.y0-first.y0+1.6)<1e-9);assert.deepEqual(index.bounds(selection,.8),first);
 (f.world.arenas[0]!.surfaces[0]!.polygon[0] as any).x=-9000;assert.deepEqual(index.bounds(selection,.8),first);
});
test('scope construction rejects duplicate ownership, missing path closure and foreign bed/bank bindings',()=>{
 {const f=fixture();(f.rooms[1] as any).surfaceIds.push('a.bed');assert.throws(()=>createPlayfieldFramingIndex(f.world,f),/multiple owners/);}
 {const f=fixture();(f.rooms[0] as any).railIds=['missing'];assert.throws(()=>createPlayfieldFramingIndex(f.world,f));}
 {const f=fixture();(f.rooms[0] as any).bankIds=['b.bank'];assert.throws(()=>createPlayfieldFramingIndex(f.world,f));}
 {const f=fixture();(f.world.arenas[0]!.flippers[0] as any).elevation=160;assert.throws(()=>createPlayfieldFramingIndex(f.world,f));}
 {const f=fixture();(f.transitions as any).push({...f.transitions[0],id:'duplicate',portIds:[]});assert.throws(()=>createPlayfieldFramingIndex(f.world,f),/duplicate capture/);}
});
const originRequest={bounds:{x0:0,x1:600,y0:-1200,y1:0},protectedBounds:{x0:284,x1:316,y0:-116,y1:-84},scale:.5,width:320,height:1312,safeInsets:{left:12,right:12,top:34,bottom:68},followLeft:0,followTop:-400};
test('tall phone centers the fitting vertical axis without shrinking XY; horizontal follow stays bounded',()=>{
 const r=solvePlayfieldOrigins(originRequest);assert.equal(r.status,'ok');assert.equal(r.scale,.5);assert.equal(r.axes.y.fits,true);assert.equal(r.axes.x.fits,false);assert.equal(r.top,-939);assert.equal(r.left,0);
 const moved=solvePlayfieldOrigins({...originRequest,followLeft:1000,followTop:1000});assert.equal(moved.top,r.top);assert.equal(moved.left,2);
});
test('a real off-room ball wins the intersection; infeasible protected spans are reported without fake safety',()=>{
 const r=solvePlayfieldOrigins({...originRequest,protectedBounds:{x0:1984,x1:2016,y0:-116,y1:-84}});assert.equal(r.status,'ok');assert(r.axes.x.escapedRoom);assert(r.left!==null&&1984*.5-r.left>=22&&2016*.5-r.left<=298);
 const failed=solvePlayfieldOrigins({...originRequest,protectedBounds:{x0:0,x1:1000,y0:-116,y1:-84}});assert.equal(failed.status,'infeasible');assert.equal(failed.left,null);assert(failed.maximumSafeScale<originRequest.scale);
});
test('origin policy rejects reversed bounds, invalid scale and unusable safe area',()=>{
 assert.throws(()=>solvePlayfieldOrigins({...originRequest,scale:NaN}));assert.throws(()=>solvePlayfieldOrigins({...originRequest,bounds:{x0:1,x1:0,y0:0,y1:1}}));assert.throws(()=>solvePlayfieldOrigins({...originRequest,safeInsets:{left:160,right:160,top:0,bottom:0}}));
});
test('active source connector selection is tied to actual native ramp ID or supported deck',()=>{
 const f=fixture(),field=f.world.arenas[0] as any;
 field.ramps=[{id:'native-ramp'}];
 field.surfaces.push({id:'bridge.deck',kind:'bridge',layer:0,height:80,rampId:'native-ramp',polygon:[{x:500,y:1200},{x:700,y:1200},{x:700,y:1300},{x:500,y:1300}]});
 field.rails.push({id:'bridge.rail',ax:500,ay:1200,bx:700,by:1200,layer:0,elevation:80,radius:3});
 field.pinball.ports.push({id:'bridge.entry',x:500,y:1250,layer:0,elevation:80,clearWidth:72,surfaceIds:['bridge.deck']},{id:'bridge.exit',x:700,y:1250,layer:0,elevation:80,clearWidth:72,surfaceIds:['bridge.deck'],receiverCatchId:'b.bank'});
 field.pinball.paths.push({id:'bridge.path',clearWidth:72,vertices:[{x:500,y:1250,elevation:80,layer:0},{x:700,y:1250,elevation:80,layer:0}],colliderIds:['bridge.rail'],surfaceIds:['bridge.deck'],entryPortId:'bridge.entry',exitPortId:'bridge.exit'});
 f.transitions.push({id:'bridge',arenaId:'field',fromRoomId:'a',toRoomId:'b',pathId:'bridge.path',surfaceIds:['bridge.deck'],railIds:['bridge.rail'],flipperIds:[],stationIds:[],pathIds:['bridge.path'],portIds:['bridge.entry','bridge.exit']});
 const index=createPlayfieldFramingIndex(f.world,f),onRamp=index.select(frame(600,1250,{rampId:'native-ramp'}),0),onDeck=index.select(frame(600,1250),0);
 assert(onRamp.kind==='transition');assert.equal(onRamp.reason,'native-ramp');assert(onDeck.kind==='transition');assert.equal(onDeck.reason,'native-connector-support');
});


test('transition entry rejects destination-owned support and off-support native point',()=>{
 for(const change of [
  (p:any)=>{p.surfaceIds=['b.bed'];p.x=1300;p.y=1800;},
  (p:any)=>{p.x=7000;p.y=9000;},
  (p:any)=>{p.surfaceIds=[];},
  (p:any)=>{p.elevation=160;},
 ]){const f=fixture();change(f.world.arenas[0]!.pinball!.ports[0]);assert.throws(()=>createPlayfieldFramingIndex(f.world,f),/entry source/);}
});
test('per-vertex width profile contributes to source bounds and rejects malformed profile',()=>{
 const f=fixture(),field=f.world.arenas[0] as any;
 field.rails.push({id:'wide.rail',ax:10,ay:200,bx:10,by:300,layer:0,elevation:80,radius:3});
 field.pinball.ports.push({id:'wide.entry',x:10,y:200,layer:0,elevation:80,clearWidth:24,surfaceIds:['a.bed']},{id:'wide.exit',x:10,y:300,layer:0,elevation:80,clearWidth:24,surfaceIds:['a.bed']});
 field.pinball.paths.push({id:'wide.path',clearWidth:24,clearWidths:[200,24],vertices:[{x:10,y:200,layer:0,elevation:80},{x:10,y:300,layer:0,elevation:80}],colliderIds:['wide.rail'],surfaceIds:['a.bed'],entryPortId:'wide.entry',exitPortId:'wide.exit'});
 (f.rooms[0] as any).railIds.push('wide.rail');(f.rooms[0] as any).pathIds.push('wide.path');(f.rooms[0] as any).portIds.push('wide.entry','wide.exit');
 const index=createPlayfieldFramingIndex(f.world,f),bounds=index.bounds({kind:'room',arenaId:'field',roomId:'a',reason:'native-bed-support'},.8)!;
 assert.equal(bounds.x0,-90);
 field.pinball.paths[0].clearWidths=[200];assert.throws(()=>createPlayfieldFramingIndex(f.world,f),/width profile/);
 field.pinball.paths[0].clearWidths=[200,NaN];assert.throws(()=>createPlayfieldFramingIndex(f.world,f));
});


test('capture HOLD includes the actual outlying source mouth, without destination snap',()=>{
 const f=fixture(),field=f.world.arenas[0] as any;
 field.surfaces.push({id:'mouth.deck',kind:'platform',layer:0,height:80,polygon:[{x:760,y:1040},{x:840,y:1040},{x:840,y:1160},{x:760,y:1160}]});
 field.pinball.ports[0].x=800;field.pinball.ports[0].surfaceIds=['mouth.deck'];
 (f.transitions[0] as any).surfaceIds=['mouth.deck'];
 const index=createPlayfieldFramingIndex(f.world,f),held=index.select(frame(800,1100,{active:false,transport:{mechanismId:'capture',phase:'captured',exitArenaId:'field',exitPortId:'t.exit'}}),0);
 assert(held.kind==='transition');const bounds=index.bounds(held,.8)!;assert(bounds.x1>=840);assert(bounds.x1<1000);
 const transit={...held,phase:'transit' as const};assert(index.bounds(transit,.8)!.x1>=1600);
});
