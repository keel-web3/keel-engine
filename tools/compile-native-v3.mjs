#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import draco from 'draco3dgltf';
import {compileAsset,makeNativeArchive} from '../packages/import/src/asset-compiler-v3.ts';
import {buildNativeV3} from './build-native-v3.mjs';
const [source,out='compiled-native-v3',...args]=process.argv.slice(2);
if(!source)throw Error('Usage: node tools/compile-native-v3.mjs model.glb out-directory [--mode lossless|bounded-lossy] [--max-relative-error number] [--max-absolute-error number] [--prefer-smaller] [--root directory] [--dependency file]');
const options={mode:'lossless'},dependencies=[];let root=path.dirname(path.resolve(source));
for(let i=0;i<args.length;i++){const a=args[i];if(a==='--prefer-smaller')options.selection='prefer-smaller';else if(a==='--dependency')dependencies.push(args[++i]);else if(a==='--root')root=path.resolve(args[++i]);else if(a==='--mode')options.mode=args[++i];else if(a==='--max-relative-error')options.maxRelativeError=Number(args[++i]);else if(a==='--max-absolute-error')options.maxAbsoluteError=Number(args[++i]);else throw Error('Unknown option '+a);}
const files=await Promise.all([source,...dependencies].map(async f=>({name:path.relative(root,path.resolve(f)).split(path.sep).join('/'),data:new Uint8Array(await fs.readFile(f))})));
await buildNativeV3(out);const decoderBytes=new Uint8Array(await fs.readFile(path.join(out,'asset-decoder.mjs'))),licenses=await Promise.all([['KEEL-LICENSE.txt','LICENSE-KEEL.txt'],['FFLATE-LICENSE.txt','LICENSE-fflate.txt'],['DRACO-APACHE-2.0-LICENSE.txt','LICENSE-Draco-Apache-2.0.txt']].map(async([file,name])=>({name,data:new Uint8Array(await fs.readFile(path.join(out,file)))})));
const dracoDecoder=await draco.createDecoderModule(),started=performance.now();const result=await compileAsset({files,entry:files[0].name,dracoDecoder,...options,decoderBytes,licenses});const conversionMs=performance.now()-started;
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(result.manifest,null,2));await fs.writeFile(path.join(out,result.manifest.representation==='native-code'?'asset.glb':path.basename(source)),result.preview.data);
if(result.program){await fs.writeFile(path.join(out,'asset.generated.mjs'),result.program);await fs.writeFile(path.join(out,'asset-data.kap'),result.packageBytes);await fs.writeFile(path.join(out,'runnable.zip'),makeNativeArchive(result,{decoder:decoderBytes,licenses}));const replay=await(await import(pathToFileURL(path.resolve(out,'asset.generated.mjs')).href)).build();if(!Buffer.from(replay.glb).equals(Buffer.from(result.preview.data)))throw Error('Standalone replay differs');}
await fs.writeFile(path.join(out,'timing.json'),JSON.stringify({conversionMs,scope:'cached input read and runtime build excluded; normalization, inference, encoding and validation included'},null,2));
console.log(JSON.stringify({representation:result.manifest.representation,mode:result.manifest.mode,packageBytes:result.packageBytes.length,packageSha256:result.manifest.packageSha256,conversionMs,validation:result.manifest.validation,selection:result.manifest.selection}));
