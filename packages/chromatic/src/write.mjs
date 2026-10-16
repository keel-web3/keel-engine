/** CBU1 direct USB writes. No ESP32 staging, firmware install, auto-resume or cancel. */
import {crc32} from './transport.mjs';
import {readCartInfo,readCartRange} from './cbu1.mjs';
import {inspectRom} from './cartridge.mjs';
import {sha256} from './library.mjs';
const hex=n=>n.toString(16).padStart(8,'0');
const phases={check:'Checking cartridge',erase:'Erasing first block',write:'Writing ROM',tidy:'Clearing unused space',hash:'Hashing first block',verify:'Verifying ROM on device',save:'Writing save',header:'Writing boot block','check-header':'Verifying boot block'};
export function planCartridgeWrite(rom,info,backupRom,save){
 if(!(rom instanceof Uint8Array)||rom.length<32768||rom.length%16384)throw new Error('Choose a complete bank-aligned ROM.');
 const header=inspectRom(rom);
 if(!header.headerChecksumValid||header.oversized||!header.declaredBytes)throw new Error('The selected ROM header is invalid.');
 if(!['MBC5','ROM'].includes(header.mapper))throw new Error('This USB writer supports ROM-only and MBC5 images. RTC/MBC3 cartridges need their compatible external programmer.');
 if(!info.engine||info.flashBytes>2*1048576||header.declaredBytes>info.flashBytes||rom.length>info.flashBytes||info.ramBytes!==32768||!Number.isSafeInteger(header.ramBytes)||header.ramBytes>info.ramBytes)throw new Error('This ROM or cartridge exceeds the current USB writer limits (2 MiB ROM, 32 KiB save access).');
 if(backupRom!==null&&(!(backupRom instanceof Uint8Array)||backupRom.length!==info.flashBytes))throw new Error('The supplied backup does not cover the connected cartridge.');
 if(!(save instanceof Uint8Array)||save.length!==info.ramBytes)throw new Error('The selected save must cover the cartridge save range exactly.');
 if(!Number.isSafeInteger(info.writableBytes)||info.writableBytes<32768||info.writableBytes>info.flashBytes)throw new Error('The writable range is not known.');
 for(let i=info.writableBytes;backupRom&&i<rom.length;i++)if(rom[i]!==backupRom[i])throw new Error('The selected ROM changes protected cartridge bytes. Nothing can be written.');
 return {writeRom:rom.slice(0,Math.min(rom.length,info.writableBytes)),verifyRom:rom,save,header};
}
export function cartridgeDataFrame(offset,data,binary){
 if(!Number.isSafeInteger(offset)||offset<0||offset>0xffffffff||!(data instanceof Uint8Array)||!data.length||data.length>(binary?1024:96))throw new Error('Invalid cartridge chunk request.');
 if(!binary){let raw='';for(const b of data)raw+=String.fromCharCode(b);return new TextEncoder().encode(`cart usb d ${offset} ${btoa(raw)} ${hex(crc32(data))}\r\n`);}
 const frame=new Uint8Array(data.length+14),v=new DataView(frame.buffer);frame.set([0xa5,67,66,68]);v.setUint32(4,offset,true);v.setUint16(8,data.length,true);frame.set(data,10);v.setUint32(10+data.length,crc32(frame.subarray(4,10+data.length)),true);return frame;
}
export async function streamCartridgeWrite(lease,kind,bytes,{binary=true,onProgress=()=>{}}={}){
 const crc=hex(crc32(bytes)),hash=await sha256(bytes);
 const command=kind==='rom'?`cart usb write rom ${bytes.length} ${crc} ${hash}${binary?' bin':''}`:`cart usb write sav${binary?' bin':''}`;
 let done=false,requests=0,verifiedBody=false,verifiedHeader=false;const timings={};
 await lease.request(command,event=>{
  if(event.kind!=='line')return;const start=event.line.indexOf('CBU1 ');if(start<0)return;const line=event.line.slice(start);let m;
  if(/^CBU1 (fail|busy|refused)/.test(line))throw new Error(line.slice(0,240));
  if((m=/^CBU1 want (\d+) (\d+)( bin)?$/.exec(line))){
   const offset=Number(m[1]),length=Number(m[2]);
   if(!!m[3]!==binary||!length||offset+length>bytes.length||++requests>Math.ceil(bytes.length/64)*12+1024)throw new Error('The cartridge requested an invalid range. The write was not verified.');
   const frame=cartridgeDataFrame(offset,bytes.slice(offset,offset+length),binary);
   void lease.sendChunk(frame).catch(error=>lease.fail(error));return;
  }
  if((m=/^CBU1 progress rom (\S+) (\d+) (\d+) (\d+)$/.exec(line)))onProgress({phase:phases[m[1]]||m[1],received:Number(m[2]),total:Number(m[3])});
  // These are completed phases, not merely announcements that a check began.
  // cf_usb.c emits them on phase exit; direct USB always uses full verification.
  if(!done&&(m=/^CBU1 time rom (\S+) (\d+)(?: erases=\d+ retries=\d+)?$/.exec(line))){
   if(Object.hasOwn(phases,m[1])||m[1]==='total')timings[m[1]]=Number(m[2]);
   if(m[1]==='verify')verifiedBody=true;
   if(m[1]==='check-header'&&verifiedBody)verifiedHeader=true;
  }
  if(line.startsWith(`CBU1 done ${kind} `)){
   if(line!==(kind==='rom'?`CBU1 done rom ${bytes.length} ${crc}`:`CBU1 done sav ${crc}`))throw new Error('The device completion checksum does not match the selected file.');done=true;
  }
  if(line==='CBU1 ready'){if(!done)throw new Error('The device stopped before confirming the write.');return true;}
 },{timeout:Math.max(300000,bytes.length*20+120000)});
 return {sha256:hash,crc32:crc,deviceVerified:kind==='rom'&&verifiedBody&&verifiedHeader,timings};
}
/** The caller must obtain an explicit review/confirmation, including data-loss acknowledgment when no backup is retained. */
export async function writeVerifiedCartridge(session,expectedInfo,plan,onProgress=()=>{}){
 const fresh=await readCartInfo(session);
 if(JSON.stringify(fresh)!==JSON.stringify(expectedInfo))throw new Error('The cartridge changed after review. Read its identity and confirm again.');
 const lease=session.beginCartridgeWrite();
 try{
  // Protected bytes are compared against the device even when the user skips backup.
  const offset=plan.writeRom.length,tail=plan.verifyRom.subarray(offset);
  if(tail.length){
   const current=await readCartRange(lease,'rom',tail.length,{offset,onProgress:(received,total)=>onProgress({phase:'Checking protected bytes',received,total})});
   if(current.some((byte,i)=>byte!==tail[i]))throw new Error('The selected ROM changes protected cartridge bytes. Nothing was written.');
  }
  onProgress({phase:'Writing ROM',received:0,total:plan.writeRom.length});
  const written=await streamCartridgeWrite(lease,'rom',plan.writeRom,{binary:fresh.binary,onProgress});
  const romSha256=tail.length?await sha256(plan.verifyRom):written.sha256;
  if(written.deviceVerified){
   // cf_esp.c SP_HASHCART checks SHA-256 + CRC32 using actual cartridge bytes
   // with the withheld boot block; SP_BLK0CHK then checks that block's readback
   // CRC32. Matching done + ready is required as well. Avoid downloading it again.
   // Protected bytes were not part of that write and still need their own check.
   if(tail.length){const actual=await readCartRange(lease,'rom',tail.length,{offset,onProgress:(received,total)=>onProgress({phase:'Verifying protected bytes',received,total})});if(actual.some((byte,i)=>byte!==tail[i]))throw new Error('Protected ROM readback differs. The write was not verified.');}
  }else{
   onProgress({phase:'Reading ROM back',received:0,total:plan.verifyRom.length});
   const rom=await readCartRange(lease,'rom',plan.verifyRom.length,{skipblank:fresh.skipblank,onProgress:(received,total)=>onProgress({phase:'Reading ROM back',received,total})});
   if(await sha256(rom)!==romSha256)throw new Error('ROM readback differs from the selected file. Keep any backup; do not retry automatically.');
  }
  onProgress({phase:'Writing save',received:0,total:plan.save.length});
  const saved=await streamCartridgeWrite(lease,'sav',plan.save,{binary:fresh.binary,onProgress});
  const save=await readCartRange(lease,'sav',plan.save.length,{onProgress:(received,total)=>onProgress({phase:'Reading save back',received,total})});
  const saveSha256=await sha256(save);
  if(saveSha256!==saved.sha256)throw new Error('ROM verified, but save readback differs. Keep any backup; save restore is incomplete.');
  return {romSha256,saveSha256,verified:true,romVerification:written.deviceVerified?'firmware-sha256-crc32':'browser-sha256',deviceTimings:written.timings};
 }finally{lease.release();}
}
