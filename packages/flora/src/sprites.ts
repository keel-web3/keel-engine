// Foliage sprites as pixel art, painted from a seed: grass tufts, tall grass,
// clover, flowers, ferns, sprouts, reeds and mushrooms. A sprite holds no
// colours, only what each pixel is, so one atlas serves every season and
// species and the shader colours it per plant:
//   red    the shade step, 0 (dark) to 3 (lit) as 0, 85, 170, 255
//   green  the part: 0 leaf, 85 stem, 170 blossom, 255 the flower's eye
//   alpha  255 drawn, 0 empty
// Pixel rows run up from the root (row 0 is the ground line), the way a
// card's texture coordinates do.

export const FLORA_KINDS = ["grass", "tall-grass", "clover", "daisy", "tulip", "bell", "wildflower", "fern", "sprout", "reed", "mushroom"] as const;
export type FloraKind = (typeof FLORA_KINDS)[number];

export const ROLE = { leaf: 0, stem: 1, blossom: 2, eye: 3 } as const;

export interface FloraAtlas {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** A sprite cell's size in pixels. */
  readonly cell: readonly [number, number];
  readonly cols: number;
  readonly variants: number;
  readonly kinds: readonly FloraKind[];
  /** The first cell of each kind (its variants follow). */
  readonly first: Readonly<Partial<Record<FloraKind, number>>>;
}

function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Sprite {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  px(x: number, y: number, shade: number, role: number): void {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const o = (iy * this.w + ix) * 4;
    this.data[o] = Math.max(0, Math.min(3, shade)) * 85;
    this.data[o + 1] = role * 85;
    this.data[o + 3] = 255;
  }
  filled(x: number, y: number): boolean {
    const ix = Math.round(x), iy = Math.round(y);
    return ix >= 0 && iy >= 0 && ix < this.w && iy < this.h && this.data[(iy * this.w + ix) * 4 + 3] === 255;
  }
  /** A stroke from the root up, bending by `lean` pixels at its tip; shade climbs toward the tip. */
  blade(x0: number, length: number, lean: number, shade: number, role: number, { thick = 1, tip = true } = {}): readonly [number, number] {
    const steps = Math.max(2, Math.ceil(length * 1.5));
    let x = x0, y = 0;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      x = x0 + lean * t * t;
      y = t * length;
      const s = shade + (tip && t > 0.72 ? 1 : 0) - (t < 0.2 ? 1 : 0);
      this.px(x, y, s, role);
      if (thick > 1 && t < 0.45) this.px(x + 1, y, s - 1, role);
    }
    return [x, y];
  }
  disc(cx: number, cy: number, r: number, shade: number, role: number): void {
    for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y > r * r + r * 0.6) continue;
      // Lit from up and left: a highlight on that side, a dark rim opposite.
      const s = shade + (y > 0 && x <= 0 ? 1 : 0) - (y < -r * 0.4 ? 1 : 0);
      this.px(cx + x, cy + y, s, role);
    }
  }
}

type Painter = (s: Sprite, rand: () => number) => void;

const PAINTERS: Readonly<Record<FloraKind, Painter>> = {
  grass(s, r) {
    const n = 5 + Math.floor(r() * 4);
    for (let i = 0; i < n; i += 1) {
      const x0 = s.w * 0.5 + (r() - 0.5) * s.w * 0.55;
      const out = (x0 - s.w * 0.5) / (s.w * 0.5);
      s.blade(x0, s.h * (0.32 + r() * 0.36), out * s.w * 0.3 + (r() - 0.5) * 3, 1 + Math.floor(r() * 2.4), ROLE.leaf);
    }
  },
  "tall-grass"(s, r) {
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      const x0 = s.w * 0.5 + (r() - 0.5) * s.w * 0.4;
      const [tx, ty] = s.blade(x0, s.h * (0.62 + r() * 0.36), (x0 - s.w * 0.5) * 0.9 + (r() - 0.5) * 4, 1 + Math.floor(r() * 2), ROLE.leaf);
      // A seed head on some stalks.
      if (r() < 0.55) for (let k = 0; k < 3; k += 1) s.px(tx + (k % 2), ty - k, 3 - (k === 2 ? 1 : 0), ROLE.stem);
    }
    for (let i = 0; i < 3; i += 1) s.blade(s.w * 0.5 + (r() - 0.5) * 6, s.h * 0.25, (r() - 0.5) * 6, 1, ROLE.leaf);
  },
  clover(s, r) {
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      const cx = 3 + r() * (s.w - 6), top = 3 + r() * s.h * 0.22;
      s.blade(cx, top, (r() - 0.5) * 2, 0, ROLE.stem, { tip: false });
      for (let k = 0; k < 3; k += 1) {
        const a = Math.PI * 0.5 + (k - 1) * 2.1;
        s.disc(cx + Math.cos(a) * 1.6, top + Math.sin(a) * 1.4, 1, 2, ROLE.leaf);
      }
      if (r() < 0.3) s.disc(cx, top + 2.5, 1, 2, ROLE.blossom);
    }
  },
  daisy(s, r) {
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      const x0 = s.w * 0.5 + (r() - 0.5) * s.w * 0.45;
      const [tx, ty] = s.blade(x0, s.h * (0.4 + r() * 0.42), (r() - 0.5) * 4, 1, ROLE.stem, { tip: false });
      for (let k = 0; k < 8; k += 1) {
        const a = (k / 8) * Math.PI * 2;
        s.px(tx + Math.round(Math.cos(a) * 2), ty + Math.round(Math.sin(a) * 1.6), k < 4 ? 3 : 2, ROLE.blossom);
      }
      s.px(tx, ty, 2, ROLE.eye);
    }
    PAINTERS.grass(s, () => r() * 0.6);
  },
  tulip(s, r) {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i += 1) {
      const x0 = s.w * 0.5 + (r() - 0.5) * s.w * 0.4;
      const [tx, ty] = s.blade(x0, s.h * (0.45 + r() * 0.35), (r() - 0.5) * 3, 1, ROLE.stem, { tip: false });
      for (let y = -2; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) if (!(y === 1 && x === 0)) s.px(tx + x, ty + y, x < 0 ? 3 : x > 0 ? 1 : 2, ROLE.blossom);
      s.blade(x0, s.h * 0.35, -3 - r() * 2, 2, ROLE.leaf);
      s.blade(x0, s.h * 0.3, 3 + r() * 2, 1, ROLE.leaf);
    }
  },
  bell(s, r) {
    const x0 = s.w * 0.5 + (r() - 0.5) * 3;
    const [tx, ty] = s.blade(x0, s.h * (0.6 + r() * 0.3), (r() - 0.5) * 2, 1, ROLE.stem, { tip: false });
    const bells = 2 + Math.floor(r() * 3);
    for (let k = 0; k < bells; k += 1) {
      const by = ty - 1 - k * 3, side = k % 2 === 0 ? 1 : -1;
      s.px(tx + side, by, 1, ROLE.stem);
      for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) s.px(tx + side * (2 + x), by - 1 - y, y === 0 ? 2 : 3, ROLE.blossom);
    }
    s.blade(x0 - 1, s.h * 0.3, -4, 1, ROLE.leaf);
    s.blade(x0 + 1, s.h * 0.26, 4, 2, ROLE.leaf);
  },
  wildflower(s, r) {
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i += 1) {
      const x0 = s.w * 0.5 + (r() - 0.5) * s.w * 0.6;
      const [tx, ty] = s.blade(x0, s.h * (0.25 + r() * 0.5), (r() - 0.5) * 6, 1, ROLE.stem, { tip: false });
      s.px(tx, ty, 3, ROLE.blossom);
      s.px(tx + 1, ty, 2, ROLE.blossom);
      if (r() < 0.6) s.px(tx, ty + 1, 2, ROLE.blossom);
    }
    PAINTERS.grass(s, () => r() * 0.7);
  },
  fern(s, r) {
    const fronds = 3 + Math.floor(r() * 3);
    for (let i = 0; i < fronds; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const reach = s.w * (0.25 + r() * 0.22) * side;
      const length = s.h * (0.45 + r() * 0.4);
      const steps = Math.ceil(length * 1.2);
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        const x = s.w * 0.5 + reach * t, y = length * Math.sin(t * Math.PI * 0.8);
        s.px(x, y, 1, ROLE.stem);
        // Leaflets either side of the rachis, shorter toward the tip.
        if (k % 2 === 0 && t > 0.1) {
          const l = Math.max(1, Math.round((1 - t) * 3));
          for (let q = 1; q <= l; q += 1) { s.px(x, y + q, 2 + (q === l ? 1 : 0), ROLE.leaf); s.px(x + side * q * 0.5, y - q, 1, ROLE.leaf); }
        }
      }
    }
  },
  sprout(s, r) {
    const x0 = s.w * 0.5 + (r() - 0.5) * 4;
    const [tx, ty] = s.blade(x0, s.h * (0.15 + r() * 0.15), (r() - 0.5) * 2, 1, ROLE.stem, { tip: false });
    s.disc(tx - 2, ty + 1, 1, 2, ROLE.leaf);
    s.disc(tx + 2, ty + 1, 1, 3, ROLE.leaf);
  },
  reed(s, r) {
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      const x0 = s.w * 0.5 + (r() - 0.5) * s.w * 0.35;
      const [tx, ty] = s.blade(x0, s.h * (0.7 + r() * 0.28), (r() - 0.5) * 2, 1 + Math.floor(r() * 2), ROLE.leaf, { thick: 2 });
      if (r() < 0.4) for (let k = 0; k < 4; k += 1) { s.px(tx, ty - k, 1, ROLE.blossom); s.px(tx + 1, ty - k, 0, ROLE.blossom); }
    }
  },
  mushroom(s, r) {
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      const cx = s.w * 0.5 + (r() - 0.5) * s.w * 0.5, h = 2 + Math.floor(r() * s.h * 0.18), w = 2 + Math.floor(r() * 2);
      for (let y = 0; y < h; y += 1) { s.px(cx, y, 3, ROLE.eye); s.px(cx + 1, y, 2, ROLE.eye); }
      for (let y = 0; y < 2; y += 1) for (let x = -w + y; x <= w - y; x += 1) s.px(cx + x, h + y, x < 0 ? 3 : x > 1 ? 1 : 2, ROLE.blossom);
    }
  },
};

/** Paints an atlas of every kind asked for, `variants` of each, from one seed. */
export function paintFoliageAtlas({ kinds = FLORA_KINDS, variants = 4, cell = [16, 24], seed = 1 }: { readonly kinds?: readonly FloraKind[]; readonly variants?: number; readonly cell?: readonly [number, number]; readonly seed?: number } = {}): FloraAtlas {
  const [w, h] = cell;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || w > 64 || h > 64) throw new RangeError("A foliage sprite is 8..64 pixels on a side.");
  if (!Number.isInteger(variants) || variants < 1 || variants > 16) throw new RangeError("A foliage kind has 1..16 variants.");
  const unknown = kinds.find((k) => !(k in PAINTERS));
  if (unknown !== undefined) throw new Error(`Unknown foliage kind ${unknown}.`);
  const total = kinds.length * variants;
  const cols = Math.min(total, 16);
  const rows = Math.ceil(total / cols);
  const width = cols * w, height = rows * h;
  const rgba = new Uint8Array(width * height * 4);
  const first: Partial<Record<FloraKind, number>> = {};
  kinds.forEach((kind, k) => {
    first[kind] = k * variants;
    for (let v = 0; v < variants; v += 1) {
      const sprite = new Sprite(w, h);
      PAINTERS[kind](sprite, random((seed * 0x9e3779b1) ^ (k * 7919 + v * 104729 + 1)));
      const index = k * variants + v;
      const ox = (index % cols) * w, oy = Math.floor(index / cols) * h;
      for (let y = 0; y < h; y += 1) rgba.set(sprite.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * width + ox) * 4);
    }
  });
  return { width, height, rgba, cell: [w, h], cols, variants, kinds, first };
}

/** The atlas cell of a kind's variant (variants wrap). */
export function spriteCell(atlas: FloraAtlas, kind: FloraKind, variant = 0): number {
  const base = atlas.first[kind];
  if (base === undefined) throw new Error(`The foliage atlas has no ${kind}.`);
  return base + (((Math.floor(variant) % atlas.variants) + atlas.variants) % atlas.variants);
}
