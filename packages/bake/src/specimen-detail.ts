/** Detail tiers: one object, drawn richer where a device can afford it.
 * Parts, patterns, tracks, emitters and dynamics each carry a tier (`detail`, absent = 0); joints, materials and everything
 * else belong to every tier. A rendition at level D draws the entries of tier <= D, in program order: tier 0 is the cartridge's
 * object and stands alone, 1 adds what phones, the browser and handhelds draw, 2 what desktops do. The hash and the art seed
 * cover the whole program; a level is a view of that one object, never another one.
 *
 * Seeded randomness never shifts between levels. Geometry draws nothing per entry; dynamic matter's streams don't depend on
 * which node it is; an emitter's stream is keyed by its tier and its rank among that tier's emitters (see emitterSlots), so an
 * entry draws the same numbers at every level that shows it, and the level-D object is exactly the program with every entry
 * above D deleted.
 *
 * Budgets (readSpecimen): the detail-0 object keeps the cartridge's limits (24 parts and expanded parts, 4 patterns, 8 tracks,
 * 4 emitters, 2 dynamics, and 8 joints unless some entry is tiered); the whole program has 64 parts and expanded parts,
 * 8 patterns, 16 joints and tracks, 8 emitters, 4 dynamics. */
import {SPECIMEN_DETAIL_MAX,type SpecimenDetail,type SpecimenProgram} from './specimen-types.ts';
const tier=(e:{detail?:number}):number=>e.detail??0;
/** The highest tier any entry of the program has (0 for a program without tiers). */
export function specimenDetail(program:SpecimenProgram):number{
 let d=0;const see=(list:readonly {detail?:number}[]|undefined)=>{for(const e of list??[])d=Math.max(d,tier(e));};
 see(program.parts);see(program.patterns);see(program.patterns?.map(p=>p.part));see(program.motion?.tracks);see(program.emitters);see(program.dynamics);
 return d;
}
/** The program a rendition at `detail` draws: the entries above it left out, in order, each keeping its tier. The same object
 * when nothing is above it, so a program without tiers is untouched at every level. A pattern goes when its own tier or its
 * part's is above the level. */
export function specimenAtDetail<P extends SpecimenProgram>(program:P,detail:SpecimenDetail=SPECIMEN_DETAIL_MAX):P{
 if(specimenDetail(program)<=detail)return program;
 const keep=<T extends {detail?:number}>(list:T[])=>list.filter(e=>tier(e)<=detail);
 return {...program,parts:keep(program.parts),
  ...(program.patterns?{patterns:program.patterns.filter(p=>tier(p)<=detail&&tier(p.part)<=detail)}:{}),
  ...(program.motion?{motion:{...program.motion,tracks:keep(program.motion.tracks)}}:{}),
  ...(program.emitters?{emitters:keep(program.emitters)}:{}),...(program.dynamics?{dynamics:keep(program.dynamics)}:{})};
}
/** Each emitter's first random stream: 31 + 1000 * tier + 8 * (its rank among its tier's emitters); birth b of five uses
 * slot + b. Tier 0 is 31 + 8i, as it always was; another tier's emitters never move a tier-0 emitter's numbers. */
export const emitterSlots=(program:SpecimenProgram):number[]=>{
 const rank=new Map<number,number>();
 return (program.emitters??[]).map(e=>{const t=tier(e),k=rank.get(t)??0;rank.set(t,k+1);return 31+t*1000+k*8;});
};
