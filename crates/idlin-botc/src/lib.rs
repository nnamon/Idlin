//! Bot toolchain: assembles bot source into Idlin VM bytecode, and ships the
//! built-in templates that chat-command players run.
//!
//! ## Assembly syntax
//! ```text
//! ; comment
//! .equ NAME 0x1234          ; named constant
//! label:                    ; label (own line or before an instruction)
//!     push NAME+8           ; imm32: number, label, or constant, +offset
//!     pushs -3              ; imm16, sign-extended at runtime
//!     loadsp -8             ; sp-relative, signed byte offset
//!     jmp label             ; flow ops take a label (rel16 computed)
//!     sys 2 3               ; macro: pushs argc; pushs number; syscall
//!     .word 1, 0xFF         ; raw 32-bit little-endian data
//! ```
//! Syscall ABI (matches idlin-vm): push args in reverse order (argN first),
//! then `sys <number> <argc>`; the host replaces them with one result word.

pub mod lang;
mod templates;

pub use lang::{CompileError, Resolver, compile, compile_with};
pub use templates::{TEMPLATE_GRINDER, template_grinder};

use idlin_vm::Op;
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AsmError {
    #[error("line {line}: unknown instruction `{mnemonic}`")]
    UnknownInstruction { line: usize, mnemonic: String },
    #[error("line {line}: bad operand `{operand}`: {reason}")]
    BadOperand {
        line: usize,
        operand: String,
        reason: String,
    },
    #[error("line {line}: expected {expected} operand(s), got {got}")]
    WrongArity {
        line: usize,
        expected: usize,
        got: usize,
    },
    #[error("line {line}: undefined symbol `{name}`")]
    UndefinedSymbol { line: usize, name: String },
    #[error("line {line}: duplicate symbol `{name}`")]
    DuplicateSymbol { line: usize, name: String },
    #[error("line {line}: jump to `{target}` out of rel16 range ({distance})")]
    JumpOutOfRange {
        line: usize,
        target: String,
        distance: i64,
    },
    #[error("line {line}: value {value} does not fit in {width}")]
    ValueOutOfRange {
        line: usize,
        value: i64,
        width: &'static str,
    },
    #[error("program too large: {len} bytes (max {max})")]
    ProgramTooLarge { len: usize, max: usize },
}

/// One parsed source statement (after label/equ extraction).
#[derive(Debug, Clone)]
enum Stmt {
    Instr {
        line: usize,
        mnemonic: String,
        operands: Vec<String>,
    },
    Word {
        line: usize,
        values: Vec<String>,
    },
}

impl Stmt {
    /// Encoded size in bytes — must be exact so pass 1 can place labels.
    fn size(&self) -> usize {
        match self {
            Stmt::Word { values, .. } => 4 * values.len(),
            Stmt::Instr { mnemonic, .. } => match mnemonic.as_str() {
                "push" => 5,
                "pushs" | "loadsp" | "storesp" | "jmp" | "jmpif" | "jmpifz" | "call" => 3,
                "sys" => 7, // pushs argc; pushs number; syscall
                _ => 1,
            },
        }
    }
}

pub fn assemble(source: &str) -> Result<Vec<u8>, AsmError> {
    let mut symbols: BTreeMap<String, i64> = BTreeMap::new();
    let mut stmts: Vec<Stmt> = Vec::new();

    // -- parse + pass 1: collect statements, define .equ symbols and labels --
    let mut offset = 0usize;
    for (idx, raw) in source.lines().enumerate() {
        let line = idx + 1;
        let mut text = raw;
        if let Some(p) = text.find(';') {
            text = &text[..p];
        }
        let mut text = text.trim();

        // Labels (possibly followed by an instruction on the same line).
        while let Some(colon) = text.find(':') {
            let (label, rest) = text.split_at(colon);
            let label = label.trim();
            if !is_ident(label) {
                return Err(AsmError::BadOperand {
                    line,
                    operand: label.to_string(),
                    reason: "invalid label name".into(),
                });
            }
            if symbols.insert(label.to_string(), offset as i64).is_some() {
                return Err(AsmError::DuplicateSymbol {
                    line,
                    name: label.to_string(),
                });
            }
            text = rest[1..].trim();
        }
        if text.is_empty() {
            continue;
        }

        let mut parts = text.split_whitespace();
        let head = parts.next().unwrap().to_ascii_lowercase();
        let rest: Vec<String> = text[head.len()..]
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        // Whitespace-separated operands also accepted (e.g. `sys 2 3`).
        let operands: Vec<String> = if rest.len() <= 1 {
            text.split_whitespace()
                .skip(1)
                .map(|s| s.trim_end_matches(',').to_string())
                .collect()
        } else {
            rest
        };

        match head.as_str() {
            ".equ" => {
                if operands.len() != 2 {
                    return Err(AsmError::WrongArity {
                        line,
                        expected: 2,
                        got: operands.len(),
                    });
                }
                if !is_ident(&operands[0]) {
                    return Err(AsmError::BadOperand {
                        line,
                        operand: operands[0].clone(),
                        reason: "invalid constant name".into(),
                    });
                }
                let value = parse_number(&operands[1]).ok_or_else(|| AsmError::BadOperand {
                    line,
                    operand: operands[1].clone(),
                    reason: "expected a number".into(),
                })?;
                if symbols.insert(operands[0].clone(), value).is_some() {
                    return Err(AsmError::DuplicateSymbol {
                        line,
                        name: operands[0].clone(),
                    });
                }
            }
            ".word" => {
                if operands.is_empty() {
                    return Err(AsmError::WrongArity {
                        line,
                        expected: 1,
                        got: 0,
                    });
                }
                let stmt = Stmt::Word {
                    line,
                    values: operands,
                };
                offset += stmt.size();
                stmts.push(stmt);
            }
            _ => {
                let stmt = Stmt::Instr {
                    line,
                    mnemonic: head,
                    operands,
                };
                expected_arity(&stmt)?; // validate mnemonic + arity early
                offset += stmt.size();
                stmts.push(stmt);
            }
        }
    }

    if offset > idlin_vm::CODE_MAX {
        return Err(AsmError::ProgramTooLarge {
            len: offset,
            max: idlin_vm::CODE_MAX,
        });
    }

    // -- pass 2: encode (raw code; the versioned container is added at the end) --
    let mut out: Vec<u8> = Vec::with_capacity(offset);
    for stmt in &stmts {
        match stmt {
            Stmt::Word { line, values } => {
                for v in values {
                    let value = resolve(v, &symbols, *line)?;
                    out.extend_from_slice(&(value as i32).to_le_bytes());
                }
            }
            Stmt::Instr {
                line,
                mnemonic,
                operands,
            } => {
                encode(&mut out, *line, mnemonic, operands, &symbols)?;
            }
        }
    }
    // Programs ship as versioned containers so the VM can reject outdated
    // bytecode at deploy time.
    Ok(idlin_vm::wrap_program(&out))
}

/// Validate mnemonic and operand count. Returns the expected arity.
fn expected_arity(stmt: &Stmt) -> Result<(), AsmError> {
    let Stmt::Instr {
        line,
        mnemonic,
        operands,
    } = stmt
    else {
        return Ok(());
    };
    let expected = match mnemonic.as_str() {
        "halt" | "nop" | "pushz" | "pop" | "dup" | "swap" | "load" | "store" | "callabs"
        | "ret" | "lt" | "le" | "gt" | "ge" | "eq" | "ne" | "add" | "sub" | "mul" | "mulfx"
        | "div" | "divfx" | "mod" | "and" | "or" | "xor" | "shl" | "shr" | "neg" | "not"
        | "abs" | "min" | "max" | "syscall" => 0,
        "push" | "pushs" | "loadsp" | "storesp" | "jmp" | "jmpif" | "jmpifz" | "call" => 1,
        "sys" => 2,
        _ => {
            return Err(AsmError::UnknownInstruction {
                line: *line,
                mnemonic: mnemonic.clone(),
            });
        }
    };
    if operands.len() != expected {
        return Err(AsmError::WrongArity {
            line: *line,
            expected,
            got: operands.len(),
        });
    }
    Ok(())
}

fn encode(
    out: &mut Vec<u8>,
    line: usize,
    mnemonic: &str,
    operands: &[String],
    symbols: &BTreeMap<String, i64>,
) -> Result<(), AsmError> {
    let simple = |op: Op| -> u8 { op as u8 };
    match mnemonic {
        "halt" => out.push(simple(Op::Halt)),
        "nop" => out.push(simple(Op::Nop)),
        "pushz" => out.push(simple(Op::PushZero)),
        "pop" => out.push(simple(Op::Pop)),
        "dup" => out.push(simple(Op::Dup)),
        "swap" => out.push(simple(Op::Swap)),
        "load" => out.push(simple(Op::LoadAbs)),
        "store" => out.push(simple(Op::StoreAbs)),
        "callabs" => out.push(simple(Op::CallAbs)),
        "ret" => out.push(simple(Op::Ret)),
        "lt" => out.push(simple(Op::Lt)),
        "le" => out.push(simple(Op::Le)),
        "gt" => out.push(simple(Op::Gt)),
        "ge" => out.push(simple(Op::Ge)),
        "eq" => out.push(simple(Op::Eq)),
        "ne" => out.push(simple(Op::Ne)),
        "add" => out.push(simple(Op::Add)),
        "sub" => out.push(simple(Op::Sub)),
        "mul" => out.push(simple(Op::Mul)),
        "mulfx" => out.push(simple(Op::MulFx)),
        "div" => out.push(simple(Op::Div)),
        "divfx" => out.push(simple(Op::DivFx)),
        "mod" => out.push(simple(Op::Mod)),
        "and" => out.push(simple(Op::And)),
        "or" => out.push(simple(Op::Or)),
        "xor" => out.push(simple(Op::Xor)),
        "shl" => out.push(simple(Op::Shl)),
        "shr" => out.push(simple(Op::Shr)),
        "neg" => out.push(simple(Op::Neg)),
        "not" => out.push(simple(Op::Not)),
        "abs" => out.push(simple(Op::Abs)),
        "min" => out.push(simple(Op::Min)),
        "max" => out.push(simple(Op::Max)),
        "syscall" => out.push(simple(Op::Syscall)),
        "push" => {
            let v = resolve(&operands[0], symbols, line)?;
            let v = i32::try_from(v).map_err(|_| AsmError::ValueOutOfRange {
                line,
                value: v,
                width: "imm32",
            })?;
            out.push(simple(Op::Push));
            out.extend_from_slice(&v.to_le_bytes());
        }
        "pushs" => {
            let v = resolve(&operands[0], symbols, line)?;
            let v = i16::try_from(v).map_err(|_| AsmError::ValueOutOfRange {
                line,
                value: v,
                width: "imm16",
            })?;
            out.push(simple(Op::PushShort));
            out.extend_from_slice(&v.to_le_bytes());
        }
        "loadsp" | "storesp" => {
            let v = resolve(&operands[0], symbols, line)?;
            let v = i16::try_from(v).map_err(|_| AsmError::ValueOutOfRange {
                line,
                value: v,
                width: "off16",
            })?;
            out.push(simple(if mnemonic == "loadsp" {
                Op::LoadSpRel
            } else {
                Op::StoreSpRel
            }));
            out.extend_from_slice(&v.to_le_bytes());
        }
        "jmp" | "jmpif" | "jmpifz" | "call" => {
            let op = match mnemonic {
                "jmp" => Op::Jmp,
                "jmpif" => Op::JmpIf,
                "jmpifz" => Op::JmpIfZ,
                _ => Op::Call,
            };
            let target = resolve(&operands[0], symbols, line)?;
            // rel16 is relative to the pc after the 2-byte operand.
            let after = out.len() as i64 + 3;
            let distance = target - after;
            let off = i16::try_from(distance).map_err(|_| AsmError::JumpOutOfRange {
                line,
                target: operands[0].clone(),
                distance,
            })?;
            out.push(simple(op));
            out.extend_from_slice(&off.to_le_bytes());
        }
        "sys" => {
            // Macro: pushs argc; pushs number; syscall.
            let number = resolve(&operands[0], symbols, line)?;
            let argc = resolve(&operands[1], symbols, line)?;
            for v in [argc, number] {
                let v = i16::try_from(v).map_err(|_| AsmError::ValueOutOfRange {
                    line,
                    value: v,
                    width: "imm16",
                })?;
                out.push(simple(Op::PushShort));
                out.extend_from_slice(&v.to_le_bytes());
            }
            out.push(simple(Op::Syscall));
        }
        _ => unreachable!("validated in pass 1"),
    }
    Ok(())
}

/// Resolve an operand: `NUMBER`, `SYMBOL`, or `SYMBOL+NUMBER` / `SYMBOL-NUMBER`.
fn resolve(operand: &str, symbols: &BTreeMap<String, i64>, line: usize) -> Result<i64, AsmError> {
    if let Some(v) = parse_number(operand) {
        return Ok(v);
    }
    let (name, offset) = match operand.rfind(['+', '-']) {
        // Careful: a leading '-' is a negative literal, handled above.
        Some(p) if p > 0 => {
            let (name, off_str) = operand.split_at(p);
            let off = parse_number(off_str).ok_or_else(|| AsmError::BadOperand {
                line,
                operand: operand.to_string(),
                reason: "bad offset".into(),
            })?;
            (name.trim(), off)
        }
        _ => (operand, 0),
    };
    let base = symbols
        .get(name)
        .copied()
        .ok_or_else(|| AsmError::UndefinedSymbol {
            line,
            name: name.to_string(),
        })?;
    Ok(base + offset)
}

fn parse_number(s: &str) -> Option<i64> {
    let s = s.trim();
    let (neg, s) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let v = if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        i64::from_str_radix(hex, 16).ok()?
    } else if let Some(plus) = s.strip_prefix('+') {
        plus.parse::<i64>().ok()?
    } else {
        s.parse::<i64>().ok()?
    };
    Some(if neg { -v } else { v })
}

fn is_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use idlin_vm::{RunExit, Vm};

    fn run_to_halt(program: &[u8]) -> Vm {
        let mut vm = Vm::new(program).expect("assembled programs carry a valid header");
        let mut budget = 100_000;
        assert_eq!(vm.run(&mut budget), RunExit::Halted);
        vm
    }

    #[test]
    fn assembles_arithmetic() {
        let prog = assemble("push 5\npush 3\nadd\nhalt\n").unwrap();
        let mut vm = run_to_halt(&prog);
        assert_eq!(vm.pop(), 8);
    }

    #[test]
    fn equ_labels_and_expressions() {
        let src = r#"
            .equ BASE 0xC000
            push 77
            push BASE+4
            store              ; mem[0xC004] = 77
            push BASE+4
            load
            halt
        "#;
        let mut vm = run_to_halt(&assemble(src).unwrap());
        assert_eq!(vm.pop(), 77);
    }

    #[test]
    fn loops_with_labels() {
        // Sum 1..=10 with a countdown loop.
        let src = r#"
            .equ ACC 0xC000
            pushs 10           ; counter
        loop:
            dup                ; counter counter
            push ACC
            load
            add                ; counter acc+counter
            push ACC
            store
            pushs -1
            add                ; counter-1
            dup
            jmpif loop
            pop
            push ACC
            load
            halt
        "#;
        let mut vm = run_to_halt(&assemble(src).unwrap());
        assert_eq!(vm.pop(), 55);
    }

    #[test]
    fn sys_macro_yields_syscall() {
        let src = r#"
            pushs 9            ; arg1
            sys 2 1            ; syscall number 2, argc 1
            halt
        "#;
        let prog = assemble(src).unwrap();
        let mut vm = Vm::new(&prog).unwrap();
        let mut budget = 1000;
        assert_eq!(vm.run(&mut budget), RunExit::Syscall { number: 2, argc: 1 });
        assert_eq!(vm.pop(), 9); // host pops arg1
    }

    #[test]
    fn call_ret_roundtrip() {
        let src = r#"
            call double5
            halt
        double5:
            ; stack: retaddr — compute 5*2 then return with result under control
            pushs 5
            pushs 2
            mul                ; retaddr result
            swap               ; result retaddr
            ret
        "#;
        let mut vm = run_to_halt(&assemble(src).unwrap());
        assert_eq!(vm.pop(), 10);
    }

    #[test]
    fn forward_and_backward_jumps() {
        let src = r#"
            jmp start
        dead:
            push 666
            halt
        start:
            pushz
            jmpifz good
            jmp dead
        good:
            pushs 1
            halt
        "#;
        let mut vm = run_to_halt(&assemble(src).unwrap());
        assert_eq!(vm.pop(), 1);
    }

    #[test]
    fn word_directive_and_label_address() {
        let src = r#"
            jmp code
        data:
            .word 1234, 0x5678
        code:
            push data+4
            load
            halt
        "#;
        let mut vm = run_to_halt(&assemble(src).unwrap());
        assert_eq!(vm.pop(), 0x5678);
    }

    #[test]
    fn errors_carry_line_numbers() {
        assert_eq!(
            assemble("nop\nbogus_op\n"),
            Err(AsmError::UnknownInstruction {
                line: 2,
                mnemonic: "bogus_op".into()
            })
        );
        assert_eq!(
            assemble("push nowhere\n"),
            Err(AsmError::UndefinedSymbol {
                line: 1,
                name: "nowhere".into()
            })
        );
        assert!(matches!(
            assemble("a:\na:\n"),
            Err(AsmError::DuplicateSymbol { line: 2, .. })
        ));
        assert!(matches!(
            assemble("pushs 99999\n"),
            Err(AsmError::ValueOutOfRange { line: 1, .. })
        ));
    }

    #[test]
    fn grinder_template_assembles() {
        let prog = template_grinder().expect("grinder template must assemble");
        assert!(!prog.is_empty());
        assert!(prog.len() <= idlin_vm::CODE_MAX);
    }
}
