import type {ArenaOwnerInput,ArenaPlayer} from '@keel-engine/pinball-arena';
export const PINBALL_ROOM_VERSION='keel-pinball-room@1';
export interface RoomInput {readonly type:'input';readonly seq:number;readonly held:number;readonly edges:number;readonly x:number;readonly y:number}
export interface RoomLobby {readonly type:'lobby';readonly players:readonly {readonly name:string;readonly ready:boolean;readonly connected:boolean}[];readonly capacity:number;readonly minimum:number}
export interface RoomRound {readonly type:'round';readonly protocol:typeof PINBALL_ROOM_VERSION;readonly roundId:string;readonly kernel:string;readonly authority:string;readonly worldDigest:string;readonly seed:string;readonly generation:{readonly arenas:1|2|3;readonly players:number;readonly teamSize:1|5;readonly detail:'high'};readonly players:readonly ArenaPlayer[];readonly ownerId:number|null;readonly match:{readonly mode:'battle'|'expedition';readonly maxTicks:number;readonly stormDelayTicks:number;readonly stormDurationTicks:number}}
export type RoomClientMessage={readonly type:'hello';readonly protocol:typeof PINBALL_ROOM_VERSION;readonly name:string;readonly resume?:string}|{readonly type:'ready';readonly ready:boolean}|RoomInput;
const integer=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=lo&&v<=hi;
function keys(value:Record<string,unknown>,allowed:readonly string[]){if(Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Unexpected room message field');}
/** Owner, health, position and commands are deliberately absent from input. */
export function parseRoomMessage(text:string):RoomClientMessage{
 if(new TextEncoder().encode(text).length>1024)throw new Error('Room message exceeds cap');
 const v=JSON.parse(text) as Record<string,unknown>;
 if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid room message');
 if(v.type==='hello'){
  keys(v,['type','protocol','name','resume']);
  if(v.protocol!==PINBALL_ROOM_VERSION||typeof v.name!=='string'||!v.name.trim()||v.name.length>32||/[\x00-\x1f\x7f]/.test(v.name)||v.resume!==undefined&&(typeof v.resume!=='string'||!/^[0-9a-f]{64}$/.test(v.resume)))throw new Error('Invalid room hello');
  return {type:'hello',protocol:PINBALL_ROOM_VERSION,name:v.name.trim(),...(typeof v.resume==='string'?{resume:v.resume}:{})};
 }
 if(v.type==='ready'){keys(v,['type','ready']);if(typeof v.ready!=='boolean')throw new Error('Invalid ready state');return {type:'ready',ready:v.ready};}
 if(v.type==='input'){
  keys(v,['type','seq','held','edges','x','y']);
  if(!integer(v.seq,1,Number.MAX_SAFE_INTEGER)||!integer(v.held,0,3)||!integer(v.edges,0,60)||(v.edges&3)!==0||!integer(v.x,-127,127)||!integer(v.y,-127,127))throw new Error('Invalid room input');
  return {type:'input',seq:v.seq,held:v.held,edges:v.edges,x:v.x,y:v.y};
 }
 throw new Error('Unknown room message');
}
export function roomInput(ownerId:number,message:RoomInput):ArenaOwnerInput{return {ownerId,bits:message.held|message.edges,steerX:message.x/127,steerY:message.y/127};}
