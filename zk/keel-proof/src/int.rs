//! Integer helpers matching @keel-engine/proof's int.ts.

/// floor(sqrt(n)) for n >= 0 (negative n gives 0), by Newton's method on integers.
pub fn isqrt(n: i64) -> i64 {
    if n < 2 { return if n < 0 { 0 } else { n }; }
    let bits = 64 - (n as u64).leading_zeros();
    let mut x: i64 = 1 << ((bits + 1) / 2);
    loop {
        let y = (x + n / x) / 2;
        if y >= x { return x; }
        x = y;
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn exact() {
        for n in (0..20_000i64).chain((0..2000).map(|i| (i * 2_251_799_813_685u64 as i64) % (1 << 53))) {
            let s = super::isqrt(n);
            assert!(s * s <= n && (s + 1) * (s + 1) > n, "isqrt({n}) = {s}");
        }
        assert_eq!(super::isqrt((1 << 53) - 1), 94906265);
    }
}
