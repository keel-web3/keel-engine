#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {compileAsset} from '../packages/import/src/asset-compiler.ts';
import {buildAssetCompiler} from './build-asset-compiler.mjs';
if (process.argv.slice(2).includes('--model-target')) {
  const { parseModelCompilerArgs, compileModelTarget } = await import('./compile-model-target.mjs');
  const result = await compileModelTarget(parseModelCompilerArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ target: result.target, models: result.models, fullBytes: result.cost.fullBytes,
    baselineFullBytes: result.baselineCost.fullBytes, savedBytes: result.savedBytes, validation: result.validation }));
} else {
const [source,out='compiled-asset',...deps]=process.argv.slice(2);
if(!source){console.error('Usage: node tools/compile-asset.mjs source.glb output-directory [dependency files...]');process.exit(1)}
const root=path.dirname(path.resolve(source));
const files=await Promise.all([source,...deps].map(async f=>({name:path.relative(root,path.resolve(f)).split(path.sep).join('/'),data:new Uint8Array(await fs.readFile(f))})));
const t=performance.now(),r=await compileAsset({entry:files[0].name,files,mode:'lossless'});
await fs.mkdir(out,{recursive:true}); const runtime = await buildAssetCompiler(out);await fs.writeFile(path.join(out,'asset.kac'),r.packageBytes);await fs.writeFile(path.join(out,'asset.generated.mjs'),r.program);await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({...r.manifest,runtime:{...r.manifest.runtime,decoderBytes:runtime.decoderBytes,downloadIncludesDecoder:true},conversionMs:performance.now()-t},null,2));
for(const f of r.preview.files){const p=path.join(out,'decoded',f.name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,f.data)}
console.log(JSON.stringify({sourceBytes:r.manifest.sourceBytes,packageBytes:r.packageBytes.length,sha256:r.manifest.packageSha256,resourceBytesExact:r.manifest.validation.resourceBytesExact,conversionMs:performance.now()-t}));
}
