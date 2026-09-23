//! The portable roll: @keel-engine/proof's roll.ts, u32 wrapping arithmetic for Math.imul.

pub fn mix32(x: u32) -> u32 {
    let mut h = x;
    h ^= h >> 16;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    h
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RollKey(pub u32, pub u32);

fn fold(seed: &[u8; 32], start: u32) -> u32 {
    let mut h = start;
    for i in (0..32).step_by(4) {
        let w = u32::from_be_bytes([seed[i], seed[i + 1], seed[i + 2], seed[i + 3]]);
        h = mix32(h ^ w).wrapping_add(0x9e37_79b9);
    }
    mix32(h)
}

pub fn roll_key(seed: &[u8; 32]) -> RollKey { RollKey(fold(seed, 0x243f_6a88), fold(seed, 0x85a3_08d3)) }

/// A u32 named by four coordinates. Coordinates are taken mod 2^32, as the TS side does.
pub fn roll(k: RollKey, a: u32, b: u32, c: u32, d: u32) -> u32 {
    let mut h = mix32(k.0 ^ a.wrapping_mul(0x9e37_79b1));
    h = mix32(h ^ b.wrapping_mul(0x85eb_ca77) ^ k.1);
    h = mix32(h ^ c.wrapping_mul(0xc2b2_ae3d));
    mix32(h ^ d.wrapping_mul(0x27d4_eb2f) ^ k.0)
}

/// 0..n-1 (n <= 2^21).
pub fn below(k: RollKey, n: u32, a: u32, b: u32, c: u32, d: u32) -> u32 {
    ((roll(k, a, b, c, d) as u64 * n as u64) >> 32) as u32
}

pub fn ppm(k: RollKey, a: u32, b: u32, c: u32, d: u32) -> u32 { below(k, 1_000_000, a, b, c, d) }

pub fn chance_ppm(k: RollKey, p: i64, a: u32, b: u32, c: u32, d: u32) -> bool { (ppm(k, a, b, c, d) as i64) < p }

pub fn pick_weighted(k: RollKey, weights: &[u32], a: u32, b: u32, c: u32, d: u32) -> usize {
    let total: u32 = weights.iter().sum();
    let mut r = below(k, total, a, b, c, d);
    for (i, &w) in weights.iter().enumerate() {
        if r < w { return i; }
        r -= w;
    }
    weights.len() - 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::program_id;

    #[test]
    fn pinned_like_the_typescript() {
        // packages/proof/test/vectors.mjs pins the same numbers.
        let k = roll_key(&program_id("keel/proof/test"));
        assert_eq!((k.0, k.1), (3578586263, 3043208446));
        assert_eq!(roll(k, 0, 0, 0, 0), 2911776024);
        assert_eq!(roll(k, 1, 2, 3, 4), 668755810);
        assert_eq!(roll(k, 0xffff_ffff, 7, 0, 1), 1665936403);
        assert_eq!(below(k, 1_000_000, 5, 6, 7, 8), 920335);
        assert_eq!([mix32(0), mix32(1), mix32(0x9e37_79b9)], [0, 1364076727, 2462723854]);
    }
}
