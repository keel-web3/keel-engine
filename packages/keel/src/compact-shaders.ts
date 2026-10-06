// Build-only GLSL compaction. No shader identifier renaming or runtime decoder.
import ts from 'typescript';

const TOKEN = /(?:0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFuU]?|[A-Za-z_]\w*|<<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[^\s])/gu;
const MARKER = '__KEEL_SHADER_FRAGMENT_';
const commentsOut = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, comment => comment.replace(/[^\n]/gu, ' '));

/** Lexical proof surface, including directive text and boundaries. */
export function shaderTokens(source: string): string[] {
  const lines = commentsOut(source).split('\n'), tokens: string[] = [];
  let continuation = false;
  for (const line of lines) {
    if (continuation || /^\s*#/u.test(line)) {
      tokens.push('#:' + line.trim()); continuation = /\\\s*$/u.test(line);
    } else tokens.push(...(line.match(TOKEN) ?? []));
  }
  return tokens;
}

/** Preserve token order and preprocessor lines; line-dependent shaders stay verbatim. */
export function compactGlsl(source: string, protectedText: readonly string[] = []): string {
  if (/\b__LINE__\b|\b__FILE__\b/u.test(source)) return source;
  // Shader variants may use exact string replacements and assertion needles.
  // Keep those slices byte-for-byte while compacting the rest of the source.
  const held: string[] = [];
  let prepared = source;
  for (const text of protectedText) if (prepared.includes(text)) {
    const marker = `${MARKER}HELD_${held.length}__`;
    held.push(text); prepared = prepared.split(text).join(marker);
  }
  const clean = commentsOut(prepared), lines = clean.split('\n');
  let out = '', previous = '', continuation = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (continuation || /^\s*#/u.test(line)) {
      if (out && !out.endsWith('\n')) out += '\n';
      out += line.trim() + (i < lines.length - 1 ? '\n' : '');
      previous = ''; continuation = /\\\s*$/u.test(line); continue;
    }
    for (const match of line.matchAll(TOKEN)) {
      const token = match[0];
      // Interpolation may form part of a number/identifier. Preserve its original boundary.
      const marker = previous.includes(MARKER) || token.includes(MARKER);
      const combined = previous + token, joined = combined.match(TOKEN) ?? [];
      const separate = previous && (marker
        ? /\s/u.test(line.slice(Math.max(0, match.index! - 1), match.index)) || match.index === 0
        : joined.length !== 2 || joined[0] !== previous || joined[1] !== token || combined === '/*' || combined === '//');
      if (separate && out && !out.endsWith('\n')) out += ' ';
      out += token; previous = token;
    }
  }
  // Templates can be composed with another shader fragment outside this expression.
  if (/^\s/u.test(source) && out && !/^\s/u.test(out)) out = ' ' + out;
  if (/\s$/u.test(source) && out && !/\s$/u.test(out)) out += '\n';
  for (let i = 0; i < held.length; i++) out = out.split(`${MARKER}HELD_${i}__`).join(held[i]!);
  if (JSON.stringify(shaderTokens(out)) !== JSON.stringify(shaderTokens(source))) return source;
  return out;
}

type Piece = { text: string } | { expression: ts.Expression };
/** Compact only literal parts of expressions beginning with a GLSL #version directive. */
export function compactShaderLiterals(source: string): { code: string; shaders: number; savedBytes: number } {
  const file = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: { start: number; end: number; code: string }[] = [], seen = new Set<ts.Node>();
  const literal = (node: ts.Node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const plus = (node: ts.Node): node is ts.BinaryExpression => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const protectedText = new Set<string>();
  function preserve(node: ts.Node) {
    if (literal(node)) {
      const text = (node as ts.StringLiteral).text;
      if (text.length >= 5 && text.length <= 2048 && /\s/u.test(text) && !/^\s*#version\b/u.test(text)) protectedText.add(text);
    }
    ts.forEachChild(node, preserve);
  }
  preserve(file);
  const needles = [...protectedText].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  function piecesOf(node: ts.Expression, pieces: Piece[]) {
    if (literal(node)) pieces.push({ text: (node as ts.StringLiteral).text });
    else if (ts.isTemplateExpression(node)) {
      pieces.push({ text: node.head.text });
      for (const span of node.templateSpans) pieces.push({ expression: span.expression }, { text: span.literal.text });
    } else if (plus(node)) { piecesOf(node.left, pieces); pieces.push(literal(node.right) ? { text: (node.right as ts.StringLiteral).text } : { expression: node.right }); }
    else pieces.push({ expression: node });
  }
  function visit(node: ts.Node) {
    if (literal(node) || ts.isTemplateExpression(node)) {
      let root = node as ts.Expression;
      while (root.parent && plus(root.parent) && root.parent.left === root) root = root.parent;
      if (!seen.has(root)) {
        seen.add(root);
        const pieces: Piece[] = []; piecesOf(root, pieces);
        if (pieces[0] && 'text' in pieces[0] && /^\s*#version\b/u.test(pieces[0].text)) {
          let original = '', n = 0;
          for (const piece of pieces) original += 'text' in piece ? piece.text : `${MARKER}${n++}__`;
          if (!original.includes(MARKER + n + '__')) {
            const compact = compactGlsl(original, needles), segments = compact.split(new RegExp(`${MARKER}\\d+__`, 'u'));
            const expressions = pieces.filter((piece): piece is { expression: ts.Expression } => 'expression' in piece);
            if (segments.length === expressions.length + 1 && Buffer.byteLength(compact) < Buffer.byteLength(original)) {
              let code = JSON.stringify(segments[0]);
              for (let j = 0; j < expressions.length; j++) code += `+(${expressions[j]!.expression.getText(file)})+${JSON.stringify(segments[j + 1])}`;
              edits.push({ start: root.getStart(file), end: root.end, code: expressions.length ? '(' + code + ')' : code });
              return; // the replacement retains opaque expressions verbatim
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  let code = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.code + code.slice(edit.end);
  return { code, shaders: edits.length, savedBytes: Buffer.byteLength(source) - Buffer.byteLength(code) };
}
