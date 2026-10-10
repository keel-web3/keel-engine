import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const engine=resolve(import.meta.dirname,'../../..'),require=createRequire(resolve(engine,'package.json')),ts=require('typescript'),paths={};
for(const name of readdirSync(resolve(engine,'packages'))){try{const p=JSON.parse(readFileSync(resolve(engine,'packages',name,'package.json'),'utf8'));for(const [key,value]of Object.entries(p.exports??{'.':'./src/index.ts'})){if(typeof value==='string')paths[p.name+(key==='.'?'':key.slice(1))]=[resolve(engine,'packages',name,value)];}}catch{}}
const options={...ts.readConfigFile(resolve(engine,'tsconfig.base.json'),ts.sys.readFile).config.compilerOptions,baseUrl:engine,paths,noEmit:true,types:[]};
const parsed=ts.convertCompilerOptionsFromJson(options,engine),program=ts.createProgram([resolve(import.meta.dirname,'../src/index.ts')],parsed.options),diagnostics=ts.getPreEmitDiagnostics(program);console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>engine,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));process.exitCode=diagnostics.length?1:0;
