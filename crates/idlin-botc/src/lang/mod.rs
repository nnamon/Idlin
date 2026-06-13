//! The `.bot` language: a small C-like language compiling to Idlin VM
//! bytecode. This is what brains and (eventually) player submissions are
//! written in; the assembler remains underneath as the escape hatch.
//!
//! ```text
//! const SELF = 0xE000;
//! var kills;                       // globals persist across ticks
//!
//! fn main() {                      // runs once per tick
//!     self_status(SELF);
//!     if (mem[SELF + 32] & 1) { return; }     // dead
//!     if (read_entities(0xE100, 1, 1) > 0) {
//!         use_skill(0, mem[0xE100], 0, 0);
//!         move_to(mem[0xE100 + 8], mem[0xE100 + 12]);
//!     }
//! }
//! ```
//!
//! Design choices (bot-sized, deliberately):
//! - **Locals are statically allocated** (so are params): no recursion, no
//!   frame management, every variable is just an address. Globals from
//!   0xC000 up.
//! - `fn main()` is called by an implicit `loop { main(); halt }` — one
//!   invocation per tick. Calling `halt()` mid-function ends the tick right
//!   there and resumes at that point next tick.
//! - `&&`/`||` are logical but NOT short-circuiting (both sides evaluate).
//! - Integers are the VM's i32 words; positions are Q16.16 (use
//!   `mulfx`/`divfx` builtins for fixed-point math).

mod analyze;
mod ast;
mod codegen;
mod lexer;
mod parser;
mod resolve;

pub use analyze::{ArgBound, SyscallUse, analyze_with};
pub use resolve::Resolver;

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileError {
    pub line: usize,
    pub msg: String,
}

impl CompileError {
    pub fn new(line: usize, msg: impl Into<String>) -> CompileError {
        CompileError {
            line,
            msg: msg.into(),
        }
    }
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line, self.msg)
    }
}

impl std::error::Error for CompileError {}

/// Compile `.bot` source into a versioned ILBC bytecode container.
/// Content refs (`item "rusted_cleaver"`) are rejected — they need a
/// database; use [`compile_with`] (the content loader does).
pub fn compile(source: &str) -> Result<Vec<u8>, CompileError> {
    compile_with(source, &|kind, id| {
        Err(format!(
            "content ref `{kind} \"{id}\"` needs the content database — \
             only brains compiled at content load can use refs"
        ))
    })
}

/// Compile with a content resolver: every `kind "id"` ref becomes the
/// integer the resolver returns, at compile time. Unknown ids fail the
/// compile (and therefore the content load) with the resolver's message.
pub fn compile_with(source: &str, resolver: Resolver) -> Result<Vec<u8>, CompileError> {
    let tokens = lexer::lex(source)?;
    let mut program = parser::parse(tokens)?;
    resolve::resolve(&mut program, resolver)?;
    let code = codegen::generate(&program)?;
    Ok(idlin_vm::wrap_program(&code))
}
