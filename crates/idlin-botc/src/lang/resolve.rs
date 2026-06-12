//! Content-reference resolution: rewrites `item "rusted_cleaver"` (and
//! every other `ContentRef`) into the plain integer the resolver supplies,
//! BEFORE codegen. Brains are compiled at content load, so the resolver
//! has the sorted database in hand; an unknown id is a load error, not a
//! runtime surprise. After this pass no `ContentRef` (or `ConstValue::Ref`)
//! survives in the AST.

use super::CompileError;
use super::ast::{ConstValue, Expr, Program, Stmt};

/// Maps (kind, id) → the i32 a ref compiles to. Kind is one of
/// `parser::REF_KINDS`; the error string should say what was looked up
/// and what exists.
pub type Resolver<'a> = &'a dyn Fn(&str, &str) -> Result<i32, String>;

pub fn resolve(program: &mut Program, r: Resolver) -> Result<(), CompileError> {
    for (_, value, line) in &mut program.consts {
        if let ConstValue::Ref { kind, id } = value {
            let n = r(kind, id).map_err(|msg| CompileError::new(*line, msg))?;
            *value = ConstValue::Num(n as i64);
        }
    }
    for (_, _, init, _) in &mut program.globals {
        if let Some(e) = init {
            expr(e, r)?;
        }
    }
    for f in &mut program.fns {
        for s in &mut f.body {
            stmt(s, r)?;
        }
    }
    Ok(())
}

fn stmt(s: &mut Stmt, r: Resolver) -> Result<(), CompileError> {
    match s {
        Stmt::VarDecl { init, .. } => {
            if let Some(e) = init {
                expr(e, r)?;
            }
        }
        Stmt::Assign { value, .. } => expr(value, r)?,
        Stmt::MemAssign { addr, value, .. } => {
            expr(addr, r)?;
            expr(value, r)?;
        }
        Stmt::IndexAssign { index, value, .. } => {
            expr(index, r)?;
            expr(value, r)?;
        }
        Stmt::If {
            cond,
            then_body,
            else_body,
            ..
        } => {
            expr(cond, r)?;
            for s in then_body.iter_mut().chain(else_body.iter_mut()) {
                stmt(s, r)?;
            }
        }
        Stmt::While { cond, body, .. } => {
            expr(cond, r)?;
            for s in body {
                stmt(s, r)?;
            }
        }
        Stmt::Return { value, .. } => {
            if let Some(e) = value {
                expr(e, r)?;
            }
        }
        Stmt::Break { .. } | Stmt::Continue { .. } => {}
        Stmt::Expr { expr: e, .. } => expr(e, r)?,
    }
    Ok(())
}

fn expr(e: &mut Expr, r: Resolver) -> Result<(), CompileError> {
    match e {
        Expr::ContentRef { kind, id, line } => {
            let n = r(kind, id).map_err(|msg| CompileError::new(*line, msg))?;
            *e = Expr::Num {
                value: n as i64,
                line: *line,
            };
        }
        Expr::Num { .. } | Expr::Ident { .. } => {}
        Expr::Mem { addr, .. } => expr(addr, r)?,
        Expr::Index { index, .. } => expr(index, r)?,
        Expr::Unary { operand, .. } => expr(operand, r)?,
        Expr::Binary { lhs, rhs, .. } => {
            expr(lhs, r)?;
            expr(rhs, r)?;
        }
        Expr::Call { args, .. } => {
            for a in args {
                expr(a, r)?;
            }
        }
    }
    Ok(())
}
