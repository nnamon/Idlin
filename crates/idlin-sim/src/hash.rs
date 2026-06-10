//! FNV-1a 64-bit hashing for determinism checks. World state is folded into
//! one hash in a canonical order; replays and snapshots embed it so any
//! divergence is caught at the tick it happens, not weeks later.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fnv1a64 {
    state: u64,
}

pub const FNV_OFFSET: u64 = 0xcbf29ce484222325;
pub const FNV_PRIME: u64 = 0x100000001b3;

impl Default for Fnv1a64 {
    fn default() -> Self {
        Fnv1a64 { state: FNV_OFFSET }
    }
}

impl Fnv1a64 {
    pub fn new() -> Fnv1a64 {
        Fnv1a64::default()
    }

    pub fn write_u8(&mut self, b: u8) {
        self.state ^= b as u64;
        self.state = self.state.wrapping_mul(FNV_PRIME);
    }

    pub fn write_bytes(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u8(b);
        }
    }

    pub fn write_u32(&mut self, v: u32) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_u64(&mut self, v: u64) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_i32(&mut self, v: i32) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_i64(&mut self, v: i64) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn finish(&self) -> u64 {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_vectors() {
        // Standard FNV-1a 64 test vectors.
        assert_eq!(Fnv1a64::new().finish(), 0xcbf29ce484222325);

        let mut h = Fnv1a64::new();
        h.write_bytes(b"a");
        assert_eq!(h.finish(), 0xaf63dc4c8601ec8c);

        let mut h = Fnv1a64::new();
        h.write_bytes(b"foobar");
        assert_eq!(h.finish(), 0x85944171f73967e8);
    }
}
