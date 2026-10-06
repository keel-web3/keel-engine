/** Deterministic device lowering. Source coverage is 0..255; no GPU, wallet or
 * chain reader is needed to compile a mask for a cartridge or a stored asset. */
export const TARGET_RASTER_MODULE = {id: 'keel/render-target-raster', version: '0.1.0', kind: 'runtime'} as const;
export interface MaskRaster {
  readonly width: number; readonly height: number; readonly pixels: ArrayLike<number>;
  /** Generator-owned detail priority: contours, strokes and interaction marks
   * can survive a budget that discards equally small decorative texture. */
  readonly importance?: ArrayLike<number>;
  /** Occupancy independent of material brightness; keeps dither inside the object. */
  readonly silhouette?: ArrayLike<number>;
}
export interface MaskTarget {
  readonly width: number;
  readonly height: number;
  /** Fraction of ink within a destination pixel. A thin rule can use 0.25. */
  readonly threshold?: number;
  readonly dither?: 'none' | 'ordered';
  readonly featureThreshold?: number;
  /** Regenerate a one-pixel inner contour after filtering the occupancy mask. */
  readonly outline?: 'none' | 'inner';
  readonly silhouetteThreshold?: number;
  /** Physical display pixels per encoded pixel, kept with the output. */
  readonly pixelAspect?: readonly [number, number];
}
export interface LoweredMask {
  readonly width: number; readonly height: number;
  readonly pixelAspect: readonly [number, number];
  readonly coverage: Float32Array; readonly pixels: Uint8Array;
  readonly packed: Uint8Array; readonly rowBytes: number;
}
const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const size = (w: number,h: number): number => {
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>16777216)throw new RangeError('Raster dimensions must be positive integers within the pixel budget');
  return w*h;
};
export interface RasterRelief {
  readonly width:number; readonly height:number;
  /** Disjoint masks: a letter face always covers its offset depth. */
  readonly face:Uint8Array; readonly depth:Uint8Array;
  /** Palette roles: 0 background, 1 depth, 2 face. */
  readonly pixels:Uint8Array;
}
/** Offset relief from the target's actual binary strokes. Native adapters
 * choose register colours and encode these roles; no font resampling or
 * chain dependency is required. Offscreen depth is clipped, never wrapped. */
export function rasterRelief(source:{readonly width:number;readonly height:number;readonly pixels:ArrayLike<number>},offset:readonly [number,number]=[1,1],target:{readonly scanlineTones?:readonly (1|2)[]}={}):RasterRelief {
  const n=size(source.width,source.height);
  if(source.pixels.length!==n)throw new RangeError('Relief mask byte count does not match its dimensions');
  if(offset.length!==2||offset.some(v=>!Number.isSafeInteger(v)||Math.abs(v)>16777216))throw new RangeError('Relief offset must contain bounded integer pixels');
  const roles=target.scanlineTones;
  if(roles&&(!roles.length||roles.length>source.height||roles.some(v=>v!==1&&v!==2)))throw new RangeError('Relief scanline tones must contain depth or face roles');
  const face=new Uint8Array(n),depth=new Uint8Array(n),pixels=new Uint8Array(n);
  for(let i=0;i<n;i++){
    if(source.pixels[i]!==0&&source.pixels[i]!==1)throw new RangeError('Relief strokes must be binary');
    if(source.pixels[i])face[i]=1;
  }
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(face[y*source.width+x]){
    const dx=x+offset[0],dy=y+offset[1];
    if(dx>=0&&dy>=0&&dx<source.width&&dy<source.height&&!face[dy*source.width+dx])depth[dy*source.width+dx]=1;
  }
  for(let i=0;i<n;i++){
    const role=roles?.[Math.floor(i/source.width)%roles.length];
    if(role===1)face[i]=0;
    if(role===2)depth[i]=0;
    pixels[i]=face[i]?2:depth[i]?1:0;
  }
  return {width:source.width,height:source.height,face,depth,pixels};
}
/** Exact area filtering, including non-integer footprints. Background stays
 * empty; text can instead be regenerated from the UI's stroke font at its
 * target size and passed through this same packer without shrinking glyphs. */
export function lowerRasterMask(source: MaskRaster,target: MaskTarget): LoweredMask {
  const sourceSize=size(source.width,source.height),n=size(target.width,target.height);
  if(source.pixels.length!==sourceSize)throw new RangeError('Raster byte count does not match its dimensions');
  const threshold=target.threshold??.5,featureThreshold=target.featureThreshold??.125,dither=target.dither??'none',aspect=target.pixelAspect??[1,1];
  if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new RangeError('Coverage threshold must be within 0..1');
  if(dither!=='none'&&dither!=='ordered')throw new RangeError('Unknown raster dither');
  if(!Number.isFinite(featureThreshold)||featureThreshold<=0||featureThreshold>1)throw new RangeError('Feature threshold must be within 0..1');
  if(source.importance&&source.importance.length!==sourceSize)throw new RangeError('Feature byte count does not match its dimensions');
  if(aspect.length!==2||aspect.some(v=>!Number.isFinite(v)||v<=0))throw new RangeError('Pixel aspect must be positive');
  for(let i=0;i<sourceSize;i++){
    if(!Number.isFinite(source.pixels[i])||source.pixels[i]!<0||source.pixels[i]!>255)throw new RangeError('Coverage bytes must be within 0..255');
    if(source.importance&&(!Number.isFinite(source.importance[i])||source.importance[i]!<0||source.importance[i]!>255))throw new RangeError('Feature bytes must be within 0..255');
  }
  const outline=target.outline??'none',silhouetteThreshold=target.silhouetteThreshold??.5;
  if(outline!=='none'&&outline!=='inner')throw new RangeError('Unknown raster outline');
  if(!Number.isFinite(silhouetteThreshold)||silhouetteThreshold<=0||silhouetteThreshold>1)throw new RangeError('Silhouette threshold must be within 0..1');
  if(source.silhouette){
    if(source.silhouette.length!==sourceSize)throw new RangeError('Silhouette byte count does not match its dimensions');
    for(let i=0;i<sourceSize;i++)if(!Number.isFinite(source.silhouette[i])||source.silhouette[i]!<0||source.silhouette[i]!>255)throw new RangeError('Silhouette bytes must be within 0..255');
  }
  if(outline==='inner'&&!source.silhouette)throw new RangeError('An inner outline requires a silhouette channel');
  const occupancy=source.silhouette?new Uint8Array(n):undefined;
  const coverage=new Float32Array(n),pixels=new Uint8Array(n),rowBytes=Math.ceil(target.width/8),packed=new Uint8Array(rowBytes*target.height);
  const sx=source.width/target.width,sy=source.height/target.height;
  for(let y=0;y<target.height;y++)for(let x=0;x<target.width;x++){
    const x0=x*sx,x1=(x+1)*sx,y0=y*sy,y1=(y+1)*sy;let ink=0,feature=0,shape=0;
    for(let py=Math.floor(y0);py<Math.min(source.height,Math.ceil(y1));py++)for(let px=Math.floor(x0);px<Math.min(source.width,Math.ceil(x1));px++){
      const area=(Math.min(x1,px+1)-Math.max(x0,px))*(Math.min(y1,py+1)-Math.max(y0,py));
      ink+=source.pixels[py*source.width+px]!*area;
      if(source.silhouette)shape+=source.silhouette[py*source.width+px]!*area;
      if(source.importance)feature+=source.pixels[py*source.width+px]!*source.importance[py*source.width+px]!*area;
    }
    const at=y*target.width+x,c=ink/(255*sx*sy);coverage[at]=c;
    const keepFeature=feature/(255*255*sx*sy)>=featureThreshold;
    if(occupancy)occupancy[at]=shape>0&&(shape/(255*sx*sy)>=silhouetteThreshold||keepFeature)?1:0;
    const cut=dither==='ordered'?(BAYER[(y&3)*4+(x&3)]!+.5)/16:threshold;
    if(c>0&&(c>=cut||keepFeature)){pixels[at]=1;packed[y*rowBytes+(x>>3)]!|=128>>(x&7);}
  }
  if(occupancy){
    packed.fill(0);
    for(let y=0;y<target.height;y++)for(let x=0;x<target.width;x++){
      const at=y*target.width+x;
      const edge=outline==='inner'&&occupancy[at]&&(x===0||y===0||x===target.width-1||y===target.height-1||!occupancy[at-1]||!occupancy[at+1]||!occupancy[at-target.width]||!occupancy[at+target.width]);
      pixels[at]=occupancy[at]&&(edge||pixels[at])?1:0;
      if(pixels[at])packed[y*rowBytes+(x>>3)]!|=128>>(x&7);
    }
  }
  return {width:target.width,height:target.height,pixelAspect:[aspect[0],aspect[1]],coverage,pixels,packed,rowBytes};
}
/** The pipeline can lower a batch once and stream the resulting packed rows
 * to a native adapter; every frame has an independent, fixed byte budget. */
export function lowerRasterMaskFrames(bytes: Uint8Array,source: {readonly width:number;readonly height:number;readonly importance?:Uint8Array;readonly silhouette?:Uint8Array},target: MaskTarget): Uint8Array {
  const frameBytes=size(source.width,source.height);size(target.width,target.height);
  if(bytes.length%frameBytes)throw new RangeError('Raster frame batch is truncated');
  if(source.importance&&source.importance.length!==bytes.length)throw new RangeError('Raster feature batch is truncated');
  if(source.silhouette&&source.silhouette.length!==bytes.length)throw new RangeError('Raster silhouette batch is truncated');
  const stride=Math.ceil(target.width/8)*target.height,count=bytes.length/frameBytes;
  const out=new Uint8Array(count*stride);
  for(let i=0;i<count;i++)out.set(lowerRasterMask({width:source.width,height:source.height,pixels:bytes.subarray(i*frameBytes,(i+1)*frameBytes),...(source.importance?{importance:source.importance.subarray(i*frameBytes,(i+1)*frameBytes)}:{}),...(source.silhouette?{silhouette:source.silhouette.subarray(i*frameBytes,(i+1)*frameBytes)}:{})},target).packed,i*stride);
  return out;
}

export type RasterRGB = readonly [number,number,number];
export interface TargetColour {readonly code:number;readonly rgb:RasterRGB}
export interface ToneSource {readonly stroke:RasterRGB;readonly tones:readonly RasterRGB[]}
export interface ToneTarget {
  /** Native register codes, not a simulated unrestricted colour space. */
  readonly palette:readonly TargetColour[]; readonly background:RasterRGB;
  readonly toneCount:1|2; readonly strokeContrast?:number; readonly toneContrast?:number;
}
export interface TargetTones {
  readonly stroke:TargetColour; readonly tones:readonly TargetColour[];
  /** A palette can make a requested contrast impossible. Report that cut. */
  readonly contrastMet:boolean;
}
const rgbCheck=(c:RasterRGB):void=>{if(c.length!==3||c.some(v=>!Number.isFinite(v)||v<0||v>255))throw new RangeError('Tone RGB must be within 0..255');};
const linear=(v:number):number=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
const luminance=(c:RasterRGB):number=>.2126*linear(c[0])+.7152*linear(c[1])+.0722*linear(c[2]);
const contrast=(a:RasterRGB,b:RasterRGB):number=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const lab=(c:RasterRGB):readonly number[]=>{
  const r=linear(c[0]),g=linear(c[1]),b=linear(c[2]);
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
};
/** Fit the canonical object's material ramp to the machine. A shared family
 * can pass the same source ramp; adding objects never changes its result.
 * Contour and material roles stay separate, with deterministic register ties. */
export function fitTargetTones(source:ToneSource,target:ToneTarget):TargetTones {
  rgbCheck(source.stroke);rgbCheck(target.background);source.tones.forEach(rgbCheck);
  if(!source.tones.length||!target.palette.length||target.palette.length>256)throw new RangeError('Tone source and native palette must be nonempty and bounded');
  if(target.toneCount!==1&&target.toneCount!==2)throw new RangeError('Target supports one or two material tones');
  const strokeContrast=target.strokeContrast??2.5,toneContrast=target.toneContrast??1;
  if([strokeContrast,toneContrast].some(v=>!Number.isFinite(v)||v<1||v>21))throw new RangeError('Tone contrast must be within 1..21');
  const codes=new Set<number>();for(const p of target.palette){rgbCheck(p.rgb);if(!Number.isInteger(p.code)||p.code<0||p.code>255||codes.has(p.code))throw new RangeError('Native colour codes must be unique bytes');codes.add(p.code);}
  let contrastMet=true;
  const choose=(rgb:RasterRGB,floor:number,excluded?:number,minLight?:number):TargetColour=>{
    let eligible=target.palette.filter(p=>p.code!==excluded&&(minLight===undefined||luminance(p.rgb)>=minLight));
    if(!eligible.length)eligible=[...target.palette];
    const contrasted=eligible.filter(p=>contrast(p.rgb,target.background)>=floor);
    if(contrasted.length)eligible=contrasted;else{contrastMet=false;const best=Math.max(...eligible.map(p=>contrast(p.rgb,target.background)));eligible=eligible.filter(p=>contrast(p.rgb,target.background)>=best-1e-9);}
    const reference=lab(rgb),distance=(p:TargetColour)=>lab(p.rgb).reduce((n,v,i)=>n+(v-reference[i]!)**2,0);
    return [...eligible].sort((a,b)=>distance(a)-distance(b)||a.code-b.code)[0]!;
  };
  const stroke=choose(source.stroke,strokeContrast),base=choose(source.tones[0]!,toneContrast);
  const tones:TargetColour[]=[base];
  if(target.toneCount===2)tones.push(choose(source.tones.at(-1)!,toneContrast,base.code,luminance(base.rgb)));
  return {stroke,tones,contrastMet};
}
