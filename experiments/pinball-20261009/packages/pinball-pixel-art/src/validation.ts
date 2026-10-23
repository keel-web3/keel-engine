import type{PixelCanvas}from'./pixel-canvas.ts';
export function artArguments(p:PixelCanvas,...values:number[]){if(p.palette.length<40||values.some(v=>!Number.isFinite(v)||Math.abs(v)>1e5)||![p.offsetX,p.offsetY].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e5))throw Error('Pixel art requires40 inks and finite bounded arguments');}
export function artSeed(seed:string){if(typeof seed!=='string'||seed.length>512)throw Error('Pixel art seed budget');}
export function artTheme(theme:string){if(!['ion-relay','grove','sun-vault','vaporwave','synthwave'].includes(theme))throw Error('Unknown pixel mechanism theme');}
export function artSegment(p:PixelCanvas,a:readonly[number,number],b:readonly[number,number],width:number){artArguments(p,...a,...b,width);const n=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]));if(a.length!==2||b.length!==2||width<0||width>60||n>2048||(Math.ceil(n)+1)*Math.max(1,Math.ceil(width+4)**2)>1048576)throw Error('Pixel art segment budget');}
/** Dense, finite, positively sized cyclic axis-aligned rectangle. Either
 * winding and any starting corner are valid; bowties/backtracking are not. */
export function nativeRectangleBounds(polygon:readonly {readonly x:number;readonly y:number}[]):readonly[number,number,number,number]{
 if(!Array.isArray(polygon)||polygon.length!==4)throw Error('Native rectangle requires four corners');
 for(let i=0;i<4;i++){if(!Object.hasOwn(polygon,i))throw Error('Native rectangle requires dense corners');const p=polygon[i];if(!p||typeof p!=='object'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6)throw Error('Native rectangle coordinate budget');}
 const xs=polygon.map(p=>p.x),ys=polygon.map(p=>p.y),bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)] as const;
 if(bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||new Set(polygon.map(p=>p.x+','+p.y)).size!==4||polygon.some(p=>![bounds[0],bounds[2]].includes(p.x)||![bounds[1],bounds[3]].includes(p.y)))throw Error('Native rectangle positive unique corners required');
 let twiceArea=0,winding=0;
 for(let i=0;i<4;i++){const a=polygon[i]!,b=polygon[(i+1)%4]!,c=polygon[(i+2)%4]!,dx=b.x-a.x,dy=b.y-a.y,cross=dx*(c.y-b.y)-dy*(c.x-b.x);if((dx===0)===(dy===0)||cross===0||(winding!==0&&Math.sign(cross)!==winding))throw Error('Native rectangle cyclic edges required');winding=Math.sign(cross);twiceArea+=(a.x-bounds[0])*(b.y-bounds[1])-(b.x-bounds[0])*(a.y-bounds[1]);}
 if(!Number.isFinite(twiceArea)||Math.abs(twiceArea)<=0)throw Error('Native rectangle positive area required');
 return bounds;
}
