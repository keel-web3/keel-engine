import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSram,checkEngine,loadSram} from '../src/sram.mjs';
import {prepareCartridge} from '../src/prepare.mjs';
const bits=bytes=>bytes.map(b=>b.toString(2).padStart(8,'0')).join('');
const small=[bits([6,0,0,1,40,27]),bits([59,0,0,0,0,1]),bits([1,2,3,4,0,0,0,0,0,0])].join('\n');
test('SRAM parser reverses wire bytes and computes configuration checksum excluding row trailer',()=>{const image=parseSram(small);assert.equal(image.idcode,0x1281b);assert.equal(image.checksum,0x406);assert.equal(image.data[0],0x60);assert.throws(()=>parseSram(small.replace('00000110','00000111')),/GW5A/);});
test('wrong official engine bytes cannot pass the pinned digest gate',async()=>{await assert.rejects(checkEngine(new TextEncoder().encode(small)),/SHA-256/);});
function bridge({badId=false,done=true}={}){
 let command=0,read=0,configured=false,edit=false;const commands=[],packets=[];
 return {commands,packets,opened:true,async close(){this.opened=false;},async transferOut(ep,bytes){assert.equal(ep,2);packets.push([...bytes]);if(bytes[0]===0x5b&&bytes[1]===3&&bytes[3]===0x6b){command=bytes[5];commands.push(command);read=0;if(command===0x15)edit=true;if(command===0x3a)edit=false;if(command===8)configured=true;}
 return {status:'ok',bytesWritten:bytes.length};},async transferIn(ep,n){let b;if(ep===3)b=new Uint8Array(4);else {const value=command===0x11?(badId?123:0x1281b):32|(edit?128:0)|(configured&&done?8192:0);const all=Uint8Array.of(value&255,value>>>8&255,value>>>16&255,value>>>24);b=all.slice(read,read+n);read+=n;}return {status:'ok',data:new DataView(b.buffer)};}};
}
test('SRAM loader uses volatile configuration only, exits final bit, and checks DONE',async()=>{const d=bridge();await loadSram(d,parseSram(small));assert.deepEqual(d.commands.slice(0,4),[0x11,0x3c,2,0x41]);assert.equal(d.commands.filter(c=>c===5).length,2);assert.ok(d.commands.includes(0x17));assert.ok(d.commands.includes(10));assert.ok(d.commands.includes(8));assert.equal(d.commands.some(c=>[0x16,0x75,0x71].includes(c)),false);assert.ok(d.packets.some(p=>p[0]===0x6b&&p.at(-3)===0x5b));});
test('wrong hardware ID aborts before any configuration instruction',async()=>{const d=bridge({badId:true});await assert.rejects(loadSram(d,parseSram(small)),/GW5A/);assert.deepEqual(d.commands,[0x11]);});
test('load without DONE is rejected',async()=>{await assert.rejects(loadSram(bridge({done:false}),parseSram(small)),/did not accept/);});
function setup({busy=false,lose=true,returns=true,engine=true}={}){
 const commands=[],stages=[];let loaded=0,closed=0,input;
 const original={getInfo:()=>({usbVendorId:0x374e,usbProductId:0x0101})};
 const returned={...original,async open(){this.readable=new ReadableStream({start:c=>input=c});},async setSignals(){},async close(){},writable:new WritableStream({write(b){const cmd=new TextDecoder().decode(b).trim();if(!cmd)return;commands.push(cmd);const line=cmd==='cart usb status'?'CBU1 status idle':`CBU1 info proto=1 flash=2097152 writable=2031616 ram=8192 chunk=1024 skipblank=1 bin=1 engine=${engine?1:0} type=1b romcode=06 ramcode=02 header=ok title="REAL RESPONSE"\r\nCBU1 ready`;input.enqueue(new TextEncoder().encode(line+'\r\n'));}})};
 let ports=[original];const d=Object.assign(bridge(),{vendorId:0x33aa,productId:0x0120});
 const serial=Object.assign(new EventTarget(),{getPorts:async()=>ports});const nav={serial,usb:{getDevices:async()=>[d]}};
 const session={port:original,closed:false,async close(){closed++;this.closed=true;},async request(cmd,handle){commands.push(cmd);return handle({kind:'line',line:busy?'CBU1 status unfinished':'CBU1 status idle'});}};
 let next;return {commands,stages,get loaded(){return loaded;},get closed(){return closed;},get next(){return next;},options:{nav,session,bridge:d,onStage:s=>stages.push(s),onSession:s=>next=s},deps:{fetchImage:async()=>parseSram(small),loadImage:async()=>{loaded++;if(lose)serial.dispatchEvent(Object.assign(new Event('disconnect'),{port:original}));ports=returns?[returned]:[];},wait:async()=>{},reconnectMs:5}};
}
test('preparation waits for physical disconnect/reconnect then verifies engine identity',async()=>{const f=setup();const info=await prepareCartridge(f.options,f.deps);assert.equal(info.engine,true);assert.equal(f.loaded,1);assert.equal(f.closed,1);assert.deepEqual(f.commands,['cart usb status','cart usb status','cart usb info']);assert.ok(f.stages.some(s=>s.includes('return')));await f.next.close();});
test('an unfinished operation stops preparation before download or FPGA changes',async()=>{const f=setup({busy:true});await assert.rejects(prepareCartridge(f.options,f.deps),/unfinished/);assert.equal(f.loaded,0);assert.equal(f.closed,0);});
test('missing console loss, missing return and unconfirmed engine never succeed',async()=>{for(const [options,error] of [[{lose:false},/did not disconnect/],[{returns:false},/did not return/],[{engine:false},/did not confirm/]]){const f=setup(options);await assert.rejects(prepareCartridge(f.options,f.deps),error);if(!options.engine&&f.next)await f.next.close();}});
