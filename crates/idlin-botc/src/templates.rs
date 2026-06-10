//! Built-in bot templates. These are the "brains" chat-command players get;
//! the param block (0xF000) tunes them without redeploying code.

use crate::AsmError;

pub const TEMPLATE_GRINDER: &str = include_str!("templates/grinder.asm");

/// The default grind-forever brain: fight the nearest monster, pick up own
/// loot, wander when the area is clear, sleep while dead.
pub fn template_grinder() -> Result<Vec<u8>, AsmError> {
    crate::assemble(TEMPLATE_GRINDER)
}
