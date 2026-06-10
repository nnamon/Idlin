//! The Idlin bot VM: a stack machine with 32-bit signed words, a flat 64 KiB
//! wrapping memory, and a per-tick instruction budget. Untrusted bytecode runs
//! here; every reachable state must be defined and non-fatal, and execution
//! must be bit-exact across platforms (no floats, no host time, no host RNG).
//!
//! Phase 0 ships the machine model (memory, stack, budget, exits) with only
//! `Halt`/`Nop`/`Syscall` wired into the dispatch loop; the full instruction
//! set lands in Phase 1 together with conformance tests.

#![forbid(unsafe_code)]
#![deny(
    clippy::float_arithmetic,
    clippy::disallowed_types,
    clippy::disallowed_methods
)]

pub const MEM_SIZE: usize = 0x1_0000;
/// Code is loaded at 0x0000 and may occupy at most the lower half of memory.
pub const CODE_MAX: usize = 0x8000;
/// The stack grows upward from here.
pub const STACK_BASE: u16 = 0x8000;
/// Host-written parameter block (the chat-command → bot channel).
pub const PARAM_BLOCK_ADDR: u16 = 0xF000;
pub const PARAM_BLOCK_LEN: usize = 0x100;
/// Default per-tick instruction budget.
pub const DEFAULT_TICK_BUDGET: u32 = 5_000;

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
    // Memory
    LoadAbs = 0x10,
    StoreAbs = 0x11,
    LoadSpRel = 0x12,
    StoreSpRel = 0x13,
    // Flow
    Jmp = 0x20,    // + rel16
    JmpIf = 0x21,  // + rel16
    JmpIfZ = 0x22, // + rel16
    Call = 0x23,   // + rel16
    CallAbs = 0x24,
    Ret = 0x25,
    // Comparisons (push 0/1)
    Lt = 0x30,
    Le = 0x31,
    Gt = 0x32,
    Ge = 0x33,
    Eq = 0x34,
    Ne = 0x35,
    // ALU
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
    Not = 0x4d,
    // World interface
    Syscall = 0x50,
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
}

pub struct Vm {
    mem: Box<[u8]>, // always MEM_SIZE
    pc: u16,
    sp: u16,
}

impl Vm {
    pub fn new(program: &[u8]) -> Result<Vm, VmError> {
        if program.len() > CODE_MAX {
            return Err(VmError::ProgramTooLarge { len: program.len() });
        }
        let mut mem = vec![0u8; MEM_SIZE].into_boxed_slice();
        mem[..program.len()].copy_from_slice(program);
        Ok(Vm {
            mem,
            pc: 0,
            sp: STACK_BASE,
        })
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

    // -- memory: all accesses wrap; out-of-bounds is impossible by construction --

    pub fn load_u8(&self, addr: u16) -> u8 {
        self.mem[addr as usize]
    }

    pub fn store_u8(&mut self, addr: u16, val: u8) {
        self.mem[addr as usize] = val;
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

    // -- stack: grows upward from STACK_BASE; underflow/overflow wraps (defined) --

    pub fn push(&mut self, val: i32) {
        self.store_u32(self.sp, val as u32);
        self.sp = self.sp.wrapping_add(4);
    }

    pub fn pop(&mut self) -> i32 {
        self.sp = self.sp.wrapping_sub(4);
        self.load_u32(self.sp) as i32
    }

    /// Execute up to `budget` instructions. Never panics, never fails: every
    /// input byte sequence has defined behavior.
    pub fn run(&mut self, budget: u32) -> RunExit {
        for _ in 0..budget {
            let byte = self.load_u8(self.pc);
            self.pc = self.pc.wrapping_add(1);
            match Op::from_u8(byte) {
                // Undefined opcode is defined behavior: halt for this tick.
                Some(Op::Halt) | None => return RunExit::Halted,
                Some(Op::Nop) => {}
                Some(Op::Syscall) => {
                    let number = self.pop();
                    let argc = self.pop();
                    return RunExit::Syscall { number, argc };
                }
                // Remaining instruction set lands in Phase 1 (with conformance
                // tests). Until then they execute as Nop so bytecode containing
                // them is still budget-bounded.
                Some(_) => {}
            }
        }
        RunExit::OutOfBudget
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_wraps_at_end() {
        let mut vm = Vm::new(&[]).unwrap();
        vm.store_u32(0xFFFE, 0xAABBCCDD);
        assert_eq!(vm.load_u8(0xFFFE), 0xDD);
        assert_eq!(vm.load_u8(0xFFFF), 0xCC);
        assert_eq!(vm.load_u8(0x0000), 0xBB);
        assert_eq!(vm.load_u8(0x0001), 0xAA);
        assert_eq!(vm.load_u32(0xFFFE), 0xAABBCCDD);
    }

    #[test]
    fn stack_roundtrip_and_underflow_is_defined() {
        let mut vm = Vm::new(&[]).unwrap();
        vm.push(-42);
        vm.push(7);
        assert_eq!(vm.pop(), 7);
        assert_eq!(vm.pop(), -42);
        // Underflow wraps the stack pointer — defined, not a fault.
        let _ = vm.pop();
        assert_eq!(vm.sp(), STACK_BASE.wrapping_sub(4));
    }

    #[test]
    fn halt_and_budget_exhaustion() {
        // 0x00 = Halt at pc 0.
        let mut vm = Vm::new(&[0x00]).unwrap();
        assert_eq!(vm.run(100), RunExit::Halted);

        // A Nop sled never halts: budget bounds it.
        let mut vm = Vm::new(&[0x01; 16]).unwrap();
        assert_eq!(vm.run(8), RunExit::OutOfBudget);
        assert_eq!(vm.pc(), 8); // resumes where it left off
    }

    #[test]
    fn empty_program_halts_immediately() {
        // Zeroed memory decodes as Halt.
        let mut vm = Vm::new(&[]).unwrap();
        assert_eq!(vm.run(DEFAULT_TICK_BUDGET), RunExit::Halted);
    }

    #[test]
    fn syscall_yields_to_host() {
        // PushZero (→ argc slot), PushZero (→ number slot), Syscall.
        let mut vm = Vm::new(&[0x04, 0x04, 0x50]).unwrap();
        assert_eq!(vm.run(100), RunExit::Syscall { number: 0, argc: 0 });
    }

    #[test]
    fn oversized_program_rejected() {
        let big = vec![0u8; CODE_MAX + 1];
        assert!(matches!(
            Vm::new(&big),
            Err(VmError::ProgramTooLarge { .. })
        ));
    }

    #[test]
    fn param_block_visible_to_bot_memory() {
        let mut vm = Vm::new(&[]).unwrap();
        vm.write_param_block(&[1, 2, 3, 4]);
        assert_eq!(vm.load_u32(PARAM_BLOCK_ADDR), 0x04030201);
    }
}
