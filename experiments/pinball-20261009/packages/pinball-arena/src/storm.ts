const Q=1024;
const integer=(value:number,min:number,max:number)=>Number.isSafeInteger(value)&&value>=min&&value<=max;

/** Floor square root with integer arithmetic. The diagonal is computed once
 * per world; no implementation-dependent hypot enters boundary authority. */
export function integerSquareRoot(value:bigint):bigint {
 if(value<0n)throw Error('Negative integer square root');
 if(value<2n)return value;
 let current=value,next=(current+1n)>>1n;
 while(next<current){current=next;next=(current+value/current)>>1n;}
 return current;
}

/** Legacy storm primitive, at the same native Q resolution as collision.
 * The explicit enabled policy keeps disabled geometry constant and prevents geographic damage; session-owned BR rules disable it.
 * Boundary comparisons and exported radius share exactly the same integers.
 */
export function createFixedStorm(bounds:readonly[number,number,number,number],arenaId:string,mode:'battle'|'expedition',delayTicks:number,durationTicks:number,enabled=true){
 if(typeof enabled!=='boolean'||!Array.isArray(bounds)||bounds.length!==4||bounds.some(n=>!Number.isFinite(n)||Math.abs(n)>65535)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||!integer(delayTicks,0,432000)||!integer(durationTicks,1,432000)||!['battle','expedition'].includes(mode))throw Error('Invalid fixed storm');
 const [left,top,right,bottom]=bounds.map(n=>Math.round(n*Q)) as [number,number,number,number];
 const dx=BigInt(right-left),dy=BigInt(bottom-top),startQ=Number(integerSquareRoot(dx*dx+dy*dy)>>1n),centerX2Q=left+right,centerY2Q=top+bottom;
 let cachedTick=-1,cachedRadiusQ=startQ;
 function radiusQ(tick:number){
  if(!integer(tick,0,432000))throw Error('Invalid storm tick');
  if(!enabled)return startQ;
  if(tick!==cachedTick){const elapsed=Math.min(durationTicks,Math.max(0,tick-delayTicks));cachedRadiusQ=Math.max(160*Q,Number(BigInt(startQ)*BigInt(durationTicks-elapsed)/BigInt(durationTicks)));cachedTick=tick;}
  return cachedRadiusQ;
 }
 function read(tick:number){return{active:enabled&&mode==='battle'&&tick>delayTicks,arenaId,x:centerX2Q/(2*Q),y:centerY2Q/(2*Q),radius:radiusQ(tick)/Q};}
 function isOutside(point:{x:number;y:number},tick:number){
  const xQ=Math.round(point.x*Q),yQ=Math.round(point.y*Q);
  // A native body can cross the descriptor's coordinate boundary before its
  // escape/recovery branch runs. Admit the actual signed-32-bit kernel range.
  if(!integer(xQ,-2147483648,2147483647)||!integer(yQ,-2147483648,2147483647))throw Error('Invalid storm point');
  if(!enabled)return false;
  const dx2Q=2*xQ-centerX2Q,dy2Q=2*yQ-centerY2Q,r2Q=2*radiusQ(tick);
  // Products and their sum fit exactly in Number's integer range here.
  // Large coordinate envelopes use the same predicate via BigInt.
  if(Math.abs(dx2Q)<=67108863&&Math.abs(dy2Q)<=67108863&&r2Q<=94906265)return dx2Q*dx2Q+dy2Q*dy2Q>r2Q*r2Q;
  const x=BigInt(dx2Q),y=BigInt(dy2Q),r=BigInt(r2Q);return x*x+y*y>r*r;
 }
 return{read,isOutside,startRadiusQ:startQ};
}
