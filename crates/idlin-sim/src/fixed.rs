//! Q16.16 fixed-point scalar for all spatial quantities in the sim.
//!
//! `Fx` is an `i32` whose low 16 bits are the fraction — it matches the bot
//! VM's 32-bit word exactly, so positions cross the syscall boundary as raw
//! words. Arithmetic saturates instead of wrapping (a position clamped at the
//! world edge is recoverable; a wrapped one teleports), and division by zero
//! is defined as zero, mirroring the VM's "every state is defined" rule.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{Add, AddAssign, Div, Mul, Neg, Sub, SubAssign};

pub const FRAC_BITS: u32 = 16;
/// Q16.16 scale factor (`1 << FRAC_BITS`): one whole unit in raw fixed-point.
/// The client divides replicated raw coords by this — exported to TS as
/// `FX_SCALE` so the magic `/ 65536` lives in exactly one place.
pub const FX_SCALE: i64 = 1 << FRAC_BITS;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Fx(pub i32);

impl Fx {
    pub const ZERO: Fx = Fx(0);
    pub const ONE: Fx = Fx(1 << FRAC_BITS);
    pub const MAX: Fx = Fx(i32::MAX);
    pub const MIN: Fx = Fx(i32::MIN);

    pub const fn from_raw(raw: i32) -> Fx {
        Fx(raw)
    }

    pub const fn raw(self) -> i32 {
        self.0
    }

    pub const fn from_int(n: i16) -> Fx {
        Fx((n as i32) << FRAC_BITS)
    }

    /// Integer part, rounding toward negative infinity.
    pub const fn floor(self) -> i32 {
        self.0 >> FRAC_BITS
    }

    pub const fn abs(self) -> Fx {
        Fx(self.0.saturating_abs())
    }

    pub fn min(self, other: Fx) -> Fx {
        Fx(self.0.min(other.0))
    }

    pub fn max(self, other: Fx) -> Fx {
        Fx(self.0.max(other.0))
    }

    pub fn clamp(self, lo: Fx, hi: Fx) -> Fx {
        Fx(self.0.clamp(lo.0, hi.0))
    }

    /// Fixed-point square root via integer Newton's method. Negative → zero.
    ///
    /// Uses the monotonic-descent formulation: starting from x₀ ≥ √target the
    /// sequence strictly decreases until it reaches ⌊√target⌋, then the next
    /// step is ≥ x and we stop. (A naive `x != last` termination check can
    /// oscillate between two adjacent integers forever.)
    pub fn sqrt(self) -> Fx {
        if self.0 <= 0 {
            return Fx::ZERO;
        }
        // sqrt(v / 2^16) * 2^16 == sqrt(v * 2^16) == isqrt(v << 16)
        let target = (self.0 as i64) << FRAC_BITS;
        let mut x = target; // target >= 1 ⇒ target >= sqrt(target)
        loop {
            let y = (x + target / x) / 2;
            if y >= x {
                break;
            }
            x = y;
        }
        Fx(clamp_i64(x))
    }
}

fn clamp_i64(v: i64) -> i32 {
    v.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

impl Add for Fx {
    type Output = Fx;
    fn add(self, rhs: Fx) -> Fx {
        Fx(self.0.saturating_add(rhs.0))
    }
}

impl AddAssign for Fx {
    fn add_assign(&mut self, rhs: Fx) {
        *self = *self + rhs;
    }
}

impl Sub for Fx {
    type Output = Fx;
    fn sub(self, rhs: Fx) -> Fx {
        Fx(self.0.saturating_sub(rhs.0))
    }
}

impl SubAssign for Fx {
    fn sub_assign(&mut self, rhs: Fx) {
        *self = *self - rhs;
    }
}

impl Mul for Fx {
    type Output = Fx;
    /// Saturating Q16.16 multiply (widens to i64 internally).
    fn mul(self, rhs: Fx) -> Fx {
        let wide = (self.0 as i64 * rhs.0 as i64) >> FRAC_BITS;
        Fx(clamp_i64(wide))
    }
}

impl Div for Fx {
    type Output = Fx;
    /// Saturating Q16.16 divide. Division by zero is defined as zero.
    fn div(self, rhs: Fx) -> Fx {
        if rhs.0 == 0 {
            return Fx::ZERO;
        }
        let wide = ((self.0 as i64) << FRAC_BITS) / rhs.0 as i64;
        Fx(clamp_i64(wide))
    }
}

impl Neg for Fx {
    type Output = Fx;
    fn neg(self) -> Fx {
        Fx(self.0.saturating_neg())
    }
}

impl fmt::Debug for Fx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Render as a decimal without going through floats.
        let int = self.0 >> FRAC_BITS;
        let frac = (self.0 & 0xFFFF) as i64;
        let dec = (frac * 10_000) >> FRAC_BITS;
        write!(f, "{int}.{dec:04}")
    }
}

/// 2D point/vector in Q16.16.
#[derive(
    Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug, Serialize, Deserialize,
)]
pub struct FxV2 {
    pub x: Fx,
    pub y: Fx,
}

impl FxV2 {
    pub const ZERO: FxV2 = FxV2 {
        x: Fx::ZERO,
        y: Fx::ZERO,
    };

    pub const fn new(x: Fx, y: Fx) -> FxV2 {
        FxV2 { x, y }
    }

    pub fn dist(self, other: FxV2) -> Fx {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }
}

impl Add for FxV2 {
    type Output = FxV2;
    fn add(self, rhs: FxV2) -> FxV2 {
        FxV2 {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl Sub for FxV2 {
    type Output = FxV2;
    fn sub(self, rhs: FxV2) -> FxV2 {
        FxV2 {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_arithmetic() {
        let a = Fx::from_int(5);
        let b = Fx::from_int(3);
        assert_eq!((a + b).floor(), 8);
        assert_eq!((a - b).floor(), 2);
        assert_eq!((a * b).floor(), 15);
        assert_eq!((a / b).raw(), 0x1_AAAA); // 5/3 ≈ 1.6666 in Q16.16
    }

    #[test]
    fn saturation_not_wrapping() {
        assert_eq!(Fx::MAX + Fx::ONE, Fx::MAX);
        assert_eq!(Fx::MIN - Fx::ONE, Fx::MIN);
        assert_eq!(Fx::MAX * Fx::from_int(2), Fx::MAX);
        assert_eq!(-Fx::MIN, Fx::MAX); // saturating_neg
    }

    #[test]
    fn div_by_zero_is_zero() {
        assert_eq!(Fx::from_int(100) / Fx::ZERO, Fx::ZERO);
    }

    #[test]
    fn sqrt_exact_squares_and_bounds() {
        assert_eq!(Fx::from_int(16).sqrt(), Fx::from_int(4));
        assert_eq!(Fx::from_int(0).sqrt(), Fx::ZERO);
        assert_eq!(Fx::from_int(-4).sqrt(), Fx::ZERO);
        // sqrt(2) ≈ 1.41421; Newton on integers may be off by 1 ulp.
        let r = (Fx::from_int(2).sqrt().raw() - 0x16A09).abs();
        assert!(r <= 1, "sqrt(2) raw off by {r}");
    }

    #[test]
    fn sqrt_terminates_and_is_exact_floor_everywhere() {
        // Regression: the old `x != last` Newton termination oscillated
        // forever on some inputs. Property-check a dense sweep: the result
        // must be the exact floor square root, and it must terminate.
        let mut x = 1i64;
        while x <= i32::MAX as i64 {
            let s = Fx(x as i32).sqrt().raw() as i64;
            let target = x << 16;
            assert!(s * s <= target, "sqrt({x}) = {s} too large");
            assert!((s + 1) * (s + 1) > target, "sqrt({x}) = {s} too small");
            // Dense at the low end (where oscillation bites), sparse above.
            x += 1 + x / 257;
        }
    }

    #[test]
    fn dist_is_euclidean() {
        let a = FxV2::new(Fx::from_int(0), Fx::from_int(0));
        let b = FxV2::new(Fx::from_int(3), Fx::from_int(4));
        assert_eq!(a.dist(b), Fx::from_int(5));
    }
}
