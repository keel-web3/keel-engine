import{nativeRectangleBounds}from'./validation.ts';
import{createRoll,deriveSeed}from'@keel-engine/core';
import type{ArenaWorldDefinition,ArenaSurface}from'@keel-engine/pinball-arena';
/** Art-only deterministic assembly recipe. No target, gate or collision is added.
 * Every physical-purpose reference is retained from the actual source field. */
export function roomGrammar(seed:string,field:ArenaWorldDefinition['arenas'][number],bed:ArenaSurface){
 if(!field.surfaces.includes(bed)||bed.kind!=='playfield')throw Error('Exact native bed required');
 if(typeof seed!=='string'||seed.length>512||!Number.isSafeInteger(bed.layer)||bed.layer<0||!Number.isFinite(bed.height)||Math.abs(bed.height)>1e6)throw Error('Native room coordinate budget');
 const bounds=nativeRectangleBounds(bed.polygon);
 const inside=(x:number,y:number)=>x>=bounds[0]&&x<=bounds[2]&&y>=bounds[1]&&y<=bounds[3];
 const rng=createRoll(deriveSeed(seed,bed.id+'/room'));
 return{bedId:bed.id,bounds,layer:bed.layer,elevation:bed.height,
  anatomy:['pressure-bank','turbine-court','relay-foundry'][rng.index(0,3)]!,
  serviceSide:rng.index(1,2)===0?-1:1,panelJoints:2+rng.index(2,3),ribPitch:30+rng.index(3,4)*7,
  springs:field.bumpers.filter(v=>v.layer===bed.layer&&(v.elevation??0)===bed.height&&inside(v.x,v.y)).map(v=>v.id),
  targets:field.rails.filter(v=>v.kind==='target'&&v.layer===bed.layer&&(v.elevation??0)===bed.height&&inside(v.ax,v.ay)&&inside(v.bx,v.by)).map(v=>v.id),
  stations:field.stations.filter(v=>v.layer===bed.layer&&(v.elevation??0)===bed.height&&inside(v.x,v.y)).map(v=>v.id),
  placement:'surface-material-only; raised noncontact architecture requires supplied full shot/sweep reservations' as const};
}
