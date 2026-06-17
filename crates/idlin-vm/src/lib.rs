//! The Idlin bot VM: a stack machine with 32-bit signed words, a flat 64 KiB
//! wrapping memory, and a per-tick instruction budget. Untrusted bytecode runs
//! here; every reachable state must be defined and non-fatal, and execution
//! must be bit-exact across platforms (no floats, no host time, no host RNG).
//!
//! ## Machine model
//! - Words are `i32`. The operand stack lives in main memory and grows upward
//!   from `STACK_BASE`; `sp` points at the next free slot.
//! - All addresses wrap at 64 KiB: out-of-bounds access is impossible by
//!   construction. Stack under/overflow wraps the same way — garbage in,
//!   garbage out, but never a fault.
//! - Code is loaded at 0x0000. Zeroed memory decodes as `Halt`, so falling
//!   off the end of a program is benign.
//! - `run` executes at most `budget` instructions, decrementing the counter
//!   in place so the host can resume after servicing a syscall.
//!
//! ## Calling conventions (used by idlin-botc and the sim's syscall host)
//! - Binary ops: `push a; push b; OP` computes `a OP b`.
//! - Syscalls: push args in reverse order (argN first, arg1 last), then argc,
//!   then the syscall number. The host pops number, argc, then arg1..argN,
//!   and pushes a single result word.
//! - `Call`/`CallAbs` push the return address; `Ret` pops it.

#![forbid(unsafe_code)]
#![deny(
    clippy::float_arithmetic,
    clippy::disallowed_types,
    clippy::disallowed_methods
)]

use serde::{Deserialize, Serialize};

/// Bytecode container magic: "ILBC".
pub const BYTECODE_MAGIC: [u8; 4] = *b"ILBC";
/// Current bytecode format version. Bump on any encoding change; the VM
/// rejects programs whose version it does not support, so outdated bots fail
/// fast at deploy time instead of misbehaving at runtime.
///
/// v2 (#54 PR1b-B): the declared-build ref table widened from u16 to i32 per
/// entry — node refs are stable tagged content nums now, like every other
/// content id, so they no longer fit in 16 bits.
pub const BYTECODE_FORMAT_VERSION: u16 = 2;
/// Header: magic (4) + format version u16 LE (2) + reserved u16 (2).
pub const HEADER_LEN: usize = 8;

pub const MEM_SIZE: usize = 0x1_0000;
/// Code is loaded at 0x0000 and may occupy at most the lower half of memory.
pub const CODE_MAX: usize = 0x8000;
/// The stack grows upward from here.
pub const STACK_BASE: u16 = 0x8000;
/// Host-written parameter block (the chat-command → bot channel).
pub const PARAM_BLOCK_ADDR: u16 = 0xF000;
pub const PARAM_BLOCK_LEN: usize = 0x100;
/// Bot-owned persistent storage: the host carries this region across program
/// redeployments and zone transfers. Only the bot's own code writes here —
/// players have no channel into it (params are the only host→bot input).
pub const PERSIST_BLOCK_ADDR: u16 = 0xF200;
pub const PERSIST_BLOCK_LEN: usize = 0x400;
/// Default per-tick instruction budget.
pub const DEFAULT_TICK_BUDGET: u32 = 5_000;

// Syscall numbers — the host/VM ABI, the SINGLE owner. Both the compiler
// (idlin-botc BUILTINS) and the host (idlin-sim bots.rs / zone_brain.rs)
// reference these so a number is defined exactly once. Entity bot syscalls
// are 0..32; zone-brain syscalls are 100+.
pub const SYS_DEBUG: i32 = 0;
pub const SYS_SELF_STATUS: i32 = 1;
pub const SYS_READ_ENTITIES: i32 = 2;
pub const SYS_READ_INVENTORY: i32 = 5;
pub const SYS_MOVE_TO: i32 = 6;
pub const SYS_USE_SKILL: i32 = 7;
pub const SYS_PICK_UP: i32 = 8;
pub const SYS_EQUIP_BEST: i32 = 12;
/// Emitted by the compiler from the `build [...]` declaration, not callable.
pub const SYS_SET_BUILD: i32 = 14;
pub const SYS_RANDOM: i32 = 15;
pub const SYS_MOVE_ITEM: i32 = 16;
pub const SYS_DROP_ITEM: i32 = 17;
pub const SYS_READ_SKILLS: i32 = 18;
pub const SYS_SOCKET_GEM: i32 = 19;
pub const SYS_COUNT_ENTITIES: i32 = 20;
pub const SYS_LINE_OF_SIGHT: i32 = 21;
pub const SYS_USE_SKILL_AT: i32 = 22;
pub const SYS_USE_SKILL_DIR: i32 = 23;
pub const SYS_READ_CURRENCY: i32 = 24;
pub const SYS_USE_CURRENCY: i32 = 25;
pub const SYS_SAY: i32 = 26;
pub const SYS_READ_EXITS: i32 = 27;
pub const SYS_USE_EXIT: i32 = 28;
pub const SYS_USE_FLASK: i32 = 29;
/// #54 PR2a: on-demand per-skill definitional detail (shape/radius/target_mode/
/// skill_kind) stripped from ReadSkills — call when you need to know HOW to aim.
pub const SYS_SKILL_INFO: i32 = 30;
/// #54 PR2a: an inventory item's rolled affix instances (affix_num, value, tier).
pub const SYS_READ_ITEM_MODS: i32 = 31;
/// #54 PR3: the currently worn gear, per slot (slot, base_num, rarity, item_level)
/// — so a bot can score its own gear instead of leaning on `equip_best`.
pub const SYS_READ_EQUIPMENT: i32 = 32;
/// #54 PR3: equip a specific bag item into its content-defined slot (manual
/// counterpart to `equip_best`); the displaced item returns to the bag.
pub const SYS_EQUIP: i32 = 33;
/// #54 PR3: the gear slot a gear item num belongs to (the deferred Def-lookup,
/// RFC Q2) — so a bot can match a bag candidate against the worn item in its
/// slot. -1 for a non-gear or unknown num. The ONE definitional escape hatch:
/// base reads stay pure, but manual gear scoring needs base_num→slot.
pub const SYS_ITEM_SLOT: i32 = 34;
/// #54 PR3: bare a gear slot — move the worn item back to the bag, leaving the
/// slot empty (the deliberate counterpart to `equip`'s swap). Unlike a swap,
/// this REFUSES (-1) when the bag is full rather than dropping the item.
pub const SYS_UNEQUIP: i32 = 35;
// Zone-brain syscalls (no-ops for entity bots).
pub const SYS_QUERY_CHARACTERS: i32 = 100;
pub const SYS_POLL_EVENTS: i32 = 101;
pub const SYS_NARRATE: i32 = 102;
pub const SYS_DROP_LOOT: i32 = 103;
pub const SYS_SPAWN_MONSTER: i32 = 104;
pub const SYS_SET_EXIT: i32 = 106;
pub const SYS_SET_GATE: i32 = 107;
pub const SYS_SPAWN_ELITE: i32 = 108;

/// Instruction set. Stack machine, RPN: operands are pushed, opcodes pop them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Op {
    // Control / stack
    Halt = 0x00,
    Nop = 0x01,
    Push = 0x02,      // + imm32 LE
    PushShort = 0x03, // + imm16 LE, sign-extended
    PushZero = 0x04,
    Pop = 0x05,
    Dup = 0x06,
    Swap = 0x07,
    // Memory (word-granular; addresses are the low 16 bits of the word)
    LoadAbs = 0x10,
    StoreAbs = 0x11,
    LoadSpRel = 0x12,  // + off16 (signed, bytes, relative to sp)
    StoreSpRel = 0x13, // + off16 (signed, bytes, relative to sp after the pop)
    // Flow (+ rel16 signed offsets relative to the pc after the operand)
    Jmp = 0x20,
    JmpIf = 0x21,
    JmpIfZ = 0x22,
    Call = 0x23,
    CallAbs = 0x24,
    Ret = 0x25,
    // Comparisons (push 0/1)
    Lt = 0x30,
    Le = 0x31,
    Gt = 0x32,
    Ge = 0x33,
    Eq = 0x34,
    Ne = 0x35,
    // ALU (wrapping; div/mod by zero produce 0)
    Add = 0x40,
    Sub = 0x41,
    Mul = 0x42,
    MulFx = 0x43, // Q16.16 multiply
    Div = 0x44,
    DivFx = 0x45, // Q16.16 divide
    Mod = 0x46,
    And = 0x47,
    Or = 0x48,
    Xor = 0x49,
    Shl = 0x4a,
    Shr = 0x4b, // arithmetic shift right
    Neg = 0x4c,
    Not = 0x4d, // bitwise not
    // World interface
    Syscall = 0x50,
    // Extended ALU (additive opcodes are backward compatible: existing
    // bytecode is unaffected, so no format version bump)
    Abs = 0x60,
    Min = 0x61,
    Max = 0x62,
}

impl Op {
    pub fn from_u8(byte: u8) -> Option<Op> {
        Some(match byte {
            0x00 => Op::Halt,
            0x01 => Op::Nop,
            0x02 => Op::Push,
            0x03 => Op::PushShort,
            0x04 => Op::PushZero,
            0x05 => Op::Pop,
            0x06 => Op::Dup,
            0x07 => Op::Swap,
            0x10 => Op::LoadAbs,
            0x11 => Op::StoreAbs,
            0x12 => Op::LoadSpRel,
            0x13 => Op::StoreSpRel,
            0x20 => Op::Jmp,
            0x21 => Op::JmpIf,
            0x22 => Op::JmpIfZ,
            0x23 => Op::Call,
            0x24 => Op::CallAbs,
            0x25 => Op::Ret,
            0x30 => Op::Lt,
            0x31 => Op::Le,
            0x32 => Op::Gt,
            0x33 => Op::Ge,
            0x34 => Op::Eq,
            0x35 => Op::Ne,
            0x40 => Op::Add,
            0x41 => Op::Sub,
            0x42 => Op::Mul,
            0x43 => Op::MulFx,
            0x44 => Op::Div,
            0x45 => Op::DivFx,
            0x46 => Op::Mod,
            0x47 => Op::And,
            0x48 => Op::Or,
            0x49 => Op::Xor,
            0x4a => Op::Shl,
            0x4b => Op::Shr,
            0x4c => Op::Neg,
            0x4d => Op::Not,
            0x50 => Op::Syscall,
            0x60 => Op::Abs,
            0x61 => Op::Min,
            0x62 => Op::Max,
            _ => return None,
        })
    }
}

/// Why `Vm::run` returned control to the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunExit {
    /// `Halt` executed (or an undefined opcode was hit — defined as halt-for-tick).
    Halted,
    /// Instruction budget exhausted; PC/stack persist, resumes next tick.
    OutOfBudget,
    /// `Syscall` executed: the host must pop args, act, push a result, and resume.
    Syscall { number: i32, argc: i32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VmError {
    ProgramTooLarge { len: usize },
    BadMagic,
    UnsupportedVersion { got: u16, supported: u16 },
}

impl std::fmt::Display for VmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VmError::ProgramTooLarge { len } => {
                write!(f, "program too large: {len} bytes (max {CODE_MAX})")
            }
            VmError::BadMagic => write!(f, "not an Idlin bytecode container (bad magic)"),
            VmError::UnsupportedVersion { got, supported } => {
                write!(
                    f,
                    "bytecode format v{got} not supported (server supports v{supported})"
                )
            }
        }
    }
}

impl std::error::Error for VmError {}

/// Wrap raw code in a versioned bytecode container.
pub fn wrap_program(code: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN + code.len());
    out.extend_from_slice(&BYTECODE_MAGIC);
    out.extend_from_slice(&BYTECODE_FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&[0, 0]); // reserved
    out.extend_from_slice(code);
    out
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Vm {
    mem: Box<[u8]>, // always MEM_SIZE
    pc: u16,
    sp: u16,
    /// Bytecode format version the loaded program declared.
    format_version: u16,
}

impl Vm {
    /// Load a versioned bytecode container (header + code). This is the only
    /// entry point for untrusted programs: outdated or foreign blobs are
    /// rejected here, before they ever execute.
    pub fn new(program: &[u8]) -> Result<Vm, VmError> {
        if program.len() < HEADER_LEN || program[..4] != BYTECODE_MAGIC {
            return Err(VmError::BadMagic);
        }
        let version = u16::from_le_bytes([program[4], program[5]]);
        if version != BYTECODE_FORMAT_VERSION {
            return Err(VmError::UnsupportedVersion {
                got: version,
                supported: BYTECODE_FORMAT_VERSION,
            });
        }
        let mut vm = Vm::from_code(&program[HEADER_LEN..])?;
        vm.format_version = version;
        Ok(vm)
    }

    /// Load bare code with no container header (tests, trusted host code).
    pub fn from_code(code: &[u8]) -> Result<Vm, VmError> {
        if code.len() > CODE_MAX {
            return Err(VmError::ProgramTooLarge { len: code.len() });
        }
        let mut mem = vec![0u8; MEM_SIZE].into_boxed_slice();
        mem[..code.len()].copy_from_slice(code);
        Ok(Vm {
            mem,
            pc: 0,
            sp: STACK_BASE,
            format_version: BYTECODE_FORMAT_VERSION,
        })
    }

    pub fn format_version(&self) -> u16 {
        self.format_version
    }

    pub fn pc(&self) -> u16 {
        self.pc
    }

    pub fn sp(&self) -> u16 {
        self.sp
    }

    /// Host-side write of the parameter block (refreshed every tick).
    pub fn write_param_block(&mut self, block: &[u8]) {
        let len = block.len().min(PARAM_BLOCK_LEN);
        for (i, &b) in block[..len].iter().enumerate() {
            self.store_u8(PARAM_BLOCK_ADDR.wrapping_add(i as u16), b);
        }
    }

    /// Host-side snapshot of the persistent block (taken before teardown).
    pub fn read_persist_block(&self) -> Vec<u8> {
        (0..PERSIST_BLOCK_LEN)
            .map(|i| self.load_u8(PERSIST_BLOCK_ADDR.wrapping_add(i as u16)))
            .collect()
    }

    /// Host-side restore of the persistent block into a fresh instance.
    pub fn write_persist_block(&mut self, block: &[u8]) {
        let len = block.len().min(PERSIST_BLOCK_LEN);
        for (i, &b) in block[..len].iter().enumerate() {
            self.store_u8(PERSIST_BLOCK_ADDR.wrapping_add(i as u16), b);
        }
    }

    /// Fold the full VM state into a hasher-friendly iterator of bytes.
    /// (Used by the sim's canonical state hash.)
    pub fn state_bytes(&self) -> impl Iterator<Item = u8> + '_ {
        self.pc
            .to_le_bytes()
            .into_iter()
            .chain(self.sp.to_le_bytes())
            .chain(self.mem.iter().copied())
    }

    // -- memory: all accesses wrap; out-of-bounds is impossible by construction --

    pub fn load_u8(&self, addr: u16) -> u8 {
        self.mem[addr as usize]
    }

    pub fn store_u8(&mut self, addr: u16, val: u8) {
        self.mem[addr as usize] = val;
    }

    pub fn load_u16(&self, addr: u16) -> u16 {
        u16::from_le_bytes([self.load_u8(addr), self.load_u8(addr.wrapping_add(1))])
    }

    pub fn store_u16(&mut self, addr: u16, val: u16) {
        for (i, b) in val.to_le_bytes().into_iter().enumerate() {
            self.store_u8(addr.wrapping_add(i as u16), b);
        }
    }

    pub fn load_u32(&self, addr: u16) -> u32 {
        u32::from_le_bytes([
            self.load_u8(addr),
            self.load_u8(addr.wrapping_add(1)),
            self.load_u8(addr.wrapping_add(2)),
            self.load_u8(addr.wrapping_add(3)),
        ])
    }

    pub fn store_u32(&mut self, addr: u16, val: u32) {
        for (i, b) in val.to_le_bytes().into_iter().enumerate() {
            self.store_u8(addr.wrapping_add(i as u16), b);
        }
    }

    pub fn load_i32(&self, addr: u16) -> i32 {
        self.load_u32(addr) as i32
    }

    pub fn store_i32(&mut self, addr: u16, val: i32) {
        self.store_u32(addr, val as u32);
    }

    // -- stack: grows upward from STACK_BASE; underflow/overflow wraps (defined) --

    pub fn push(&mut self, val: i32) {
        self.store_u32(self.sp, val as u32);
        self.sp = self.sp.wrapping_add(4);
    }

    pub fn pop(&mut self) -> i32 {
        self.sp = self.sp.wrapping_sub(4);
        self.load_u32(self.sp) as i32
    }

    // -- operand fetch --

    fn fetch_u8(&mut self) -> u8 {
        let b = self.load_u8(self.pc);
        self.pc = self.pc.wrapping_add(1);
        b
    }

    fn fetch_i16(&mut self) -> i16 {
        let lo = self.fetch_u8();
        let hi = self.fetch_u8();
        i16::from_le_bytes([lo, hi])
    }

    fn fetch_i32(&mut self) -> i32 {
        let b = [
            self.fetch_u8(),
            self.fetch_u8(),
            self.fetch_u8(),
            self.fetch_u8(),
        ];
        i32::from_le_bytes(b)
    }

    /// Execute instructions until `Halt`, a syscall, or the budget runs out,
    /// decrementing `budget` in place (so the host can charge syscalls and
    /// resume with the remainder). Never panics: every byte sequence and
    /// every stack state has defined behavior.
    pub fn run(&mut self, budget: &mut u32) -> RunExit {
        while *budget > 0 {
            *budget -= 1;
            let byte = self.fetch_u8();
            let Some(op) = Op::from_u8(byte) else {
                // Undefined opcode is defined behavior: halt for this tick.
                return RunExit::Halted;
            };
            match op {
                Op::Halt => return RunExit::Halted,
                Op::Nop => {}
                Op::Push => {
                    let v = self.fetch_i32();
                    self.push(v);
                }
                Op::PushShort => {
                    let v = self.fetch_i16();
                    self.push(v as i32);
                }
                Op::PushZero => self.push(0),
                Op::Pop => {
                    self.pop();
                }
                Op::Dup => {
                    let v = self.pop();
                    self.push(v);
                    self.push(v);
                }
                Op::Swap => {
                    let b = self.pop();
                    let a = self.pop();
                    self.push(b);
                    self.push(a);
                }
                Op::LoadAbs => {
                    let addr = self.pop() as u16;
                    let v = self.load_i32(addr);
                    self.push(v);
                }
                Op::StoreAbs => {
                    let addr = self.pop() as u16;
                    let val = self.pop();
                    self.store_i32(addr, val);
                }
                Op::LoadSpRel => {
                    let off = self.fetch_i16();
                    let addr = self.sp.wrapping_add_signed(off);
                    let v = self.load_i32(addr);
                    self.push(v);
                }
                Op::StoreSpRel => {
                    let off = self.fetch_i16();
                    let val = self.pop();
                    let addr = self.sp.wrapping_add_signed(off);
                    self.store_i32(addr, val);
                }
                Op::Jmp => {
                    let off = self.fetch_i16();
                    self.pc = self.pc.wrapping_add_signed(off);
                }
                Op::JmpIf => {
                    let off = self.fetch_i16();
                    if self.pop() != 0 {
                        self.pc = self.pc.wrapping_add_signed(off);
                    }
                }
                Op::JmpIfZ => {
                    let off = self.fetch_i16();
                    if self.pop() == 0 {
                        self.pc = self.pc.wrapping_add_signed(off);
                    }
                }
                Op::Call => {
                    let off = self.fetch_i16();
                    self.push(self.pc as i32);
                    self.pc = self.pc.wrapping_add_signed(off);
                }
                Op::CallAbs => {
                    let target = self.pop() as u16;
                    self.push(self.pc as i32);
                    self.pc = target;
                }
                Op::Ret => {
                    self.pc = self.pop() as u16;
                }
                Op::Lt | Op::Le | Op::Gt | Op::Ge | Op::Eq | Op::Ne => {
                    let b = self.pop();
                    let a = self.pop();
                    let r = match op {
                        Op::Lt => a < b,
                        Op::Le => a <= b,
                        Op::Gt => a > b,
                        Op::Ge => a >= b,
                        Op::Eq => a == b,
                        _ => a != b,
                    };
                    self.push(r as i32);
                }
                Op::Add
                | Op::Sub
                | Op::Mul
                | Op::MulFx
                | Op::Div
                | Op::DivFx
                | Op::Mod
                | Op::And
                | Op::Or
                | Op::Xor
                | Op::Shl
                | Op::Shr => {
                    let b = self.pop();
                    let a = self.pop();
                    let r = match op {
                        Op::Add => a.wrapping_add(b),
                        Op::Sub => a.wrapping_sub(b),
                        Op::Mul => a.wrapping_mul(b),
                        // Q16.16: low 32 bits of the widened product/quotient.
                        Op::MulFx => ((a as i64).wrapping_mul(b as i64) >> 16) as i32,
                        Op::Div => {
                            if b == 0 {
                                0
                            } else {
                                a.wrapping_div(b)
                            }
                        }
                        Op::DivFx => {
                            if b == 0 {
                                0
                            } else {
                                (((a as i64) << 16) / b as i64) as i32
                            }
                        }
                        Op::Mod => {
                            if b == 0 {
                                0
                            } else {
                                a.wrapping_rem(b)
                            }
                        }
                        Op::And => a & b,
                        Op::Or => a | b,
                        Op::Xor => a ^ b,
                        Op::Shl => a.wrapping_shl(b as u32 & 31),
                        _ => a.wrapping_shr(b as u32 & 31), // Shr, arithmetic
                    };
                    self.push(r);
                }
                Op::Neg => {
                    let a = self.pop();
                    self.push(a.wrapping_neg());
                }
                Op::Not => {
                    let a = self.pop();
                    self.push(!a);
                }
                Op::Abs => {
                    let a = self.pop();
                    // i32::MIN stays i32::MIN (wrapping) — defined, like Neg.
                    self.push(a.wrapping_abs());
                }
                Op::Min | Op::Max => {
                    let b = self.pop();
                    let a = self.pop();
                    self.push(if (op == Op::Min) == (a < b) { a } else { b });
                }
                Op::Syscall => {
                    let number = self.pop();
                    let argc = self.pop();
                    return RunExit::Syscall { number, argc };
                }
            }
        }
        RunExit::OutOfBudget
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Syscall numbers are a BINARY CONTRACT: deployed bot bytecode encodes
    /// them. Pin the values so an accidental edit to a const is caught here,
    /// not by a live bot silently calling the wrong host routine.
    #[test]
    fn syscall_numbers_are_pinned() {
        assert_eq!(SYS_DEBUG, 0);
        assert_eq!(SYS_SELF_STATUS, 1);
        assert_eq!(SYS_READ_ENTITIES, 2);
        assert_eq!(SYS_READ_INVENTORY, 5);
        assert_eq!(SYS_MOVE_TO, 6);
        assert_eq!(SYS_USE_SKILL, 7);
        assert_eq!(SYS_PICK_UP, 8);
        assert_eq!(SYS_EQUIP_BEST, 12);
        assert_eq!(SYS_SET_BUILD, 14);
        assert_eq!(SYS_RANDOM, 15);
        assert_eq!(SYS_MOVE_ITEM, 16);
        assert_eq!(SYS_DROP_ITEM, 17);
        assert_eq!(SYS_READ_SKILLS, 18);
        assert_eq!(SYS_SOCKET_GEM, 19);
        assert_eq!(SYS_COUNT_ENTITIES, 20);
        assert_eq!(SYS_LINE_OF_SIGHT, 21);
        assert_eq!(SYS_USE_SKILL_AT, 22);
        assert_eq!(SYS_USE_SKILL_DIR, 23);
        assert_eq!(SYS_READ_CURRENCY, 24);
        assert_eq!(SYS_USE_CURRENCY, 25);
        assert_eq!(SYS_SAY, 26);
        assert_eq!(SYS_READ_EXITS, 27);
        assert_eq!(SYS_USE_EXIT, 28);
        assert_eq!(SYS_USE_FLASK, 29);
        assert_eq!(SYS_SKILL_INFO, 30);
        assert_eq!(SYS_READ_ITEM_MODS, 31);
        assert_eq!(SYS_READ_EQUIPMENT, 32);
        assert_eq!(SYS_EQUIP, 33);
        assert_eq!(SYS_ITEM_SLOT, 34);
        assert_eq!(SYS_UNEQUIP, 35);
        assert_eq!(SYS_QUERY_CHARACTERS, 100);
        assert_eq!(SYS_POLL_EVENTS, 101);
        assert_eq!(SYS_NARRATE, 102);
        assert_eq!(SYS_DROP_LOOT, 103);
        assert_eq!(SYS_SPAWN_MONSTER, 104);
        assert_eq!(SYS_SET_EXIT, 106);
        assert_eq!(SYS_SET_GATE, 107);
        assert_eq!(SYS_SPAWN_ELITE, 108);
    }

    /// Run a program with a fresh VM and a generous budget; return the VM
    /// after it halts. Panics if it doesn't halt (tests use finite programs).
    fn exec(program: &[u8]) -> Vm {
        let mut vm = Vm::from_code(program).unwrap();
        let mut budget = 100_000;
        assert_eq!(vm.run(&mut budget), RunExit::Halted, "program must halt");
        vm
    }

    /// Execute `code` and assert the top of the stack afterwards.
    fn assert_tos(program: &[u8], expected: i32) {
        let mut vm = exec(program);
        assert_eq!(vm.pop(), expected);
    }

    fn push(v: i32) -> Vec<u8> {
        let mut b = vec![0x02];
        b.extend_from_slice(&v.to_le_bytes());
        b
    }

    /// Build `push a; push b; <op>; halt`.
    fn binop(a: i32, b: i32, op: u8) -> Vec<u8> {
        let mut p = push(a);
        p.extend(push(b));
        p.push(op);
        p.push(0x00);
        p
    }

    #[test]
    fn memory_wraps_at_end() {
        let mut vm = Vm::from_code(&[]).unwrap();
        vm.store_u32(0xFFFE, 0xAABBCCDD);
        assert_eq!(vm.load_u8(0xFFFE), 0xDD);
        assert_eq!(vm.load_u8(0xFFFF), 0xCC);
        assert_eq!(vm.load_u8(0x0000), 0xBB);
        assert_eq!(vm.load_u8(0x0001), 0xAA);
        assert_eq!(vm.load_u32(0xFFFE), 0xAABBCCDD);
    }

    #[test]
    fn stack_roundtrip_and_underflow_is_defined() {
        let mut vm = Vm::from_code(&[]).unwrap();
        vm.push(-42);
        vm.push(7);
        assert_eq!(vm.pop(), 7);
        assert_eq!(vm.pop(), -42);
        let _ = vm.pop(); // underflow wraps sp — defined, not a fault
        assert_eq!(vm.sp(), STACK_BASE.wrapping_sub(4));
    }

    #[test]
    fn push_variants() {
        assert_tos(&[0x02, 0xD2, 0x02, 0x96, 0x49, 0x00], 1234567890); // Push
        assert_tos(&[0x03, 0xFE, 0xFF, 0x00], -2); // PushShort sign-extends
        assert_tos(&[0x04, 0x00], 0); // PushZero
    }

    #[test]
    fn dup_swap_pop() {
        // push 1; push 2; swap; pop  -> leaves 2
        let mut p = push(1);
        p.extend(push(2));
        p.extend([0x07, 0x05, 0x00]);
        assert_tos(&p, 2);

        // push 9; dup; add -> 18
        let mut p = push(9);
        p.extend([0x06, 0x40, 0x00]);
        assert_tos(&p, 18);
    }

    #[test]
    fn alu_semantics() {
        assert_tos(&binop(5, 3, 0x40), 8); // Add
        assert_tos(&binop(5, 3, 0x41), 2); // Sub: a - b
        assert_tos(&binop(i32::MAX, 1, 0x40), i32::MIN); // wrapping add
        assert_tos(&binop(-7, 3, 0x44), -2); // Div truncates toward zero
        assert_tos(&binop(7, 0, 0x44), 0); // div by zero -> 0
        assert_tos(&binop(7, 0, 0x46), 0); // mod by zero -> 0
        assert_tos(&binop(i32::MIN, -1, 0x44), i32::MIN); // MIN/-1 wraps
        assert_tos(&binop(-7, 3, 0x46), -1); // Mod follows Rust rem
        assert_tos(&binop(0b1100, 0b1010, 0x47), 0b1000); // And
        assert_tos(&binop(0b1100, 0b1010, 0x48), 0b1110); // Or
        assert_tos(&binop(0b1100, 0b1010, 0x49), 0b0110); // Xor
        assert_tos(&binop(1, 4, 0x4a), 16); // Shl
        assert_tos(&binop(-16, 2, 0x4b), -4); // Shr is arithmetic
        assert_tos(&binop(1, 33, 0x4a), 2); // shift counts mask to 5 bits

        // MulFx: 2.5 * 4.0 = 10.0 in Q16.16
        assert_tos(&binop(0x2_8000, 0x4_0000, 0x43), 0xA_0000);
        // DivFx: 10.0 / 4.0 = 2.5
        assert_tos(&binop(0xA_0000, 0x4_0000, 0x45), 0x2_8000);
        assert_tos(&binop(0xA_0000, 0, 0x45), 0); // DivFx by zero -> 0

        // Neg / Not (unary)
        let mut p = push(5);
        p.extend([0x4c, 0x00]);
        assert_tos(&p, -5);
        let mut p = push(0);
        p.extend([0x4d, 0x00]);
        assert_tos(&p, -1);
    }

    #[test]
    fn extended_alu_abs_min_max() {
        let mut p = push(-7);
        p.extend([0x60, 0x00]); // abs
        assert_tos(&p, 7);
        let mut p = push(7);
        p.extend([0x60, 0x00]);
        assert_tos(&p, 7);
        let mut p = push(i32::MIN);
        p.extend([0x60, 0x00]); // wrapping: MIN stays MIN, defined
        assert_tos(&p, i32::MIN);

        assert_tos(&binop(3, -5, 0x61), -5); // min
        assert_tos(&binop(3, -5, 0x62), 3); // max
        assert_tos(&binop(4, 4, 0x61), 4);
        assert_tos(&binop(4, 4, 0x62), 4);
    }

    #[test]
    fn comparison_semantics() {
        assert_tos(&binop(2, 3, 0x30), 1); // 2 < 3
        assert_tos(&binop(3, 3, 0x30), 0);
        assert_tos(&binop(3, 3, 0x31), 1); // <=
        assert_tos(&binop(4, 3, 0x32), 1); // >
        assert_tos(&binop(3, 4, 0x33), 0); // >=
        assert_tos(&binop(3, 3, 0x34), 1); // ==
        assert_tos(&binop(3, 4, 0x35), 1); // !=
        assert_tos(&binop(-1, 1, 0x30), 1); // signed compare
    }

    #[test]
    fn absolute_load_store() {
        // push 0xBEEF(val); push 0xC000(addr); store; push 0xC000; load; halt
        let mut p = push(0xBEEF);
        p.extend(push(0xC000));
        p.push(0x11);
        p.extend(push(0xC000));
        p.extend([0x10, 0x00]);
        assert_tos(&p, 0xBEEF);
    }

    #[test]
    fn sp_relative_load_store() {
        // push 11; push 22; loadsp -8  -> copies the 11 (two words down)
        let mut p = push(11);
        p.extend(push(22));
        p.extend([0x12, 0xF8, 0xFF, 0x00]); // loadsp -8
        assert_tos(&p, 11);

        // push 11; push 22; push 99; storesp -8; pop -> stack now [99, 22] -> pop -> 99
        let mut p = push(11);
        p.extend(push(22));
        p.extend(push(99));
        p.extend([0x13, 0xF8, 0xFF]); // storesp -8 (after the pop, sp-8 = slot of 11)
        p.extend([0x05, 0x00]); // pop the 22, leaving 99 on top
        assert_tos(&p, 99);
    }

    #[test]
    fn jumps_and_calls() {
        // Forward jump over a poison push:
        // jmp +5; push 666; halt <- skipped ; push 1; halt
        let mut p = vec![0x20, 0x06, 0x00]; // jmp over push(666)+halt = 5+1 bytes
        p.extend(push(666));
        p.push(0x00);
        p.extend(push(1));
        p.push(0x00);
        assert_tos(&p, 1);

        // JmpIf taken / not taken
        // push 1; jmpif +5; push 666; halt; push 7; halt
        let mut p = push(1);
        p.extend([0x21, 0x06, 0x00]);
        p.extend(push(666));
        p.push(0x00);
        p.extend(push(7));
        p.push(0x00);
        assert_tos(&p, 7);

        // push 0; jmpifz +5 ... same shape
        let mut p = push(0);
        p.extend([0x22, 0x06, 0x00]);
        p.extend(push(666));
        p.push(0x00);
        p.extend(push(7));
        p.push(0x00);
        assert_tos(&p, 7);

        // call/ret: the callee pushes a value, so it must swap the return
        // address back to the top before ret.
        // Layout: 0: call(3B) -> ret addr 3, jumps to 4; 3: halt;
        //         4: push 42; 9: swap; 10: ret
        let mut p = vec![0x23, 0x01, 0x00, 0x00];
        p.extend(push(42));
        p.extend([0x07, 0x25]);
        let mut vm = Vm::from_code(&p).unwrap();
        let mut budget = 1000;
        assert_eq!(vm.run(&mut budget), RunExit::Halted);
        assert_eq!(vm.pop(), 42);
    }

    #[test]
    fn callabs_pushes_return_address() {
        // push 0x0010(target); callabs; ... target at 0x10: halt
        // After callabs the return address (7) is on the stack.
        let mut p = push(0x10);
        p.push(0x24);
        p.resize(0x10, 0x01); // pad with nops
        p.push(0x00); // halt at 0x10
        let mut vm = Vm::from_code(&p).unwrap();
        let mut budget = 1000;
        assert_eq!(vm.run(&mut budget), RunExit::Halted);
        assert_eq!(vm.pop(), 6); // pc after the callabs opcode
    }

    #[test]
    fn budget_decrements_and_resumes() {
        let mut vm = Vm::from_code(&[0x01; 32]).unwrap(); // nop sled
        let mut budget = 10;
        assert_eq!(vm.run(&mut budget), RunExit::OutOfBudget);
        assert_eq!(budget, 0);
        assert_eq!(vm.pc(), 10);
        let mut budget = 5;
        assert_eq!(vm.run(&mut budget), RunExit::OutOfBudget);
        assert_eq!(vm.pc(), 15); // resumed where it left off
    }

    #[test]
    fn syscall_yields_with_remaining_budget() {
        // pushz(argc=0), pushs 7(number), syscall, halt
        let p = [0x04, 0x03, 0x07, 0x00, 0x50, 0x00];
        let mut vm = Vm::from_code(&p).unwrap();
        let mut budget = 100;
        assert_eq!(vm.run(&mut budget), RunExit::Syscall { number: 7, argc: 0 });
        assert_eq!(budget, 97);
        // Host pushes a result and resumes.
        vm.push(123);
        assert_eq!(vm.run(&mut budget), RunExit::Halted);
        assert_eq!(vm.pop(), 123);
    }

    #[test]
    fn undefined_opcode_halts() {
        let mut vm = Vm::from_code(&[0xFF]).unwrap();
        let mut budget = 10;
        assert_eq!(vm.run(&mut budget), RunExit::Halted);
    }

    #[test]
    fn oversized_program_rejected() {
        let big = vec![0u8; CODE_MAX + 1];
        assert!(matches!(
            Vm::from_code(&big),
            Err(VmError::ProgramTooLarge { .. })
        ));
    }

    #[test]
    fn bytecode_container_versioning() {
        // A wrapped program loads and runs.
        let wrapped = wrap_program(&[0x04, 0x00]); // pushz; halt
        let mut vm = Vm::new(&wrapped).unwrap();
        assert_eq!(vm.format_version(), BYTECODE_FORMAT_VERSION);
        let mut budget = 10;
        assert_eq!(vm.run(&mut budget), RunExit::Halted);

        // Garbage and truncated blobs are rejected.
        assert!(matches!(Vm::new(b"nope"), Err(VmError::BadMagic)));
        assert!(matches!(Vm::new(&[]), Err(VmError::BadMagic)));

        // A future format version is rejected with both versions reported.
        let mut future = wrap_program(&[0x00]);
        future[4] = 0xFF;
        future[5] = 0x00;
        match Vm::new(&future) {
            Err(VmError::UnsupportedVersion { got, supported }) => {
                assert_eq!(got, 0xFF);
                assert_eq!(supported, BYTECODE_FORMAT_VERSION);
            }
            _ => panic!("expected UnsupportedVersion"),
        }
    }

    #[test]
    fn param_block_visible_to_bot_memory() {
        let mut vm = Vm::from_code(&[]).unwrap();
        vm.write_param_block(&[1, 2, 3, 4]);
        assert_eq!(vm.load_u32(PARAM_BLOCK_ADDR), 0x04030201);
    }
}
