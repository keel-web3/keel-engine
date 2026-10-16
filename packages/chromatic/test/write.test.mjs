import test from 'node:test';import assert from 'node:assert/strict';
import {ConsoleSession,crc32} from '../src/transport.mjs';
import {parseCartInfo} from '../src/cbu1.mjs';
import {planCartridgeWrite,cartridgeDataFrame,writeVerifiedCartridge} from '../src/write.mjs';
const enc=new TextEncoder(),hex=n=>n.toString(16).padStart(8,'0');
function rom(seed=4){const b=new Uint8Array(32768).fill(seed);b.set(enc.encode('OURGAME'),0x134);b[0x13b]=0;b[0x143]=0xc0;b[0x147]=0x1b;b[0x148]=0;b[0x149]=2;let h=0;for(let i=0x134;i<=0x14c;i++)h=(h-b[i]-1)&255;b[0x14d]=h;let g=0;for(let i=0;i<b.length;i++)if(i!==0x14e&&i!==0x14f)g=(g+b[i])&65535;b[0x14e]=g>>8;b[0x14f]=g&255;return b;}
const INFO='CBU1 info proto=1 flash=32768 writable=32768 ram=32768 chunk=1024 skipblank=1 bin=1 engine=1 type=1b romcode=00 ramcode=02 header=ok title="OLDGAME"';
function readFrame(kind,offset,data){const b=new Uint8Array(data.length+15),v=new DataView(b.buffer);b.set([0xa5,67,66,85,kind==='rom'?82:83]);v.setUint32(5,offset,true);v.setUint16(9,data.length,true);b.set(data,11);v.setUint32(11+data.length,crc32(b.subarray(4,11+data.length)),true);return b;}
class Port {
 constructor(options={}){this.options=options;this.commands=[];this.flash=rom(1);this.save=new Uint8Array(32768).fill(3);this.job=null;}
 getInfo(){return {usbVendorId:0x374e,usbProductId:0x0101};}
 async setSignals(){}async close(){}
 line(s){this.c.enqueue(enc.encode(s+'\r\n'));}
 async open(){this.readable=new ReadableStream({start:c=>this.c=c});this.writable=new WritableStream({write:b=>this.receive(b)});}
 receive(b){
  if(b[0]===0xa5){const v=new DataView(b.buffer,b.byteOffset,b.byteLength),offset=v.getUint32(4,true),n=v.getUint16(8,true);assert.deepEqual([...b.slice(0,4)],[0xa5,67,66,68]);assert.equal(b.length,14+n);assert.equal(v.getUint32(10+n,true),crc32(b.subarray(4,10+n)));this.job.bytes.set(b.subarray(10,10+n),offset);if(this.options.disconnect){this.c.error(new Error('USB unplugged'));return;}if(offset+n<this.job.bytes.length){this.line(`CBU1 want ${offset+n} ${Math.min(1024,this.job.bytes.length-offset-n)} bin`);return;}const j=this.job;if(this.options.duplicateWant)this.line(`CBU1 want ${offset} ${n} bin`);assert.equal(crc32(j.bytes),j.crc);if(j.kind==='rom')this.flash.set(j.bytes);else this.save=j.bytes;this.line(j.kind==='rom'?`CBU1 done rom ${j.bytes.length} ${hex(j.crc)}`:`CBU1 done sav ${hex(j.crc)}`);this.line('CBU1 ready');this.job=null;return;
  }
  const cmd=new TextDecoder().decode(b).trim();if(!cmd)return;this.commands.push(cmd);
  if(cmd==='cart usb status'){this.line('CBU1 status idle');return;}
  if(cmd==='cart usb info'){this.line(this.options.changed?INFO.replace('OLDGAME','DIFFERENT'):(this.options.info||INFO));this.line('CBU1 ready');return;}
  const write=/^cart usb write (rom|sav)(?: (\d+) ([0-9a-f]{8}) ([0-9a-f]{64}))? bin$/.exec(cmd);
  if(write){if(this.options.refuse){this.line('CBU1 fail rom code=13');return;}const kind=write[1],n=kind==='rom'?Number(write[2]):32768;this.job={kind,bytes:new Uint8Array(n),crc:kind==='rom'?parseInt(write[3],16):crc32(new Uint8Array(32768).fill(9))};this.line(`CBU1 want 0 ${Math.min(1024,n)} bin`);return;}
  const read=/^cart usb read (rom|sav) (\d+) (\d+)(?: skipblank)?$/.exec(cmd);
  if(read){const kind=read[1],offset=Number(read[2]),data=(kind==='rom'?this.flash:this.save).slice(offset,offset+Number(read[3]));if(this.options.corruptReadback&&kind==='rom')data[700]^=1;for(let i=0;i<data.length;i+=1024)this.c.enqueue(readFrame(kind,offset+i,data.slice(i,i+1024)));this.line(`CBU1 end ${kind} ${offset} ${data.length} ${hex(crc32(data))}`);this.line('CBU1 ready');return;}
  throw new Error('Unexpected fixture command '+cmd);
 }
}
const info=parseCartInfo(INFO),save=new Uint8Array(32768).fill(9);
test('binary and text chunk formats follow public CBU1 offsets and CRC coverage',()=>{const b=cartridgeDataFrame(0x1234,Uint8Array.of(1,2,255),true),v=new DataView(b.buffer);assert.equal(v.getUint32(4,true),0x1234);assert.equal(v.getUint16(8,true),3);assert.equal(v.getUint32(13,true),crc32(b.subarray(4,13)));assert.equal(new TextDecoder().decode(cartridgeDataFrame(12,Uint8Array.of(1,2,3),false)),`cart usb d 12 AQID ${hex(crc32(Uint8Array.of(1,2,3)))}\r\n`);assert.throws(()=>cartridgeDataFrame(0,new Uint8Array(1025),true),/Invalid/);});
test('explicit cartridge lease excludes input and arbitrary commands; release before wake sends no write',async()=>{const p=new Port(),s=await new ConsoleSession(p).open(),lease=s.beginCartridgeWrite();assert.throws(()=>s.request('fwversion',()=>{}),/owns/);assert.throws(()=>s.beginInput(),/idle/);assert.throws(()=>lease.request('cart usb clear',()=>{}),/Unsupported/);const job=lease.request('cart usb write sav bin',()=>{});lease.release();await assert.rejects(job,/disabled before/);assert.deepEqual(p.commands,[]);await s.close();});
test('plan refuses an incomplete supplied backup, RTC mapper, excess capacity, save mismatch and protected-byte changes',()=>{assert.throws(()=>planCartridgeWrite(rom(),info,new Uint8Array(1),save),/backup/);let rtc=rom();rtc[0x147]=0x10;let h=0;for(let i=0x134;i<=0x14c;i++)h=(h-rtc[i]-1)&255;rtc[0x14d]=h;assert.throws(()=>planCartridgeWrite(rtc,info,rom(1),save),/external/);assert.throws(()=>planCartridgeWrite(rom(),{...info,flashBytes:16384},rom(1),save),/limits/);assert.throws(()=>planCartridgeWrite(rom(),info,rom(1),new Uint8Array(8192)),/save/);const large=new Uint8Array(65536).fill(255);large.set(rom());large[0x148]=1;let check=0;for(let i=0x134;i<=0x14c;i++)check=(check-large[i]-1)&255;large[0x14d]=check;const backup=large.slice();backup[60000]=1;assert.throws(()=>planCartridgeWrite(large,{...info,flashBytes:65536,writableBytes:32768},backup,save),/protected/);});
test('direct ROM+save write verifies both full readbacks and can restore the prior ROM',async()=>{const p=new Port(),s=await new ConsoleSession(p).open(),old=p.flash.slice(),plan=planCartridgeWrite(rom(),info,old,save);const result=await writeVerifiedCartridge(s,info,plan);assert.equal(result.verified,true);assert.deepEqual(p.flash,rom());assert.deepEqual(p.save,save);const back=planCartridgeWrite(old,info,p.flash,save);assert.equal((await writeVerifiedCartridge(s,info,back)).verified,true);assert.deepEqual(p.flash,old);assert.equal(p.commands.filter(c=>c.startsWith('cart usb write rom')).length,2);assert.equal(p.commands.some(c=>c.includes('stage')||c.includes('clear')),false);await s.close();});
for(const [mode,pattern] of [['changed',/changed/],['refuse',/code=13/],['corruptReadback',/readback differs/],['disconnect',/unplugged/]])test(`write failure: ${mode} retains failure and never retries the job`,async()=>{const p=new Port({[mode]:true}),s=await new ConsoleSession(p).open(),plan=planCartridgeWrite(rom(),info,p.flash,save);await assert.rejects(writeVerifiedCartridge(s,info,plan),pattern);assert.ok(p.commands.filter(c=>c.startsWith('cart usb write rom')).length<=1);assert.equal(p.commands.some(c=>c.startsWith('cart usb write sav')),false);await s.close();});

test('a late duplicate chunk request never sends old ROM bytes into readback or the next save job',async()=>{const p=new Port({duplicateWant:true}),s=await new ConsoleSession(p).open(),plan=planCartridgeWrite(rom(),info,p.flash,save);assert.equal((await writeVerifiedCartridge(s,info,plan)).verified,true);assert.deepEqual(p.save,save);await s.close();});

test('a ROM-only original cartridge can be restored after installing a banked game',async()=>{const p=new Port(),original=rom(1);original[0x147]=0;original[0x149]=0;let h=0;for(let i=0x134;i<=0x14c;i++)h=(h-original[i]-1)&255;original[0x14d]=h;p.flash=original.slice();const s=await new ConsoleSession(p).open();assert.equal((await writeVerifiedCartridge(s,info,planCartridgeWrite(rom(),info,p.flash,save))).verified,true);assert.equal((await writeVerifiedCartridge(s,info,planCartridgeWrite(original,info,p.flash,save))).verified,true);assert.deepEqual(p.flash,original);await s.close();});


test('writing without a backup performs no pre-write ROM/save backup and still verifies both outputs',async()=>{
 const p=new Port(),s=await new ConsoleSession(p).open();
 assert.equal((await writeVerifiedCartridge(s,info,planCartridgeWrite(rom(),info,null,save))).verified,true);
 const firstWrite=p.commands.findIndex(c=>c.startsWith('cart usb write'));
 assert.equal(p.commands.slice(0,firstWrite).some(c=>c.startsWith('cart usb read')),false);
 assert.equal(p.commands.filter(c=>c.startsWith('cart usb read')).length,2);
 assert.deepEqual(p.flash,rom());assert.deepEqual(p.save,save);await s.close();
});
function protectedRom(){const b=new Uint8Array(65536).fill(255);b.set(rom());b[0x148]=1;let h=0;for(let i=0x134;i<=0x14c;i++)h=(h-b[i]-1)&255;b[0x14d]=h;return b;}
for(const mismatch of [false,true])test(`no-backup protected tail is checked before writing: mismatch=${mismatch}`,async()=>{
 const wireInfo=INFO.replace('flash=32768','flash=65536'),geometry=parseCartInfo(wireInfo),target=protectedRom();
 const p=new Port({info:wireInfo});p.flash=new Uint8Array(65536).fill(255);p.flash.set(rom(1));if(mismatch)p.flash[60000]=17;
 const s=await new ConsoleSession(p).open(),plan=planCartridgeWrite(target,geometry,null,save);
 if(mismatch){await assert.rejects(writeVerifiedCartridge(s,geometry,plan),/protected/);assert.equal(p.commands.some(c=>c.startsWith('cart usb write')),false);}
 else{assert.equal((await writeVerifiedCartridge(s,geometry,plan)).verified,true);assert.deepEqual(p.flash,target);}
 assert.equal(p.commands.find(c=>c.startsWith('cart usb read')),'cart usb read rom 32768 32768');
 await s.close();
});
