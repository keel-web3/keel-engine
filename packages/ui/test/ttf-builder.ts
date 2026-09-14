// A minimal TrueType font, built in the test: head, hhea, maxp, hmtx, cmap
// (format 4), loca, glyf (simple glyphs with quadratic curves, and a
// composite), kern (format 0) and OS/2 (cap and x-heights). Units per em
// 1000; cap height 700; x-height 500. (Its WOFF wrapping: woff-builder.ts.)

type Pt = [number, number, boolean];
export interface TestGlyph { code: number; adv: number; contours?: Pt[][]; parts?: Array<{ glyph: number; dx: number; dy: number }> }

export const u16 = (v: number) => [(v >> 8) & 255, v & 255];
export const i16 = (v: number) => u16(v & 0xffff);
export const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0, true], [x0, y1, true], [x1, y1, true], [x1, y0, true]];

/** The glyphs: .notdef, H, O (curves), l, -, = (a composite of two "-"), A and V (kerned), space. */
export const TEST_GLYPHS: TestGlyph[] = [
  { code: -1, adv: 500, contours: [] },
  { code: 72, adv: 600, contours: [rect(60, 0, 160, 700), rect(440, 0, 540, 700), rect(160, 300, 440, 400)] },
  { code: 79, adv: 640, contours: [
    [[320, 0, true], [40, 0, false], [40, 350, true], [40, 700, false], [320, 700, true], [600, 700, false], [600, 350, true], [600, 0, false]],
    [[320, 100, true], [500, 100, false], [500, 350, true], [500, 600, false], [320, 600, true], [140, 600, false], [140, 350, true], [140, 100, false]],
  ] },
  { code: 108, adv: 260, contours: [rect(80, 0, 180, 700)] },
  { code: 45, adv: 400, contours: [rect(60, 280, 340, 380)] },
  { code: 61, adv: 400, parts: [{ glyph: 4, dx: 0, dy: -110 }, { glyph: 4, dx: 0, dy: 110 }] },
  { code: 65, adv: 620, contours: [[[20, 0, true], [270, 700, true], [350, 700, true], [600, 0, true], [500, 0, true], [310, 560, true], [120, 0, true]], rect(170, 180, 450, 260)] },
  { code: 86, adv: 620, contours: [[[20, 700, true], [120, 700, true], [310, 140, true], [500, 700, true], [600, 700, true], [350, 0, true], [270, 0, true]]] },
  { code: 32, adv: 280, contours: [] },
];
export const KERN_AV = -120;

function glyphBytes(g: TestGlyph): number[] {
  if (g.parts) {
    const out = [...i16(-1), ...i16(0), ...i16(0), ...i16(700), ...i16(700)];
    g.parts.forEach((p, i) => { out.push(...u16(0x0003 | (i < g.parts!.length - 1 ? 0x20 : 0)), ...u16(p.glyph), ...i16(p.dx), ...i16(p.dy)); });
    return out;
  }
  const cs = g.contours ?? [];
  if (!cs.length) return [];
  const pts = cs.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const out = [...i16(cs.length), ...i16(Math.min(...xs)), ...i16(Math.min(...ys)), ...i16(Math.max(...xs)), ...i16(Math.max(...ys))];
  let end = -1;
  for (const c of cs) { end += c.length; out.push(...u16(end)); }
  out.push(...u16(0));
  for (const p of pts) out.push(p[2] ? 1 : 0);
  let last = 0;
  for (const x of xs) { out.push(...i16(x - last)); last = x; }
  last = 0;
  for (const y of ys) { out.push(...i16(y - last)); last = y; }
  while (out.length % 4) out.push(0);
  return out;
}

export function buildTtf(glyphs: TestGlyph[] = TEST_GLYPHS): Uint8Array {
  const n = glyphs.length;
  const glyf: number[] = [];
  const loca: number[] = [];
  for (const g of glyphs) { loca.push(...u32(glyf.length)); glyf.push(...glyphBytes(g)); }
  loca.push(...u32(glyf.length));
  const head = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0), ...u16(1000), ...Array(16).fill(0), ...i16(0), ...i16(-200), ...i16(1000), ...i16(800), ...u16(0), ...u16(8), ...i16(2), ...i16(1), ...i16(0)];
  const hhea = [...u32(0x00010000), ...i16(800), ...i16(-200), ...i16(90), ...u16(700), ...i16(0), ...i16(0), ...i16(700), ...i16(1), ...i16(0), ...i16(0), ...Array(8).fill(0), ...i16(0), ...u16(n)];
  const maxp = [...u32(0x00005000), ...u16(n)];
  const hmtx = glyphs.flatMap((g) => [...u16(g.adv), ...i16(0)]);
  // cmap format 4: one segment per code, then the 0xFFFF end.
  const mapped = glyphs.map((g, i) => [g.code, i] as const).filter(([c]) => c >= 0).sort((a, b) => a[0] - b[0]);
  const segs = [...mapped.map(([c, gi]) => ({ s: c, e: c, d: gi - c })), { s: 0xffff, e: 0xffff, d: 1 }];
  const sc = segs.length;
  const f4 = [...u16(4), ...u16(16 + sc * 8), ...u16(0), ...u16(sc * 2), ...u16(2), ...u16(0), ...u16(0),
    ...segs.flatMap((g) => u16(g.e)), ...u16(0), ...segs.flatMap((g) => u16(g.s)), ...segs.flatMap((g) => i16(g.d)), ...segs.flatMap(() => u16(0))];
  const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12), ...f4];
  const A = glyphs.findIndex((g) => g.code === 65), V = glyphs.findIndex((g) => g.code === 86);
  const kern = [...u16(0), ...u16(1), ...u16(0), ...u16(14 + 6), ...u16(0x0001), ...u16(1), ...u16(6), ...u16(0), ...u16(0), ...u16(A), ...u16(V), ...i16(KERN_AV)];
  const os2 = Array(96).fill(0);
  os2[1] = 2;
  os2.splice(86, 4, ...i16(500), ...i16(700));
  const tables: Array<[string, number[]]> = [["OS/2", os2], ["cmap", cmap], ["glyf", glyf], ["head", head], ["hhea", hhea], ["hmtx", hmtx], ["kern", kern], ["loca", loca], ["maxp", maxp]];
  const dirLen = 12 + tables.length * 16;
  const out: number[] = [...u32(0x00010000), ...u16(tables.length), ...u16(128), ...u16(3), ...u16(16)];
  let offset = dirLen;
  const body: number[] = [];
  for (const [tag, data] of tables) {
    out.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(offset), ...u32(data.length));
    body.push(...data);
    while (body.length % 4) body.push(0);
    offset = dirLen + body.length;
  }
  return Uint8Array.from([...out, ...body]);
}
