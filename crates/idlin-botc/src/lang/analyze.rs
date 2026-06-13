//! Static analysis of a `.bot` program: what does a brain statically ask
//! of the host? We walk the resolved AST and, for the syscalls whose
//! arguments are content-table INDICES (say/narrate/drop_loot/spawn_*),
//! classify each argument as far as compile-time constants allow. The
//! content loader uses this to catch out-of-range indices at load —
//! the same discipline the map BFS and affix-pool checks already enforce.
//!
//! This sees only what's STATICALLY knowable: a literal, a `const`, or a
//! `% constant` (whose result is bounded). A variable or computed value
//! is `Dynamic` and left to the runtime's own bounds guards.

use super::CompileError;
use super::Resolver;
use super::ast::{BinOp, ConstValue, Expr, Stmt};
use std::collections::BTreeMap;

/// How tightly a call argument is pinned at compile time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArgBound {
    /// A literal or a `const` that folded to this value.
    Const(i64),
    /// `expr % m` — the value is in `0..m` (when the lhs is non-negative,
    /// as content indices always are), so the highest index is `m - 1`.
    ModuloMax(i64),
    /// A variable / computed value we can't bound statically.
    Dynamic,
}

/// One call to a bounded syscall, with each source-order argument classified.
#[derive(Debug, Clone)]
pub struct SyscallUse {
    pub name: String,
    pub line: usize,
    pub args: Vec<ArgBound>,
}

/// The syscalls whose arguments index a content table (and so can be
/// statically range-checked). Order-of-args matches the source call.
const BOUNDED: &[&str] = &[
    "say",
    "narrate",
    "drop_loot",
    "spawn_monster",
    "spawn_elite",
];

/// Lex, parse, and resolve `source` (so `line "x"`/`item "x"` refs are
/// already folded to numbers), then collect every bounded-syscall call
/// with its arguments classified. Same front-end as `compile_with`, so an
/// analyzable program is a compilable one.
pub fn analyze_with(source: &str, resolver: Resolver) -> Result<Vec<SyscallUse>, CompileError> {
    let tokens = super::lexer::lex(source)?;
    let mut program = super::parser::parse(tokens)?;
    super::resolve::resolve(&mut program, resolver)?;

    // After resolve every const is a plain number; fold them so
    // `say(MY_LINE)` is as knowable as `say(3)`.
    let mut consts = BTreeMap::new();
    for (name, value, _) in &program.consts {
        if let ConstValue::Num(n) = value {
            consts.insert(name.clone(), *n);
        }
    }

    let mut uses = Vec::new();
    for (_, _, init, _) in &program.globals {
        if let Some(e) = init {
            walk_expr(e, &consts, &mut uses);
        }
    }
    for f in &program.fns {
        for s in &f.body {
            walk_stmt(s, &consts, &mut uses);
        }
    }
    Ok(uses)
}

fn walk_stmt(s: &Stmt, consts: &BTreeMap<String, i64>, out: &mut Vec<SyscallUse>) {
    match s {
        Stmt::VarDecl { init, .. } => {
            if let Some(e) = init {
                walk_expr(e, consts, out);
            }
        }
        Stmt::Assign { value, .. } => walk_expr(value, consts, out),
        Stmt::MemAssign { addr, value, .. } => {
            walk_expr(addr, consts, out);
            walk_expr(value, consts, out);
        }
        Stmt::IndexAssign { index, value, .. } => {
            walk_expr(index, consts, out);
            walk_expr(value, consts, out);
        }
        Stmt::If {
            cond,
            then_body,
            else_body,
            ..
        } => {
            walk_expr(cond, consts, out);
            for s in then_body.iter().chain(else_body.iter()) {
                walk_stmt(s, consts, out);
            }
        }
        Stmt::While { cond, body, .. } => {
            walk_expr(cond, consts, out);
            for s in body {
                walk_stmt(s, consts, out);
            }
        }
        Stmt::Return { value, .. } => {
            if let Some(e) = value {
                walk_expr(e, consts, out);
            }
        }
        Stmt::Break { .. } | Stmt::Continue { .. } => {}
        Stmt::Expr { expr: e, .. } => walk_expr(e, consts, out),
    }
}

fn walk_expr(e: &Expr, consts: &BTreeMap<String, i64>, out: &mut Vec<SyscallUse>) {
    match e {
        Expr::Call { name, args, line } => {
            if BOUNDED.contains(&name.as_str()) {
                out.push(SyscallUse {
                    name: name.clone(),
                    line: *line,
                    args: args.iter().map(|a| classify(a, consts)).collect(),
                });
            }
            // A call can also nest bounded calls in its args.
            for a in args {
                walk_expr(a, consts, out);
            }
        }
        Expr::Mem { addr, .. } => walk_expr(addr, consts, out),
        Expr::Index { index, .. } => walk_expr(index, consts, out),
        Expr::Unary { operand, .. } => walk_expr(operand, consts, out),
        Expr::Binary { lhs, rhs, .. } => {
            walk_expr(lhs, consts, out);
            walk_expr(rhs, consts, out);
        }
        Expr::Num { .. } | Expr::Ident { .. } | Expr::ContentRef { .. } => {}
    }
}

/// Classify one argument expression. Folds literals, `const` idents, and
/// `expr % const`; everything else is `Dynamic`.
fn classify(e: &Expr, consts: &BTreeMap<String, i64>) -> ArgBound {
    match e {
        Expr::Num { value, .. } => ArgBound::Const(*value),
        Expr::Ident { name, .. } => consts
            .get(name)
            .map(|n| ArgBound::Const(*n))
            .unwrap_or(ArgBound::Dynamic),
        Expr::Binary {
            op: BinOp::Mod,
            rhs,
            ..
        } => match fold(rhs, consts) {
            Some(m) if m > 0 => ArgBound::ModuloMax(m),
            _ => ArgBound::Dynamic,
        },
        _ => ArgBound::Dynamic,
    }
}

/// Fold an expression to a constant if it is one (a literal or a `const`).
fn fold(e: &Expr, consts: &BTreeMap<String, i64>) -> Option<i64> {
    match e {
        Expr::Num { value, .. } => Some(*value),
        Expr::Ident { name, .. } => consts.get(name).copied(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_refs(kind: &str, id: &str) -> Result<i32, String> {
        Err(format!("no refs in test: {kind} {id}"))
    }

    fn analyze(src: &str) -> Vec<SyscallUse> {
        analyze_with(src, &no_refs).expect("compiles")
    }

    #[test]
    fn const_and_modulo_and_dynamic() {
        let src = "
            const MY_LINE = 5;
            fn main() {
                say(7);
                say(MY_LINE);
                say((random() & 0x7FFFFFFF) % 8);
                var v;
                say(v);
            }
        ";
        let uses = analyze(src);
        let says: Vec<_> = uses.iter().filter(|u| u.name == "say").collect();
        assert_eq!(says.len(), 4);
        assert_eq!(says[0].args, vec![ArgBound::Const(7)]);
        assert_eq!(says[1].args, vec![ArgBound::Const(5)]);
        assert_eq!(says[2].args, vec![ArgBound::ModuloMax(8)]);
        assert_eq!(says[3].args, vec![ArgBound::Dynamic]);
    }

    #[test]
    fn drop_loot_args_in_source_order() {
        let src = "
            fn main() {
                drop_loot(0, 5, 0, 0, 1);
                var base;
                drop_loot(0, base, 0, 0, 1);
            }
        ";
        let uses: Vec<_> = analyze(src)
            .into_iter()
            .filter(|u| u.name == "drop_loot")
            .collect();
        assert_eq!(uses.len(), 2);
        assert_eq!(uses[0].args[0], ArgBound::Const(0)); // kind
        assert_eq!(uses[0].args[1], ArgBound::Const(5)); // idx
        assert_eq!(uses[1].args[0], ArgBound::Const(0));
        assert_eq!(uses[1].args[1], ArgBound::Dynamic); // var idx
    }

    #[test]
    fn finds_calls_nested_in_control_flow() {
        let src = "
            fn main() {
                if (random() > 0) {
                    while (random() > 0) {
                        spawn_monster(3, 0, 0);
                    }
                }
            }
        ";
        let uses: Vec<_> = analyze(src)
            .into_iter()
            .filter(|u| u.name == "spawn_monster")
            .collect();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].args[0], ArgBound::Const(3));
    }

    #[test]
    fn ignores_unbounded_syscalls() {
        let src = "fn main() { move_to(100, 200); use_flask(); }";
        assert!(analyze(src).is_empty());
    }
}
