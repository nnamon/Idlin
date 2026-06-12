//! AST for the `.bot` language.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    And,
    Or,
    Xor,
    Shl,
    Shr,
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
    LogicalAnd,
    LogicalOr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnOp {
    Neg,
    Not,    // logical !
    BitNot, // ~
}

#[derive(Debug, Clone)]
pub enum Expr {
    Num {
        value: i64,
        line: usize,
    },
    /// Variable read, or array name (which evaluates to its address).
    Ident {
        name: String,
        line: usize,
    },
    /// `mem[addr]`
    Mem {
        addr: Box<Expr>,
        line: usize,
    },
    /// `arr[index]` — word-indexed sugar for `mem[arr + index*4]`.
    Index {
        name: String,
        index: Box<Expr>,
        line: usize,
    },
    Unary {
        op: UnOp,
        operand: Box<Expr>,
        line: usize,
    },
    Binary {
        op: BinOp,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
        line: usize,
    },
    /// Builtin or user function call.
    Call {
        name: String,
        args: Vec<Expr>,
        line: usize,
    },
    /// `item "rusted_cleaver"`, `gem "arc"`, `line "welcome"`, … — a
    /// content reference resolved to its index at compile time (brains
    /// compile at content load, with the database in hand). Position is
    /// an engine detail; authors name things.
    ContentRef {
        kind: String,
        id: String,
        line: usize,
    },
}

impl Expr {
    /// Reserved for richer diagnostics.
    #[allow(dead_code)]
    pub fn line(&self) -> usize {
        match self {
            Expr::Num { line, .. }
            | Expr::Ident { line, .. }
            | Expr::Mem { line, .. }
            | Expr::Index { line, .. }
            | Expr::Unary { line, .. }
            | Expr::Binary { line, .. }
            | Expr::Call { line, .. }
            | Expr::ContentRef { line, .. } => *line,
        }
    }
}

#[derive(Debug, Clone)]
pub enum Stmt {
    /// `var name;` / `var name = expr;` / `var name[len];`
    VarDecl {
        name: String,
        len: Option<u32>,
        init: Option<Expr>,
        line: usize,
    },
    /// `name = expr;`
    Assign {
        name: String,
        value: Expr,
        line: usize,
    },
    /// `mem[addr] = expr;`
    MemAssign {
        addr: Expr,
        value: Expr,
        line: usize,
    },
    /// `arr[index] = expr;`
    IndexAssign {
        name: String,
        index: Expr,
        value: Expr,
        line: usize,
    },
    If {
        cond: Expr,
        then_body: Vec<Stmt>,
        else_body: Vec<Stmt>,
        line: usize,
    },
    While {
        cond: Expr,
        body: Vec<Stmt>,
        line: usize,
    },
    Return {
        value: Option<Expr>,
        line: usize,
    },
    Break {
        line: usize,
    },
    Continue {
        line: usize,
    },
    /// Expression for its side effects (calls); result discarded.
    Expr {
        expr: Expr,
        line: usize,
    },
}

impl Stmt {
    /// Reserved for richer diagnostics.
    #[allow(dead_code)]
    pub fn line(&self) -> usize {
        match self {
            Stmt::VarDecl { line, .. }
            | Stmt::Assign { line, .. }
            | Stmt::MemAssign { line, .. }
            | Stmt::IndexAssign { line, .. }
            | Stmt::If { line, .. }
            | Stmt::While { line, .. }
            | Stmt::Return { line, .. }
            | Stmt::Break { line }
            | Stmt::Continue { line }
            | Stmt::Expr { line, .. } => *line,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FnDecl {
    pub name: String,
    pub params: Vec<String>,
    pub body: Vec<Stmt>,
    pub line: usize,
}

/// One build entry: a numeric node ref, or a named constant resolving to one.
#[derive(Debug, Clone)]
pub enum BuildEntry {
    Num(i64),
    Name(String),
}

/// A `const` initializer: a literal, or a content ref resolved before
/// codegen.
#[derive(Debug, Clone)]
pub enum ConstValue {
    Num(i64),
    Ref { kind: String, id: String },
}

#[derive(Debug, Clone)]
pub struct Program {
    /// Declared passive build: node refs in allocation order.
    pub build: Vec<(BuildEntry, usize)>,
    pub consts: Vec<(String, ConstValue, usize)>,
    /// Top-level vars: (name, array len or 1, optional init, line).
    pub globals: Vec<(String, u32, Option<Expr>, usize)>,
    pub fns: Vec<FnDecl>,
}
