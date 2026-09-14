// A binary min-heap of (priority, value) pairs: the searches' open lists.
export class MinHeap {
  private readonly p: number[] = [];
  private readonly v: number[] = [];
  get size(): number { return this.p.length; }
  push(pr: number, val: number): void {
    const p = this.p, v = this.v;
    let i = p.length;
    p.push(pr); v.push(val);
    while (i > 0) { const up = (i - 1) >> 1; if (p[up]! <= pr) break; p[i] = p[up]!; v[i] = v[up]!; i = up; }
    p[i] = pr; v[i] = val;
  }
  pop(): [number, number] {
    const p = this.p, v = this.v;
    const top: [number, number] = [p[0]!, v[0]!];
    const lp = p.pop()!, lv = v.pop()!;
    if (p.length) {
      let i = 0;
      const n = p.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mp = lp;
        if (l < n && p[l]! < mp) { m = l; mp = p[l]!; }
        if (r < n && p[r]! < mp) { m = r; mp = p[r]!; }
        if (m === i) break;
        p[i] = p[m]!; v[i] = v[m]!; i = m;
      }
      p[i] = lp; v[i] = lv;
    }
    return top;
  }
}
