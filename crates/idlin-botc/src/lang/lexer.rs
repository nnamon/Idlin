//! Tokenizer for the `.bot` language.

use super::CompileError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tok {
    // literals & names
    Num(i64),
    Ident(String),
    // keywords
    Fn,
    Var,
    Const,
    If,
    Else,
    While,
    Return,
    Break,
    Continue,
    Mem,
    // punctuation
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Comma,
    Semi,
    Assign,
    // operators
    OrOr,
    AndAnd,
    Or,
    Xor,
    And,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Shl,
    Shr,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Bang,
    Tilde,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub tok: Tok,
    pub line: usize,
}

pub fn lex(source: &str) -> Result<Vec<Token>, CompileError> {
    let mut out = Vec::new();
    let bytes: Vec<char> = source.chars().collect();
    let mut i = 0;
    let mut line = 1;

    let ident_start = |c: char| c.is_ascii_alphabetic() || c == '_';
    let ident_cont = |c: char| c.is_ascii_alphanumeric() || c == '_';

    while i < bytes.len() {
        let c = bytes[i];
        match c {
            '\n' => {
                line += 1;
                i += 1;
            }
            c if c.is_whitespace() => i += 1,
            '/' if i + 1 < bytes.len() && bytes[i + 1] == '/' => {
                while i < bytes.len() && bytes[i] != '\n' {
                    i += 1;
                }
            }
            '0'..='9' => {
                let start = i;
                let mut value: i64;
                if c == '0' && i + 1 < bytes.len() && (bytes[i + 1] == 'x' || bytes[i + 1] == 'X') {
                    i += 2;
                    let hs = i;
                    while i < bytes.len() && bytes[i].is_ascii_hexdigit() {
                        i += 1;
                    }
                    if hs == i {
                        return Err(CompileError::new(line, "empty hex literal"));
                    }
                    let text: String = bytes[hs..i].iter().collect();
                    value = i64::from_str_radix(&text, 16)
                        .map_err(|_| CompileError::new(line, "hex literal too large"))?;
                } else {
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    let text: String = bytes[start..i].iter().collect();
                    value = text
                        .parse()
                        .map_err(|_| CompileError::new(line, "number too large"))?;
                }
                if value > u32::MAX as i64 {
                    return Err(CompileError::new(line, "literal exceeds 32 bits"));
                }
                // Literals like 0xFFFFFFFF are the i32 bit pattern.
                if value > i32::MAX as i64 {
                    value -= 1i64 << 32;
                }
                out.push(Token {
                    tok: Tok::Num(value),
                    line,
                });
            }
            c if ident_start(c) => {
                let start = i;
                while i < bytes.len() && ident_cont(bytes[i]) {
                    i += 1;
                }
                let word: String = bytes[start..i].iter().collect();
                let tok = match word.as_str() {
                    "fn" => Tok::Fn,
                    "var" => Tok::Var,
                    "const" => Tok::Const,
                    "if" => Tok::If,
                    "else" => Tok::Else,
                    "while" => Tok::While,
                    "return" => Tok::Return,
                    "break" => Tok::Break,
                    "continue" => Tok::Continue,
                    "mem" => Tok::Mem,
                    _ => Tok::Ident(word),
                };
                out.push(Token { tok, line });
            }
            _ => {
                let two = |a: char| i + 1 < bytes.len() && bytes[i + 1] == a;
                let (tok, len) = match c {
                    '(' => (Tok::LParen, 1),
                    ')' => (Tok::RParen, 1),
                    '{' => (Tok::LBrace, 1),
                    '}' => (Tok::RBrace, 1),
                    '[' => (Tok::LBracket, 1),
                    ']' => (Tok::RBracket, 1),
                    ',' => (Tok::Comma, 1),
                    ';' => (Tok::Semi, 1),
                    '|' if two('|') => (Tok::OrOr, 2),
                    '|' => (Tok::Or, 1),
                    '&' if two('&') => (Tok::AndAnd, 2),
                    '&' => (Tok::And, 1),
                    '^' => (Tok::Xor, 1),
                    '=' if two('=') => (Tok::Eq, 2),
                    '=' => (Tok::Assign, 1),
                    '!' if two('=') => (Tok::Ne, 2),
                    '!' => (Tok::Bang, 1),
                    '<' if two('<') => (Tok::Shl, 2),
                    '<' if two('=') => (Tok::Le, 2),
                    '<' => (Tok::Lt, 1),
                    '>' if two('>') => (Tok::Shr, 2),
                    '>' if two('=') => (Tok::Ge, 2),
                    '>' => (Tok::Gt, 1),
                    '+' => (Tok::Plus, 1),
                    '-' => (Tok::Minus, 1),
                    '*' => (Tok::Star, 1),
                    '/' => (Tok::Slash, 1),
                    '%' => (Tok::Percent, 1),
                    '~' => (Tok::Tilde, 1),
                    other => {
                        return Err(CompileError::new(
                            line,
                            format!("unexpected character `{other}`"),
                        ));
                    }
                };
                out.push(Token { tok, line });
                i += len;
            }
        }
    }
    Ok(out)
}
