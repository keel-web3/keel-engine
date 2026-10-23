import type {ArenaBiomeBlend,ArenaField} from './types.ts';
export interface ArenaSceneMusicBlueprint {
 readonly id:string;readonly bpm:number;readonly root:number;readonly scale:readonly number[];readonly shape:'sine'|'saw'|'square'|'pulse'|'tri';readonly chordShape:'sine'|'saw'|'square'|'pulse'|'tri';readonly wear:'clean'|'lofi'|'chip'|'soft';
 readonly bass:number;readonly lead:number;readonly drum:number;readonly chordGain:number;readonly leadEvery:1|2|4|8;readonly leadOffset:number;readonly bassEvery:1|2|4|8;readonly leadBeats:number;
 readonly kick:readonly number[];readonly snare:readonly number[];readonly hat:readonly number[];readonly partials:readonly {readonly interval:number;readonly gain:number}[];readonly air:number;readonly airHz:number;
}
export interface ArenaSceneStructure {
 readonly rim:readonly {readonly role:string;readonly inset:number;readonly drop:number;readonly width:number;readonly height:number}[];
 readonly hubs:readonly {readonly role:string;readonly kind:'box'|'ball'|'capsule';readonly a:readonly [number,number,number];readonly b:readonly [number,number,number];readonly size:readonly [number,number,number];readonly motion:'static'|'pulse'}[];
}
export interface ArenaSceneEnvironment {
 /** Recessed cosmetic floor sections. The art consumer admits bounded normalized vocabulary below the native playing deck; no collision or support is supplied here. */
 readonly substrate?:{readonly semantic:string;readonly layout?:'lattice'|'boundary';readonly spacing:number;readonly rise:number;readonly parts:readonly ArenaSceneStructure['hubs'][number][]};
 readonly semantic:string;readonly clear:readonly [number,number,number];
 readonly floor:{readonly role:string;readonly depth:number;readonly margin:number}|null;
 readonly tiers:readonly {readonly assetId:string;readonly semantic:string;readonly band:'near'|'mid'|'far';readonly spacing:number;readonly scale:readonly [number,number];readonly offset:number;readonly rise?:number}[];
 /** Presentation-only sections and mounts. The art consumer validates the
  * normalized parts and complete native footprint against physical geometry. */
 readonly construction?:{
  readonly semantic:string;
  readonly boundary:{readonly offset:number;readonly width:number;readonly rise:number;readonly drop:number;readonly spacing:number;readonly parts:readonly ArenaSceneStructure['hubs'][number][]}|null;
  readonly mounts:readonly {readonly assetId:string;readonly semantic:string;readonly width:number;readonly from:'foundation'|'chamber';readonly parts:readonly ArenaSceneStructure['hubs'][number][]}[];
 };
}
/** Serialized scene presentation remains outside collision authority. A
 * content pack owns its vocabulary; the complete recipe owns world identity. */
export interface ArenaSceneGenome {
 readonly schema:'keel-pinball-scene@1';readonly blueprintId:string;readonly blueprintRevision:string;readonly cabinetFamily:string;readonly cabinetSeed:string;readonly stage:number;readonly seed:string;
 readonly biome:ArenaBiomeBlend;readonly props:readonly {readonly assetId:string;readonly semantic:string;readonly band:'mechanical-frame'|'plant-fringe';readonly weight:number;readonly scale:readonly [number,number];readonly socket?:'boundary'|'bank-flank'}[];
 readonly material:{readonly tones:Readonly<Record<string,readonly [number,number,number]>>};
 readonly print:{readonly spacing:number;readonly layout?:'grid'|'field';readonly semantic?:string;readonly primitives:readonly {readonly a:readonly [number,number];readonly b:readonly [number,number];readonly width:number;readonly role:'trim'|'core'|'dark'|'steel'|'bark'}[]};
 readonly lighting:{readonly semantic:string;readonly fixtureAssetIds:readonly string[];readonly tintRoles:readonly [string,string];readonly gain:number};
 readonly motion:{readonly windGain:number;readonly windRate:number;readonly blinkPeriodMs:number;readonly blinkDepth:number};
 readonly growth:{readonly kind:'none'|'edge-vines';readonly density:number};
 readonly ambient:{readonly semantic:string;readonly tempo:number;readonly scale:string;readonly voices:readonly string[]};
 readonly music?:ArenaSceneMusicBlueprint;
 readonly structure?:ArenaSceneStructure;
 readonly environment?:ArenaSceneEnvironment;
}
/** Regional overrides name an existing physical region. An optional collision
 * layer distinguishes stacked chambers; exact layer overrides a regional default. */
export interface ArenaSceneRegion {readonly regionId:string;readonly layer?:number;readonly scene:ArenaSceneGenome}
/** Authority admits a bounded plain JSON envelope, without importing art or
 * audio implementations. Consumers validate their own vocabulary and grammar. */
export function assertArenaSceneEnvelope(scene:ArenaSceneGenome):void {
 let nodes=0;
 function visit(value:unknown,depth:number):void{
  if(++nodes>4096||depth>12)throw new Error('Scene presentation record cap');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Non-finite scene presentation');return;}
  if(typeof value==='string'){if(value.length>512)throw new Error('Scene presentation string cap');return;}
  if(Array.isArray(value)){if(value.length>256)throw new Error('Scene presentation array cap');for(const child of value)visit(child,depth+1);return;}
  if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){const entries=Object.entries(value);if(entries.length>128||entries.some(([key])=>key.length>120))throw new Error('Scene presentation dictionary cap');for(const [,child]of entries)visit(child,depth+1);return;}
  throw new Error('Scene presentation must be plain JSON');
 }
 visit(scene,0);
 if(scene.schema!=='keel-pinball-scene@1'||typeof scene.blueprintId!=='string'||!scene.blueprintId||typeof scene.blueprintRevision!=='string'||!scene.blueprintRevision||typeof scene.cabinetFamily!=='string'||!scene.cabinetFamily||!/^0x[0-9a-f]{64}$/.test(scene.cabinetSeed)||!/^0x[0-9a-f]{64}$/.test(scene.seed)||!Number.isSafeInteger(scene.stage)||scene.stage<0||scene.stage>100000||!Array.isArray(scene.props)||scene.props.length>24||!scene.material?.tones||!scene.print||!Array.isArray(scene.print.primitives)||scene.print.primitives.length>64||!scene.lighting||!scene.motion||!scene.growth||!scene.ambient)throw new Error('Invalid scene presentation envelope');
 if(scene.print.layout!==undefined&&!['grid','field'].includes(scene.print.layout)||scene.print.semantic!==undefined&&(typeof scene.print.semantic!=='string'||scene.print.semantic.length<1||scene.print.semantic.length>120))throw new Error('Invalid scene print presentation');
 if(new TextEncoder().encode(JSON.stringify(scene)).length>65536)throw new Error('Scene presentation byte cap');
}
/** Shared envelope for mixed-biome presentation. It never supplies bounds,
 * gravity, collision, routes or authoritative region selection. */
export function assertArenaFieldScenes(field:Pick<ArenaField,'regions'|'scene'|'sceneRegions'>):void {
 if(field.scene!==undefined)assertArenaSceneEnvelope(field.scene);
 if(field.sceneRegions===undefined)return;
 if(!Array.isArray(field.sceneRegions)||field.sceneRegions.length>16)throw new Error('Regional scene record cap');
 const keys=new Set<string>();
 for(const binding of field.sceneRegions){
  if(!binding||typeof binding!=='object'||Array.isArray(binding)||(Object.getPrototypeOf(binding)!==Object.prototype&&Object.getPrototypeOf(binding)!==null)||Object.keys(binding).some(key=>!['regionId','layer','scene'].includes(key))||typeof binding.regionId!=='string'||binding.regionId.length<1||binding.regionId.length>120||field.regions.filter(region=>region.id===binding.regionId).length!==1||binding.layer!==undefined&&(!Number.isSafeInteger(binding.layer)||binding.layer<0||binding.layer>3))throw new Error('Invalid regional scene binding');
  const key=binding.regionId+'\u0000'+(binding.layer??'*');if(keys.has(key))throw new Error('Duplicate regional scene binding');keys.add(key);
  assertArenaSceneEnvelope(binding.scene);
 }
 if(new TextEncoder().encode(JSON.stringify({scene:field.scene,sceneRegions:field.sceneRegions})).length>65536)throw new Error('Regional scene byte cap');
}
/** Resolve canonical region/layer identity; never infer it from art or alter
 * an authoritative body. A source field recipe remains the fallback. */
export function arenaSceneForRegion(field:Pick<ArenaField,'scene'|'sceneRegions'>,regionId:string,layer:number):ArenaSceneGenome|undefined {
 return field.sceneRegions?.find(binding=>binding.regionId===regionId&&binding.layer===layer)?.scene??field.sceneRegions?.find(binding=>binding.regionId===regionId&&binding.layer===undefined)?.scene??field.scene;
}
