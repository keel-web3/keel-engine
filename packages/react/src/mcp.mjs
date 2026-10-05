import {readFile,writeFile,unlink,access} from 'node:fs/promises';
import {join} from 'node:path';
import {DESIGN_LANGUAGE,recipeTheme,themeTokens} from './design.ts';
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const recipe=object({seed:{type:'string',maxLength:256},culture:{type:'string',enum:['industrial','organic','crystalline','arcane','brutal','clean']},pins:object({tone:{enum:['dark','light']},hue:{type:'number',minimum:0,maximum:360},accentHue:{type:'number',minimum:0,maximum:360},motion:{enum:['snappy','bouncy','none']},corner:{enum:['flat','bevel','inset','notched','rivets','glow','round']},body:{type:'integer',minimum:5,maximum:16},unit:{type:'integer',minimum:1,maximum:8},border:{type:'integer',minimum:1,maximum:3},bevel:{type:'integer',minimum:0,maximum:2},fill:{enum:['solid','dither','gradient','scan']},shadow:{type:'integer',minimum:0,maximum:2},glow:{type:'integer',minimum:0,maximum:2},caps:{type:'boolean'}})});
export const TOOL_SCHEMAS={
 'keel-react-catalog':object({}),
 'keel-react-theme':object({recipe,scale:{type:'integer',minimum:1,maximum:16}}),
 'keel-react-plan':object({brief:{type:'string',minLength:1,maxLength:8192},recipe,assets:{type:'array',maxItems:128,items:object({id:{type:'string'},path:{type:'string'},kind:{enum:['font','image','audio','video','mesh']}},['id','path','kind'])}},['brief']),
 'keel-react-scaffold':object({outDir:{type:'string',minLength:1},brief:{type:'string',maxLength:8192},recipe},['outDir'])
};
function input(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Input must be an object.');for(const key of Object.keys(value))if(!allowed.includes(key))throw new TypeError(`Unknown input field ${key}.`);return value;}
function themeResult(value){const theme=recipeTheme(value.recipe),scale=value.scale??2;return {schema:'keel-react-theme@1',recipe:theme.recipe,key:theme.key,theme,tokens:themeTokens(theme,scale),css:`[data-keel-theme] {\n${Object.entries(themeTokens(theme,scale)).map(([k,v])=>`  ${k}: ${v};`).join('\n')}\n}\n`,scale};}
function plan(value){
 if(typeof value.brief!=='string'||!value.brief.trim()||value.brief.length>8192)throw new TypeError('brief must be bounded nonempty text.');
 const assets=value.assets??[];if(!Array.isArray(assets)||assets.length>128)throw new TypeError('Invalid assets.');
 const ids=new Set();for(const asset of assets){input(asset,['id','path','kind']);if(typeof asset.id!=='string'||!asset.id||ids.has(asset.id)||typeof asset.path!=='string'||!asset.path||!['font','image','audio','video','mesh'].includes(asset.kind))throw new TypeError('Invalid asset.');ids.add(asset.id);}
 return {schema:'keel-react-plan@1',brief:value.brief,package:'@keel-engine/react',designLanguage:DESIGN_LANGUAGE,theme:themeResult(value),assets,
 modules:[{id:'keel/runtime',role:'Existing registry resolves and starts authored modules.'},{id:'keel/core',role:'Seeded streams, frame convention and palette/dither.'},{id:'keel/render',role:'Canonical WebGL2 pixel scene.'},{id:'keel/ui',role:'Canonical theme recipes and retained pixel UI.'}],
 APIs:['KeelProvider','useKeelEngine','useKeelModule','KeelCanvas','KeelTheme','KeelPanel','KeelButton','createKeelStore','useKeelStore','useKeelInspection'],
 capture:{flag:'?cinematic=1',clock:'onReady handle.clock.pause()/seek(frame); draw uses frame/fps, not wall time',inspection:'Inject a project probe into useKeelInspection; trailer is an optional private plugin.'},
 gates:['Actual canonical engine source imports and input provenance.','React Strict Mode cleanup and server hydration.','Real browser renderer and integer pixel scale.','Same seed/frame produces matching scene pixels.','Existing design, controls and world surfaces preserved.'],status:'editable-plan',publication:'No upload, wallet request, asset license inference or registered-runtime claim.'};
}
const descriptions={
 'keel-react-catalog':'Discover reusable KEEL React APIs, design rules, canonical engine modules and limitations. React hosts the actual engine scene and authored world controls.',
 'keel-react-theme':'Generate a real keel/ui theme from a seeded recipe; return the exact palette, spacing, frame, type and scoped React CSS tokens. No borrowed font or project assets.',
 'keel-react-plan':'Prepare an editable React app plan using canonical KEEL runtime/core/render/ui, source assets and the shared design language. Preserves authored world control placement. No publishing.',
 'keel-react-scaffold':'Write an additive React example using the actual KEEL pixel renderer and theme into an empty workspace directory. Returns files and plan; refuses overwrites, does not install dependencies or modify existing app UI.'
};
export const keelPlugin={apiVersion:1,id:'keel/react',version:'0.1.0',instructions:'For React app work call keel-react-catalog and keel-react-plan. Use @keel-engine/react to connect the actual KEEL runtime and scene; theme tokens derive from keel/ui. Retain authored in-world controls and project fonts. Register actual meshes/graphs/grids for inspection; visual similarity and local builds are separate from browser/chain evidence.',tools:Object.entries(TOOL_SCHEMAS).map(([name,inputSchema])=>({descriptor:{name,description:descriptions[name],inputSchema},async run({workspace},raw){
 const value=input(raw,Object.keys(inputSchema.properties));
 if(name==='keel-react-catalog')return {schema:'keel-react-catalog@1',designLanguage:DESIGN_LANGUAGE,toolSchemas:TOOL_SCHEMAS,package:'@keel-engine/react',runtime:'canonical keel/runtime, keel/core, keel/render, keel/ui',README:new URL('../README.md',import.meta.url).pathname};
 if(name==='keel-react-theme')return themeResult(value);
 if(name==='keel-react-plan')return plan(value);
 if(typeof value.outDir!=='string'||!value.outDir)throw new TypeError('outDir required.');
 const result=plan({...value,brief:value.brief??'A seeded KEEL scene hosted by React.'}),out=await workspace.resolveOutputDirectory(value.outDir);
 const template=await readFile(new URL('../examples/KeelDemo.tsx',import.meta.url),'utf8');
 const component=template.replace("seed: 'keel/react-demo', culture: 'clean'",`seed: ${JSON.stringify(result.theme.recipe.seed)}, culture: ${JSON.stringify(result.theme.recipe.culture)}, pins: ${JSON.stringify(result.theme.recipe.pins)}`);
 const files=[{name:'KeelDemo.tsx',content:component},{name:'keel-react.plan.json',content:JSON.stringify(result,null,2)+'\n'},{name:'README.md',content:'Import KeelDemo.tsx into a client page. Install/link @keel-engine/react and React >=18.3 from your trusted engine workspace; Node >=22.18. Project fonts remain project-owned. Read keel-react.plan.json for APIs, design rules and browser gates. The example contains a small canonical engine world, not a substitute renderer.\n'}];
 for(const file of files){try{await access(join(out,file.name));throw new Error(`Refusing to overwrite ${file.name}.`);}catch(error){if(error.code!=='ENOENT')throw error;}}
 const written=[];try{for(const file of files){const path=join(out,file.name);await writeFile(path,file.content,{flag:'wx'});written.push(path);}}catch(error){await Promise.all(written.map(path=>unlink(path)));throw error;}
 return {schema:'keel-react-scaffold@1',files:written,plan:result,dependencies:['@keel-engine/react','react','react-dom'],next:'Import the component into a client route, then run real browser acceptance.'};
}}))};
