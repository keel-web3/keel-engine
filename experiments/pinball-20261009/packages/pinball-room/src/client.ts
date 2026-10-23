import {ARENA_KERNEL_SHA256,ARENA_AUTHORITY_REVISION,admitArenaInput} from '@keel-engine/pinball-arena';
import type {ArenaFrame,ArenaWorldDefinition} from '@keel-engine/pinball-arena';
import {PINBALL_ROOM_VERSION,parseRoomMessage} from './protocol.ts';
import type {RoomRound,RoomLobby} from './protocol.ts';
import {createArenaFrameCodec,createArenaFrameStreamDecoder} from './frame-codec.ts';

export type RoomClientPhase='connecting'|'lobby'|'syncing'|'playing'|'finished'|'reconnecting'|'failed'|'closed';
export interface ArenaRoomClientOptions {
 readonly url:string;readonly name:string;readonly resume?:string;
 readonly resolveWorld:(round:RoomRound)=>ArenaWorldDefinition|Promise<ArenaWorldDefinition>;
 readonly onPhase?:(phase:RoomClientPhase)=>void;readonly onLobby?:(lobby:RoomLobby)=>void;
 readonly onRound?:(round:RoomRound,world:ArenaWorldDefinition)=>void;readonly onFrame?:(frame:ArenaFrame)=>void;
 readonly onError?:(error:Error)=>void;
}
const integer=(n:unknown,lo:number,hi:number)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=lo&&n<=hi;
/** Remote authority owns the balls. A client sends only buttons/quantized aim.
 * Credentials stay in this connection object; callers decide persistence. */
export function createArenaRoomClient(options:ArenaRoomClientOptions){
 const hello=parseRoomMessage(JSON.stringify({type:'hello',protocol:PINBALL_ROOM_VERSION,name:options.name,...(options.resume?{resume:options.resume}:{})}));
 const url=new URL(options.url);if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid pinball room URL');
 let socket:WebSocket|undefined,phase:RoomClientPhase='connecting',credential=options.resume??null,ownerId:number|null=null,round:RoomRound|undefined;
 let decoder:ReturnType<typeof createArenaFrameStreamDecoder>|undefined,frame:ArenaFrame|undefined,queue:Uint8Array[]=[],sequence=0,held=0,edges=0,lastActions=0,x=0,y=0;
 let disposed=false,welcomed=false,retries=0,generation=0,reconnectTimer:ReturnType<typeof setTimeout>|undefined,greeting:ReturnType<typeof setTimeout>|undefined;
 const cache=new Map<string,Promise<ArenaWorldDefinition>>();
 function setPhase(next:RoomClientPhase){if(phase===next)return;phase=next;options.onPhase?.(next);}
 function neutral(){held=0;edges=0;lastActions=0;x=0;y=0;}
 function fail(error:unknown){if(disposed||phase==='failed')return;setPhase('failed');neutral();options.onError?.(error instanceof Error?error:new Error(String(error)));socket?.close(4002,'Room state rejected');}
 function send(value:unknown){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
 function apply(packet:Uint8Array){frame=decoder!.decode(packet);setPhase(frame.phase==='finished'?'finished':'playing');options.onFrame?.(frame);}
 function buffer(packet:Uint8Array){
  if(packet.length<4||packet.length>131072)throw new Error('Room packet cap');
  const full=new DataView(packet.buffer,packet.byteOffset,packet.byteLength).getUint32(0,true)===0x4642504b;
  // While a cold procedural resolver runs, keep only a recent complete
  // keyframe and its contiguous deltas. Never apply a delta without baseline.
  if(full)queue=[packet];else if(queue.length){if(queue.length<32)queue.push(packet);else queue=[];}
 }
 async function admitRound(value:RoomRound,epoch:number){
  if(round)throw new Error('Repeated room round admission');
  if(!welcomed||value.protocol!==PINBALL_ROOM_VERSION||value.kernel!==ARENA_KERNEL_SHA256||value.authority!==ARENA_AUTHORITY_REVISION||typeof value.roundId!=='string'||!/^[0-9a-f]{24}$/.test(value.roundId)||typeof value.worldDigest!=='string'||!/^[0-9a-f]{64}$/.test(value.worldDigest)||!Array.isArray(value.players)||!integer(value.players.length,1,100)||value.ownerId!==null&&!value.players.some(p=>p.ownerId===value.ownerId)||value.players.some(p=>p.bot||typeof p.name!=='string'||p.name.length>32||!['vector','anchor','weaver'].includes(p.role)))throw new Error('Room round identity');
  round=structuredClone(value);ownerId=round.ownerId;decoder=undefined;queue=[];neutral();setPhase('syncing');
  let pending=cache.get(round.worldDigest);if(!pending){pending=Promise.resolve(options.resolveWorld(round));cache.set(round.worldDigest,pending);if(cache.size>2)cache.delete(cache.keys().next().value!);}
  const world=await pending;if(disposed||epoch!==generation)return;
  if(world.sha256!==value.worldDigest)throw new Error('Room generator identity differs from host');
  decoder=createArenaFrameStreamDecoder(createArenaFrameCodec(world,value.players));options.onRound?.(round,world);
  const buffered=queue;queue=[];for(const packet of buffered)apply(packet);
 }
 function connect(){
  if(disposed)return;const epoch=++generation;welcomed=false;ownerId=null;round=undefined;decoder=undefined;queue=[];sequence=0;neutral();
  socket=new WebSocket(url);socket.binaryType='arraybuffer';const current=socket;
  greeting=setTimeout(()=>{if(epoch===generation&&!welcomed)current.close(4008,'Hello deadline');},5000);
  current.onopen=()=>send({...hello,...(credential?{resume:credential}:{})});
  current.onmessage=event=>{
   if(epoch!==generation||disposed||phase==='failed')return;
   try{
    if(typeof event.data!=='string'){if(!(event.data instanceof ArrayBuffer))throw new Error('Unexpected room binary data');const packet=new Uint8Array(event.data);if(decoder)apply(packet);else buffer(packet);return;}
    if(new TextEncoder().encode(event.data).length>32768)throw new Error('Room metadata cap');const value=JSON.parse(event.data);
    if(value.type==='welcome'){
     if(welcomed||value.protocol!==PINBALL_ROOM_VERSION||!integer(value.capacity,2,100)||value.resume!==null&&(typeof value.resume!=='string'||!/^[0-9a-f]{64}$/.test(value.resume)))throw new Error('Room welcome identity');
     welcomed=true;credential=value.resume;clearTimeout(greeting);return;
    }
    if(!welcomed)throw new Error('Room metadata before greeting');
    if(value.type==='lobby'){
     if(!integer(value.capacity,2,100)||!integer(value.minimum,2,value.capacity)||!Array.isArray(value.players)||value.players.length>value.capacity||value.players.some((p:{name?:unknown;ready?:unknown;connected?:unknown})=>typeof p.name!=='string'||p.name.length>32||typeof p.ready!=='boolean'||typeof p.connected!=='boolean'))throw new Error('Room lobby');
     if(round)throw new Error('Lobby after round admission');setPhase('lobby');options.onLobby?.(structuredClone(value));return;
    }
    if(value.type==='round'){void admitRound(value,epoch).catch(fail);return;}
    throw new Error('Unknown room metadata');
   }catch(error){fail(error);}
  };
  current.onerror=()=>{}; // close drives the bounded reconnect policy.
  current.onclose=()=>{
   if(epoch!==generation||disposed||phase==='failed')return;clearTimeout(greeting);neutral();decoder=undefined;queue=[];
   if(credential&&retries<3){setPhase('reconnecting');reconnectTimer=setTimeout(connect,[500,1500,3000][retries++]!);}else fail(new Error('Pinball room disconnected'));
  };
 }
 const flush=setInterval(()=>{if(phase==='playing'&&ownerId!==null){send({type:'input',seq:++sequence,held,edges,x,y});edges=0;}},1000/60);
 options.onPhase?.('connecting');connect();
 return {
  ready(value=true){if(phase!=='lobby')throw new Error('Room is not awaiting readiness');send({type:'ready',ready:value});},
  /** Submit current button state; actions emit once per press/release cycle. */
  submitInput(bits:number,steerX=0,steerY=0){if(phase!=='playing'||ownerId===null)return;const input=admitArenaInput({ownerId,bits,steerX,steerY}),nextActions=input.bits&60;held=input.bits&3;edges|=nextActions&~lastActions;lastActions=nextActions;x=Math.round(input.steerX!*127);y=Math.round(input.steerY!*127);},
  neutral,disconnect(){disposed=true;generation++;clearInterval(flush);clearTimeout(greeting);clearTimeout(reconnectTimer);neutral();socket?.close(1000,'Client closed');setPhase('closed');},
  get phase(){return phase;},get frame(){return frame;},get round(){return round;},get ownerId(){return ownerId;},get resume(){return credential;},
 };
}
