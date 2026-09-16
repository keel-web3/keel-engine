import { engineVectors } from '../../keel/src/vectors.ts';

export default await engineVectors(import.meta.url, [
  {
    name: 'expression evaluation clamps values and makes division by zero finite',
    run: ({ evalExpr }) => [evalExpr(['div', 1, 0], {}), evalExpr(['clamp', ['var', 'a'], 0, 1], { a: 5 }), evalExpr(['mul', 2, ['var', 'a']], { a: 7 })],
    expect: [0, 1, 14],
  },
  {
    name: 'undeclared variables and operators cannot enter a generated program',
    run: ({ checkExpr }) => [checkExpr(['var', 'secret'], new Set(['a'])).expr, checkExpr(['pow', 2, 3], new Set(['a'])).expr],
    expect: [0, 0],
  },
]);
