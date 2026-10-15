// SPDX-License-Identifier: MIT
import {createSocket} from 'node:dgram';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {localAddress} from '../src/client.mjs';
import {packetValid} from '../src/packet.mjs';
export {localAddress,packetValid};
const origins=new Set(['https://egress.onkeel.io','https://crucible.onkeel.io']);
export function startBridge({port=48180,token=randomBytes(32).toString('hex'),allowedOrigins=origins,allowAddress=localAddress,devicePort=47820}={}){
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid launch token.');
 let active=null,pending=false;const peers=new Set();
 const close=ws=>{peers.delete(ws);if(active===ws)active=null;if(ws.data.udp){const udp=ws.data.udp;ws.data.udp=null;try{udp.close();}catch{}}};
 const send=(ws,value)=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
 const server=Bun.serve({hostname:'127.0.0.1',port,fetch(req,srv){
  const url=new URL(req.url),origin=req.headers.get('origin'),host=req.headers.get('host');
  if(host!==`127.0.0.1:${srv.port}`)return new Response('Invalid host',{status:403});
  if(url.pathname!=='/bridge'||req.headers.get('upgrade')?.toLowerCase()!=='websocket')return new Response('Chromatic Wi-Fi helper. Open EGRESS or CRUCIBLE to connect.',{headers:{'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'",'X-Content-Type-Options':'nosniff'}});
  if(!allowedOrigins.has(origin))return new Response('Origin refused',{status:403});
  const protocols=(req.headers.get('sec-websocket-protocol')??'').split(',').map(s=>s.trim());const credential=protocols.find(s=>s.startsWith('key.'))?.slice(4)??'';
  if(!protocols.includes('chromatic-v1')||! /^[a-f0-9]{64}$/.test(credential)||!timingSafeEqual(Buffer.from(credential),Buffer.from(token)))return new Response('Launch token required',{status:403});
  if(active||pending||peers.size)return new Response('A page already owns the device bridge',{status:409});
  pending=true;
  if(srv.upgrade(req,{headers:{'Sec-WebSocket-Protocol':'chromatic-v1'},data:{udp:null,ip:null,ready:false,packets:0,window:Date.now(),deadline:Date.now()+10000,lastPeer:0,wasAlive:false,rxWindow:Date.now(),rxPackets:0}}))return;
  pending=false;return new Response('Upgrade failed',{status:400});
 },websocket:{maxPayloadLength:256,idleTimeout:30,backpressureLimit:4096,closeOnBackpressureLimit:true,
  open(ws){pending=false;active=ws;peers.add(ws);send(ws,{type:'helper',version:1,capabilities:{link:true,console:false,cartridge:false,firmware:false}});},
  message(ws,message){
   try{
    const now=Date.now();if(now-ws.data.window>=1000){ws.data.window=now;ws.data.packets=0;}if(++ws.data.packets>4000)throw new Error('Link packet rate exceeded');
    if(typeof message==='string'){
     const value=JSON.parse(message);if(value.type!=='connect'||ws.data.udp||!allowAddress(value.ip))throw new Error('Choose one private IPv4 device address');
     ws.data.ip=value.ip;const udp=createSocket('udp4');ws.data.udp=udp;
     udp.on('error',()=>{send(ws,{type:'error',message:'UDP transport failed'});ws.close(1011,'UDP error');});
     udp.on('message',(bytes,from)=>{if(from.address!==ws.data.ip||from.port!==devicePort||!packetValid(bytes))return;const now=Date.now();if(now-ws.data.rxWindow>=1000){ws.data.rxWindow=now;ws.data.rxPackets=0;}if(++ws.data.rxPackets>4000){ws.close(1008,'Device packet rate exceeded');return;}ws.data.lastPeer=now;if(!ws.data.wasAlive){ws.data.wasAlive=true;send(ws,{type:'peer',connected:true});}if(ws.readyState===1)ws.sendBinary(bytes);});
     udp.bind(0,()=>{if(ws.readyState!==1)return;ws.data.ready=true;send(ws,{type:'transport',ready:true});});return;
    }
    if(!ws.data.ready||!packetValid(message))throw new Error('Only CWL2 game-link packets are accepted');
    ws.data.udp.send(message,devicePort,ws.data.ip);
   }catch(e){send(ws,{type:'error',message:'Invalid device address or game-link packet.'});ws.close(1008,'Invalid bridge request');}
  },close}});
 const tick=setInterval(()=>{for(const ws of peers){if(!ws.data.ready&&Date.now()>ws.data.deadline)ws.close(1008,'Device selection timed out');else if(ws.data.wasAlive&&Date.now()-ws.data.lastPeer>2000){ws.data.wasAlive=false;send(ws,{type:'peer',connected:false});}}},250);
 return {port:server.port,token,close(){clearInterval(tick);for(const ws of peers){ws.close();close(ws);}server.stop(true);}};
}
