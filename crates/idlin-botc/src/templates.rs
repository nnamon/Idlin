//! Built-in bot templates. These are the "brains" chat-command players get;
//! the param block (0xF000) tunes them without redeploying code.

use crate::lang::CompileError;

pub const TEMPLATE_GRINDER: &str = include_str!("templates/grinder.bot");

/// The generated stable-id consts (#54), prepended to templates so they can
/// reference content by name (`NODE_*`, `GEM_*`, …) the same way authored
/// brains do. The bare `compile` path has no include resolver, so the consts
/// are inlined here instead; the CI gate keeps this file in sync with content.
pub const GEN_IDS: &str = include_str!("../../../content/lib/gen_ids.bot");

/// The generated VM-ABI consts (#50): record strides + SelfStatus offsets, owned
/// in `idlin_vm::abi` and emitted to `gen_abi.bot`. Prepended like `GEN_IDS` so the
/// template reads VM memory through the same contract the host writes — a stride or
/// offset can't drift. (Content brains `include "gen_abi.bot"` instead.)
pub const GEN_ABI: &str = include_str!("../../../content/lib/gen_abi.bot");

/// The default grind-forever brain: fight the nearest enemy, pick up own
/// loot, keep gear/passives/gems current, wander when the area is clear.
/// Compile a PLAYER-DEPLOYED brain (#148 A6): the same prelude the stock
/// templates get — every generated content num and ABI const in scope —
/// so a deployed `.bot` writes against the documented vocabulary.
pub fn compile_deployed(source: &str) -> Result<Vec<u8>, CompileError> {
    crate::lang::compile(&format!("{GEN_IDS}\n{GEN_ABI}\n{source}"))
}

pub fn template_grinder() -> Result<Vec<u8>, CompileError> {
    crate::lang::compile(&format!("{GEN_IDS}\n{GEN_ABI}\n{TEMPLATE_GRINDER}"))
}

pub const TEMPLATE_CASTER: &str = include_str!("templates/caster.bot");
pub const TEMPLATE_RANGER: &str = include_str!("templates/ranger.bot");

/// The wand archetype (#148 A2): the Elementalist build, the wand ladder,
/// spell sockets, and a ranged hold. Shares the grinder's DNA.
pub fn template_caster() -> Result<Vec<u8>, CompileError> {
    crate::lang::compile(&format!("{GEN_IDS}\n{GEN_ABI}\n{TEMPLATE_CASTER}"))
}

/// The bow archetype (#148 A2): the Deadeye build, the bow ladder, shot
/// sockets, and a ranged hold. Shares the grinder's DNA.
pub fn template_ranger() -> Result<Vec<u8>, CompileError> {
    crate::lang::compile(&format!("{GEN_IDS}\n{GEN_ABI}\n{TEMPLATE_RANGER}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn all_three_stock_brains_assemble() {
        // #148 A2: the caster and ranger are as production-critical as the
        // grinder — a template that fails to compile is a dead archetype.
        assert!(!super::template_grinder().unwrap().is_empty());
        assert!(!super::template_caster().unwrap().is_empty());
        assert!(!super::template_ranger().unwrap().is_empty());
    }
}
