// A software stand-in for the renderer's bake mode, for tests that bake indexed sprites without a GPU.

import type { BakeWorld, IndexedBakeRenderer } from "../src/index.ts";

// A software stand-in: renderIndexed "draws" each capsule's first end as one pixel of INDEX_FS bytes (material,
// shade 100, u/v from the capsule's radius) through the job's camera, into the canvas it returns (null).
export function softIndexed(): IndexedBakeRenderer & { readonly draws: number } {
  interface Tex { w: number; h: number; data: Uint8Array }
  let W = 8, H = 8, screen = new Uint8Array(W * H * 4);
  let world: BakeWorld = {};
  const bound: { tex: Tex | null; fb: { tex: Tex | null } | null } = { tex: null, fb: null };
  const gl = {
    TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, RGBA8: 0x8058, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, FRAMEBUFFER: 0x8d40, READ_FRAMEBUFFER: 0x8ca8, COLOR_ATTACHMENT0: 0x8ce0, MAX_TEXTURE_SIZE: 0x0d33, ACTIVE_TEXTURE: 0x84e0,
    getParameter: (p: number) => (p === 0x0d33 ? 4096 : 0x84c0),
    activeTexture() {}, createTexture: (): Tex => ({ w: 0, h: 0, data: new Uint8Array(0) }), bindTexture: (_t: number, t: Tex) => { bound.tex = t; },
    texStorage2D(_t: number, _l: number, _f: number, w: number, h: number) { bound.tex!.w = w; bound.tex!.h = h; bound.tex!.data = new Uint8Array(w * h * 4); },
    createFramebuffer: () => ({ tex: null as Tex | null }),
    bindFramebuffer(target: number, fb: { tex: Tex | null } | null) { if (target !== 0x8ca8) bound.fb = fb; },
    framebufferTexture2D(_t: number, _a: number, _tt: number, tex: Tex) { bound.fb!.tex = tex; },
    copyTexSubImage2D(_t: number, _l: number, xo: number, yo: number, x: number, y: number, w: number, h: number) {
      const t = bound.tex!;
      for (let r = 0; r < h; r += 1) t.data.set(screen.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), ((yo + r) * t.w + xo) * 4);
    },
    readPixels(x: number, y: number, w: number, h: number, _f: number, _ty: number, out: Uint8Array) {
      const t = bound.fb!.tex!;
      for (let r = 0; r < h; r += 1) out.set(t.data.subarray(((y + r) * t.w + x) * 4, ((y + r) * t.w + x + w) * 4), r * w * 4);
    },
    deleteFramebuffer() {}, deleteTexture() {},
  };
  let draws = 0;
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    get draws() { return draws; },
    setTarget(w, h) { W = w; H = h; screen = new Uint8Array(W * H * 4); },
    setPalette() {}, setMaterials() {}, setStyle() {},
    setWorld(w) { world = w as BakeWorld; return { dropped: 0 }; },
    render() { throw new Error("an indexed bake never renders colours"); },
    renderIndexed(o) {
      draws += 1;
      screen.fill(0);
      // Orthographic enough for a stand-in: the camera's screen axes through the picture's origin pixel.
      const f = [o.target[0] - o.eye[0], o.target[1] - o.eye[1], o.target[2] - o.eye[2]];
      const fl = Math.hypot(f[0]!, f[1]!, f[2]!); const F = f.map((v) => v / fl);
      const rl = Math.hypot(F[2]!, F[0]!); const R = [F[2]! / rl, 0, -F[0]! / rl];
      const U = [F[1]! * R[2]! - F[2]! * R[1]!, F[2]! * R[0]! - F[0]! * R[2]!, F[0]! * R[1]! - F[1]! * R[0]!];
      const k = H / (2 * Math.tan(o.fov! / 2) * fl);
      for (const c of world.capsules ?? []) {
        const d = [c.a[0]! - o.target[0], c.a[1]! - o.target[1], c.a[2]! - o.target[2]];
        const px = Math.floor(W / 2 + (d[0]! * R[0]! + d[1]! * R[1]! + d[2]! * R[2]!) * k);
        const py = Math.floor(H / 2 - (d[0]! * U[0]! + d[1]! * U[1]! + d[2]! * U[2]!) * k);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        screen.set([128 + (c.mat ?? 0), 100, Math.round(c.r * 100), 7], ((H - 1 - py) * W + px) * 4);
      }
      return null;
    },
  };
}
