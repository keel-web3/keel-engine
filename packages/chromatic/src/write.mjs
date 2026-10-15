/** CBU1 direct USB writes. No ESP32 staging, firmware install, auto-resume or cancel. */
import {crc32} from './transport.mjs';
import {readCartInfo,readCartRange} from './cbu1.mjs';
import {inspectRom} from './cartridge.mjs';
import {sha256} from './library.mjs';
const hex=n=>n.toString(16).padStart(8,'0');
export function planCartridgeWrite(rom,info,backupRom,save){
 if(!(rom instanceof Uint8Array)||rom.length<32768||rom.length%16384)throw new Error('Choose a complete bank-aligned ROM.');
 const header=inspectRom(rom);
 if(!header.headerChecksumValid||header.oversized||!header.declaredBytes)throw new Error('The selected ROM header is invalid.');
 if(header.mapper!=='MBC5')throw new Error('This USB writer supports MBC5 ROMs. RTC/MBC3 cartridges need their compatible external programmer.');
 if(!info.engine||info.flashBytes>2*1048576||header.declaredBytes>info.flashBytes||rom.length>info.flashBytes||info.ramBytes!==32768||!Number.isSafeInteger(header.ramBytes)||header.ramBytes>info.ramBytes)throw new Error('This ROM or cartridge exceeds the current USB writer limits (2 MiB ROM, 32 KiB save access).');
 if(!(backupRom instanceof Uint8Array)||backupRom.length!==info.flashBytes)throw new Error('A complete verified backup of the connected cartridge is required.');
 if(!(save instanceof Uint8Array)||save.length!==info.ramBytes)throw new Error('The selected save must cover the cartridge save range exactly.');
 if(!Number.isSafeInteger(info.writableBytes)||info.writableBytes<32768||info.writableBytes>info.flashBytes)throw new Error('The writable range is not known.');
 for(let i=info.writableBytes;i<rom.length;i++)if(rom[i]!==backupRom[i])throw new Error('The selected ROM changes protected cartridge bytes. Nothing can be written.');
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
 let done=false,requests=0;
 await lease.request(command,event=>{
  if(event.kind!=='line')return;const start=event.line.indexOf('CBU1 ');if(start<0)return;const line=event.line.slice(start);let m;
  if(/^CBU1 (fail|busy|refused)/.test(line))throw new Error(line.slice(0,240));
  if((m=/^CBU1 want (\d+) (\d+)( bin)?$/.exec(line))){
   const offset=Number(m[1]),length=Number(m[2]);
   if(!!m[3]!==binary||!length||offset+length>bytes.length||++requests>Math.ceil(bytes.length/64)*12+1024)throw new Error('The cartridge requested an invalid range. The write was not verified.');
   const frame=cartridgeDataFrame(offset,bytes.slice(offset,offset+length),binary);
   void lease.sendChunk(frame).catch(error=>lease.fail(error));return;
  }
  if((m=/^CBU1 progress rom (\S+) (\d+) (\d+) (\d+)$/.exec(line)))onProgress({phase:m[1],received:Number(m[2]),total:Number(m[3])});
  if(line.startsWith(`CBU1 done ${kind} `)){
   if(line!==(kind==='rom'?`CBU1 done rom ${bytes.length} ${crc}`:`CBU1 done sav ${crc}`))throw new Error('The device completion checksum does not match the selected file.');done=true;
  }
  if(line==='CBU1 ready'){if(!done)throw new Error('The device stopped before confirming the write.');return true;}
 },{timeout:Math.max(300000,bytes.length*20+120000)});
 return {sha256:hash,crc32:crc};
}
/** The caller must obtain an explicit review/confirmation and a fresh two-read backup. */
export async function writeVerifiedCartridge(session,expectedInfo,plan,onProgress=()=>{}){
 const fresh=await readCartInfo(session);
 if(JSON.stringify(fresh)!==JSON.stringify(expectedInfo))throw new Error('The cartridge changed after backup. Read and back it up again.');
 const lease=session.beginCartridgeWrite();
 try{
  onProgress({phase:'Writing ROM',received:0,total:plan.writeRom.length});
  await streamCartridgeWrite(lease,'rom',plan.writeRom,{binary:fresh.binary,onProgress});
  onProgress({phase:'Reading ROM back',received:0,total:plan.verifyRom.length});
  const rom=await readCartRange(lease,'rom',plan.verifyRom.length,{skipblank:fresh.skipblank,onProgress:(received,total)=>onProgress({phase:'Reading ROM back',received,total})});
  if(await sha256(rom)!==await sha256(plan.verifyRom))throw new Error('ROM readback differs from the selected file. Keep the backup; do not retry automatically.');
  onProgress({phase:'Writing save',received:0,total:plan.save.length});
  await streamCartridgeWrite(lease,'sav',plan.save,{binary:fresh.binary,onProgress});
  const save=await readCartRange(lease,'sav',plan.save.length,{onProgress:(received,total)=>onProgress({phase:'Reading save back',received,total})});
  if(await sha256(save)!==await sha256(plan.save))throw new Error('ROM verified, but save readback differs. Keep the backup; save restore is incomplete.');
  return {romSha256:await sha256(rom),saveSha256:await sha256(save),verified:true};
 }finally{lease.release();}
}
