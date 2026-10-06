import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createKeelBrowserBundlePlugin } from '../src/bundle.mjs';

test('React hosts can bundle canonical runtime APIs and compose transforms with one shared React import', async () => {
 let loads=0;
 const transform={name:'host-source',setup(b){b.onResolve({filter:/^host-entry$/},()=>({path:'host-entry',namespace:'host-entry'}));b.onLoad({filter:/.*/,namespace:'host-entry'},()=>{loads++;return {contents:"export {useState} from 'react'; export {lookMesh} from '@keel-engine/bake';",resolveDir:import.meta.dirname,loader:'js'};});}};
 const result=await build({entryPoints:['host-entry'],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',minify:true,external:['react'],plugins:[createKeelBrowserBundlePlugin({aliases:{'@keel-engine/bake':'@keel-engine/bake/runtime'},transforms:[transform]})]});
 assert.equal(loads,1);assert.ok(Object.keys(result.metafile.inputs).some(p=>p.endsWith('/bake/src/runtime.ts')));
 const output=Object.values(result.metafile.outputs)[0];assert.ok(output.exports.includes('lookMesh'));assert.ok(output.exports.includes('useState'));assert.equal(output.imports.filter(p=>p.path==='react'&&p.external).length,1);
 assert.throws(()=>createKeelBrowserBundlePlugin({aliases:{a:null}}),/module IDs/);assert.throws(()=>createKeelBrowserBundlePlugin({transforms:[{}]}),/plugins/);
});
