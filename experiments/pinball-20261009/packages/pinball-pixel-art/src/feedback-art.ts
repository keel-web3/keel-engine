import {dsin,dcos} from '@keel-engine/core';
import type {ArenaFrame,ArenaWorldDefinition} from '@keel-engine/pinball-arena';
import type {PinballFeedbackSample} from '@keel-engine/pinball-feedback';
import type {PixelCanvas} from './pixel-canvas.ts';
import type {PinballArcadeTheme} from './theme-backdrop.ts';

const themes:readonly string[]=['ion-relay','grove','sun-vault','vaporwave','synthwave'];
const finite=(v:number)=>Number.isFinite(v)&&Math.abs(v)<=1e6;
const integer=(v:number,a:number,b:number)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
type Point=readonly[number,number];
export interface PinballPixelTrailPoint {readonly bodyId:string;readonly ownerId:number;readonly arenaId:string;readonly x:number;readonly y:number;readonly elevation:number;readonly radius?:number;readonly layer:number;readonly tick:number;readonly alpha:number}
type StoredPoint=Omit<PinballPixelTrailPoint,'alpha'>;

/** Consume EVERY completed native tick, including replay. Samples contain
 * observed positions only: no guessed previous point from current velocity. */
export function createPinballPixelTrails(world:ArenaWorldDefinition,options:{readonly pointsPerBody?:number;readonly lifetimeTicks?:number;readonly strideTicks?:number}={}) {
  if(!world||!Array.isArray(world.arenas)||world.arenas.length<1||world.arenas.length>4)throw Error('Pixel trail native world');
  const count=options.pointsPerBody??16,life=options.lifetimeTicks??32,stride=options.strideTicks??2;
  if(!integer(count,1,32)||!integer(life,1,120)||!integer(stride,1,16))throw Error('Pixel trail budget');
  const arenas=new Set(world.arenas.map(a=>a.id)),paths=new Map<string,StoredPoint[]>();let tick=-1,lastIdentity='';
  function update(frame:ArenaFrame) {
    if(frame.schema!=='keel-pinball-arena-frame@2'||!integer(frame.tick,0,432000)||frame.tick<tick||!Array.isArray(frame.balls)||frame.balls.length>128||!Array.isArray(frame.events)||frame.events.length>4096)throw Error('Pixel trail native frame');
    const ids=new Set<string>();
    for(let i=0;i<frame.balls.length;i++){const b=frame.balls[i];if(!b||typeof b.id!=='string'||ids.has(b.id)||!integer(b.ownerId,0,99)||!arenas.has(b.arenaId)||![b.x,b.y,b.elevation,b.radius].every(finite)||b.radius<=0||b.radius>256||!integer(b.layer,0,3)||typeof b.active!=='boolean'||typeof b.eliminated!=='boolean')throw Error('Pixel trail native body');ids.add(b.id);}
    // Validate before touching persistent trails. Same-tick re-observation is
    // idempotent only when the actual body state is identical.
    const identity=JSON.stringify(frame.balls.map(b=>[b.id,b.x,b.y,b.elevation,b.radius,b.layer,b.arenaId,b.active,b.eliminated,b.transport]));
    if(frame.tick===tick){if(identity!==lastIdentity)throw Error('Pixel trail conflicting native tick');return;}
    const relocated=new Set<number>();
    for(let i=0;i<frame.events.length;i++){const e=frame.events[i];if(!e||typeof e.type!=='string'||!integer(e.tick,0,frame.tick))throw Error('Pixel trail native event');if(e.tick===frame.tick&&['portal','fall','drain','escape','capture-enter','capture-release'].includes(e.type)&&e.ownerId!==undefined)relocated.add(e.ownerId);}
    for(const id of paths.keys())if(!ids.has(id))paths.delete(id);
    for(const b of frame.balls){
      if(!b.active||b.eliminated||b.transport!==null||relocated.has(b.ownerId)){paths.delete(b.id);continue;}
      let points=paths.get(b.id)??[],last=points.at(-1);
      if(last&&(last.arenaId!==b.arenaId||last.layer!==b.layer))points=[];
      points=points.filter(q=>frame.tick-q.tick<life);
      if(frame.tick%stride===0)points.push({bodyId:b.id,ownerId:b.ownerId,arenaId:b.arenaId,x:b.x,y:b.y,elevation:b.elevation,radius:b.radius,layer:b.layer,tick:frame.tick});
      if(points.length>count)points.splice(0,points.length-count);paths.set(b.id,points);
    }
    tick=frame.tick;lastIdentity=identity;
  }
  return {update,reset(){paths.clear();tick=-1;lastIdentity='';},sample():readonly PinballPixelTrailPoint[]{return Object.freeze([...paths.values()].flatMap(points=>points.map(q=>Object.freeze({...q,alpha:(1-(tick-q.tick)/life)**2}))));},get stats(){return Object.freeze({tick,bodies:paths.size,points:[...paths.values()].reduce((n,a)=>n+a.length,0),maxPoints:128*count});}};
}

export interface PinballPixelFeedbackArtRequest {
  readonly theme:PinballArcadeTheme;readonly arenaId:string;readonly scale:number;
  readonly project:(x:number,y:number,z:number)=>Point;
  readonly feedback:PinballFeedbackSample;
  readonly trails?:readonly PinballPixelTrailPoint[];
  readonly reducedMotion?:boolean;
}

/** Canonical native impacts become authored indexed spark clusters, expanding
 * arcs and observed ball trails. Draw below current balls/working blades. */
export function drawPinballPixelFeedback(p:PixelCanvas,r:PinballPixelFeedbackArtRequest) {
  if(!themes.includes(r.theme)||typeof r.arenaId!=='string'||!Number.isFinite(r.scale)||r.scale<=0||r.scale>2||typeof r.project!=='function'||p.palette.length<40||!Number.isFinite(r.feedback.tick)||r.feedback.tick<0||r.feedback.tick>=432001||!Array.isArray(r.feedback.particles)||r.feedback.particles.length>2048||!Array.isArray(r.feedback.pulses)||r.feedback.pulses.length>512||!Array.isArray(r.trails??[])||(r.trails?.length??0)>4096||(r.reducedMotion!==undefined&&typeof r.reducedMotion!=='boolean'))throw Error('Pixel feedback art budget');
  const project=(q:{x:number;y:number;elevation:number})=>{if(![q.x,q.y,q.elevation].every(finite))throw Error('Pixel feedback position');const a=r.project(q.x,q.y,q.elevation);if(!Array.isArray(a)||a.length!==2||![0,1].every(i=>Object.hasOwn(a,i)&&Number.isFinite(a[i])&&Math.abs(a[i]!)<=100000))throw Error('Pixel feedback projection');return a;};
  // Preflight every supplied element before painting; malformed late values
  // cannot leave a half-painted impact in the shared indexed buffer.
  const particles=[] as {q:PinballFeedbackSample['particles'][number];point:Point}[],pulses=[] as {q:PinballFeedbackSample['pulses'][number];point:Point}[],trails=[] as {q:PinballPixelTrailPoint;point:Point}[];
  for(let i=0;i<r.feedback.particles.length;i++){const q=r.feedback.particles[i];if(!q||!['spark','mist','ring','charge'].includes(q.kind)||!Number.isFinite(q.alpha)||q.alpha<0||q.alpha>1||!Number.isFinite(q.size)||q.size<0||q.size>32||!Number.isFinite(q.age)||q.age<0)throw Error('Pixel feedback particle');const point=project(q);if(q.arenaId===r.arenaId)particles.push({q,point});}
  for(let i=0;i<r.feedback.pulses.length;i++){const q=r.feedback.pulses[i];if(!q||!['spark','mist','ring','charge'].includes(q.kind)||!Number.isFinite(q.alpha)||q.alpha<0||q.alpha>1||!Number.isFinite(q.radius)||q.radius<0||q.radius>256)throw Error('Pixel feedback pulse');const point=project(q);if(q.arenaId===r.arenaId)pulses.push({q,point});}
  for(let i=0;i<(r.trails?.length??0);i++){const q=r.trails![i];if(!q||typeof q.bodyId!=='string'||!q.bodyId||typeof q.arenaId!=='string'||!integer(q.ownerId,0,99)||!integer(q.layer,0,3)||!Number.isFinite(q.alpha)||q.alpha<0||q.alpha>1||!integer(q.tick,0,r.feedback.tick))throw Error('Pixel feedback trail');const point=project(q);if(q.arenaId===r.arenaId)trails.push({q,point});}
  if(r.reducedMotion)return {particles:0,pulses:0,trails:0};
  const accent=r.theme==='grove'?20:r.theme==='sun-vault'?15:r.theme==='ion-relay'?20:25;
  // Connect only consecutive observations belonging to the same body/floor.
  // This is the recorded ball path, with a shaded pixel ribbon and bright head.
  const previous=new Map<string,{q:PinballPixelTrailPoint;point:Point}>();
  for(const item of trails){const {q,point:[x,y]}=item;if(q.alpha<.07)continue;const size=q.alpha>.65?2:q.alpha>.3?1.5:1,ink=accent+Math.min(3,Math.floor(q.alpha*4)),old=previous.get(q.bodyId);
    if(old&&old.q.arenaId===q.arenaId&&old.q.layer===q.layer&&q.tick>old.q.tick&&q.tick-old.q.tick<=16&&Math.max(Math.abs(x-old.point[0]),Math.abs(y-old.point[1]))<96){
      p.line(old.point[0],old.point[1],x,y,accent+1,q.alpha>.65?3:2);p.line(old.point[0],old.point[1],x,y,ink);
    }
    previous.set(q.bodyId,item);
    if(r.theme==='grove')p.poly([x-size*2,y,x,y-size,x+size*2,y,x,y+size],ink);
    else if(r.theme==='vaporwave'){p.disk(x,y,size,ink);if(q.alpha>.6)p.dot(x-1,y-1,accent+4);}
    else p.disk(x,y,size,ink);
  }
  for(const {q,point:[x,y]} of pulses){if(q.alpha<.15)continue;const rad=Math.max(2,q.radius*r.scale),ink=q.alpha>.6?accent+4:accent+2;
    for(let k=0;k<12;k++){if(q.kind==='spark'&&k%3===1)continue;const a=k*Math.PI/6,b=a+Math.PI/10;p.line(x+dcos(a)*rad,y+dsin(a)*rad,x+dcos(b)*rad,y+dsin(b)*rad,ink,1);}
    if(q.alpha>.72&&(q.kind==='spark'||q.kind==='charge')){
      const arm=Math.max(3,Math.round(q.alpha*8));
      p.line(x-arm-2,y,x+arm+2,y,accent+2,3);p.line(x,y-arm-2,x,y+arm+2,accent+2,3);
      p.line(x-arm,y,x+arm,y,accent+4);p.line(x,y-arm,x,y+arm,accent+4);
      p.poly([x,y-3,x+3,y,x,y+3,x-3,y],34);p.dot(x-1,y-1,34);
      for(const sign of[-1,1]){p.line(x+sign*4,y+4,x+sign*7,y+7,ink);p.line(x+sign*4,y-4,x+sign*7,y-7,ink);}
    }
  }
  for(const {q,point:[x,y]} of particles){if(q.alpha<.08)continue;const ink=q.alpha>.65?34:q.alpha>.3?accent+4:accent+2,size=Math.max(1,Math.min(3,q.size*r.scale));
    if(q.kind==='mist'){p.disk(x+1,y+1,size,accent+1);p.disk(x,y,Math.max(1,size-1),ink);}
    else if(q.kind==='charge'){p.line(x-size,y,x+size,y,ink);p.line(x,y-size,x,y+size,ink);p.dot(x,y,34);}
    else if(q.kind==='ring'){p.poly([x,y-size,x+size,y,x,y+size,x-size,y],ink);p.dot(x,y,accent+1);}
    else{p.line(x-2,y+2,x+1,y-1,accent+2);p.line(x-1,y+1,x+1,y-1,ink);if(q.alpha>.7)p.dot(x+1,y-1,34);}
  }
  return {particles:particles.length,pulses:pulses.length,trails:trails.length};
}
