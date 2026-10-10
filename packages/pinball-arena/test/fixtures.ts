import {sha256,toHex} from '@keel-engine/codec/hash';
import type {ArenaField,ArenaWorldDefinition,ArenaPlayer} from '../src/types.ts';
export const player=(ownerId=0,teamId=ownerId):ArenaPlayer=>({ownerId,teamId,name:`P${ownerId}`,role:'vector',bot:false});
export function worldFrom(fields:readonly ArenaField[]):ArenaWorldDefinition {
 const body={schema:'keel-pinball-arena-world@1' as const,generatorVersion:'test-physical-routes@1',id:'physical-route-fixture',seed:'0x01',unitScale:.025,arenas:fields,links:[]};
 return {...body,canonical:JSON.stringify(body),sha256:toHex(sha256(new TextEncoder().encode(JSON.stringify(body))))};
}
export function field(overrides:Partial<ArenaField>={}):ArenaField {
 return {id:'field',name:'PHYSICAL ROUTE FIXTURE',seed:'0x01',gravity:{x:0,y:0},bounds:[64,64,1800,1600],regions:[{id:'start',name:'START',seed:'0x01',bounds:[64,64,700,1600],center:{x:300,y:200},neighbors:['arrival'],biome:{forge:1,neon:0,garden:0,glacier:0,ruins:0}},{id:'arrival',name:'ARRIVAL',seed:'0x02',bounds:[700,64,1800,1600],center:{x:834,y:850},neighbors:['start'],biome:{forge:0,neon:0,garden:1,glacier:0,ruins:0}}],chunks:[],rails:[],bumpers:[],flippers:[],stations:[{id:'home',ownerId:0,teamId:0,x:150,y:200,layer:0,elevation:0,launchX:174,launchY:200,launchVx:11,launchVy:0,flipperIds:[]},{id:'next',ownerId:-1,teamId:-1,x:834,y:850,layer:0,elevation:0,launchX:834,launchY:826,launchVx:0,launchVy:-11,captureRadius:45,flipperIds:[]}],switches:[],gates:[],ramps:[],portals:[],surfaces:[],flows:[],routes:{nodes:[],edges:[]},...overrides};
}
export function shotRouteWorld():ArenaWorldDefinition {
 return worldFrom([field({
  rails:[{id:'ground-under-ramp',ax:500,ay:110,bx:500,by:290,radius:3,restitution:1,layer:0,elevation:0,material:'steel'},{id:'orbit-turn',ax:750,ay:100,bx:1000,by:350,radius:3,restitution:1,layer:0,elevation:0,material:'steel'}],
  ramps:[{id:'shot-ramp',ax:350,ay:200,bx:650,by:200,width:180,fromLayer:0,toLayer:1,fromElevation:0,toElevation:100,bidirectional:true}],
  surfaces:[{id:'bridge',kind:'bridge',polygon:[{x:650,y:110},{x:750,y:110},{x:750,y:290},{x:650,y:290}],layer:1,height:100,material:'steel',biome:{forge:1,neon:0,garden:0,glacier:0,ruins:0}}],
  gates:[{id:'shared-gate',ax:740,ay:700,bx:940,by:700,radius:4,restitution:1,layer:0,elevation:0,initiallyOpen:false}],
  challenges:[{id:'raised-shot',name:'RAISED SHOT',checkpoints:[{x:250,y:200,radius:35,layer:0,elevation:0},{x:700,y:200,radius:35,layer:1,elevation:100}]},{id:'return-shot',name:'RETURN SHOT',checkpoints:[{x:834,y:400,radius:40,layer:0,elevation:0},{x:834,y:600,radius:40,layer:0,elevation:0}]}],
  requirements:[{id:'compound-lock',name:'TWO SHOT ADMISSION',routeIds:['raised-shot','return-shot'],gateIds:['shared-gate'],scope:'team',holdTicks:900,persistent:true}],
 })]);
}

/** Fresh paired-flipper funnel; served through a canonical inlane. */
export function pairedFlipperWorld():ArenaWorldDefinition {return worldFrom([field({bounds:[64,64,1200,1800],stations:[{id:'home',ownerId:0,teamId:0,x:600,y:1460,layer:0,elevation:0,launchX:550,launchY:1250,launchVx:0,launchVy:6,flipperIds:['left','right']}],flippers:[{id:'left',ownerId:0,side:'left',pivotX:475,pivotY:1500,length:96,radius:8,restAngle:18,activeAngle:-35,layer:0,elevation:0},{id:'right',ownerId:0,side:'right',pivotX:725,pivotY:1500,length:96,radius:8,restAngle:162,activeAngle:215,layer:0,elevation:0}],flows:[{id:'gravity-left',ax:300,ay:100,bx:300,by:1700,width:600,fx:0,fy:.04,layer:0,maxSpeed:18},{id:'gravity-right',ax:900,ay:100,bx:900,by:1700,width:600,fx:0,fy:.04,layer:0,maxSpeed:18}],rails:[{id:'wall-left',ax:80,ay:100,bx:80,by:1100,radius:3,restitution:.95,layer:0,elevation:0,material:'steel'},{id:'wall-right',ax:1120,ay:100,bx:1120,by:1100,radius:3,restitution:.95,layer:0,elevation:0,material:'steel'},{id:'wall-top',ax:80,ay:100,bx:1120,by:100,radius:3,restitution:.95,layer:0,elevation:0,material:'steel'},{id:'funnel-left',ax:80,ay:1100,bx:475,by:1500,radius:3,restitution:.85,layer:0,elevation:0,material:'steel'},{id:'funnel-right',ax:1120,ay:1100,bx:725,by:1500,radius:3,restitution:.85,layer:0,elevation:0,material:'steel'}],bumpers:[{id:'target-left',x:260,y:600,radius:65,impulse:2,layer:0,elevation:0,kind:'coil'},{id:'target-right',x:940,y:600,radius:65,impulse:2,layer:0,elevation:0,kind:'coil'}],hazards:[{id:'drain',kind:'drain',x:600,y:1640,radius:90,layer:0,elevation:0,damage:0,cooldownTicks:120}]})]);}
