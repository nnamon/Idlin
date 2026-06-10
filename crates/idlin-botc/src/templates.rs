//! Built-in bot templates. These are the "brains" chat-command players get;
//! the param block (0xF000) tunes them without redeploying code.

use crate::lang::CompileError;

pub const TEMPLATE_GRINDER: &str = include_str!("templates/grinder.bot");

/// The default grind-forever brain: fight the nearest enemy, pick up own
/// loot, keep gear/passives/gems current, wander when the area is clear.
pub fn template_grinder() -> Result<Vec<u8>, CompileError> {
    crate::lang::compile(TEMPLATE_GRINDER)
}
