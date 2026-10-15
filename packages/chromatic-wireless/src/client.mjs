// SPDX-License-Identifier: MIT
// Browser-to-local-helper transport. A helper handshake is never a device handshake.
import {packetValid} from './packet.mjs';
export function connectHelper({token,ip,onPacket=()=>{},onState=()=>{},WebSocketImpl=globalThis.WebSocket,url='ws://127.0.0.1:48180/bridge',timeout=8000}={}){
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Open the private launch link printed by the helper.');
 if(!localAddress(ip))throw new Error('Enter the Chromatic’s private IPv4 address from Device health.');
 const target=new URL(url);if(target.hostname!=='127.0.0.1'||target.protocol!=='ws:'||target.pathname!=='/bridge')throw new Error('The helper must run on this computer.');
 const ws=new WebSocketImpl(url,['chromatic-v1',`key.${token}`]);ws.binaryType='arraybuffer';
 let closed=false,helper=false,ready=false,peer=false,timer;
 const state=(phase,message)=>onState({phase,message,helper,transport:ready,peer});
 const close=()=>{if(closed)return;closed=true;clearTimeout(timer);ws.close();};
 const fail=message=>{helper=false;ready=false;peer=false;close();state('error',message);};
 const deadline=message=>{clearTimeout(timer);timer=setTimeout(()=>fail(message),timeout);};
 state('opening','Connecting to the local helper…');deadline('The helper did not respond. Start it on this computer and reopen its launch link.');
 ws.onmessage=e=>{if(closed)return;try{
  if(typeof e.data==='string'){
   const v=JSON.parse(e.data);
   if(v.type==='helper'){
    if(helper||v.version!==1||v.capabilities?.link!==true||v.capabilities?.console!==false||v.capabilities?.cartridge!==false||v.capabilities?.firmware!==false)throw new Error('Unsupported helper capabilities.');
    helper=true;state('helper','Local helper responding; device not checked.');ws.send(JSON.stringify({type:'connect',ip}));deadline('The helper could not open its UDP transport.');
   }else if(v.type==='transport'&&helper&&v.ready===true){ready=true;clearTimeout(timer);state('transport','UDP transport open; waiting for a device response.');}
   else if(v.type==='peer'&&ready&&typeof v.connected==='boolean'){peer=v.connected;state(peer?'peer':'transport',peer?'Device sent a CWL2 packet.':'Device stopped responding.');}
   else if(v.type==='error')fail(typeof v.message==='string'?v.message:'Helper error.');
   else throw new Error('Unexpected helper response.');
  }else{const bytes=new Uint8Array(e.data);if(!ready||!packetValid(bytes))throw new Error('Invalid game-link packet.');onPacket(bytes);}
 }catch{fail('The helper returned an invalid response.');}};
 ws.onerror=()=>fail('Could not connect to the local helper. Check that it is running and allow the browser’s local-network request if shown.');
 ws.onclose=()=>{if(closed)return;helper=false;ready=false;peer=false;close();state('closed','Wi-Fi helper disconnected.');};
 return {send(bytes){if(closed||!ready)throw new Error('Wi-Fi transport is not ready.');if(!packetValid(bytes))throw new Error('Invalid CWL2 packet.');if(ws.bufferedAmount>4096){fail('The Wi-Fi transport is too slow.');throw new Error('Link backpressure exceeded.');}ws.send(bytes);},close};
}
export function localAddress(ip){if(typeof ip!=='string'||!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))return false;const parts=ip.split('.');if(parts.some(v=>String(Number(v))!==v||Number(v)>255))return false;const [a,b,,d]=parts.map(Number);return d!==0&&d!==255&&(a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168));}
/** One bounded HELLO_PROBE, never a game exchange, reset or management write. */
export function probeWifi({token,ip,onState=()=>{},signal,transportOptions={}}={}){
 return new Promise((resolve,reject)=>{
  let transport,timer,finished=false,abort=()=>finish(new Error('Wi-Fi check cancelled.'));
  function finish(error,value){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);transport?.close();error?reject(error):resolve(value);}
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  try{transport=connectHelper({...transportOptions,token,ip,onState:s=>{onState(s);if(s.phase==='error'||s.phase==='closed')finish(new Error(s.message));if(s.phase==='transport'&&!timer){const id=crypto.getRandomValues(new Uint8Array(2));transport.send(Uint8Array.of(67,87,2,6,...id));timer=setTimeout(()=>finish(new Error('No CWL2 HELLO response in 5 seconds. Check Wi-Fi link mode and the device IP. No reset was attempted.')),5000);}},onPacket:bytes=>{if(bytes[3]===5)finish(null,{protocol:'CWL2',deviceResponded:true,management:false,gameplayVerified:false});}});}catch(e){finish(e);}
 });
}
