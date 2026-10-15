/** Cartridge requirements and release selection. No device IO or write authorization. */
const integer = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sizes = new Map([...Array(9)].map((_, code) => [code, 32768 * 2 ** code]));
sizes.set(0x52, 72 * 16384); sizes.set(0x53, 80 * 16384); sizes.set(0x54, 96 * 16384);
const ramSizes = [0, 2048, 8192, 32768, 131072, 65536];
const mappers = new Map([[0x00,'ROM'],[0x08,'ROM'],[0x09,'ROM'],[0x01,'MBC1'],[0x02,'MBC1'],[0x03,'MBC1'],[0x05,'MBC2'],[0x06,'MBC2'],[0x0f,'MBC3'],[0x10,'MBC3'],[0x11,'MBC3'],[0x12,'MBC3'],[0x13,'MBC3'],[0x19,'MBC5'],[0x1a,'MBC5'],[0x1b,'MBC5'],[0x1c,'MBC5'],[0x1d,'MBC5'],[0x1e,'MBC5']]);

export function inspectRom(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 0x150) throw new Error('ROM is shorter than its header.');
  const cgb = bytes[0x143];
  const titleEnd = cgb === 0x80 || cgb === 0xc0 ? 0x143 : 0x144;
  let title = '';
  for (let i=0x134;i<titleEnd && bytes[i];i++) title += bytes[i]>=32 && bytes[i]<=126 ? String.fromCharCode(bytes[i]) : '?';
  let header = 0, global = 0;
  for(let i=0x134;i<=0x14c;i++) header = (header-bytes[i]-1)&255;
  for(let i=0;i<bytes.length;i++) if(i!==0x14e && i!==0x14f) global=(global+bytes[i])&65535;
  const declaredBytes=sizes.get(bytes[0x148]) ?? null;
  const type=bytes[0x147];
  return {title, actualBytes:bytes.length, declaredBytes, ramBytes:type===5||type===6?512:ramSizes[bytes[0x149]]??null, mapper:mappers.get(type)??null, cartridgeType:type, cgb: cgb===0xc0?'required':cgb===0x80?'supported':'no', headerChecksumValid:header===bytes[0x14d], globalChecksumValid:global===(bytes[0x14e]<<8|bytes[0x14f]), trimmed:declaredBytes!==null&&bytes.length<declaredBytes, oversized:declaredBytes!==null&&bytes.length>declaredBytes, licensee:bytes[0x14b]===0x33?String.fromCharCode(bytes[0x144],bytes[0x145]):bytes[0x14b].toString(16).padStart(2,'0'),licenseeFormat:bytes[0x14b]===0x33?'new':'old',version:bytes[0x14c],region:bytes[0x14a]===0?'Japan':bytes[0x14a]===1?'International':'Unknown',sgb:bytes[0x146]===3,capacityEvidence:false};
}

function rangesValid(ranges, limit) {
  if(!Array.isArray(ranges)) return false;
  let end=0;
  if(ranges.some(r=>!r || typeof r!=='object')) return false;
  for(const r of [...ranges].sort((a,b)=>a.start-b.start)) {
    if(!integer(r.start)||!integer(r.end)||r.start>=r.end||r.end>limit||r.start<end) return false;
    end=r.end;
  }
  return true;
}

/** All capabilities must be from a verified adapter, never from the currently installed ROM header.
 * `selection` is not a write permit; preparation, backup, consent and readback are separate gates.
 * A protected check is bound to the exact variant SHA, device epoch and full range.
 */
export function selectVariant(capability, variants, writer = null) {
  const c=capability;
  const unknown = !c || c.evidence!=='verified' || !integer(c.romBytes) || c.romBytes===0 || !integer(c.addressableBytes) || c.addressableBytes===0 || c.addressableBytes>c.romBytes || !integer(c.ramBytes) || !Array.isArray(c.mappers) || !c.mappers.length || !Array.isArray(c.features) || !rangesValid(c.protectedRanges,c.romBytes) || !rangesValid(c.writableRanges,c.romBytes) || !rangesValid([...c.protectedRanges,...c.writableRanges],c.romBytes) || (c.protectedChecks!==undefined&&!Array.isArray(c.protectedChecks)) || typeof c.epoch!=='string' || !c.epoch;
  if(unknown) return {selection:null,status:'unknown-cartridge',rejected:[],canWrite:false};
  const rejected=[]; const candidates=[];
  for(const v of variants) {
    const reasons=[];
    if(!v || v.validation!=='passed' || !hash(v.sha256) || !integer(v.romBytes) || !v.romBytes || v.romBytes%16384 || !integer(v.actualBytes) || v.actualBytes<0x150 || v.actualBytes>v.romBytes || !integer(v.ramBytes) || !Number.isFinite(v.contentRank) || !Array.isArray(v.features) || typeof v.id!=='string') { rejected.push({id:v?.id??null,reasons:['unvalidated-release']});continue; }
    if(v.romBytes>c.addressableBytes) reasons.push('rom-capacity');
    if(v.ramBytes>c.ramBytes) reasons.push('save-capacity');
    if(!c.mappers.includes(v.mapper)) reasons.push('mapper');
    if(v.features.some(f=>!c.features.includes(f))) reasons.push('peripheral');
    const covered=[...c.writableRanges,...c.protectedRanges].sort((a,b)=>a.start-b.start);
    let prefix=0;
    for(const r of covered){if(r.start>prefix)break;prefix=r.end;}
    if(prefix<v.romBytes) reasons.push('unmapped-rom-range');
    let verifyProtected=false;
    for(const r of c.protectedRanges.filter(r=>r.start<v.romBytes)) {
      const proof=(c.protectedChecks??[]).find(p=>p && p.start===r.start&&p.end===r.end&&p.variantSha256===v.sha256&&p.epoch===c.epoch);
      if(proof?.equal===false) reasons.push('protected-bytes-differ');
      else if(proof?.equal!==true) verifyProtected=true;
    }
    if(reasons.length) rejected.push({id:v.id,reasons});
    else candidates.push({variant:v,verifyProtected});
  }
  candidates.sort((a,b)=>b.variant.contentRank-a.variant.contentRank||a.variant.romBytes-b.variant.romBytes||a.variant.id.localeCompare(b.variant.id,'en'));
  const writable = candidates.filter(({variant:v})=>writer?.verified===true && typeof writer.boardId==='string' && writer.boardId===c.boardId && integer(writer.maxRomBytes) && v.romBytes<=writer.maxRomBytes && Array.isArray(writer.mappers) && writer.mappers.includes(v.mapper));
  const chosen=writable[0]??candidates[0];
  if(!chosen)return {selection:null,status:'no-compatible-release',rejected,canWrite:false};
  const writerSupported=writer?.verified===true && typeof writer.boardId==='string' && writer.boardId===c.boardId && integer(writer.maxRomBytes) && chosen.variant.romBytes<=writer.maxRomBytes && Array.isArray(writer.mappers)&&writer.mappers.includes(chosen.variant.mapper);
  return {selection:chosen.variant,status:chosen.verifyProtected?'verify-protected-bytes':writerSupported?'compatible-release':'writer-unavailable',writerSupported,protectedReadRequired:chosen.verifyProtected,rejected,canWrite:false};
}
