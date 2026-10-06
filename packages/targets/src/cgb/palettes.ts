/** Lossless scene-wide palette-set packing. No quantization or recoloring.
 * Each demand retains its BG index-zero color separately from nonzero colors,
 * preserving the index-zero OBJ priority rule even when RGB colors duplicate.
 * Combine all required rest/turn frames into demands for a joint assignment. */
export interface PaletteDemand { readonly key:string; readonly zeroColor:number; readonly nonzeroColors:readonly number[] }
export interface FixedPalette { readonly id:number; readonly colors:readonly number[] }
export interface PalettePackingOptions { readonly limit?:number; readonly fixed?:readonly FixedPalette[]; readonly maxSearchNodes?:number }
interface Bin { id:number; zero:number; colors:Set<number>; fixed:readonly number[]|undefined }
export type PalettePacking={readonly ok:true;readonly palettes:readonly (readonly number[])[];readonly assignments:ReadonlyMap<string,number>;readonly nodes:number}|{readonly ok:false;readonly reason:'tile-colors'|'palette-capacity'|'search-limit';readonly key?:string;readonly nodes:number};
const word=(c:number)=>{if(!Number.isInteger(c)||c<0||c>32767)throw new Error('invalid RGB555 color');return c;};
export function packLosslessPalettes(demands:readonly PaletteDemand[],options:PalettePackingOptions={}):PalettePacking {
 const limit=options.limit??8,maxNodes=options.maxSearchNodes??100000;
 if(!Number.isInteger(limit)||limit<1||limit>8||!Number.isInteger(maxNodes)||maxNodes<1)throw new Error('invalid CGB palette budget');
 const keys=new Set<string>(),bins:Bin[]=[],assignment=new Map<string,number>();
 const order=demands.map(d=>{if(keys.has(d.key))throw new Error('duplicate palette demand '+d.key);keys.add(d.key);const colors=new Set(d.nonzeroColors.map(word));return {key:d.key,zero:word(d.zeroColor),colors};});
 for(const d of order)if(d.colors.size>3)return {ok:false,reason:'tile-colors',key:d.key,nodes:0};
 for(const fixed of options.fixed??[]){if(!Number.isInteger(fixed.id)||fixed.id<0||fixed.id>=limit||fixed.colors.length!==4||bins.some(b=>b.id===fixed.id))throw new Error('invalid fixed palette');fixed.colors.forEach(word);bins.push({id:fixed.id,zero:fixed.colors[0]!,colors:new Set(fixed.colors.slice(1)),fixed:[...fixed.colors]});}
 bins.sort((a,b)=>a.id-b.id);order.sort((a,b)=>b.colors.size-a.colors.size||a.zero-b.zero||(a.key<b.key?-1:a.key>b.key?1:0));
 let nodes=0,limited=false;
 function visit(at:number):boolean {
  if(++nodes>maxNodes){limited=true;return false;}if(at===order.length)return true;
  const d=order[at]!,choices=bins.filter(b=>b.zero===d.zero).map(b=>({b,merged:new Set([...b.colors,...d.colors])})).filter(({b,merged})=>merged.size<=3&&(!b.fixed||merged.size===b.colors.size)).sort((a,b)=>a.merged.size-a.b.colors.size-(b.merged.size-b.b.colors.size)||a.b.id-b.b.id),seen=new Set<string>();
  for(const {b,merged} of choices){const sig=[b.zero,...[...b.colors].sort((a,c)=>a-c)].join(',')+(b.fixed?'F':'');if(seen.has(sig))continue;seen.add(sig);const old=b.colors;b.colors=merged;assignment.set(d.key,b.id);if(visit(at+1))return true;b.colors=old;if(limited)return false;}
  if(bins.length<limit){let id=0;while(bins.some(b=>b.id===id))id++;bins.push({id,zero:d.zero,colors:new Set(d.colors),fixed:undefined});assignment.set(d.key,id);if(visit(at+1))return true;bins.pop();}
  assignment.delete(d.key);return false;
 }
 if(!visit(0))return {ok:false,reason:limited?'search-limit':'palette-capacity',nodes};
 const palettes:Array<readonly number[]>=Array.from({length:limit},()=>[0,0,0,0]);
 for(const b of bins){if(b.fixed)palettes[b.id]=b.fixed;else{const p=[b.zero,...[...b.colors].sort((a,b)=>a-b)];while(p.length<4)p.push(b.zero);palettes[b.id]=p;}}
 return {ok:true,palettes,assignments:assignment,nodes};
}
/** Remap a color without collapsing nonzero indices onto BG index zero. */
export function paletteIndex(colors:readonly number[],color:number,wasZero:boolean):number {
 if(wasZero){if(colors[0]!==color)throw new Error('BG zero color changed');return 0;}
 const at=colors.findIndex((c,i)=>i>0&&c===color);if(at<0)throw new Error('nonzero color does not fit palette');return at;
}
