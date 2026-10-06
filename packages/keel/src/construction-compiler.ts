// Host-only exact primitive macro emission. Dynamic expressions remain ordinary JS.
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Plugin } from 'esbuild';

export const CONSTRUCTION_MACRO_REVISION = 1;

export interface PrimitiveDescriptor {
  /** Exact stable imported/const binding or immutable receiver method; never a getter. */
  callee: string;
  /** Fresh inline scalar tuples; primitive does not compare their allocation timing/identity. */
  inlineArrays?: readonly number[];
  /** Numeric argument positions, allowing reuse of proved stable primitive expressions. */
  numeric?: readonly number[];
}
export interface ConstructionCompilerOptions {
  fileName?: string;
  primitives: readonly PrimitiveDescriptor[];
  mode?: 'literals' | 'arrays' | 'reuse' | 'combined';
  maxSourceBytes?: number;
  maxCalls?: number;
  maxPatterns?: number;
  maxVariants?: number;
  maxMacros?: number;
}
export interface ConstructionMacro {
  name: string;
  callee: string;
  template: string;
  parameters: number;
  calls: number;
}
type Atom = { node: ts.Expression; numeric: boolean };
type Call = { start: number; end: number; receiver: string | undefined; primitive: string; atoms: Atom[]; shape: (number | number[])[] };
type Variant = { call: Call; args: string[]; saved: number };
type Pattern = { key: string; primitive: string; template: string; parameters: number; variants: Variant[] };

const strip = (n: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
};
const arithmetic = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.BarToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken]);
const literal = (n: ts.Expression): boolean => {
  n = strip(n);
  return ts.isNumericLiteral(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isPrefixUnaryExpression(n) && (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken) && ts.isNumericLiteral(strip(n.operand));
};
const syntaxLength = (text: string): number => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  let size = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) size += scanner.getTokenText().length;
  return size;
};

/** Descriptors are a trusted primitive contract, not a transform for arbitrary callbacks/getters. */
export function compilePrimitiveMacros(source: string, options: ConstructionCompilerOptions) {
  const unchanged = (reason: string) => ({ revision: CONSTRUCTION_MACRO_REVISION, code: source, macros: [] as ConstructionMacro[], calls: 0, savedSourceBytes: 0, reason });
  if (Buffer.byteLength(source) > (options.maxSourceBytes ?? 1_048_576)) return unchanged('source-limit');
  const fileName = options.fileName ?? 'construction.ts';
  let file: ts.SourceFile, checker: ts.TypeChecker;
  try {
    file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if ((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return unchanged('parse-error');
    const program = ts.createProgram([fileName], { noLib: true, noResolve: true }, {
      getSourceFile: name => name === fileName ? file : undefined,
      getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '', getDirectories: () => [],
      fileExists: name => name === fileName, readFile: name => name === fileName ? source : undefined,
      getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    });
    checker = program.getTypeChecker();
  } catch (error) {
    if (error instanceof RangeError) return unchanged('parser-depth-limit');
    throw error;
  }
  const descriptors = new Map(options.primitives.map(p => [p.callee, p]));
  const mode = options.mode ?? 'combined', arrays = mode === 'arrays' || mode === 'combined', reuse = mode === 'reuse' || mode === 'combined';
  const constants = mode === 'literals' || mode === 'combined';
  // Reuse only side-effect-free expressions of stable primitive-valued local bindings.
  // The original arithmetic tree is evaluated once, never reassociated or quantized.
  function stable(n: ts.Expression, depth = 0): boolean {
    if (depth > 24) return false;
    n = strip(n);
    if (ts.isNumericLiteral(n)) return true;
    if (ts.isPrefixUnaryExpression(n)) return stable(n.operand, depth + 1);
    if (ts.isBinaryExpression(n)) return arithmetic.has(n.operatorToken.kind) && stable(n.left, depth + 1) && stable(n.right, depth + 1);
    if (!ts.isIdentifier(n)) return false;
    const declaration = checker.getSymbolAtLocation(n)?.valueDeclaration;
    // Parameters can be reassigned by another argument/callback. Immutable local
    // primitive bindings are the deliberately smaller proof surface for reuse.
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return false;
    const value = strip(declaration.initializer);
    // A numeric arithmetic initializer already produced an immutable primitive, even
    // when its inputs came from an object. No getter/coercion is repeated here.
    return ts.isNumericLiteral(value) || ts.isPrefixUnaryExpression(value) ||
      ts.isBinaryExpression(value) && arithmetic.has(value.operatorToken.kind) || stable(value, depth + 1);
  }
  const calls: Call[] = [], identifiers = new Set<string>(), stack: { node: ts.Node; depth: number; opaque?: boolean }[] = [{ node: file, depth: 0 }];
  while (stack.length) {
    const { node, depth, opaque } = stack.pop()!;
    if (depth > 128) return unchanged('syntax-depth-limit');
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (opaque) { ts.forEachChild(node, child => { stack.push({ node: child, depth: depth + 1, opaque: true }); }); continue; }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file), primitive = descriptors.get(callee);
      if (primitive && !node.questionDotToken && !node.arguments.some(ts.isSpreadElement)) {
        if (ts.isIdentifier(node.expression)) {
          // A helper lives at module scope. Never redirect a shadowed/local binding
          // to a module-level primitive with the same spelling.
          const declaration = checker.getSymbolAtLocation(node.expression)?.declarations?.[0];
          const imported = declaration && (ts.isImportSpecifier(declaration) || ts.isImportClause(declaration));
          const moduleConst = declaration && ts.isVariableDeclaration(declaration) &&
            ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const &&
            ts.isVariableStatement(declaration.parent.parent) && ts.isSourceFile(declaration.parent.parent.parent);
          if (!imported && !moduleConst) {
            ts.forEachChild(node, child => { stack.push({ node: child, depth: depth + 1, opaque: true }); }); continue;
          }
        }
        // Calls embedded in larger expressions are deliberately outside this pass.
        if (!ts.isExpressionStatement(node.parent) && !ts.isArrowFunction(node.parent)) {
          ts.forEachChild(node, child => { stack.push({ node: child, depth: depth + 1 }); }); continue;
        }
        const receiver = ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
          ? node.expression.expression.text : undefined;
        if (ts.isPropertyAccessExpression(node.expression) && !receiver) {
          ts.forEachChild(node, child => { stack.push({ node: child, depth: depth + 1, opaque: true }); }); continue;
        }
        const atoms: Atom[] = [], shape: Call['shape'] = [];
        node.arguments.forEach((arg, position) => {
          const value = strip(arg), numeric = primitive.numeric?.includes(position) ?? false;
          if (arrays && primitive.inlineArrays?.includes(position) && ts.isArrayLiteralExpression(value) && value.elements.length === 3 && !value.elements.some(e => ts.isSpreadElement(e) || ts.isOmittedExpression(e))) {
            const indexes: number[] = [];
            for (const item of value.elements) { indexes.push(atoms.length); atoms.push({ node: item as ts.Expression, numeric: true }); }
            shape.push(indexes);
          } else { shape.push(atoms.length); atoms.push({ node: arg, numeric }); }
        });
        calls.push({ start: node.getStart(file), end: node.end, receiver, primitive: callee, atoms, shape });
        if (calls.length > (options.maxCalls ?? 20_000)) return unchanged('call-limit');
        ts.forEachChild(node, child => { stack.push({ node: child, depth: depth + 1, opaque: true }); });
        continue; // Opaque argument calls retain their exact text and evaluation order.
      }
    }
    ts.forEachChild(node, child => { stack.push({ node: child, depth: depth + 1 }); });
  }
  calls.sort((a, b) => a.start - b.start);
  const patterns = new Map<string, Pattern>(); let variantsCount = 0;
  for (const call of calls) {
    const originalSize = syntaxLength(source.slice(call.start, call.end)) - call.primitive.length + (call.receiver ? call.primitive.length : 1);
    const fixed = constants ? call.atoms.map((a, i) => literal(a.node) ? i : -1).filter(i => i >= 0)
      .sort((a, b) => call.atoms[b]!.node.getText(file).length - call.atoms[a]!.node.getText(file).length || a - b).slice(0, 6) : [];
    for (let mask = 0; mask < 2 ** fixed.length; mask++) {
      const selected = new Set(fixed.filter((_, i) => mask & (1 << i))), values: string[] = [], args: string[] = [];
      const repeated = new Map<string, { parameter: string; negative: boolean }>();
      if (call.receiver) args.push(call.receiver);
      for (let i = 0; i < call.atoms.length; i++) {
        const atom = call.atoms[i]!, original = atom.node.getText(file), expression = strip(atom.node);
        if (selected.has(i)) { values.push(ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) ? JSON.stringify(expression.text) : original); continue; }
        const negative = ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken;
        const base = negative ? strip(expression.operand) : expression;
        const identity = reuse && atom.numeric && stable(base) ? base.getText(file) : undefined;
        const previous = identity === undefined ? undefined : repeated.get(identity);
        if (previous) values.push(previous.negative === negative ? previous.parameter : `(-${previous.parameter})`);
        else {
          const parameter = `p${args.length}`; values.push(parameter); args.push(original);
          if (identity !== undefined) repeated.set(identity, { parameter, negative });
        }
      }
      const parameters = args.length, target = call.receiver ? `p0.${call.primitive.slice(call.primitive.indexOf('.') + 1)}` : call.primitive;
      const template = `${target}(${call.shape.map(part => Array.isArray(part) ? `[${part.map(i => values[i]).join(',')}]` : values[part]).join(',')})`;
      const key = `${call.primitive}:${template}`;
      const pattern = patterns.get(key) ?? { key, primitive: call.primitive, template, parameters, variants: [] };
      pattern.variants.push({ call, args, saved: originalSize - 1 - syntaxLength(args.join(',')) - 2 }); patterns.set(key, pattern);
      if (patterns.size > (options.maxPatterns ?? 8_192)) return unchanged('pattern-limit');
      if (++variantsCount > (options.maxVariants ?? 65_536)) return unchanged('variant-limit');
    }
  }
  const available = new Set(calls), chosen: { pattern: Pattern; variants: Variant[]; name: string }[] = [];
  while (chosen.length < (options.maxMacros ?? 64)) {
    let best: Pattern | undefined, variants: Variant[] = [], score = 0;
    const name = `__keelPrimitive${chosen.length}`;
    if (identifiers.has(name)) return unchanged('generated-name-collision');
    for (const pattern of patterns.values()) {
      const active = pattern.variants.filter(v => available.has(v.call));
      if (active.length < 3) continue;
      // Ranking is only a source heuristic for a bounded candidate. Final selection
      // must include minification and whole-graph gzip/Brotli costs, including helpers.
      const saved = active.reduce((n, v) => n + v.saved, 0);
      const cost = syntaxLength(`function m(${Array.from({ length: pattern.parameters }, (_, i) => `p${i}`).join(',')}){return ${pattern.template};}`);
      if (saved - cost > score || saved - cost === score && best && pattern.key < best.key) { best = pattern; variants = active; score = saved - cost; }
    }
    if (!best || score <= 0) break;
    chosen.push({ pattern: best, variants, name }); for (const v of variants) available.delete(v.call);
  }
  if (!chosen.length) return unchanged('no-profitable-source-macros');
  const edits = chosen.flatMap(({ variants, name }) => variants.map(v => ({ start: v.call.start, end: v.call.end, text: `${name}(${v.args.join(',')})` }))).sort((a, b) => a.start - b.start);
  const chunks: string[] = []; let cursor = 0;
  for (const edit of edits) { chunks.push(source.slice(cursor, edit.start), edit.text); cursor = edit.end; }
  chunks.push(source.slice(cursor));
  for (const { pattern, name } of chosen) chunks.push(`\nfunction ${name}(${Array.from({ length: pattern.parameters }, (_, i) => `p${i}:any`).join(',')}){return ${pattern.template};}\n`);
  const code = chunks.join('');
  return { revision: CONSTRUCTION_MACRO_REVISION, code, macros: chosen.map(({ pattern, variants, name }) => ({ name, callee: pattern.primitive, template: pattern.template, parameters: pattern.parameters, calls: variants.length })),
    calls: edits.length, savedSourceBytes: Buffer.byteLength(source) - Buffer.byteLength(code), reason: 'compiled' };
}

export const VEHICLE_SERVICE_PRIMITIVES: readonly PrimitiveDescriptor[] = [
  { callee: 'box', numeric: [2, 3, 4, 5, 6, 7] },
  { callee: 'cap', inlineArrays: [2, 3], numeric: [4] },
  { callee: 'wedge', numeric: [2, 3, 4, 5, 6, 7, 8] },
];
export const CITY_TREE_PRIMITIVES: readonly PrimitiveDescriptor[] = [
  { callee: 'K.box', numeric: [0, 1, 2, 3, 4, 5, 7] },
  { callee: 'K.ball', numeric: [0, 1, 2, 3] },
  { callee: 'K.limb', inlineArrays: [0, 1], numeric: [2] },
];

/** Fixed host build choice per input; planners must measure complete emitted graphs. */
export function constructionCompilerPlugin(options: {
  sources: readonly (ConstructionCompilerOptions & { fileName: string })[];
  report?: (fileName: string, result: ReturnType<typeof compilePrimitiveMacros>) => void;
}): Plugin {
  const sources = new Map(options.sources.map(source => [source.fileName, source]));
  const cached = new Map<string, { source: string; result: ReturnType<typeof compilePrimitiveMacros> }>();
  return { name: 'keel-construction-macros', setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]s$/, namespace: 'file' }, async args => {
      const profile = sources.get(args.path);
      if (!profile) return undefined;
      const source = await readFile(args.path, 'utf8');
      let entry = cached.get(args.path);
      if (entry?.source !== source) {
        entry = { source, result: compilePrimitiveMacros(source, profile) };
        cached.set(args.path, entry); // One content entry per explicitly selected source.
      }
      const compiled = entry.result;
      options.report?.(args.path, compiled);
      return { contents: compiled.code, loader: 'ts', resolveDir: dirname(args.path) };
    });
  } };
}
