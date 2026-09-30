#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import draco from 'draco3dgltf';
import {compileAsset,makeNativeArchive} from '../packages/import/src/asset-compiler-v4.ts';
import {buildNativeV4} from './build-native-v4.mjs';
const[source,out='compiled-native-asset',...args]=process.argv.slice(2);
if(!source)throw Error('Usage: node tools/compile-native-v4.mjs model.glb output [--mode lossless|bounded-lossy] [--target-ratio 0.5] [--geometry-error 0.01] [--texture-size 1024] [--texture-quality 85] [--root directory] [--dependency file]');
let mode='lossless',root=path.dirname(path.resolve(source));const geometry={targetRatio:.5,maxError:.01,samplesPerClip:5,maxSurfaceSamples:2048},textures={maxDimension:1024,quality:85},dependencies=[];
for(let i=0;i<args.length;i++)switch(args[i]){
 case '--mode':mode=args[++i];break;
 case '--root':root=path.resolve(args[++i]);break;
 case '--dependency':dependencies.push(args[++i]);break;
 case '--target-ratio':geometry.targetRatio=Number(args[++i]);break;
 case '--geometry-error':geometry.maxError=Number(args[++i]);break;
 case '--texture-size':textures.maxDimension=Number(args[++i]);break;
 case '--texture-quality':textures.quality=Number(args[++i]);break;
 default:throw Error('Unknown option '+args[i]);
}
const files=await Promise.all([source,...dependencies].map(async file=>({name:path.relative(root,path.resolve(file)).split(path.sep).join('/'),data:new Uint8Array(await fs.readFile(file))})));
const dracoDecoder=await draco.createDecoderModule();const result=await compileAsset({files,entry:files[0].name,mode,dracoDecoder,...(mode==='bounded-lossy'?{geometry,textures}:{})});
await buildNativeV4(out);const decoder=new Uint8Array(await fs.readFile(path.join(out,'asset-decoder.mjs'))),licenses=await Promise.all([['KEEL-LICENSE.txt','LICENSE-KEEL.txt'],['FFLATE-LICENSE.txt','LICENSE-fflate.txt'],['DRACO-APACHE-2.0-LICENSE.txt','LICENSE-Draco-Apache-2.0.txt'],['MESHOPTIMIZER-LICENSE.txt','LICENSE-meshoptimizer.txt']].map(async([from,name])=>({name,data:new Uint8Array(await fs.readFile(path.join(out,from)))})));
for(const[name,data]of[['asset.generated.mjs',result.program],['asset-data.kap',result.packageBytes],['asset.glb',result.preview.data],['manifest.json',JSON.stringify(result.manifest,null,2)],['timings.json',JSON.stringify(result.timings,null,2)],['runnable.zip',makeNativeArchive(result,{decoder,licenses})]])await fs.writeFile(path.join(out,name),data);
const replay=await(await import(pathToFileURL(path.resolve(out,'asset.generated.mjs')).href)).build();if(!Buffer.from(replay.glb).equals(Buffer.from(result.preview.data)))throw Error('Standalone replay mismatch');
console.log(JSON.stringify({mode,packageBytes:result.packageBytes.length,sha256:result.manifest.packageSha256,timings:result.timings,geometry:result.manifest.passes.geometry?{original:result.manifest.passes.geometry.originalTriangles,output:result.manifest.passes.geometry.outputTriangles}:null,textures:result.manifest.passes.textures?{originalBytes:result.manifest.passes.textures.sourceBytes,outputBytes:result.manifest.passes.textures.outputBytes}:null},null,2));
