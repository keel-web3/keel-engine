/** Lossless table factoring for four-color, four-tint CGB assets.
 * Each asset shares its first two colors across tints. References pack the
 * prefix ID above the group ID; group entries point to two-word color pairs.
 * No RGB quantization, hue reconstruction, or frame pixels are involved. */
export interface PaletteGroups {
 readonly schema:'keel-cgb-palette-groups@1'; readonly references:Uint16Array;
 readonly prefixes:readonly (readonly number[])[]; readonly groups:readonly (readonly number[])[];
 readonly pairs:readonly (readonly number[])[]; readonly groupBits:number;
 readonly layout:'direct'|'dictionary';
 readonly groupsOffset:number; readonly pairsOffset:number; readonly bytes:Uint8Array;
}
const compare=(a:readonly number[],b:readonly number[])=>{for(let i=0;i<a.length;i++){const d=a[i]!-b[i]!;if(d)return d;}return 0;};
const unique=(rows:readonly (readonly number[])[])=>[...new Map(rows.map(p=>[p.join(','),[...p]])).values()].sort(compare);
export function packPaletteGroups(assets:readonly (readonly (readonly number[])[])[]):PaletteGroups {
 for(const tints of assets){if(tints.length!==4)throw new Error('four CGB tint palettes required');for(const p of tints)if(p.length!==4||p.some(c=>!Number.isInteger(c)||c<0||c>32767))throw new Error('invalid RGB555 palette');if(tints.some(p=>p[0]!==tints[0]![0]||p[1]!==tints[0]![1]))throw new Error('asset prefix changes between tints');}
 const prefixes=unique(assets.map(a=>a[0]!.slice(0,2))),pairs=unique(assets.flatMap(a=>a.map(p=>p.slice(2))));
 if(prefixes.length>256||pairs.length>65536)throw new Error('CGB palette dictionary exceeds reference budget');
 const prefixMap=new Map(prefixes.map((p,i)=>[p.join(','),i])),pairMap=new Map(pairs.map((p,i)=>[p.join(','),i]));
 const vectors=assets.map(a=>a.map(p=>pairMap.get(p.slice(2).join(','))!)),groups=unique(vectors),groupMap=new Map(groups.map((p,i)=>[p.join(','),i]));
 const prefixBits=prefixes.length>1?Math.ceil(Math.log2(prefixes.length)):0,groupBits=16-prefixBits;
 if(groups.length>2**groupBits)throw new Error('CGB tint group exceeds 16-bit reference budget');
 // Groups are eight-byte aligned, pairs four-byte aligned: no lookup crosses
 // a 16 KiB ROM bank. A backend must independently allocate physical banks.
 // Use direct four-tint groups when they are smaller. That path removes one
 // ROM lookup; the dictionary path wins when color pairs are heavily shared.
 const layout=groups.length*16<=groups.length*8+pairs.length*4?'direct':'dictionary';
 const groupsOffset=0,pairsOffset=layout==='direct'?0:groups.length*8,bytes=new Uint8Array(layout==='direct'?groups.length*16:pairsOffset+pairs.length*4);
 if(bytes.length>65536)throw new Error('CGB palette blob exceeds 16-bit address budget');
 const view=new DataView(bytes.buffer);
 if(layout==='direct')groups.forEach((g,i)=>g.forEach((pair,k)=>pairs[pair]!.forEach((word,c)=>view.setUint16(i*16+k*4+c*2,word,true))));
 else {groups.forEach((g,i)=>g.forEach((v,k)=>view.setUint16(i*8+k*2,v,true)));pairs.forEach((p,i)=>p.forEach((v,k)=>view.setUint16(pairsOffset+i*4+k*2,v,true)));}
 const references=Uint16Array.from(vectors,(g,i)=>prefixMap.get(assets[i]![0]!.slice(0,2).join(','))!*2**groupBits+groupMap.get(g.join(','))!);
 return {schema:'keel-cgb-palette-groups@1',references,prefixes,groups,pairs,groupBits,layout,groupsOffset,pairsOffset,bytes};
}
/** Independent byte reader for backend roundtrip tests and benchmark oracles. */
export function unpackPaletteGroup(p:PaletteGroups,reference:number,tint:number):number[] {
 if(!Number.isInteger(reference)||reference<0||reference>65535||!Number.isInteger(tint)||tint<0||tint>3)throw new Error('invalid CGB palette reference');
 const group=reference%(2**p.groupBits),prefix=p.prefixes[Math.floor(reference/2**p.groupBits)];
 if(group>=p.groups.length||!prefix)throw new Error('unknown CGB palette reference');
 const v=new DataView(p.bytes.buffer,p.bytes.byteOffset,p.bytes.byteLength);
 if(p.layout==='direct')return [...prefix,v.getUint16(group*16+tint*4,true),v.getUint16(group*16+tint*4+2,true)];
 const pair=v.getUint16(p.groupsOffset+group*8+tint*2,true);
 if(pair>=p.pairs.length)throw new Error('unknown CGB color pair');
 return [...prefix,v.getUint16(p.pairsOffset+pair*4,true),v.getUint16(p.pairsOffset+pair*4+2,true)];
}
