import{dhypot}from'@keel-engine/core';
import type{ArenaField}from'@keel-engine/pinball-arena';
import{PixelCanvas}from'@keel-engine/pinball-pixel-art';
import type{RoomArtTheme}from'./index.ts';
type P=readonly[number,number];type Project=(x:number,y:number,z:number)=>P;
const nativeDot=PixelCanvas.prototype.dot,nativeClip=Object.getOwnPropertyDescriptor(PixelCanvas.prototype,'clip')!.get;
function directTarget(p:PixelCanvas){
 const x=Object.getOwnPropertyDescriptor(p,'offsetX'),y=Object.getOwnPropertyDescriptor(p,'offsetY'),ownDot=Object.getOwnPropertyDescriptor(p,'dot'),prototypeDot=Object.getOwnPropertyDescriptor(PixelCanvas.prototype,'dot');
 if(Object.getPrototypeOf(p)!==PixelCanvas.prototype||ownDot&&(!Object.hasOwn(ownDot,'value')||ownDot.value!==nativeDot)||!prototypeDot||!Object.hasOwn(prototypeDot,'value')||prototypeDot.value!==nativeDot||Object.hasOwn(p,'clip')||Object.getOwnPropertyDescriptor(PixelCanvas.prototype,'clip')?.get!==nativeClip||
  ['pixels','palette','W','H'].some(key=>!Object.hasOwn(Object.getOwnPropertyDescriptor(p,key)??{},'value'))||
  !x||!y||!Object.hasOwn(x,'value')||!Object.hasOwn(y,'value')||!Number.isInteger(x.value)||!Number.isInteger(y.value)||Math.abs(x.value)>1e6||Math.abs(y.value)>1e6||p.palette.length<24)return null;
 const q=p.clip;return{offsetX:x.value as number,offsetY:y.value as number,left:Math.max(0,q?Math.ceil(q[0]):0),right:Math.min(p.W,q?Math.floor(q[2])+1:p.W),top:Math.max(0,q?Math.ceil(q[1]):0),bottom:Math.min(p.H,q?Math.floor(q[3])+1:p.H)};
}
/** Indexed wire/grating illustration lies strictly inside actual supported
 * native polygons. Dark slots are material apertures, never physics holes. */
export function paintNativeTrackGrating(p:PixelCanvas,field:ArenaField,pathId:string,project:Project,style:RoomArtTheme){
 const path=field.pinball?.paths.find(v=>v.id===pathId);if(!path||path.role!=='orbit'||!['ion-relay','grove','vaporwave'].includes(style))throw Error('Native coaster deck binding');
 const segments=[];let length=0;for(let i=1;i<path.vertices.length;i++){const a=path.vertices[i-1]!,b=path.vertices[i]!,d=dhypot(b.x-a.x,b.y-a.y);if(!Number.isFinite(d)||d<=0)throw Error('Native deck segment');segments.push({a,b,d,start:length});length+=d;}
 const baseHeight=Math.min(...path.vertices.map(v=>v.elevation));let pixels=0,surfaces=0;
 for(const id of path.surfaceIds){const s=field.surfaces.find(v=>v.id===id);if(!s)throw Error('Native deck surface missing');if(s.height<=baseHeight&&!s.vertexElevations?.some(z=>z>baseHeight))continue;
  const poly=s.polygon.map((v,i)=>project(v.x,v.y,s.vertexElevations?.[i]??s.height));if(poly.some(q=>q.length!==2||![q[0],q[1]].every(Number.isFinite)))throw Error('Deck projection');
  const minX=Math.max(0,Math.floor(Math.min(...poly.map(v=>v[0])))),maxX=Math.min(p.W-1,Math.ceil(Math.max(...poly.map(v=>v[0])))),minY=Math.max(0,Math.floor(Math.min(...poly.map(v=>v[1])))),maxY=Math.min(p.H-1,Math.ceil(Math.max(...poly.map(v=>v[1]))));if(minX>maxX||minY>maxY)continue;
  const cx=s.polygon.reduce((n,v)=>n+v.x,0)/s.polygon.length,cy=s.polygon.reduce((n,v)=>n+v.y,0)/s.polygon.length;
  const segment=[...segments].sort((a,b)=>{const distance=(v:typeof a)=>{const t=Math.max(0,Math.min(1,((cx-v.a.x)*(v.b.x-v.a.x)+(cy-v.a.y)*(v.b.y-v.a.y))/(v.d*v.d)));return(cx-v.a.x-(v.b.x-v.a.x)*t)**2+(cy-v.a.y-(v.b.y-v.a.y)*t)**2;};return distance(a)-distance(b);})[0]!;
  const a=project(segment.a.x,segment.a.y,segment.a.elevation),b=project(segment.b.x,segment.b.y,segment.b.elevation),dx=b[0]-a[0],dy=b[1]-a[1],d=dhypot(dx,dy);if(d<.1)continue;
  const nx=-(segment.b.y-segment.a.y)/segment.d,ny=(segment.b.x-segment.a.x)/segment.d,edge=project(segment.a.x+nx*path.clearWidth/2,segment.a.y+ny*path.clearWidth/2,segment.a.elevation),half=Math.max(1,dhypot(edge[0]-a[0],edge[1]-a[1]));
  // Compute the original even/odd crossings once per scanline. Each pixel
  // still uses the exact original material arithmetic and write order.
  const direct=directTarget(p),crossings:number[]=[];
  const inside=(x:number,y:number)=>{let odd=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const u=poly[i]!,v=poly[j]!;if((u[1]>y)!==(v[1]>y)&&x<(v[0]-u[0])*(y-u[1])/(v[1]-u[1])+u[0])odd=!odd;}return odd;};
  for(let y=minY;y<=maxY;y++){
   crossings.length=0;const sampleY=y+.5;
   for(let i=0,j=poly.length-1;i<poly.length;j=i++){const u=poly[i]!,v=poly[j]!;if((u[1]>sampleY)!==(v[1]>sampleY)){const cross=(v[0]-u[0])*(sampleY-u[1])/(v[1]-u[1])+u[0];if(!Number.isNaN(cross))crossings.push(cross);}}
   if(crossings.length%2||crossings.some(v=>!Number.isFinite(v))){
    crossings.length=0;for(let x=minX;x<=maxX;x++)if(inside(x+.5,sampleY)){crossings.push(x+.5);while(x<maxX&&inside(x+1.5,sampleY))x++;crossings.push(x+1.5);}
   }else crossings.sort((a,b)=>a-b);
   for(let k=0;k+1<crossings.length;k+=2){const left=Math.max(minX,Math.ceil(crossings[k]!-.5)),right=Math.min(maxX,Math.ceil(crossings[k+1]!-.5)-1);
    for(let x=left;x<=right;x++){const along=((x-a[0])*dx+(y-a[1])*dy)/(d*d),cross=((x-a[0])*-dy+(y-a[1])*dx)/d,station=segment.start+along*segment.d,phase=((station%30)+30)%30,row=Math.abs(cross)/half;
   let ink=style==='grove'?14:style==='vaporwave'?14:3;
   // Slots under16native units are narrower than the served ball; the exact
   // same solid native support remains underneath this visual wire mesh.
   if(phase>7&&phase<23&&row<.82)ink=1;
   if(phase<3)ink=style==='grove'?16:style==='vaporwave'?22:4;
   else if(phase<7)ink=style==='grove'?13:style==='vaporwave'?20:2;
   if(Math.abs(row-.38)<.08)ink=style==='grove'?15:style==='vaporwave'?23:5;
   if(row>.86)ink=style==='grove'?14:style==='vaporwave'?21:3;
   if(direct){const X=x+direct.offsetX,Y=y+direct.offsetY;if(X>=direct.left&&X<direct.right&&Y>=direct.top&&Y<direct.bottom)p.pixels[Y*p.W+X]=ink;}else p.dot(x,y,ink);pixels++;
    }
   }
  }surfaces++;
 }
 return{pathId,surfaces,pixels,scope:'Indexed native-deck material; no physical holes or new rails'};
}
