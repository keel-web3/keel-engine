// Test vectors for keel/lod, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

const node = { key: "a", lo: [-5, 0, 95], hi: [5, 40, 105], levels: [3000, 1200, 300], steps: [{ terms: [{ error: 1 }, { error: 3, facing: "roof", roofY: 40 }] }, { terms: [{ error: 8 }] }] };
const view = (z) => ({ kind: "persp", origin: [0, 2, z], forward: [0, 0, 1], k: 0, tanHalfFov: 0.6, height: 420 });

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":13,"digest":"240ea01bd76c313f652a5d88d14a3f58b6679bf79dc819e2d3d5fe1d60850ed6"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  },
  {
    name: "screen-space error from the true distance, and the roof term",
    run: ({ pixelError, facingVisibility }) => [pixelError(view(0), node, node.steps[0]), pixelError(view(0), node, node.steps[1]), facingVisibility("roof", 0.5, 80, 60), facingVisibility("wall", 1, 200)],
    expect: [3.6842105263157894,29.473684210526315,0.5,0.2],
  },
  {
    name: "a selector walking away: levels and fades, frame by frame",
    run: ({ createLodSelector, rangesOf }) => {
      const sel = createLodSelector({ tau: 2, dwell: 0.1, fade: 0.1 });
      const out = [];
      for (let i = 0; i < 40; i += 1) { const p = sel.select(view(-i * 20), [node], 1 / 30)[0]; out.push([p.level, p.fading ? +p.fading.t.toFixed(4) : null, rangesOf(p, node).length]); }
      return out;
    },
    expect: [[0,null,1],[0,null,1],[0,null,1],[0,null,1],[0,null,1],[0,null,1],[0,null,1],[0,null,1],[0,0.6667,2],[0,0.3333,2],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1],[1,null,1]],
  },
  {
    name: "tiles and the work queue",
    run: ({ gridTiles, createWorkQueue }) => {
      const tiles = gridTiles([[0, 0], [100, 0], [0, 100], [100, 100], [50, 50]].map(([x, z]) => ({ lo: [x, 0, z], hi: [x + 10, 20, z + 10] })), 2).map((t) => [t.cell, t.members]);
      const ran = [];
      const q = createWorkQueue({ blocking: 0 });
      for (const [k, st, c, p] of [["b", 1, 5, 0], ["a", 0, 3, -2], ["c", 0, 3, -1]]) q.add({ key: k, stage: st, cost: c, priority: p, run: () => ran.push(k) });
      q.run(4);
      return [tiles, ran, q.progress, q.ready];
    },
    expect: [[[0,[0]],[1,[1]],[2,[2]],[3,[3,4]]],["c"],0.5,false],
  },
]);
