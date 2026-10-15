// SPDX-License-Identifier: Apache-2.0
// GW5A SRAM sequence and GWU2X packet format adapted from openFPGALoader v1.1.1.
// Copyright (C) 2024 Gwenhael Goavec-Merou. See THIRD_PARTY.md.
// No SPI access or nonvolatile flash write instructions are implemented here.
export const ENGINE_URL='https://install.shinyrelay.com/cart/engine.fs';
export const ENGINE_SHA256='6e30f490e9d4702f5a96f63e368afb56802ba7c9e38544428302b8fbd10204ee';
export async function fetchEngine(){
 const response=await fetch(ENGINE_URL,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('Temporary engine download failed. Nothing on the device was changed.');
 return checkEngine(new Uint8Array(await response.arrayBuffer()));
}
export async function checkEngine(bytes){
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==ENGINE_SHA256)throw new Error('Temporary engine SHA-256 did not match. Nothing on the device was changed.');
 return parseSram(new TextDecoder().decode(bytes));
}
// This pinned release is uncompressed. Reject other encodings rather than guessing.
export function parseSram(text){
 const lines=text.split(/\r?\n/).filter(l=>l&&!l.startsWith('//'));
 if(!lines.length||lines.some(l=>!/^[01]+$/.test(l)||l.length%8))throw new Error('Invalid FPGA bitstream.');
 const raw=lines.map(l=>Uint8Array.from(l.match(/.{8}/g),b=>parseInt(b,2)));
 let id=0,rows=0,start=-1,crc=false;
 for(let i=0;i<raw.length;i++){
  const b=raw[i],key=b[0]&127;let value=0;for(const v of b.slice(-4))value=(value*256+v)>>>0;
  if(key===6)id=value;
  if(key===16&&(value&8192))throw new Error('Compressed engines are not supported.');
  if(key===59){rows=value&65535;crc=!!(value&0x800000);start=i+1;break;}
 }
 if((id&0x0fffffff)!==0x1281b||start<0||!rows||start+rows>raw.length)throw new Error('Engine is not a complete GW5A-25 image.');
 let checksum=0,high=null;
 for(const row of raw.slice(start,start+rows)){
  const end=row.length-(crc?8:6);if(end<0)throw new Error('Invalid engine configuration row.');
  for(const byte of row.subarray(0,end)){if(high===null)high=byte;else{checksum=(checksum+high*256+byte)&65535;high=null;}}
 }
 if(high!==null)throw new Error('Unaligned engine checksum.');
 const data=new Uint8Array(raw.reduce((sum,b)=>sum+b.length,0));let at=0;
 for(const row of raw)for(let b of row){b=((b&0x55)<<1)|((b>>>1)&0x55);b=((b&0x33)<<2)|((b>>>2)&0x33);data[at++]=((b&15)<<4)|(b>>>4);}
 return {data,checksum,idcode:id&0x0fffffff};
}
class SramJtag{
 constructor(device){this.device=device;this.failed=false;}
 async io(bytes,size=0){
  if(this.failed)throw new Error('FPGA preparation stopped. Reconnect the bridge.');
  let timer;const work=(async()=>{
   const out=await this.device.transferOut(2,Uint8Array.from(bytes));
   if(out.status!=='ok'||out.bytesWritten!==bytes.length)throw new Error('Incomplete FPGA transfer.');
   if(!size)return;
   const ack=await this.device.transferIn(3,4);if(ack.status!=='ok'||ack.data?.byteLength!==4)throw new Error('Missing FPGA acknowledgement.');
   const result=new Uint8Array(size);let at=0;
   while(at<size){const r=await this.device.transferIn(1,size-at);if(r.status!=='ok'||!r.data?.byteLength||r.data.byteLength>size-at)throw new Error('Incomplete FPGA response.');result.set(new Uint8Array(r.data.buffer,r.data.byteOffset,r.data.byteLength),at);at+=r.data.byteLength;}return result;
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{this.failed=true;void this.device.close().catch(()=>{});reject(new Error('FPGA transfer timed out. Preparation stopped; no cartridge bytes were written.'));},8000);})]);}catch(e){this.failed=true;throw e;}finally{clearTimeout(timer);}
 }
 async init(){await this.io([0x20,7,2,0x21,0,0,0xab,60]);await this.io([0x5b,5,0x1f]);}
 async command(cmd){await this.io([0x5b,3,3,0x6b,6,cmd&127,0x5b,0,1|((cmd&128)?128:0),0x5b,1,1,0x9b,5,0]);}
 async clocks(n){while(n){const count=Math.min(n,65536)-1;await this.io([0x9b,count&255,count>>>8]);n-=count+1;}}
 async register(cmd){await this.command(cmd);await this.io([0x5b,2,1]);const low=await this.io([0x7c,2,255,255,255,0x8b],3);const high=await this.io([0x6c,6,255,0x5c,0,0x81,0x8b],1);await this.io([0x5b,1,1]);return (low[0]|low[1]<<8|low[2]<<16|high[0]<<24)>>>0;}
 async poll(mask,value){const end=Date.now()+10000;while(Date.now()<end){const st=await this.register(0x41);if((st&mask)===value)return st;await new Promise(r=>setTimeout(r,25));}throw new Error('FPGA preparation status timed out. No cartridge bytes were written.');}
 async disable(){await this.command(0x3a);await this.command(2);await this.poll(128,0);}
 async shift(data,onProgress=()=>{}){
  await this.io([0x5b,2,1]);
  // Keep SHIFT-DR across all packets. Only the final bit exits the shift state.
  for(let at=0;at<data.length-1;){const n=Math.min(256,data.length-1-at);await this.io([0x7b,n-1,...data.subarray(at,at+n)]);at+=n;if(at%16384===0||at===data.length-1)onProgress(at,data.length);}
  const last=data[data.length-1];await this.io([0x6b,6,last&127,0x5b,0,1|((last&128)?128:0),0x5b,1,1]);onProgress(data.length,data.length);
 }
}
export async function loadSram(device,image,onProgress=()=>{}){
 if(image.idcode!==0x1281b||!image.data?.length)throw new Error('Invalid temporary engine.');
 const j=new SramJtag(device);await j.init();
 if(await j.register(0x11)!==0x1281b)throw new Error('The selected USB bridge is not a GW5A-25.');
 await j.command(0x3c);await j.command(2);await j.clocks(1000000);
 let status=await j.register(0x41);
 if(status&26){for(const cmd of [0x15,0x3f,0x3a,2,0x11,2])await j.command(cmd);await j.clocks(1000);}
 let erased=false;
 for(let pass=0;pass<4;pass++){
  await j.command(0x15);await j.poll(128,128);await j.command(5);await j.command(2);await j.poll(32,32);await j.command(9);await j.command(2);await j.disable();status=await j.register(0x41);
  if(pass>=1&&!(status&8192)){erased=true;break;}
 }
 if(!erased)throw new Error('Temporary FPGA memory did not become ready. Preparation stopped.');
 for(const cmd of [0x15,0x12,0x17])await j.command(cmd);
 await j.shift(image.data,onProgress);await j.command(10);
 await j.shift(Uint8Array.of(image.checksum&255,image.checksum>>>8,0,0));
 for(const cmd of [8,0x3a,2])await j.command(cmd);
 status=await j.register(0x41);
 if(!(status&8192)||(status&15))throw new Error('FPGA did not accept the temporary engine (status 0x'+status.toString(16)+'). No cartridge bytes were written.');
 return {status};
}
