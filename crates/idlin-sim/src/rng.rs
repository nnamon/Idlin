//! Deterministic RNG, hand-rolled so no dependency update can ever change
//! world history. PCG-XSH-RR 32 (Melissa O'Neill's pcg32) for generation,
//! splitmix64 for deriving independent streams per (domain, instance).

/// Domains for stream derivation — adding a new consumer gets its own stream
/// and never shifts an existing one's sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u64)]
pub enum Domain {
    ZoneAi = 1,
    Loot = 2,
    MapLayout = 3,
    Combat = 4,
    Bot = 5,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Pcg32 {
    state: u64,
    inc: u64,
}

const PCG_MULT: u64 = 6364136223846793005;

impl Pcg32 {
    /// Standard pcg32 seeding (`pcg32_srandom_r`).
    pub fn new(seed: u64, seq: u64) -> Pcg32 {
        let mut rng = Pcg32 {
            state: 0,
            inc: (seq << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    /// Derive the stream for a given (domain, instance) under a world seed.
    pub fn stream(world_seed: u64, domain: Domain, instance: u64) -> Pcg32 {
        let mut x = world_seed;
        let seed = splitmix64(&mut x) ^ splitmix64(&mut { domain as u64 });
        let seq = splitmix64(&mut { instance.wrapping_add(0x9E3779B97F4A7C15) });
        Pcg32::new(seed, seq)
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(PCG_MULT).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform-ish value in `0..n` (n > 0) via 32×32→64 multiply-shift.
    /// The tiny bias is irrelevant for game rolls and it's branch-free.
    pub fn next_range(&mut self, n: u32) -> u32 {
        debug_assert!(n > 0);
        ((self.next_u32() as u64 * n as u64) >> 32) as u32
    }

    /// Roll `1..=sides` (dice-style).
    pub fn roll(&mut self, sides: u32) -> u32 {
        self.next_range(sides) + 1
    }
}

pub fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E3779B97F4A7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_pcg32_reference_vectors() {
        // First outputs of the canonical pcg32 demo: seed=42, seq=54.
        let mut rng = Pcg32::new(42, 54);
        let expected = [
            0xa15c02b7u32,
            0x7b47f409,
            0xba1d3330,
            0x83d2f293,
            0xbfa4784b,
            0xcbed606e,
        ];
        for (i, &e) in expected.iter().enumerate() {
            assert_eq!(rng.next_u32(), e, "output {i} diverged from reference");
        }
    }

    #[test]
    fn streams_are_independent_and_reproducible() {
        let mut a1 = Pcg32::stream(1234, Domain::Loot, 7);
        let mut a2 = Pcg32::stream(1234, Domain::Loot, 7);
        let mut b = Pcg32::stream(1234, Domain::Combat, 7);
        let s1: Vec<u32> = (0..8).map(|_| a1.next_u32()).collect();
        let s2: Vec<u32> = (0..8).map(|_| a2.next_u32()).collect();
        let sb: Vec<u32> = (0..8).map(|_| b.next_u32()).collect();
        assert_eq!(s1, s2);
        assert_ne!(s1, sb);
    }

    #[test]
    fn next_range_is_bounded() {
        let mut rng = Pcg32::new(99, 1);
        for _ in 0..10_000 {
            assert!(rng.next_range(7) < 7);
        }
        for _ in 0..1_000 {
            let r = rng.roll(6);
            assert!((1..=6).contains(&r));
        }
    }
}
