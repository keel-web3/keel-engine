import { themeOf, THEME_GENERATOR, CULTURES } from '@keel-engine/ui';
import { toHex } from '../../ui/src/color.ts';
import type { Theme, ThemeRecipe } from '@keel-engine/ui';
export const DESIGN_LANGUAGE = Object.freeze({
  id: 'keel/react-design@1',
  rules: ['Canonical KEEL generators and renderer own the scene.', 'React binds state, lifecycle and accessible controls to the same world.', 'Controls stay on their authored world surfaces; DOM counterparts retain their placement.', 'Theme recipes provide semantic palette, spacing, type, frames and motion.', 'Pixel scenes use integer scale and nearest-neighbour sampling.', 'Project-owned fonts and assets retain provenance.', 'Seed and frame clocks are explicit; captures export real source geometry and state.'],
  references: ['REDLINE: React host callbacks into the shared engine world.', 'CRUCIBLE: React state controls a genuine KEEL pixel-rendered package room.'],
  limitations: ['DOM primitives expose semantic theme roles, not every pixel UI frame decoration.', 'A CSS font must be supplied by the project; generated pixel glyphs are available through keel/ui.', 'The React adapter is host tooling, not an onchain registered React runtime.'],
});
export function themeTokens(theme: Theme, scale = 2): Record<string,string> {
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new RangeError('UI scale must be an integer from 1 to 16.');
  const p=theme.palette, hex=(r:readonly number[],i:number)=>toHex(r[i]??r[0]??0);
  const values:Record<string,string> = {
    '--keel-surface':hex(p.surface,2),'--keel-raised':hex(p.surface,3),'--keel-ink':hex(p.ink,1),'--keel-muted':hex(p.ink,0),'--keel-accent':hex(p.accent,2),'--keel-on-accent':toHex(p.onAccent),'--keel-outline':toHex(p.outline),'--keel-good':hex(p.good,2),'--keel-warn':hex(p.warn,2),'--keel-bad':hex(p.bad,2),
    '--keel-px':`${scale}px`,'--keel-border':`${theme.frame.border*scale}px`,'--keel-pad':`${theme.space.pad*scale}px`,'--keel-gap':`${theme.space.gap*scale}px`,'--keel-body':`${theme.type.body*scale}px`,'--keel-motion':`${theme.motion.ms}ms`,
  };
  for(const [name,ramp] of Object.entries(p)) if(Array.isArray(ramp)&&typeof ramp[0]==='number')ramp.forEach((value,i)=>{values[`--keel-${name}-${i}`]=toHex(value);});
  return values;
}
export function recipeTheme(input:unknown = {}): Theme {
  if(!input || typeof input!=='object'||Array.isArray(input))throw new TypeError('Theme recipe must be an object.');
  const value=input as Record<string,unknown>;for(const key of Object.keys(value))if(!['seed','culture','pins'].includes(key))throw new TypeError(`Unknown recipe field ${key}.`);
  const seed=value.seed??'keel/react',culture=value.culture??'clean';
  if(typeof seed!=='string'||seed.length>256||!CULTURES.includes(culture as typeof CULTURES[number]))throw new TypeError('Invalid seed or culture.');
  const pins=value.pins??{};if(!pins||typeof pins!=='object'||Array.isArray(pins))throw new TypeError('Pins must be an object.');
  const allowed:Record<string,readonly unknown[]|readonly [number,number]>={tone:['dark','light'],hue:[0,360],accentHue:[0,360],motion:['snappy','bouncy','none'],corner:['flat','bevel','inset','notched','rivets','glow','round'],body:[5,16],unit:[1,8],border:[1,3],bevel:[0,2],fill:['solid','dither','gradient','scan'],shadow:[0,2],glow:[0,2],caps:[true,false]};
  for(const [key,pin] of Object.entries(pins)){const range=allowed[key];if(!range)throw new TypeError(`Unsupported pin ${key}.`);if(typeof range[0]==='number'){if(typeof pin!=='number'||!Number.isFinite(pin)||pin<(range[0] as number)||pin>(range[1] as number)||(!key.endsWith('Hue')&&key!=='hue'&&!Number.isInteger(pin)))throw new TypeError(`Invalid pin ${key}.`);}else if(!range.includes(pin))throw new TypeError(`Invalid pin ${key}.`);}
  return themeOf({generator:THEME_GENERATOR,seed,culture,pins} as ThemeRecipe);
}
