import { engineVectors } from '../../keel/src/vectors.ts';

export default await engineVectors(import.meta.url, [
  {
    name: 'input tapes preserve unsigned words and run boundaries',
    run: ({ createTape, encodeTape, decodeTape }) => {
      const tape = createTape();
      for (const word of [0, 1, 1, 0xffffffff, 0]) tape.push(word);
      const restored = decodeTape(encodeTape(tape));
      return { ticks: restored.ticks, words: restored.words(), before: restored.at(-1), after: restored.at(5) };
    },
    expect: { ticks: 5, words: [0, 1, 1, 4294967295, 0], before: 0, after: 0 },
  },
  {
    name: 'checksums retain exact floating point state',
    run: ({ createHasher }) => [
      createHasher().f64(0).value !== createHasher().f64(-0).value,
      createHasher().f64(0.1 + 0.2).value !== createHasher().f64(0.3).value,
      createHasher().str('seed').int(7).value === createHasher().str('seed').int(7).value,
    ],
    expect: [true, true, true],
  },
]);
