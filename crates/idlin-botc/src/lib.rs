//! Bot toolchain: assembles bot source into Idlin VM bytecode.
//!
//! Phase 1 brings the assembler and the built-in chat-command templates;
//! Phase 5 adds the C-like `.bot` language compiler. The server is the only
//! consumer — the sim sees nothing but bytecode.

#[derive(Debug, thiserror::Error)]
pub enum AsmError {
    #[error("assembler not yet implemented (Phase 1)")]
    Unimplemented,
}

/// Assemble bot assembly source into VM bytecode.
pub fn assemble(_source: &str) -> Result<Vec<u8>, AsmError> {
    Err(AsmError::Unimplemented)
}
