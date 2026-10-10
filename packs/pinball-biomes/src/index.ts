import {createRoll,deriveSeed,normalizeSeed} from '@keel-engine/core/rng';
export {manifest} from './module.ts';
export const PINBALL_BIOME_VERSION='keel-pinball-biome@1' as const;
export const PINBALL_BIOME_THEMES=['nightshift','cyberpunk','vaporwave','gold','nature'] as const;
export type PinballBiomeTheme=typeof PINBALL_BIOME_THEMES[number];
export type PinballBiomeDensity='low'|'medium'|'high';
export type PinballOrnamentKind='leaf'|'frond'|'circuit'|'tower'|'grid'|'sun'|'obelisk'|'gem';
export interface PinballBiomePalette {readonly floor:string;readonly raised:string;readonly steel:string;readonly rail:string;readonly ball:string;readonly accent:string;readonly brass:string;readonly warning:string}
export interface PinballBiomeOrnament {readonly id:string;readonly kind:PinballOrnamentKind;readonly x:number;readonly y:number;readonly size:number;readonly rotation:number;readonly phase:number;readonly variant:number}
export interface PinballBiome {readonly schema:typeof PINBALL_BIOME_VERSION;readonly theme:PinballBiomeTheme;readonly seed:string|number;readonly ornaments:readonly PinballBiomeOrnament[];readonly palette:PinballBiomePalette}
export interface PinballBiomeOptions {theme:PinballBiomeTheme;seed:string|number;width:number;height:number;density?:PinballBiomeDensity}
export const PINBALL_BIOME_CAPS=Object.freeze({low:12,medium:24,high:44});
export const PINBALL_BIOME_PALETTES:Readonly<Record<PinballBiomeTheme,PinballBiomePalette>>=Object.freeze({
  nightshift:Object.freeze({floor:'#07121b',raised:'#183642',steel:'#36505c',rail:'#b4cad1',ball:'#f6fbff',accent:'#52f9c5',brass:'#cf9d50',warning:'#ff796e'}),
  cyberpunk:Object.freeze({floor:'#0b061b',raised:'#221341',steel:'#554574',rail:'#62e7ff',ball:'#ffffff',accent:'#fb42dc',brass:'#f8c463',warning:'#ff725c'}),
  vaporwave:Object.freeze({floor:'#120928',raised:'#37214f',steel:'#8b67ac',rail:'#f3b8e4',ball:'#faffff',accent:'#6df4ed',brass:'#ffaacf',warning:'#ffe277'}),
  gold:Object.freeze({floor:'#110f0a',raised:'#30291a',steel:'#776848',rail:'#edd181',ball:'#fffdf2',accent:'#ffecaa',brass:'#b9913d',warning:'#fa9c65'}),
  nature:Object.freeze({floor:'#061a15',raised:'#123e2d',steel:'#49654d',rail:'#c1d2a8',ball:'#ffffff',accent:'#a6ee6e',brass:'#d3a864',warning:'#ffae74'}),
});
const q=(value:number)=>Math.round(value*1024)/1024;
/** Decorative coordinates only. Physics must never consume this resource. */
export function createPinballBiome(options:PinballBiomeOptions):PinballBiome {
  const {theme,seed,width,height}=options,density=options.density??'medium';
  if(!PINBALL_BIOME_THEMES.includes(theme))throw new TypeError('Unknown pinball biome theme');
  if(!Object.hasOwn(PINBALL_BIOME_CAPS,density))throw new TypeError('Unknown pinball biome density');
  for(const [name,value] of [['width',width],['height',height]] as const)if(!Number.isFinite(value)||value<100||value>4096)throw new RangeError(`Invalid biome ${name}`);
  if(typeof seed==='number'?(!Number.isSafeInteger(seed)||seed<0):typeof seed!=='string'||seed.length===0||seed.length>160||/[\u0000-\u001f]/u.test(seed))throw new TypeError('Biome seed must be a bounded string or nonnegative safe integer');
  const root=typeof seed==='string'&&/^0x[0-9a-fA-F]{64}$/u.test(seed)?normalizeSeed(seed):deriveSeed('pinball-biome@1',`${typeof seed}:${seed}`);
  const count=PINBALL_BIOME_CAPS[density],unit=Math.min(width,height),ornaments:PinballBiomeOrnament[]=[];
  for(let i=0;i<count;i++){
    // Each stable ID owns a stream. Density adds ornaments without rerolling any.
    const roll=createRoll(deriveSeed(root,`${theme}:ornament:${i}`));
    const f=(slot:number)=>roll.at(slot)/65535;
    const left=i%2===0,side=left?1:-1;
    let kind:PinballOrnamentKind='circuit',x=(left?.085:.915)*width,y=(.18+f(1)*.48)*height,size=(.018+f(2)*.022)*unit,rotation=0;
    if(theme==='nature'){
      kind=i<2?'frond':i%7===0?'frond':'leaf';
      x=(left?.135:.865)*width;y=(.24+f(1)*.60)*height;
      size=(kind==='frond'?.09+f(2)*.045:.016+f(2)*.023)*unit;
      rotation=side*(.28+f(3)*.8);
      if(i<2){x=(left?.06:.94)*width;y=.20*height;size=.16*unit;}
    }else if(theme==='cyberpunk'){
      kind=i<6||i%3===0?'tower':'circuit';
      if(i<6){x=(.10+i*.16)*width;y=(.15+f(1)*.11)*height;size=(.06+f(2)*.07)*unit;}
      else {x=(left?.075:.925)*width;y=(.27+f(1)*.41)*height;size=(.03+f(2)*.035)*unit;}
    }else if(theme==='vaporwave'){
      kind=i===0?'sun':i===1?'grid':i%4===0?'frond':'grid';
      if(i===0){x=.50*width;y=.17*height;size=.16*unit;}
      else if(i===1){x=.50*width;y=.38*height;size=.35*unit;}
      else {x=(left?.105:.895)*width;y=(.24+f(1)*.40)*height;size=(kind==='frond'?.07:.025)*unit+f(2)*.025*unit;rotation=side*(kind==='frond'?.5:0);}
    }else if(theme==='gold'){
      kind=i<4||i%5===0?'obelisk':'gem';
      if(i<4){x=(.12+i*.25)*width;y=(.18+f(1)*.09)*height;size=(.06+f(2)*.045)*unit;}
      else {x=(left?.09:.91)*width;y=(.28+f(1)*.38)*height;size=(kind==='gem'?.018:.06)*unit+f(2)*.015*unit;}
      rotation=kind==='gem'?side*f(3)*.5:0;
    }else {
      kind=i%5===0?'tower':'circuit';
      x=(left?.075:.925)*width;y=(.20+f(1)*.46)*height;size=(kind==='tower'?.055:.025)*unit+f(2)*.018*unit;
    }
    // Lower ornaments stay outside the central approach/landing corridor.
    if(y+size/2>=height*.70 && x+size/2>width*.19 && x-size/2<width*.81){x=left?width*.055:width*.945;}
    ornaments.push(Object.freeze({id:`${theme}.ornament.${String(i).padStart(3,'0')}`,kind,x:q(x),y:q(y),size:q(size),rotation:q(rotation),phase:q(f(4)*Math.PI*2),variant:roll.range(5,0,3)}));
  }
  return Object.freeze({schema:PINBALL_BIOME_VERSION,theme,seed,ornaments:Object.freeze(ornaments),palette:PINBALL_BIOME_PALETTES[theme]});
}
