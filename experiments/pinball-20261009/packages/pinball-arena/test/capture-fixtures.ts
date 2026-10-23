import {field,worldFrom} from './fixtures.ts';
import type {ArenaPinballPort,ArenaStation} from '../src/types.ts';
const biome={forge:1,neon:0,garden:0,glacier:0,ruins:0};
export function captureWorld(camped=false){
 const ports:ArenaPinballPort[]=[['mouth',400,200,'capture-entry'],['exit',1100,300,'release-exit'],['fallback',1000,400,'release-exit']].map(([id,x,y,role])=>({id:String(id),mechanismId:'transport',role:role as ArenaPinballPort['role'],x:Number(x),y:Number(y),layer:0,elevation:0,tangent:{x:1,y:0},clearWidth:64,direction:'forward',surfaceIds:['floor'],maxBallRadius:12,admittedSpeed:{min:1,max:18}}));
 const stations:ArenaStation[]=[{id:'home',ownerId:0,teamId:0,x:150,y:200,layer:0,elevation:0,launchX:174,launchY:200,launchVx:11,launchVy:0,flipperIds:[]}];
 if(camped)stations.push(...[1,2].map(ownerId=>({id:`camp${ownerId}`,ownerId,teamId:ownerId,x:ownerId===1?1100:1000,y:ownerId===1?300:400,layer:0,elevation:0,launchX:ownerId===1?1100:1000,launchY:ownerId===1?300:400,launchVx:0,launchVy:0,flipperIds:[]})));
 return worldFrom([field({stations,surfaces:[{id:'floor',kind:'ground',polygon:[{x:64,y:64},{x:1800,y:64},{x:1800,y:1600},{x:64,y:1600}],layer:0,height:0,material:'steel',biome}],gates:[{id:'busy',ax:400,ay:160,bx:400,by:240,radius:3,restitution:1,layer:0,elevation:0,initiallyOpen:true}],pinball:{paths:[],ports},captures:[{id:'transport',kind:'tunnel',entryPortId:'mouth',exitArenaId:'field',exitPortId:'exit',fallbackExitPortId:'fallback',approach:{minSpeed:1,maxSpeed:18,minDot:.5},captureTicks:12,travelTicks:24,maxExitWaitTicks:12,exitVelocity:{x:8,y:0},release:{kind:'timer'},busyGateIds:['busy'],blockedTerminal:'drain'}]})]);
}
