"use client";
import {useEffect,useState} from 'react';
import {recognizeRelease,annotationForRelease,type PublishedRelease} from './releases.mjs';
import {ActionButton} from './controls';
import {getBytes,saveEntry,sha256,type LibraryEntry} from './library.mjs';
import {readCartInfo,verifiedBackup,type CartInfo} from './cbu1.mjs';
import {planCartridgeWrite,writeVerifiedCartridge,type WriteProgress} from './write.mjs';
import type {ConsoleSession} from './transport.mjs';
const size=(n:number)=>`${(n/1048576).toFixed(2)} MiB`;
type Receipt={session:ConsoleSession;info:CartInfo;rom:Uint8Array;save:Uint8Array;group:string;romEntry:LibraryEntry};
export function CartridgeWriter({site,session,cart,entries,releases,busy,run,refresh,onProgress,notify}:{site:string;session:ConsoleSession|null;cart:CartInfo|null;entries:LibraryEntry[];releases:PublishedRelease[];busy:boolean;run:(label:string,job:()=>Promise<void>)=>void;refresh:()=>Promise<void>;onProgress:(progress:WriteProgress)=>void;notify:(message:string)=>void}){
 const [selected,setSelected]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null),[consent,setConsent]=useState(false),[result,setResult]=useState('');
 const roms=entries.filter(e=>e.kind==='rom'),entry=roms.find(e=>e.sha256===selected);
 const restoreGroup=entry?.backupGroups?.at(-1)||entry?.group;
 const paired=restoreGroup?entries.find(e=>e.kind==='sav'&&(e.group===restoreGroup||e.backupGroups?.includes(restoreGroup))):undefined;
 const restoring=entry?.source==='cartridge-backup'||!!restoreGroup;
 const journalKey=`keel-cartridge-write:${site}`;
 useEffect(()=>{setReceipt(null);setConsent(false);},[session,cart]);
 useEffect(()=>{try{const last=JSON.parse(localStorage.getItem(journalKey)||'null');if(last&&last.state!=='complete')setResult(`Previous write ${last.state==='running'?'was interrupted':last.state}. Backup group: ${last.backupGroup}. Nothing will restart automatically. Reconnect and check cartridge status first.`);}catch{}},[journalKey]);
 let blocked='';
 if(!entry)blocked='Save a published release to the library below, or import a ROM, then choose it here.';
 else if(restoring&&!paired)blocked='This ROM backup has no matching save backup. Restore is blocked so your current save is not silently replaced.';
 else if(!entry.metadata?.headerChecksumValid)blocked='This file has an invalid header and cannot be flashed.';
 else if(entry.metadata.mapper!=='MBC5')blocked='RTC / MBC3 images require an external programmer compatible with that cartridge. This USB adapter supports MBC5.';
 else if(cart&&(entry.metadata.declaredBytes!>cart.flashBytes||entry.bytes>cart.flashBytes||cart.flashBytes>2097152||cart.ramBytes!==32768||entry.metadata.ramBytes!>cart.ramBytes))blocked='The selected ROM does not fit this USB adapter’s verified 2 MiB ROM / 32 KiB save range. Download it for a compatible external writer.';
 function backupForWrite(){run('Backing up cartridge before flash',async()=>{
  if(!session||!cart)throw new Error('Connect and identify the cartridge first.');
  const info=await readCartInfo(session);if(JSON.stringify(info)!==JSON.stringify(cart))throw new Error('The cartridge changed. Read its identity again.');
  const data=await verifiedBackup(session,info,p=>onProgress({phase:`Backup ${p.kind.toUpperCase()} · read ${p.pass}/2`,received:p.received,total:p.total}));
  if(!data.sav)throw new Error('The complete save could not be backed up.');
  const match=await recognizeRelease(data.rom,releases);
  const group=crypto.randomUUID(),name=match?.title||info.title||'Cartridge';
  const romEntry=await saveEntry(data.rom,{kind:'rom',name:name+' backup',verification:'two-device-reads',source:'cartridge-backup',group,...(match?{annotation:annotationForRelease(match)}:{})});
  const actualGroup=group;
  await saveEntry(data.sav,{kind:'sav',name:name+' save',verification:'two-device-reads',source:'cartridge-backup',group:actualGroup});
  setReceipt({session,info,rom:data.rom,save:data.sav,group:actualGroup,romEntry});setConsent(false);await refresh();notify('Current cartridge and save backed up twice and verified in local storage. Review the selected ROM before flashing.');
 });}
 function flash(){run(restoring?'Restoring cartridge backup':'Flashing selected ROM',async()=>{
  if(!session||!cart||!entry||!receipt||receipt.session!==session||!consent||blocked)throw new Error('A fresh backup and explicit write confirmation are required.');
  const target=await getBytes(entry),save=restoring&&paired?await getBytes(paired):new Uint8Array(cart.ramBytes);
  // The receipt retains the exact verified bytes. Recheck its persistent copy before any write.
  await getBytes(receipt.romEntry);const plan=planCartridgeWrite(target,cart,receipt.rom,save);
  const record={state:'running',romSha256:entry.sha256,romName:entry.name,backupGroup:receipt.group,backupRomSha256:receipt.romEntry.sha256,at:new Date().toISOString()};
  localStorage.setItem(journalKey,JSON.stringify(record));setResult('');
  try{const verified=await writeVerifiedCartridge(session,receipt.info,plan,onProgress);localStorage.setItem(journalKey,JSON.stringify({...record,state:'complete',...verified}));setResult(`${entry.name} written and read back successfully. The ROM and save match their expected SHA-256 hashes. Power the Chromatic off and on to play.`);notify(`${entry.name}: ROM and save readback verified. Your previous cartridge backup remains in the library.`);}
  catch(error){localStorage.setItem(journalKey,JSON.stringify({...record,state:'outcome-unverified'}));setResult('The write did not complete verification. Keep the backup. Do not assume the cartridge is bootable or start a different write; reconnect and check status first.');throw error;}
  finally{setConsent(false);setReceipt(null);}
 });}
 return <section className="chromatic-writer" aria-label="Flash and restore cartridge"><h3>Flash / restore cartridge</h3>
  <p>Choose a game from your local library. A verified backup comes first, then review and confirm. Choose one of your earlier ROM backups to put it and its paired save back.</p>
  <label className="chromatic-select">ROM to write<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setConsent(false);setResult('');}}><option value="">Choose a ROM or cartridge backup</option>{roms.map(e=><option key={e.sha256} value={e.sha256}>{e.name}{e.source==='cartridge-backup'?' · backup':''}</option>)}</select></label>
  {entry&&<><p><b>{entry.annotation?.title||entry.name}</b> · {size(entry.bytes)} · {entry.metadata?.mapper}</p>{entry.annotation?.previewImage&&<img className="chromatic-rom-preview" src={entry.annotation.previewImage} alt={`${entry.name} preview`} width={160} height={144} loading="lazy" referrerPolicy="no-referrer"/>}<p className="chromatic-hash">SHA-256 {entry.sha256}</p><p>{restoring&&paired?'The matching save from this backup group will be restored.':'A fresh empty save will be written. Your current game and save remain in the verified backup.'}</p></>}
  {blocked&&<p role="note">{blocked}</p>}
  {!cart&&<p>Connect the console and USB bridge, then read cartridge identity above.</p>}
  <div className="chromatic-actions"><ActionButton disabled={busy||!session||!cart||!!blocked} onClick={backupForWrite}>Back up before flashing</ActionButton></div>
  {receipt&&<><p>Backup ready: {receipt.info.title||'Cartridge'} · ROM and save verified by two device reads. Group {receipt.group.slice(0,8)}.</p><label className="chromatic-check"><input type="checkbox" checked={consent} disabled={busy||!!blocked} onChange={e=>setConsent(e.target.checked)}/>I approve replacing this cartridge’s game and save with the selected ROM and save above. Existing game data will be erased; saves may be lost if I discard the verified backup.</label></>}
  <div className="chromatic-actions"><ActionButton primary disabled={busy||!receipt||!entry||!consent||!!blocked||!session} onClick={flash}>{restoring?'Restore selected backup':'Flash selected ROM'}</ActionButton></div>
  {result&&<p role="status">{result}</p>}
  <p>Direct USB writes use the firmware’s chip checks and preserve protected bytes. ROM and save are read back after writing. Keep this tab and cable connected. A failed or interrupted write is never retried automatically. Hardware acceptance of this new browser writer is still pending.</p>
 </section>;
}
