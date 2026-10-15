import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectRom,selectVariant} from '../src/cartridge.mjs';
const MiB=1024*1024;
const release=(size,extra={})=>({id:`rom-${size}`,sha256:String(size).padStart(64,'0'),romBytes:size*MiB,actualBytes:size*MiB,ramBytes:32768,mapper:'MBC5',features:[],contentRank:size,validation:'passed',...extra});
const cap=(size,extra={})=>({boardId:'fixture',epoch:'connect-1',evidence:'verified',romBytes:size*MiB,addressableBytes:size*MiB,ramBytes:131072,mappers:['MBC5'],features:[],writableRanges:[{start:0,end:size*MiB}],protectedRanges:[],...extra});
const writer={verified:true,boardId:'fixture',maxRomBytes:8*MiB,mappers:['MBC5']};
test('selects the best fitting release dynamically, independent of input order',()=>{
  for(const size of [1,2,4,8]) assert.equal(selectVariant(cap(size),[release(8),release(2),release(1),release(4)],writer).selection.romBytes,size*MiB);
  assert.equal(selectVariant(cap(16,{mappers:['CUSTOM']}),[release(16,{mapper:'CUSTOM'})],{...writer,mappers:['CUSTOM'],maxRomBytes:16*MiB}).selection.romBytes,16*MiB);
});
test('unknown, inferred and malformed physical capabilities never select',()=>{
  for(const c of [null,cap(8,{evidence:'rom-header'}),cap(8,{ramBytes:null}),cap(8,{romBytes:NaN}),cap(8,{addressableBytes:16*MiB}),cap(8,{epoch:''}),cap(8,{writableRanges:[{start:0,end:9*MiB}]})]) assert.equal(selectVariant(c,[release(1)],writer).selection,null);
});
test('save memory, mapper, peripheral and validation can select a smaller edition',()=>{
  const result=selectVariant(cap(8,{ramBytes:32768}),[release(8,{ramBytes:131072}),release(4,{features:['rtc']}),release(2),release(1,{mapper:'MBC3'})],writer);
  assert.equal(result.selection.id,'rom-2');
  assert.equal(selectVariant(cap(8),[release(8,{validation:'planned'})],writer).selection,null);
});
test('board writer limit is separate from the selected game and never authorizes a write',()=>{
  const result=selectVariant(cap(8),[release(8),release(2)],{...writer,maxRomBytes:2*MiB});
  assert.equal(result.selection.id,'rom-2'); assert.equal(result.status,'compatible-release');assert.equal(result.canWrite,false);
  assert.equal(selectVariant(cap(8),[release(8)],{...writer,maxRomBytes:2*MiB}).status,'writer-unavailable');
  assert.equal(selectVariant(cap(8),[release(8)],{...writer,boardId:'another-board'}).writerSupported,false);
});
test('protected bytes require proof for this exact release and connection',()=>{
  const r={start:2*MiB-65536,end:2*MiB};
  const c=cap(2,{protectedRanges:[r],writableRanges:[{start:0,end:r.start}]});
  assert.equal(selectVariant(c,[release(2)],writer).status,'verify-protected-bytes');
  const proof={...r,epoch:c.epoch,variantSha256:release(2).sha256,equal:true};
  assert.equal(selectVariant({...c,protectedChecks:[proof]},[release(2)],writer).status,'compatible-release');
  assert.equal(selectVariant({...c,protectedChecks:[{...proof,epoch:'stale'}]},[release(2)],writer).status,'verify-protected-bytes');
  assert.equal(selectVariant({...c,protectedChecks:[{...proof,equal:false}]},[release(2)],writer).selection,null);
});
test('overlapping or missing write ranges cannot silently cover a ROM',()=>{
  assert.equal(selectVariant(cap(2,{protectedRanges:[{start:0,end:65536}]}),[release(2)],writer).status,'unknown-cartridge');
  assert.equal(selectVariant(cap(2,{writableRanges:[{start:0,end:MiB-1},{start:MiB,end:2*MiB}]}),[release(2)],writer).selection,null);
});
test('a ROM header describes requirements, never cartridge capacity',()=>{
  const bytes=new Uint8Array(81920);bytes.set(new TextEncoder().encode('TEST'),0x134);bytes[0x143]=0xc0;bytes[0x147]=0x1b;bytes[0x148]=6;bytes[0x149]=2;
  let sum=0;for(let i=0x134;i<=0x14c;i++)sum=(sum-bytes[i]-1)&255;bytes[0x14d]=sum;
  sum=bytes.reduce((a,b)=>a+b,0)&65535;bytes[0x14e]=sum>>8;bytes[0x14f]=sum&255;
  const m=inspectRom(bytes);assert.equal(m.declaredBytes,2*MiB);assert.equal(m.actualBytes,81920);assert.equal(m.ramBytes,8192);assert.equal(m.trimmed,true);assert.equal(m.headerChecksumValid,true);assert.equal(m.globalChecksumValid,true);assert.equal(m.capacityEvidence,false);
  bytes[0x148]=0xff;assert.equal(inspectRom(bytes).declaredBytes,null);assert.throws(()=>inspectRom(new Uint8Array(30)));
});
