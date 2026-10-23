import{rasterize,crisp}from'@keel-engine/ui';
// Coverage alone is translation/palette independent. Retain only small full
// canonical masks; neither the cache nor its mutable arrays leave this module.
const coverageMasks=new Map<string,Uint8Array>();let coverageBytes=0;
function coverageMask(local:number[],w:number,h:number,cache:boolean){
 const key=cache&&w*h<=131072?w+','+h+':'+local.join(','):null;
 if(key!==null){const hit=coverageMasks.get(key);if(hit){coverageMasks.delete(key);coverageMasks.set(key,hit);return hit;}}
 const mask=crisp(rasterize([local],w,h,{sub:1}),w,h);
 if(key!==null){while(coverageMasks.size>=48||coverageBytes+mask.byteLength>1048576){const oldest=coverageMasks.keys().next().value!;coverageBytes-=coverageMasks.get(oldest)!.byteLength;coverageMasks.delete(oldest);}coverageMasks.set(key,mask);coverageBytes+=mask.byteLength;}
 return mask;
}
export class PixelCanvas{
 offsetX=0;offsetY=0;private _clip:readonly[number,number,number,number]|null=null;
 get clip(){return this._clip;}set clip(value:readonly[number,number,number,number]|null){if(value!==null){if(!Array.isArray(value)||value.length!==4)throw Error('Pixel clip array required');this.geometry(...value);if(value.length!==4||value[2]<value[0]||value[3]<value[1])throw Error('Pixel clip bounds');this._clip=Object.freeze([...value] as[number,number,number,number]);}else this._clip=null;}
 private geometry(...values:number[]){if(values.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))throw Error('Pixel primitive finite bounded geometry');}
 private ink(c:number){if(!Number.isInteger(c)||c<0||c>=this.palette.length)throw Error('Pixel palette index');}

 readonly pixels:Uint8Array;readonly palette:readonly (readonly number[])[];
 readonly W:number;readonly H:number;
 constructor(W:number,H:number,palette:readonly (readonly number[])[]){if(!Number.isInteger(W)||!Number.isInteger(H)||W<1||H<1||W>2048||H>2048||W*H>1048576)throw Error('Pixel canvas budget');if(!Array.isArray(palette)||palette.length<1||palette.length>256||Array.from({length:palette.length},(_,i)=>({c:palette[i],own:Object.prototype.hasOwnProperty.call(palette,i)})).some(({c,own})=>!own||!Array.isArray(c)||c.length!==3||[0,1,2].some(i=>!Object.prototype.hasOwnProperty.call(c,i)||!Number.isInteger(c[i])||c[i]<0||c[i]>255)))throw Error('Pixel palette RGB');this.W=W;this.H=H;this.pixels=new Uint8Array(W*H);this.palette=Object.freeze(palette.map(c=>Object.freeze([...c])));}
 private write(x:number,y:number,c:number){x=Math.round(x+this.offsetX);y=Math.round(y+this.offsetY);const q=this._clip;if(x>=0&&y>=0&&x<this.W&&y<this.H&&(!q||(x>=q[0]&&y>=q[1]&&x<=q[2]&&y<=q[3])))this.pixels[y*this.W+x]=c;}
 dot(x:number,y:number,c:number){this.geometry(x,y,this.offsetX,this.offsetY);this.ink(c);this.write(x,y,c);}
 rect(x:number,y:number,w:number,h:number,c:number){this.geometry(x,y,w,h,this.offsetX,this.offsetY);this.ink(c);if(w<0||h<0||w>8192||h>8192)throw Error('Pixel rect budget');x+=this.offsetX;y+=this.offsetY;const q=this._clip,l=Math.max(0,Math.round(x),q?Math.ceil(q[0]):0),r=Math.min(this.W,Math.ceil(x+w),q?Math.floor(q[2])+1:this.W),t=Math.max(0,Math.round(y),q?Math.ceil(q[1]):0),b=Math.min(this.H,Math.ceil(y+h),q?Math.floor(q[3])+1:this.H);if(r<=l||b<=t)return;for(let j=t;j<b;j++)this.pixels.fill(c,j*this.W+l,j*this.W+r);}
 private diskPixels(x:number,y:number,r:number,c:number,ry:number){if(r===0||ry===0){this.write(x,y,c);return;}const q=this._clip;if(x+r+this.offsetX<0||y+ry+this.offsetY<0||x-r+this.offsetX>=this.W||y-ry+this.offsetY>=this.H||q&&(x+r+this.offsetX<q[0]||y+ry+this.offsetY<q[1]||x-r+this.offsetX>q[2]||y-ry+this.offsetY>q[3]))return;// Integer samples with zero offsets form one contiguous ellipse span per row.
 // Binary searches use the ORIGINAL predicate, including its division/order;
 // no square-root approximation moves edge pixels. Custom storage/writers
 // and fractional offsets retain the original per-pixel call behavior.
 // Tiny stroke caps cost less in the original loop than span admission/search.
 if(r*ry>=64&&canFillDiskSpans(this)){
  const left=Math.floor(x-r),right=Math.floor(x+r),center=Math.max(left,Math.min(right,Math.round(x))),
   top=Math.max(Math.floor(y-ry),0,q?Math.ceil(q[1]):0),bottom=Math.min(Math.floor(y+ry),this.H-1,q?Math.floor(q[3]):this.H-1),
   clipLeft=Math.max(0,q?Math.ceil(q[0]):0),clipRight=Math.min(this.W-1,q?Math.floor(q[2]):this.W-1);
  for(let j=top;j<=bottom;j++){
   const inside=(i:number)=>((i-x)/r)**2+((j-y)/ry)**2<=1;
   if(!inside(center))continue;
   let lo=left,hi=center;while(lo<hi){const m=Math.floor((lo+hi)/2);if(inside(m))hi=m;else lo=m+1;}const start=Math.max(lo,clipLeft);
   lo=center;hi=right;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(inside(m))lo=m;else hi=m-1;}const end=Math.min(lo,clipRight);
   if(start<=end)diskSpanFill.call(this.pixels,c,j*this.W+start,j*this.W+end+1);
  }
  return;
 }
 for(let j=Math.floor(y-ry);j<=y+ry;j++)for(let i=Math.floor(x-r);i<=x+r;i++)if(((i-x)/r)**2+((j-y)/ry)**2<=1)this.write(i,j,c);}
 disk(x:number,y:number,r:number,c:number,ry=r){this.geometry(x,y,r,ry,this.offsetX,this.offsetY);this.ink(c);if(r<0||ry<0||r>512||ry>512)throw Error('Pixel disk budget');this.diskPixels(x,y,r,c,ry);}
 line(x:number,y:number,a:number,b:number,c:number,width=1){this.geometry(x,y,a,b,width,this.offsetX,this.offsetY);this.ink(c);if(width<0||width>64||Math.max(Math.abs(a-x),Math.abs(b-y))>8192||(Math.ceil(Math.max(Math.abs(a-x),Math.abs(b-y)))+1)*Math.max(1,Math.ceil(width)**2)>1048576)throw Error('Pixel line budget');
  const q=this._clip,l=Math.max(0,q?Math.ceil(q[0]):0),r=Math.min(this.W,q?Math.floor(q[2])+1:this.W),t=Math.max(0,q?Math.ceil(q[1]):0),bottom=Math.min(this.H,q?Math.floor(q[3])+1:this.H),margin=1+(width>1?width/2:0);
  // Reject only the entire stroke, including disks, write() rounding,
  // and floating-point cancellation in the original sample arithmetic.
  // Partially visible strokes retain their original sampling positions.
  if(l>=r||t>=bottom||Math.max(x,a)+this.offsetX+margin<l||Math.min(x,a)+this.offsetX-margin>=r||Math.max(y,b)+this.offsetY+margin<t||Math.min(y,b)+this.offsetY-margin>=bottom)return;
  const dx=a-x,dy=b-y,n=Math.max(Math.abs(dx),Math.abs(dy),1);let enter=0,leave=1;
  if(dx!==0){const p=(l-margin-this.offsetX-x)/dx,q=(r+margin-this.offsetX-x)/dx;enter=Math.max(enter,Math.min(p,q));leave=Math.min(leave,Math.max(p,q));}
  if(dy!==0){const p=(t-margin-this.offsetY-y)/dy,q=(bottom+margin-this.offsetY-y)/dy;enter=Math.max(enter,Math.min(p,q));leave=Math.min(leave,Math.max(p,q));}
  if(enter>leave)return;
  // Keep the original n and arithmetic rather than resampling a clipped line.
  // Two extra samples on each side protect fractional/cancellation boundaries.
  const first=Math.max(0,Math.floor(enter*n)-2),last=Math.min(Math.floor(n),Math.ceil(leave*n)+2);
  for(let i=first;i<=last;i++)width>1?this.diskPixels(x+(a-x)*i/n,y+(b-y)*i/n,width/2,c,width/2):this.write(x+(a-x)*i/n,y+(b-y)*i/n,c);}
 poly(points:number[],c:number){if(points.length<6||points.length>128||points.length%2)throw Error('Pixel polygon vertices');this.geometry(...points,this.offsetX,this.offsetY);this.ink(c);const xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1),x=Math.floor(Math.min(...xs)),y=Math.floor(Math.min(...ys)),w=Math.ceil(Math.max(...xs))-x+1,h=Math.ceil(Math.max(...ys))-y+1;if(w>2048||h>2048||w*h>1048576)throw Error('Pixel polygon mask budget');
  // Native flat cabinet beds project to integer rectangles. Their sub=1
  // coverage is exactly the half-open box; avoid allocating a coverage mask.
  const integralOffset=Number.isInteger(this.offsetX)&&Number.isInteger(this.offsetY);
  const q=this._clip,ox=x+this.offsetX,oy=y+this.offsetY,l=Math.max(0,q?Math.ceil(q[0]):0),r=Math.min(this.W,q?Math.floor(q[2])+1:this.W),t=Math.max(0,q?Math.ceil(q[1]):0),b=Math.min(this.H,q?Math.floor(q[3])+1:this.H);
  if(integralOffset&&(l>=r||t>=b||ox+w<=l||ox>=r||oy+h<=t||oy>=b))return;
  if(integralOffset&&points.length===8&&points.every(Number.isInteger)&&new Set(points.map((_,i)=>i%2?null:points[i]+','+points[i+1]).filter(v=>v!==null)).size===4&&xs.every(v=>v===x||v===x+w-1)&&ys.every(v=>v===y||v===y+h-1)&&points.every((_,i)=>i%2===1||points[i]===points[(i+2)%8]||points[i+1]===points[(i+3)%8])){const left=Math.max(ox,l),right=Math.min(ox+w-1,r);if(left<right)for(let j=Math.max(oy,t);j<Math.min(oy+h-1,b);j++)this.pixels.fill(c,j*this.W+left,j*this.W+right);return;}
  const local=points.map((v,i)=>v-(i%2?y:x)),mask=coverageMask(local,w,h,integralOffset&&points.every(Number.isInteger));
  if(!integralOffset){for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(mask[j*w+i])this.write(x+i,y+j,c);return;}
  // Keep canonical coverage and dropout control, then blit contiguous runs.
  // Offset and clip boundaries are applied once per row rather than per cell.
  for(let j=Math.max(0,t-oy);j<Math.min(h,b-oy);j++){let i=Math.max(0,l-ox),end=Math.min(w,r-ox);while(i<end){while(i<end&&!mask[j*w+i])i++;const start=i;while(i<end&&mask[j*w+i])i++;if(i>start)this.pixels.fill(c,(oy+j)*this.W+ox+start,(oy+j)*this.W+ox+i);}}
 }
 bevel(points:number[],ramp:number){if(points.length<6||points.length>128||points.length%2)throw Error('Pixel bevel vertices');this.geometry(...points,this.offsetX,this.offsetY);this.ink(ramp);this.ink(ramp+4);
  const xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1),x=Math.floor(Math.min(...xs)),y=Math.floor(Math.min(...ys)),w=Math.ceil(Math.max(...xs))-x+1,h=Math.ceil(Math.max(...ys))-y+1;if(w>2048||h>2048||w*h>1048576)throw Error('Pixel bevel mask budget');
  const q=this._clip,l=Math.max(0,q?Math.ceil(q[0]):0),r=Math.min(this.W,q?Math.floor(q[2])+1:this.W),t=Math.max(0,q?Math.ceil(q[1]):0),b=Math.min(this.H,q?Math.floor(q[3])+1:this.H),ox=x+this.offsetX,oy=y+this.offsetY;
  if(l>=r||t>=b||ox+w<l||ox-1>=r||oy+h<t||oy-1>=b)return;
  // Preserve the full canonical mask for dropout control and bevel shading.
  // Extra boundary cells leave fractional rounding and clipping to write().
  const left=Math.max(0,Math.floor(l-ox-.5)),right=Math.min(w,Math.ceil(r-ox+.5)),top=Math.max(0,Math.floor(t-oy-.5)),bottom=Math.min(h,Math.ceil(b-oy+.5)),mask=coverageMask(points.map((v,i)=>v-(i%2?y:x)),w,h,Number.isInteger(this.offsetX)&&Number.isInteger(this.offsetY)&&points.every(Number.isInteger));
  const at=(i:number,j:number)=>i>=0&&j>=0&&i<w&&j<h&&mask[j*w+i];
  for(let j=top;j<bottom;j++)for(let i=left;i<right;i++)if(at(i,j)){let c=ramp+2;if(!at(i,j-1)||!at(i-1,j))c=ramp+4;else if(!at(i+1,j)||!at(i,j+1))c=ramp;else if(!at(i,j-3)||!at(i-3,j))c=ramp+3;else if(!at(i+3,j)||!at(i,j+3))c=ramp+1;this.write(x+i,y+j,c);}
 }
 socket(x:number,y:number,r:number,ramp:number){this.geometry(x,y,r,this.offsetX,this.offsetY);this.ink(ramp);this.ink(ramp+4);if(r<6||r>509)throw Error('Pixel socket budget');this.disk(x+2,y+3,r+3,0);this.disk(x,y,r,ramp);this.disk(x-1,y-1,r-2,ramp+2);this.disk(x-2,y-3,r-5,ramp+3);this.disk(x,y+1,r-6,ramp+1);this.line(x-r*.5,y-r*.65,x+r*.35,y-r*.65,ramp+4,2);}
 bolt(x:number,y:number,r=3){this.geometry(x,y,r,this.offsetX,this.offsetY);this.ink(35);this.ink(39);if(r<1||r>511)throw Error('Pixel bolt budget');this.disk(x,y,r+1,0);this.disk(x,y,r,37);this.disk(x-1,y-1,r-1,39);this.line(x-1,y+1,x+1,y-1,35);}
 beam(x:number,y:number,a:number,b:number,ramp:number,w=8){this.geometry(x,y,a,b,w,this.offsetX,this.offsetY);this.ink(ramp);this.ink(ramp+4);if(w<0||w>60)throw Error('Pixel beam budget');this.line(x+2,y+3,a+2,b+3,0,w+4);this.line(x,y,a,b,ramp,w+2);this.line(x-1,y-1,a-1,b-1,ramp+2,w);this.line(x-2,y-2,a-2,b-2,ramp+4,1);}
 rgba(){const out=new Uint8Array(this.W*this.H*4);for(let i=0;i<this.pixels.length;i++){const c=this.palette[this.pixels[i]!]!;if(!c)throw Error('Pixel surface index');const k=i*4;out[k]=c[0]!;out[k+1]=c[1]!;out[k+2]=c[2]!;out[k+3]=255;}return out;}
}

// Capture original method identities without reading caller accessors.
const diskSpanWrite=Object.getOwnPropertyDescriptor(PixelCanvas.prototype,'write')!.value;
const diskSpanFill=Uint8Array.prototype.fill;
function canFillDiskSpans(p:PixelCanvas){
 const proto=Object.getPrototypeOf(p);if(proto!==PixelCanvas.prototype)return false;
 const write=Object.getOwnPropertyDescriptor(p,'write')??Object.getOwnPropertyDescriptor(proto,'write');
 if(write?.value!==diskSpanWrite||Object.getOwnPropertyDescriptor(proto,'write')?.value!==diskSpanWrite)return false;
 const d=(k:string)=>Object.getOwnPropertyDescriptor(p,k);
 const ox=d('offsetX'),oy=d('offsetY'),w=d('W'),h=d('H'),pixels=d('pixels'),clip=d('_clip');
 return ox?.value===0&&oy?.value===0&&Number.isInteger(w?.value)&&Number.isInteger(h?.value)&&
  w!.value>0&&h!.value>0&&w!.value<=2048&&h!.value<=2048&&w!.value*h!.value<=1048576&&
  pixels?.value instanceof Uint8Array&&ArrayBuffer.isView(pixels.value)&&Object.getPrototypeOf(pixels.value)===Uint8Array.prototype&&
  !Object.hasOwn(pixels.value,'length')&&pixels.value.length===w!.value*h!.value&&
  clip!==undefined&&Object.hasOwn(clip,'value')&&(clip.value===null||(Array.isArray(clip.value)&&Object.isFrozen(clip.value)&&clip.value.length===4&&
   [0,1,2,3].every(i=>{const v=Object.getOwnPropertyDescriptor(clip.value,String(i));return v!==undefined&&Object.hasOwn(v,'value')&&Number.isFinite(v.value)&&Math.abs(v.value)<=1e6;})));
}
