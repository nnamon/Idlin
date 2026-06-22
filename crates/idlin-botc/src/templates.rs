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
pub fn template_grinder() -> Result<Vec<u8>, CompileError> {
    crate::lang::compile(&format!("{GEN_IDS}\n{GEN_ABI}\n{TEMPLATE_GRINDER}"))
}
