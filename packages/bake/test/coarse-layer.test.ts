import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coarseLayerMesh,layeredMesh,prefixMesh} from '../src/lod-mesh.ts';
import type {BakeWorld} from '../src/bake.ts';
test('coarse generator has exact full-mesh paint space for arbitrary boxes, capsules and empty layers',()=>{
 for(let seed=0;seed<24;seed++) {
  const runs:BakeWorld[]=[{boxes:[{c:[seed-12,2,0],h:[3,2,4],mat:2}]},{capsules:[{a:[-seed,5,2],b:[seed+1,6,3],r:.3,mat:1}]},{boxes:[{c:[10,8,seed],h:[2,1,1],mat:3}]}];
  for(const options of [{},{around:4,rings:1}]) assert.deepEqual(prefixMesh(coarseLayerMesh(runs,options),1),prefixMesh(layeredMesh(runs,options),1));
 }
 assert.deepEqual(prefixMesh(coarseLayerMesh([{}, {boxes:[{c:[1,1,1],h:[1,1,1]}]}]),1),prefixMesh(layeredMesh([{}, {boxes:[{c:[1,1,1],h:[1,1,1]}]}]),1));
});
