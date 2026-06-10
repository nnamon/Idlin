//! Bytecode generation for the `.bot` language.
//!
//! Memory model: every variable — global, parameter, or local — is a
//! statically allocated address from 0xC000 upward. No frames, no recursion;
//! a `call` costs one stored word per argument plus the jump. Program layout:
//!
//! ```text
//! [global initializers]      runs once per deploy (memory starts zeroed)
//! loop: call main; halt; jmp loop      one main() invocation per tick
//! [function bodies]
//! ```

use super::CompileError;
use super::ast::*;
use idlin_vm::Op;
use std::collections::BTreeMap;

const GLOBALS_BASE: u32 = 0xC000;
/// Globals must stay clear of the param block at 0xF000.
const GLOBALS_END: u32 = 0xF000;

/// Syscall builtins: (name, syscall number, arity).
pub const BUILTINS: &[(&str, i32, usize)] = &[
    ("debug", 0, 1),
    ("self_status", 1, 1),
    ("read_entities", 2, 3),
    ("read_inventory", 5, 2),
    ("move_to", 6, 2),
    ("use_skill", 7, 4),
    ("pick_up", 8, 1),
    ("equip_best", 12, 0),
    ("random", 15, 0),
    ("move_item", 16, 3),
    ("drop_item", 17, 1),
    ("read_skills", 18, 2),
    ("socket_gem", 19, 2),
];

/// SetBuild is emitted by the compiler from the `build [...]` declaration,
/// never called directly from source.
const SYS_SET_BUILD: i64 = 14;

#[derive(Clone, Copy)]
struct VarSlot {
    addr: u32,
    is_array: bool,
}

struct FnInfo {
    addr: Option<u32>,
    params: Vec<u32>, // statically allocated parameter addresses
}

struct LoopCtx {
    start: usize,
    break_fixups: Vec<usize>,
}

pub fn generate(program: &Program) -> Result<Vec<u8>, CompileError> {
    let mut g = Gen {
        out: Vec::new(),
        consts: BTreeMap::new(),
        globals: BTreeMap::new(),
        locals: BTreeMap::new(),
        next_global: GLOBALS_BASE,
        fns: BTreeMap::new(),
        call_fixups: Vec::new(),
        loops: Vec::new(),
    };
    g.program(program)?;
    Ok(g.out)
}

struct Gen {
    out: Vec<u8>,
    consts: BTreeMap<String, i64>,
    globals: BTreeMap<String, VarSlot>,
    /// Current function's params + locals (statically allocated).
    locals: BTreeMap<String, VarSlot>,
    next_global: u32,
    fns: BTreeMap<String, FnInfo>,
    /// (operand position, callee name) — patched once all fns are placed.
    call_fixups: Vec<(usize, String, usize)>,
    loops: Vec<LoopCtx>,
}

impl Gen {
    fn program(&mut self, program: &Program) -> Result<(), CompileError> {
        for (name, value, line) in &program.consts {
            if self.consts.insert(name.clone(), *value).is_some() {
                return Err(CompileError::new(
                    *line,
                    format!("duplicate const `{name}`"),
                ));
            }
        }
        for (name, len, _, line) in &program.globals {
            let slot = self.alloc(*len, *line)?;
            let slot = VarSlot {
                addr: slot,
                is_array: *len > 1,
            };
            if self.globals.insert(name.clone(), slot).is_some() {
                return Err(CompileError::new(
                    *line,
                    format!("duplicate global `{name}`"),
                ));
            }
        }
        // Register functions (params get their addresses now).
        for f in &program.fns {
            let mut params = Vec::new();
            for _ in &f.params {
                params.push(self.alloc(1, f.line)?);
            }
            if self
                .fns
                .insert(f.name.clone(), FnInfo { addr: None, params })
                .is_some()
            {
                return Err(CompileError::new(
                    f.line,
                    format!("duplicate function `{}`", f.name),
                ));
            }
        }
        if !self.fns.contains_key("main") {
            return Err(CompileError::new(0, "a bot needs `fn main()`"));
        }

        // Declared build plan: the ref table lives at the end of the code
        // (patched below); SetBuild(addr, count) runs once per deploy.
        let mut build_table_fix: Option<usize> = None;
        if !program.build.is_empty() {
            self.push_value(program.build.len() as i64); // arg2: count
            self.op(Op::Push); // arg1: table address (patched)
            build_table_fix = Some(self.out.len());
            self.out.extend_from_slice(&0i32.to_le_bytes());
            self.push_value(2);
            self.push_value(SYS_SET_BUILD);
            self.op(Op::Syscall);
            self.op(Op::Pop);
        }

        // Global initializers (run once per deploy: memory starts zeroed,
        // and the loop below never returns here).
        for (name, _, init, line) in &program.globals {
            if let Some(init) = init {
                self.expr(init)?;
                let slot = self.globals[name];
                self.push_value(slot.addr as i64);
                self.op(Op::StoreAbs);
                let _ = line;
            }
        }

        // The tick loop.
        let loop_start = self.out.len();
        self.op(Op::Call);
        let main_fix = self.out.len();
        self.imm16(0);
        self.call_fixups.push((main_fix, "main".into(), 0));
        self.op(Op::Pop); // discard main's return value
        self.op(Op::Halt);
        self.op(Op::Jmp);
        let back = (loop_start as i64) - (self.out.len() as i64 + 2);
        self.imm16(back as i16);

        // Function bodies.
        for f in &program.fns {
            let info = self.fns.get_mut(&f.name).unwrap();
            info.addr = Some(self.out.len() as u32);
            self.locals.clear();
            let param_addrs = self.fns[&f.name].params.clone();
            for (p, addr) in f.params.iter().zip(param_addrs) {
                self.locals.insert(
                    p.clone(),
                    VarSlot {
                        addr,
                        is_array: false,
                    },
                );
            }
            self.body(&f.body)?;
            // Implicit `return 0`.
            self.op(Op::PushZero);
            self.op(Op::Swap);
            self.op(Op::Ret);
        }

        // The build-plan ref table (data appended after all code).
        if let Some(fix) = build_table_fix {
            let table_addr = self.out.len() as i32;
            self.out[fix..fix + 4].copy_from_slice(&table_addr.to_le_bytes());
            for (id, _) in &program.build {
                let r = crate::node_ref(id);
                self.out.extend_from_slice(&r.to_le_bytes());
            }
        }

        // Patch calls.
        for (pos, name, line) in std::mem::take(&mut self.call_fixups) {
            let target = self
                .fns
                .get(&name)
                .and_then(|f| f.addr)
                .ok_or_else(|| CompileError::new(line, format!("unknown function `{name}`")))?;
            let rel = target as i64 - (pos as i64 + 2);
            let rel = i16::try_from(rel)
                .map_err(|_| CompileError::new(line, "program too large (call out of range)"))?;
            self.out[pos..pos + 2].copy_from_slice(&rel.to_le_bytes());
        }

        if self.out.len() > idlin_vm::CODE_MAX {
            return Err(CompileError::new(
                0,
                format!(
                    "program too large: {} bytes (max {})",
                    self.out.len(),
                    idlin_vm::CODE_MAX
                ),
            ));
        }
        Ok(())
    }

    fn alloc(&mut self, words: u32, line: usize) -> Result<u32, CompileError> {
        let addr = self.next_global;
        self.next_global += 4 * words;
        if self.next_global > GLOBALS_END {
            return Err(CompileError::new(
                line,
                "out of variable memory (0xC000-0xF000)",
            ));
        }
        Ok(addr)
    }

    // -- emission helpers --

    fn op(&mut self, op: Op) {
        self.out.push(op as u8);
    }

    fn imm16(&mut self, v: i16) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn push_value(&mut self, v: i64) {
        let v = v as i32;
        if v == 0 {
            self.op(Op::PushZero);
        } else if let Ok(short) = i16::try_from(v) {
            self.op(Op::PushShort);
            self.imm16(short);
        } else {
            self.op(Op::Push);
            self.out.extend_from_slice(&v.to_le_bytes());
        }
    }

    /// Emit a jump with a placeholder offset; returns the operand position.
    fn jump(&mut self, op: Op) -> usize {
        self.op(op);
        let pos = self.out.len();
        self.imm16(0);
        pos
    }

    /// Point a previously emitted jump at the current position.
    fn patch(&mut self, operand_pos: usize) {
        let rel = (self.out.len() as i64) - (operand_pos as i64 + 2);
        self.out[operand_pos..operand_pos + 2].copy_from_slice(&(rel as i16).to_le_bytes());
    }

    fn lookup(&self, name: &str) -> Option<VarSlot> {
        self.locals
            .get(name)
            .or_else(|| self.globals.get(name))
            .copied()
    }

    // -- statements --

    fn body(&mut self, stmts: &[Stmt]) -> Result<(), CompileError> {
        for stmt in stmts {
            self.stmt(stmt)?;
        }
        Ok(())
    }

    fn stmt(&mut self, stmt: &Stmt) -> Result<(), CompileError> {
        match stmt {
            Stmt::VarDecl {
                name,
                len,
                init,
                line,
            } => {
                let words = len.unwrap_or(1);
                let addr = self.alloc(words, *line)?;
                self.locals.insert(
                    name.clone(),
                    VarSlot {
                        addr,
                        is_array: words > 1,
                    },
                );
                if let Some(init) = init {
                    self.expr(init)?;
                    self.push_value(addr as i64);
                    self.op(Op::StoreAbs);
                }
                Ok(())
            }
            Stmt::Assign { name, value, line } => {
                let slot = self.lookup(name).ok_or_else(|| {
                    CompileError::new(*line, format!("unknown variable `{name}`"))
                })?;
                if slot.is_array {
                    return Err(CompileError::new(
                        *line,
                        format!("`{name}` is an array; assign to `{name}[i]`"),
                    ));
                }
                self.expr(value)?;
                self.push_value(slot.addr as i64);
                self.op(Op::StoreAbs);
                Ok(())
            }
            Stmt::MemAssign { addr, value, .. } => {
                self.expr(value)?;
                self.expr(addr)?;
                self.op(Op::StoreAbs);
                Ok(())
            }
            Stmt::IndexAssign {
                name,
                index,
                value,
                line,
            } => {
                self.expr(value)?;
                self.index_addr(name, index, *line)?;
                self.op(Op::StoreAbs);
                Ok(())
            }
            Stmt::If {
                cond,
                then_body,
                else_body,
                ..
            } => {
                self.expr(cond)?;
                let to_else = self.jump(Op::JmpIfZ);
                self.body(then_body)?;
                if else_body.is_empty() {
                    self.patch(to_else);
                } else {
                    let to_end = self.jump(Op::Jmp);
                    self.patch(to_else);
                    self.body(else_body)?;
                    self.patch(to_end);
                }
                Ok(())
            }
            Stmt::While { cond, body, .. } => {
                let start = self.out.len();
                self.expr(cond)?;
                let to_end = self.jump(Op::JmpIfZ);
                self.loops.push(LoopCtx {
                    start,
                    break_fixups: vec![to_end],
                });
                self.body(body)?;
                let ctx = self.loops.pop().unwrap();
                let back = self.jump(Op::Jmp);
                let rel = (ctx.start as i64) - (back as i64 + 2);
                self.out[back..back + 2].copy_from_slice(&(rel as i16).to_le_bytes());
                for fix in ctx.break_fixups {
                    self.patch(fix);
                }
                Ok(())
            }
            Stmt::Break { line } => {
                let fix = self.jump(Op::Jmp);
                match self.loops.last_mut() {
                    Some(ctx) => {
                        ctx.break_fixups.push(fix);
                        Ok(())
                    }
                    None => Err(CompileError::new(*line, "`break` outside a loop")),
                }
            }
            Stmt::Continue { line } => {
                if self.loops.is_empty() {
                    return Err(CompileError::new(*line, "`continue` outside a loop"));
                }
                let start = self.loops.last().unwrap().start;
                let back = self.jump(Op::Jmp);
                let rel = (start as i64) - (back as i64 + 2);
                self.out[back..back + 2].copy_from_slice(&(rel as i16).to_le_bytes());
                Ok(())
            }
            Stmt::Return { value, .. } => {
                match value {
                    Some(v) => self.expr(v)?,
                    None => self.op(Op::PushZero),
                }
                self.op(Op::Swap);
                self.op(Op::Ret);
                Ok(())
            }
            Stmt::Expr { expr, .. } => {
                self.expr(expr)?;
                self.op(Op::Pop);
                Ok(())
            }
        }
    }

    /// Push the address of `name[index]` (word-indexed).
    fn index_addr(&mut self, name: &str, index: &Expr, line: usize) -> Result<(), CompileError> {
        let slot = self
            .lookup(name)
            .ok_or_else(|| CompileError::new(line, format!("unknown variable `{name}`")))?;
        if slot.is_array {
            self.push_value(slot.addr as i64);
        } else {
            // Indexing a scalar treats its VALUE as the base address.
            self.push_value(slot.addr as i64);
            self.op(Op::LoadAbs);
        }
        self.expr(index)?;
        self.push_value(2);
        self.op(Op::Shl);
        self.op(Op::Add);
        Ok(())
    }

    // -- expressions --

    fn expr(&mut self, expr: &Expr) -> Result<(), CompileError> {
        match expr {
            Expr::Num { value, .. } => {
                self.push_value(*value);
                Ok(())
            }
            Expr::Ident { name, line } => {
                if let Some(&value) = self.consts.get(name) {
                    self.push_value(value);
                    return Ok(());
                }
                let slot = self
                    .lookup(name)
                    .ok_or_else(|| CompileError::new(*line, format!("unknown name `{name}`")))?;
                self.push_value(slot.addr as i64);
                if !slot.is_array {
                    self.op(Op::LoadAbs);
                }
                Ok(())
            }
            Expr::Mem { addr, .. } => {
                self.expr(addr)?;
                self.op(Op::LoadAbs);
                Ok(())
            }
            Expr::Index { name, index, line } => {
                self.index_addr(name, index, *line)?;
                self.op(Op::LoadAbs);
                Ok(())
            }
            Expr::Unary { op, operand, .. } => {
                self.expr(operand)?;
                match op {
                    UnOp::Neg => self.op(Op::Neg),
                    UnOp::BitNot => self.op(Op::Not),
                    UnOp::Not => {
                        self.op(Op::PushZero);
                        self.op(Op::Eq);
                    }
                }
                Ok(())
            }
            Expr::Binary { op, lhs, rhs, .. } => {
                self.expr(lhs)?;
                if matches!(op, BinOp::LogicalAnd | BinOp::LogicalOr) {
                    self.op(Op::PushZero);
                    self.op(Op::Ne);
                }
                self.expr(rhs)?;
                if matches!(op, BinOp::LogicalAnd | BinOp::LogicalOr) {
                    self.op(Op::PushZero);
                    self.op(Op::Ne);
                }
                self.op(match op {
                    BinOp::Add => Op::Add,
                    BinOp::Sub => Op::Sub,
                    BinOp::Mul => Op::Mul,
                    BinOp::Div => Op::Div,
                    BinOp::Mod => Op::Mod,
                    BinOp::And | BinOp::LogicalAnd => Op::And,
                    BinOp::Or | BinOp::LogicalOr => Op::Or,
                    BinOp::Xor => Op::Xor,
                    BinOp::Shl => Op::Shl,
                    BinOp::Shr => Op::Shr,
                    BinOp::Lt => Op::Lt,
                    BinOp::Le => Op::Le,
                    BinOp::Gt => Op::Gt,
                    BinOp::Ge => Op::Ge,
                    BinOp::Eq => Op::Eq,
                    BinOp::Ne => Op::Ne,
                });
                Ok(())
            }
            Expr::Call { name, args, line } => self.call(name, args, *line),
        }
    }

    fn call(&mut self, name: &str, args: &[Expr], line: usize) -> Result<(), CompileError> {
        let arity_err = |want: usize| {
            CompileError::new(
                line,
                format!("`{name}` takes {want} argument(s), got {}", args.len()),
            )
        };

        // Zero-operand opcode builtins.
        let simple: Option<(Op, usize)> = match name {
            "halt" => Some((Op::Halt, 0)),
            "abs" => Some((Op::Abs, 1)),
            "min" => Some((Op::Min, 2)),
            "max" => Some((Op::Max, 2)),
            "mulfx" => Some((Op::MulFx, 2)),
            "divfx" => Some((Op::DivFx, 2)),
            _ => None,
        };
        if let Some((op, want)) = simple {
            if args.len() != want {
                return Err(arity_err(want));
            }
            for a in args {
                self.expr(a)?;
            }
            self.op(op);
            if op == Op::Halt {
                // halt() is a statement-shaped builtin; it still needs to
                // leave a value for the surrounding expression machinery.
                self.op(Op::PushZero);
            }
            Ok(())
        } else if let Some(&(_, num, want)) = BUILTINS.iter().find(|(n, _, _)| *n == name) {
            if args.len() != want {
                return Err(arity_err(want));
            }
            // Syscall ABI: args pushed in reverse, then argc, then number.
            for a in args.iter().rev() {
                self.expr(a)?;
            }
            self.push_value(want as i64);
            self.push_value(num as i64);
            self.op(Op::Syscall);
            Ok(())
        } else {
            // User function: store args into its static param slots, call.
            let info = self
                .fns
                .get(name)
                .ok_or_else(|| CompileError::new(line, format!("unknown function `{name}`")))?;
            let params = info.params.clone();
            if args.len() != params.len() {
                return Err(arity_err(params.len()));
            }
            for (a, &addr) in args.iter().zip(&params) {
                self.expr(a)?;
                self.push_value(addr as i64);
                self.op(Op::StoreAbs);
            }
            self.op(Op::Call);
            let pos = self.out.len();
            self.imm16(0);
            self.call_fixups.push((pos, name.to_string(), line));
            Ok(())
        }
    }
}
