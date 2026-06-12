//! Recursive-descent parser for the `.bot` language.

use super::CompileError;
use super::ast::*;
use super::lexer::{Tok, Token};

pub fn parse(tokens: Vec<Token>) -> Result<Program, CompileError> {
    Parser { tokens, pos: 0 }.program()
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.pos).map(|t| &t.tok)
    }

    fn line(&self) -> usize {
        self.tokens
            .get(self.pos.min(self.tokens.len().saturating_sub(1)))
            .map(|t| t.line)
            .unwrap_or(0)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.tokens.get(self.pos).map(|t| t.tok.clone());
        self.pos += 1;
        t
    }

    fn eat(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        let line = self.line();
        match self.next() {
            Some(t) if t == *want => Ok(()),
            other => Err(CompileError::new(
                line,
                format!("expected {what}, found {other:?}"),
            )),
        }
    }

    fn eat_ident(&mut self, what: &str) -> Result<String, CompileError> {
        let line = self.line();
        match self.next() {
            Some(Tok::Ident(name)) => Ok(name),
            other => Err(CompileError::new(
                line,
                format!("expected {what}, found {other:?}"),
            )),
        }
    }

    fn program(&mut self) -> Result<Program, CompileError> {
        let mut program = Program {
            build: vec![],
            consts: vec![],
            globals: vec![],
            fns: vec![],
        };
        while let Some(tok) = self.peek() {
            let line = self.line();
            match tok {
                Tok::Build => {
                    self.next();
                    self.eat(&Tok::LBracket, "`[`")?;
                    if !program.build.is_empty() {
                        return Err(CompileError::new(line, "duplicate `build` declaration"));
                    }
                    while self.peek() != Some(&Tok::RBracket) {
                        let entry_line = self.line();
                        match self.next() {
                            Some(Tok::Num(n)) => {
                                program.build.push((BuildEntry::Num(n), entry_line))
                            }
                            Some(Tok::Ident(name)) => {
                                program.build.push((BuildEntry::Name(name), entry_line))
                            }
                            other => {
                                return Err(CompileError::new(
                                    entry_line,
                                    format!("expected a node number or constant, found {other:?}"),
                                ));
                            }
                        }
                        if self.peek() == Some(&Tok::Comma) {
                            self.next();
                        } else {
                            break;
                        }
                    }
                    self.eat(&Tok::RBracket, "`]`")?;
                    self.eat(&Tok::Semi, "`;`")?;
                    if program.build.len() > 240 {
                        return Err(CompileError::new(
                            line,
                            "build plans cap at 240 nodes (level 100 earns 228 points)",
                        ));
                    }
                }
                Tok::Const => {
                    self.next();
                    let name = self.eat_ident("constant name")?;
                    self.eat(&Tok::Assign, "`=`")?;
                    let value = self.const_expr()?;
                    self.eat(&Tok::Semi, "`;`")?;
                    program.consts.push((name, value, line));
                }
                Tok::Var => {
                    self.next();
                    let (name, len, init) = self.var_tail()?;
                    program.globals.push((name, len, init, line));
                }
                Tok::Fn => {
                    self.next();
                    let name = self.eat_ident("function name")?;
                    self.eat(&Tok::LParen, "`(`")?;
                    let mut params = vec![];
                    if self.peek() != Some(&Tok::RParen) {
                        loop {
                            params.push(self.eat_ident("parameter name")?);
                            if self.peek() == Some(&Tok::Comma) {
                                self.next();
                            } else {
                                break;
                            }
                        }
                    }
                    self.eat(&Tok::RParen, "`)`")?;
                    let body = self.block()?;
                    program.fns.push(FnDecl {
                        name,
                        params,
                        body,
                        line,
                    });
                }
                other => {
                    return Err(CompileError::new(
                        line,
                        format!(
                            "expected `fn`, `var`, `const`, or `build` at top level, found {other:?}"
                        ),
                    ));
                }
            }
        }
        Ok(program)
    }

    /// Constant expressions: a literal with optional leading minus, or a
    /// content ref (`item "rusted_cleaver"`).
    fn const_expr(&mut self) -> Result<ConstValue, CompileError> {
        let line = self.line();
        match self.next() {
            Some(Tok::Num(n)) => Ok(ConstValue::Num(n)),
            Some(Tok::Minus) => match self.next() {
                Some(Tok::Num(n)) => Ok(ConstValue::Num(-n)),
                other => Err(CompileError::new(
                    line,
                    format!("expected number after `-`, found {other:?}"),
                )),
            },
            Some(Tok::Ident(kind)) if matches!(self.peek(), Some(Tok::Str(_))) => {
                check_ref_kind(&kind, line)?;
                let Some(Tok::Str(id)) = self.next() else {
                    unreachable!("peeked Str");
                };
                Ok(ConstValue::Ref { kind, id })
            }
            other => Err(CompileError::new(
                line,
                format!("expected a numeric constant or content ref, found {other:?}"),
            )),
        }
    }

    /// After `var`: `name;` | `name = expr;` | `name[NUM];`
    fn var_tail(&mut self) -> Result<(String, u32, Option<Expr>), CompileError> {
        let name = self.eat_ident("variable name")?;
        match self.peek() {
            Some(Tok::LBracket) => {
                self.next();
                let line = self.line();
                let len = match self.next() {
                    Some(Tok::Num(n)) if n > 0 && n <= 0x4000 => n as u32,
                    other => {
                        return Err(CompileError::new(
                            line,
                            format!("array length must be a positive literal, found {other:?}"),
                        ));
                    }
                };
                self.eat(&Tok::RBracket, "`]`")?;
                self.eat(&Tok::Semi, "`;`")?;
                Ok((name, len, None))
            }
            Some(Tok::Assign) => {
                self.next();
                let init = self.expr()?;
                self.eat(&Tok::Semi, "`;`")?;
                Ok((name, 1, Some(init)))
            }
            _ => {
                self.eat(&Tok::Semi, "`;`")?;
                Ok((name, 1, None))
            }
        }
    }

    fn block(&mut self) -> Result<Vec<Stmt>, CompileError> {
        self.eat(&Tok::LBrace, "`{`")?;
        let mut body = vec![];
        while self.peek() != Some(&Tok::RBrace) {
            if self.peek().is_none() {
                return Err(CompileError::new(self.line(), "unclosed `{` block"));
            }
            body.push(self.stmt()?);
        }
        self.next(); // }
        Ok(body)
    }

    fn stmt(&mut self) -> Result<Stmt, CompileError> {
        let line = self.line();
        match self.peek() {
            Some(Tok::Var) => {
                self.next();
                let (name, len, init) = self.var_tail()?;
                Ok(Stmt::VarDecl {
                    name,
                    len: (len > 1).then_some(len),
                    init,
                    line,
                })
            }
            Some(Tok::If) => {
                self.next();
                self.eat(&Tok::LParen, "`(`")?;
                let cond = self.expr()?;
                self.eat(&Tok::RParen, "`)`")?;
                let then_body = self.block()?;
                let else_body = if self.peek() == Some(&Tok::Else) {
                    self.next();
                    if self.peek() == Some(&Tok::If) {
                        vec![self.stmt()?] // else if chains
                    } else {
                        self.block()?
                    }
                } else {
                    vec![]
                };
                Ok(Stmt::If {
                    cond,
                    then_body,
                    else_body,
                    line,
                })
            }
            Some(Tok::While) => {
                self.next();
                self.eat(&Tok::LParen, "`(`")?;
                let cond = self.expr()?;
                self.eat(&Tok::RParen, "`)`")?;
                let body = self.block()?;
                Ok(Stmt::While { cond, body, line })
            }
            Some(Tok::Return) => {
                self.next();
                let value = if self.peek() == Some(&Tok::Semi) {
                    None
                } else {
                    Some(self.expr()?)
                };
                self.eat(&Tok::Semi, "`;`")?;
                Ok(Stmt::Return { value, line })
            }
            Some(Tok::Break) => {
                self.next();
                self.eat(&Tok::Semi, "`;`")?;
                Ok(Stmt::Break { line })
            }
            Some(Tok::Continue) => {
                self.next();
                self.eat(&Tok::Semi, "`;`")?;
                Ok(Stmt::Continue { line })
            }
            Some(Tok::Mem) => {
                // mem[addr] = value;
                self.next();
                self.eat(&Tok::LBracket, "`[`")?;
                let addr = self.expr()?;
                self.eat(&Tok::RBracket, "`]`")?;
                self.eat(&Tok::Assign, "`=`")?;
                let value = self.expr()?;
                self.eat(&Tok::Semi, "`;`")?;
                Ok(Stmt::MemAssign { addr, value, line })
            }
            Some(Tok::Ident(_)) => {
                // Could be: assignment, array assignment, or a call statement.
                let name = self.eat_ident("name")?;
                match self.peek() {
                    Some(Tok::Assign) => {
                        self.next();
                        let value = self.expr()?;
                        self.eat(&Tok::Semi, "`;`")?;
                        Ok(Stmt::Assign { name, value, line })
                    }
                    Some(Tok::LBracket) => {
                        self.next();
                        let index = self.expr()?;
                        self.eat(&Tok::RBracket, "`]`")?;
                        self.eat(&Tok::Assign, "`=`")?;
                        let value = self.expr()?;
                        self.eat(&Tok::Semi, "`;`")?;
                        Ok(Stmt::IndexAssign {
                            name,
                            index,
                            value,
                            line,
                        })
                    }
                    Some(Tok::LParen) => {
                        let call = self.call_tail(name, line)?;
                        self.eat(&Tok::Semi, "`;`")?;
                        Ok(Stmt::Expr { expr: call, line })
                    }
                    other => Err(CompileError::new(
                        line,
                        format!("expected `=`, `[`, or `(` after `{name}`, found {other:?}"),
                    )),
                }
            }
            other => Err(CompileError::new(
                line,
                format!("expected a statement, found {other:?}"),
            )),
        }
    }

    // -- expressions: precedence climbing --

    fn expr(&mut self) -> Result<Expr, CompileError> {
        self.binary(0)
    }

    fn binary(&mut self, min_prec: u8) -> Result<Expr, CompileError> {
        let mut lhs = self.unary()?;
        while let Some((op, prec)) = self.peek().and_then(bin_op) {
            if prec < min_prec {
                break;
            }
            let line = self.line();
            self.next();
            let rhs = self.binary(prec + 1)?;
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
                line,
            };
        }
        Ok(lhs)
    }

    fn unary(&mut self) -> Result<Expr, CompileError> {
        let line = self.line();
        match self.peek() {
            Some(Tok::Minus) => {
                self.next();
                Ok(Expr::Unary {
                    op: UnOp::Neg,
                    operand: Box::new(self.unary()?),
                    line,
                })
            }
            Some(Tok::Bang) => {
                self.next();
                Ok(Expr::Unary {
                    op: UnOp::Not,
                    operand: Box::new(self.unary()?),
                    line,
                })
            }
            Some(Tok::Tilde) => {
                self.next();
                Ok(Expr::Unary {
                    op: UnOp::BitNot,
                    operand: Box::new(self.unary()?),
                    line,
                })
            }
            _ => self.primary(),
        }
    }

    fn primary(&mut self) -> Result<Expr, CompileError> {
        let line = self.line();
        match self.next() {
            Some(Tok::Num(value)) => Ok(Expr::Num { value, line }),
            Some(Tok::LParen) => {
                let inner = self.expr()?;
                self.eat(&Tok::RParen, "`)`")?;
                Ok(inner)
            }
            Some(Tok::Mem) => {
                self.eat(&Tok::LBracket, "`[`")?;
                let addr = self.expr()?;
                self.eat(&Tok::RBracket, "`]`")?;
                Ok(Expr::Mem {
                    addr: Box::new(addr),
                    line,
                })
            }
            Some(Tok::Ident(name)) => match self.peek() {
                Some(Tok::LParen) => self.call_tail(name, line),
                Some(Tok::LBracket) => {
                    self.next();
                    let index = self.expr()?;
                    self.eat(&Tok::RBracket, "`]`")?;
                    Ok(Expr::Index {
                        name,
                        index: Box::new(index),
                        line,
                    })
                }
                // `item "rusted_cleaver"` — a content ref. The kind word
                // stays a normal identifier everywhere else; only an
                // immediately following string forms a ref.
                Some(Tok::Str(_)) => {
                    check_ref_kind(&name, line)?;
                    let Some(Tok::Str(id)) = self.next() else {
                        unreachable!("peeked Str");
                    };
                    Ok(Expr::ContentRef {
                        kind: name,
                        id,
                        line,
                    })
                }
                _ => Ok(Expr::Ident { name, line }),
            },
            other => Err(CompileError::new(
                line,
                format!("expected an expression, found {other:?}"),
            )),
        }
    }

    fn call_tail(&mut self, name: String, line: usize) -> Result<Expr, CompileError> {
        self.eat(&Tok::LParen, "`(`")?;
        let mut args = vec![];
        if self.peek() != Some(&Tok::RParen) {
            loop {
                args.push(self.expr()?);
                if self.peek() == Some(&Tok::Comma) {
                    self.next();
                } else {
                    break;
                }
            }
        }
        self.eat(&Tok::RParen, "`)`")?;
        Ok(Expr::Call { name, args, line })
    }
}

/// The content-ref vocabulary. `line`/`exit`/`gate` are zone-scoped
/// (resolved against the zone the brain is attached to); the rest are
/// global content tables.
pub const REF_KINDS: [&str; 8] = [
    "item", "gem", "monster", "zone", "currency", "line", "exit", "gate",
];

fn check_ref_kind(kind: &str, line: usize) -> Result<(), CompileError> {
    if REF_KINDS.contains(&kind) {
        return Ok(());
    }
    Err(CompileError::new(
        line,
        format!(
            "unknown content ref kind `{kind}` (one of: {})",
            REF_KINDS.join(", ")
        ),
    ))
}

fn bin_op(tok: &Tok) -> Option<(BinOp, u8)> {
    Some(match tok {
        Tok::OrOr => (BinOp::LogicalOr, 1),
        Tok::AndAnd => (BinOp::LogicalAnd, 2),
        Tok::Or => (BinOp::Or, 3),
        Tok::Xor => (BinOp::Xor, 4),
        Tok::And => (BinOp::And, 5),
        Tok::Eq => (BinOp::Eq, 6),
        Tok::Ne => (BinOp::Ne, 6),
        Tok::Lt => (BinOp::Lt, 7),
        Tok::Le => (BinOp::Le, 7),
        Tok::Gt => (BinOp::Gt, 7),
        Tok::Ge => (BinOp::Ge, 7),
        Tok::Shl => (BinOp::Shl, 8),
        Tok::Shr => (BinOp::Shr, 8),
        Tok::Plus => (BinOp::Add, 9),
        Tok::Minus => (BinOp::Sub, 9),
        Tok::Star => (BinOp::Mul, 10),
        Tok::Slash => (BinOp::Div, 10),
        Tok::Percent => (BinOp::Mod, 10),
        _ => return None,
    })
}
