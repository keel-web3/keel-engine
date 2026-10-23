// SPDX-License-Identifier: GPL-3.0-only
import factory from '../wasm/cwl.mjs';
import {packetValid} from './packet.mjs';
export {packetValid} from './packet.mjs';
export async function createPeer({send,onMaster=()=>{},onOffer=()=>{},onDrop=()=>{},onWithdraw=()=>{},now=()=>performance.now(),session,wasmBinary}={}){
 if(typeof send!=='function')throw new Error('A packet transport is required.');
 const m=await factory(wasmBinary?{wasmBinary}:{});const stamp=()=>Math.floor(now())>>>0;
 const id=session??(crypto.getRandomValues(new Uint16Array(1))[0]||1);
 if(!Number.isInteger(id)||id<1||id>65535)throw new Error('Invalid session ID.');
 const byte=b=>{if(!Number.isInteger(b)||b<0||b>255)throw new Error('Expected one byte.');return b;};
 const p=m._peer_new(id,stamp()),buffer=m._malloc(6);if(!p||!buffer){if(p)m._peer_free(p);if(buffer)m._free(buffer);throw new Error('Could not allocate link protocol state.');}let closed=false,draining=false;
 const drain=()=>{if(draining||closed)return;draining=true;try{let count=0,ptr;while(!closed&&(ptr=m._peer_event(p))){if(++count>256||m._peer_overflow(p))throw new Error('Link event queue overflow.');const b=m.HEAPU8.slice(ptr,ptr+8);m._peer_pop(p);if(b[0]===1)send(b.slice(2,8));else if(b[0]===2)onMaster(b[2]);else if(b[0]===3)onOffer(b[2]);else if(b[0]===4)onDrop();else if(b[0]===5)onWithdraw();}}finally{draining=false;}};
 const call=(fn,...args)=>{if(closed)throw new Error('Link is closed.');fn(p,...args,stamp());drain();};
 return {poll:()=>call(m._peer_poll),receive(b){if(!packetValid(b))throw new Error('Invalid CWL2 packet.');if(closed)throw new Error('Link is closed.');m.HEAPU8.set(b,buffer);const ok=m._peer_receive(p,buffer,6,stamp());drain();return !!ok;},arm:()=>call(m._peer_arm),disarm:()=>call(m._peer_disarm),master:b=>call(m._peer_master,byte(b)),result:(done,b)=>call(m._peer_result,done?1:0,byte(b)),abandon:()=>call(m._peer_abandon),alive:()=>!closed&&!!m._peer_alive(p,stamp()),close(){if(closed)return;closed=true;m._free(buffer);m._peer_free(p);}};
}
