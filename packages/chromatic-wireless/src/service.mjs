// SPDX-License-Identifier: GPL-3.0-only
import {createPeer} from './peer.mjs';
/** Adapt CWL2 to Crucible's existing authenticated /cable service.
 * The cartridge drives the clock. The service owns game semantics and ROM validation.
 * No cartridge state is interpreted or synthesized by this adapter.
 */
export async function createServiceCable({sendPacket,sendBytes,onError=()=>{},wasmBinary,now,session,capacity=4096}={}){
 if(typeof sendBytes!=='function'||typeof sendPacket!=='function')throw new Error('Both transports are required.');
 if(!Number.isInteger(capacity)||capacity<1||capacity>65536)throw new Error('Invalid queue capacity.');
 let open=false,closed=false;const queued=[];
 const peer=await createPeer({send:sendPacket,wasmBinary,now,session,onOffer(byte){
  if(!open){peer.result(false,0);return;}
  // Accept exactly once; retries and ACK loss are handled by the canonical core.
  const response=queued.length?queued.shift():0;
  peer.result(true,response);
  try{sendBytes(Uint8Array.of(byte));if(open)peer.arm();}catch{open=false;queued.length=0;peer.disarm();onError(new Error('Game service disconnected. Reconnect the game session.'));}
 },onWithdraw(){peer.result(false,0);}});
 return {receivePacket:bytes=>peer.receive(bytes),poll:()=>peer.poll(),alive:()=>peer.alive(),
  setReady(value){if(closed)throw new Error('Cable is closed.');open=!!value;queued.length=0;open?peer.arm():peer.disarm();},
  receiveBytes(bytes){if(!open)throw new Error('Game service is not authenticated.');if(!(bytes instanceof Uint8Array)||queued.length+bytes.length>capacity){open=false;queued.length=0;peer.disarm();throw new Error('Game-service receive buffer exceeded.');}queued.push(...bytes);},
  close(){if(closed)return;closed=true;open=false;queued.length=0;peer.close();}};
}
