import {test,expect} from 'bun:test';
import {createSocket} from 'node:dgram';
import {startBridge,localAddress} from '../helper/server.mjs';
const origin='https://crucible.onkeel.io';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function client(bridge,{key=bridge.token,from=origin}={}){
 const ws=new WebSocket(`ws://127.0.0.1:${bridge.port}/bridge`,{protocols:['chromatic-v1',`key.${key}`],headers:{Origin:from}});ws.binaryType='arraybuffer';const messages=[];
 ws.addEventListener('message',e=>messages.push(typeof e.data==='string'?JSON.parse(e.data):new Uint8Array(e.data)));
 await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('Rejected'));});
 return {ws,messages,async next(match){for(let n=0;n<200;n++){const i=messages.findIndex(match);if(i>=0)return messages.splice(i,1)[0];await pause(5);}throw new Error('Message timeout');}};
}
test('private IPv4 addresses only; reject DNS, public and loopback targets',()=>{for(const ip of ['10.0.0.4','172.16.0.1','192.168.1.2'])expect(localAddress(ip)).toBe(true);for(const ip of ['127.0.0.1','8.8.8.8','localhost','10.0.0.255','169.254.1.1',undefined])expect(localAddress(ip)).toBe(false);});
test('origin and launch token required, only one owner',async()=>{const b=startBridge({port:0});let c;try{await expect(client(b,{from:'https://evil.example'})).rejects.toThrow();await expect(client(b,{key:'a'.repeat(64)})).rejects.toThrow();c=await client(b);const hello=await c.next(x=>x.type==='helper');expect(hello.capabilities).toEqual({link:true,console:false,cartridge:false,firmware:false});await expect(client(b)).rejects.toThrow();}finally{c?.ws.close();b.close();}});
test('real WebSocket to UDP round trip and device expiry',async()=>{const udp=createSocket('udp4');await new Promise(r=>udp.bind(0,'127.0.0.1',r));const b=startBridge({port:0,devicePort:udp.address().port,allowAddress:ip=>ip==='127.0.0.1'});let c;try{c=await client(b);c.ws.send(JSON.stringify({type:'connect',ip:'127.0.0.1'}));await c.next(x=>x.type==='transport');expect(c.messages.some(x=>x.type==='peer')).toBe(false);const got=new Promise(r=>udp.once('message',(bytes,from)=>{r([...bytes]);udp.send(Buffer.from([67,87,2,5,0,99]),from.port,from.address);}));c.ws.send(Uint8Array.of(67,87,2,6,0,88));expect(await got).toEqual([67,87,2,6,0,88]);expect((await c.next(x=>x.type==='peer')).connected).toBe(true);expect([...(await c.next(x=>x instanceof Uint8Array))]).toEqual([67,87,2,5,0,99]);await pause(2250);expect((await c.next(x=>x.type==='peer')).connected).toBe(false);}finally{c?.ws.close();b.close();udp.close();}});
test('reject non-link payloads and unselected targets',async()=>{const b=startBridge({port:0});let c;try{c=await client(b);c.ws.send(new Uint8Array([1,2,3]));await c.next(x=>x.type==='error');await pause(20);expect(c.ws.readyState).toBe(WebSocket.CLOSED);}finally{c?.ws.close();b.close();}});
