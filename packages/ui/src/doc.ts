// Layout documents: a screen as data, so the editor and agents can generate
// and edit it. The JSON view is the authoring form:
//
//   { "screen": "hud", "root": { "type": "canvas", "children": [
//       { "type": "panel", "id": "top", "anchor": "t", "w": "fill", "dir": "row", "children": [
//           { "type": "label", "id": "res.mass", "text": "{icon:mass} 350" } ] } ] } }
//
// and UI_SCREEN (schemas.ts) is the stored form: the same tree, bit-packed
// (a node is a few bytes; ids, tones, icons and actions go through shared
// string tables). A node is its type, an optional id, its props and children.

import { UiNode, WIDGETS } from "./node.ts";
import type { NodeProps, WidgetType } from "./node.ts";
import type { ThemeRecipe } from "./theme.ts";

/** A node in a layout document: the props minus runtime-only ones (a picture), plus type, id and children. */
export type NodeDoc = Omit<NodeProps, "image"> & { type: WidgetType; id?: string; children?: NodeDoc[] };

export interface ScreenDoc {
  readonly screen: string;
  /** The theme the screen was generated with (a recipe). */
  readonly theme?: ThemeRecipe;
  readonly root: NodeDoc;
}

/** Build the retained tree from a document node. */
export function buildNode(d: NodeDoc): UiNode {
  if (!(WIDGETS as readonly string[]).includes(d.type)) throw new RangeError(`"${d.type}" isn't a widget (${WIDGETS.join(", ")}).`);
  const { type, id, children, ...props } = d;
  const n = new UiNode(type, props, id);
  for (const c of children ?? []) { const k = buildNode(c); k.parent = n; n.children.push(k); }
  return n;
}

/** The document of a retained tree (pictures left out: they're runtime content). */
export function docOf(n: UiNode): NodeDoc {
  const { image: _image, ...props } = n.props;
  void _image;
  const out: NodeDoc = { type: n.type, ...(n.auto ? {} : { id: n.id }), ...props };
  if (n.children.length) out.children = n.children.map(docOf);
  return out;
}

/** Find a document node by id. */
export function findDoc(d: NodeDoc, id: string): NodeDoc | undefined {
  if (d.id === id) return d;
  for (const c of d.children ?? []) { const f = findDoc(c, id); if (f) return f; }
  return undefined;
}

/** Every node of a document, depth first. */
export function* walkDoc(d: NodeDoc): Generator<NodeDoc> { yield d; for (const c of d.children ?? []) yield* walkDoc(c); }

/**
 * Apply overrides by id: `{ "cmd.0.0": { icon: "attack", hotkey: "A" }, "minimap": { hidden: true } }` -- every
 * generated screen is pinnable this way. A `null` removes the node.
 */
export function overrideDoc(d: NodeDoc, overrides: Readonly<Record<string, Partial<NodeDoc> | null>>): NodeDoc {
  const o = d.id !== undefined ? overrides[d.id] : undefined;
  const kids = d.children?.flatMap((c) => (c.id !== undefined && overrides[c.id] === null ? [] : [overrideDoc(c, overrides)]));
  return { ...d, ...(o ?? {}), ...(kids ? { children: kids } : {}) } as NodeDoc;
}
