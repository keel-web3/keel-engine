#!/usr/bin/env node
import fs from'node:fs/promises';import path from'node:path';import draco from'draco3dgltf';
import{compileAsset}from'../packages/import/src/asset-compiler-v2.ts';import{buildNativeCompiler}from'./build-native-asset-compiler.mjs';
const[source,out='compiled-native-asset',...dependencies]=process.argv.slice(2);if(!source)throw Error('Usage: node tools/compile-native-asset.mjs model.glb output-directory [dependencies...]');
const base=path.dirname(path.resolve(source)),files=await Promise.all([source,...dependencies].map(async p=>({name:path.relative(base,path.resolve(p)).split(path.sep).join('/'),data:new Uint8Array(await fs.readFile(p))})));
const t=performance.now(),dracoDecoder=await draco.createDecoderModule(),result=await compileAsset({files,entry:files[0].name,mode:'lossless',dracoDecoder}),conversionMs=performance.now()-t;
await fs.mkdir(out,{recursive:true});const runtime=await buildNativeCompiler(out);await fs.writeFile(path.join(out,'asset.generated.mjs'),result.program);await fs.writeFile(path.join(out,'asset.kac'),result.packageBytes);await fs.writeFile(path.join(out,'asset.glb'),result.preview.data);await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({...result.manifest,runtime:{...result.manifest.runtime,...runtime}},null,2));
await fs.writeFile(path.join(out,'timing.json'),JSON.stringify({conversionMs},null,2));
console.log(JSON.stringify({conversionMs,packageBytes:result.packageBytes.length,outputGlbBytes:result.preview.data.length,validation:result.manifest.validation,features:result.manifest.features,passes:result.manifest.passes}));
