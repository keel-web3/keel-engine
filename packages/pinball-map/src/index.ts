export {manifest} from './module.ts';
/** Canonical table coordinates: +x right, +y down; 1024 fixedpoint quanta/unit. */
export interface Segment { id: string; ax: number; ay: number; bx: number; by: number; restitution?: number; layer?: number }
export interface Bumper { id: string; x: number; y: number; radius: number; impulse?: number; points?: number; layer?: number }
export interface Flipper { id: string; pivotX: number; pivotY: number; length: number; radius: number; restAngle: number; activeAngle: number; side: 'left'|'right'; ownerId?: number; layer?: number }
export interface PinballMap {
  schema: 'keel-pinball-map@1'; id: string; width: number; height: number; gravity: number; ballRadius: number;
  launch: { x: number; y: number; vx: number; vy: number }; drainY: number;
  segments: readonly Segment[]; bumpers: readonly Bumper[]; flippers: readonly Flipper[];
}
export interface CompiledPinballMap extends PinballMap { readonly canonical: string }
const cmp = (a: {id:string}, b:{id:string}) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const quantize = (n:number) => Math.round(n * 1024) / 1024;
export function compilePinballMap(source: PinballMap): CompiledPinballMap {
  const number = (n: number, name:string, lo=-4096, hi=4096):number => {
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`Invalid pinball map ${name}`);
    return quantize(n);
  };
  const integer = (n:number, name:string, lo:number, hi:number) => { number(n,name,lo,hi); if (!Number.isInteger(n)) throw new Error(`Invalid integer ${name}`); return n; };
  if (source.schema !== 'keel-pinball-map@1' || !/^[A-Za-z0-9._-]{1,80}$/.test(source.id)) throw new Error('Invalid pinball map identity');
  if (source.segments.length > 128 || source.bumpers.length > 32 || source.flippers.length > 8) throw new Error('Pinball map collider budget exceeded');
  const ids = new Set<string>();
  const id = (value:string) => { if (!/^[A-Za-z0-9._-]{1,80}$/.test(value) || ids.has(value)) throw new Error('Invalid or duplicate collider ID'); ids.add(value); return value; };
  const layer = (n=0) => integer(n,'layer',0,15);
  const map: PinballMap = {
    schema: 'keel-pinball-map@1', id: source.id,
    width: number(source.width,'width',100,2048), height: number(source.height,'height',100,2048),
    gravity: number(source.gravity,'gravity',0,0.25), ballRadius: number(source.ballRadius,'ballRadius',4,32),
    launch: {x:number(source.launch.x,'launch.x'),y:number(source.launch.y,'launch.y'),vx:number(source.launch.vx,'launch.vx',-24,24),vy:number(source.launch.vy,'launch.vy',-24,24)},
    drainY: number(source.drainY,'drainY'),
    segments: [...source.segments].sort(cmp).map(s => { const out = {id:id(s.id),ax:number(s.ax,'ax'),ay:number(s.ay,'ay'),bx:number(s.bx,'bx'),by:number(s.by,'by'),restitution:number(s.restitution ?? .82,'restitution',0,1),layer:layer(s.layer)}; if(out.ax===out.bx && out.ay===out.by) throw new Error('Zero length rail'); return out; }),
    bumpers: [...source.bumpers].sort(cmp).map(b => ({id:id(b.id),x:number(b.x,'x'),y:number(b.y,'y'),radius:number(b.radius,'radius',1,128),impulse:number(b.impulse ?? 4,'impulse',0,12),points:integer(b.points ?? 100,'points',0,100000),layer:layer(b.layer)})),
    flippers: [...source.flippers].sort(cmp).map(f => { if (f.side!=='left' && f.side!=='right') throw new Error('Invalid flipper side'); if (Math.abs(f.activeAngle-f.restAngle)>100) throw new Error('Flipper stroke exceeds 100 degrees'); return {id:id(f.id),pivotX:number(f.pivotX,'pivotX'),pivotY:number(f.pivotY,'pivotY'),length:number(f.length,'length',16,160),radius:number(f.radius,'radius',2,24),restAngle:number(f.restAngle,'restAngle',-360,360),activeAngle:number(f.activeAngle,'activeAngle',-360,360),side:f.side,ownerId:integer(f.ownerId ?? 0,'ownerId',0,65535),layer:layer(f.layer)}; }),
  };
  Object.freeze(map.launch);
  for (const group of [map.segments,map.bumpers,map.flippers]) { for (const value of group) Object.freeze(value); Object.freeze(group); }
  return Object.freeze({...map,canonical:JSON.stringify(map)});
}
