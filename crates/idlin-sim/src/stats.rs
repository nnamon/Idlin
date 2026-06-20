//! The stat engine: every point of character power is an affix grant
//! `(stat, layer, value)`, whether it came from gear, the passive tree, or
//! (later) gems. One evaluator, the ARPG-standard three layers:
//!
//! ```text
//! final = (base + Σ added) × (1 + Σ increased) × Π (1 + more_i)
//! ```
//!
//! - `Added`: flat units of the stat.
//! - `Increased`: basis points, all summed into ONE bucket, applied once.
//! - `More`: basis points, each applies multiplicatively.
//!
//! All integer math on i64 basis points (10000 = +100%).

pub use idlin_content::stats::{
    Condition, EvalContext, Grant, Layer, STAT_COUNT, Stat, WeaponClass,
};

/// Accumulated grants, ready to evaluate against base values.
#[derive(Debug, Clone)]
pub struct StatSheet {
    added: [i64; STAT_COUNT],
    increased: [i64; STAT_COUNT],
    /// Folded multiplicative factor, starts at 10000 (×1).
    more: [i64; STAT_COUNT],
}

impl Default for StatSheet {
    fn default() -> Self {
        StatSheet {
            added: [0; STAT_COUNT],
            increased: [0; STAT_COUNT],
            more: [10000; STAT_COUNT],
        }
    }
}

impl StatSheet {
    pub fn new() -> StatSheet {
        StatSheet::default()
    }

    pub fn apply(&mut self, grant: &Grant) {
        let i = grant.stat.idx();
        match grant.layer {
            Layer::Added => self.added[i] += grant.value,
            Layer::Increased => self.increased[i] += grant.value,
            Layer::More => {
                self.more[i] = self.more[i] * (10000 + grant.value) / 10000;
            }
        }
    }

    /// Evaluate a stat against its base value. Never returns negative.
    pub fn value(&self, stat: Stat, base: i64) -> i64 {
        let i = stat.idx();
        let flat = base + self.added[i];
        let increased = (10000 + self.increased[i]).max(0);
        (flat * increased / 10000 * self.more[i] / 10000).max(0)
    }
}

/// PoE-shaped armour attenuation, integer-exact: stronger against small
/// hits, never negative, never inverts.
/// `taken = raw × 5·raw / (armour + 5·raw)`
pub fn mitigate_phys(raw: i64, armour: i64) -> i64 {
    if raw <= 0 {
        return 0;
    }
    let armour = armour.max(0);
    raw * (5 * raw) / (armour + 5 * raw)
}

/// Resistance application with a 75% cap (and a -100% floor for future
/// curses/penalties).
pub fn apply_resist(raw: i64, resist_bp: i64) -> i64 {
    if raw <= 0 {
        return 0;
    }
    let r = resist_bp.clamp(-10000, 7500);
    raw * (10000 - r) / 10000
}

/// Chance to hit in basis points: accuracy vs evasion, clamped so nothing
/// is unhittable and nothing always whiffs.
pub fn hit_chance_bp(accuracy: i64, evasion: i64) -> i64 {
    let acc = accuracy.max(1);
    let eva = evasion.max(0);
    (10000 * acc / (acc + eva / 2)).clamp(3000, 10000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layers_compose_correctly() {
        let mut sheet = StatSheet::new();
        // +20 flat, 50% increased + 10% increased (sums to 60%), 20% more, 25% more.
        sheet.apply(&Grant::new(Stat::Life, Layer::Added, 20));
        sheet.apply(&Grant::new(Stat::Life, Layer::Increased, 5000));
        sheet.apply(&Grant::new(Stat::Life, Layer::Increased, 1000));
        sheet.apply(&Grant::new(Stat::Life, Layer::More, 2000));
        sheet.apply(&Grant::new(Stat::Life, Layer::More, 2500));
        // (100+20) * 1.6 * 1.2 * 1.25 = 288
        assert_eq!(sheet.value(Stat::Life, 100), 288);
        // Other stats untouched.
        assert_eq!(sheet.value(Stat::Armour, 50), 50);
    }

    #[test]
    fn increased_is_one_bucket_not_compounding() {
        let mut sheet = StatSheet::new();
        for _ in 0..10 {
            sheet.apply(&Grant::new(Stat::DamagePhys, Layer::Increased, 1000));
        }
        // Ten "10% increased" = +100%, NOT ×1.1^10.
        assert_eq!(sheet.value(Stat::DamagePhys, 100), 200);
    }

    #[test]
    fn negative_increased_floors_at_zero() {
        let mut sheet = StatSheet::new();
        sheet.apply(&Grant::new(Stat::MoveSpeed, Layer::Increased, -15000));
        assert_eq!(sheet.value(Stat::MoveSpeed, 10000), 0);
    }

    #[test]
    fn armour_attenuation_curve() {
        // No armour: full damage.
        assert_eq!(mitigate_phys(100, 0), 100);
        // armour == 5×raw → half damage.
        assert_eq!(mitigate_phys(100, 500), 50);
        // Small hit vs big armour: crushed (the attack loop enforces its
        // own minimum on the total).
        assert!(mitigate_phys(10, 2000) <= 2);
        // Big hit vs same armour: punches through proportionally.
        let big = mitigate_phys(500, 2000);
        assert!(big * 100 / 500 > 50, "big hits punch through: {big}");
        assert_eq!(mitigate_phys(0, 1000), 0);
    }

    #[test]
    fn resists_cap_at_75() {
        assert_eq!(apply_resist(100, 7500), 25);
        assert_eq!(apply_resist(100, 20000), 25); // capped
        assert_eq!(apply_resist(100, 0), 100);
        assert_eq!(apply_resist(100, -5000), 150); // negative resist hurts
    }

    #[test]
    fn hit_chance_bounds() {
        assert_eq!(hit_chance_bp(100, 0), 10000);
        assert!(hit_chance_bp(1, 100000) == 3000); // floor
        let mid = hit_chance_bp(90, 30);
        assert!((8000..9500).contains(&mid), "got {mid}");
    }
}
