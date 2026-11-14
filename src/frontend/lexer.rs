// Token-aware lexer for Intel/MASM style 8086 assembly.
// Comments (; ...), strings and identifiers are handled here so that numeric
// literal rules (0005h, 21H, 0x21, 0b1010, 1010B) can never corrupt them.

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Ident(String),
    Num(i32),
    Str(String),
    Comma,
    Colon,
    LBracket,
    RBracket,
    LParen,
    RParen,
    Plus,
    Minus,
    Star,
    Arrow,  // ->
    LArrow, // <-
    Dot,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub tok: Tok,
    pub line: usize, // 1-based
    pub col: usize,  // 1-based
}

pub struct LexError {
    pub line: usize,
    pub col: usize,
    pub msg: String,
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '.' || c == '?' || c == '$' || c == '@'
}
fn is_ident_cont(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '?' || c == '$' || c == '@'
}

pub fn lex(src: &str) -> Result<Vec<Token>, LexError> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0usize;
    let mut line = 1usize;
    let mut col = 1usize;
    let mut out: Vec<Token> = Vec::new();

    macro_rules! bump {
        () => {{
            if chars[i] == '\n' {
                line += 1;
                col = 1;
            } else {
                col += 1;
            }
            i += 1;
        }};
    }

    while i < chars.len() {
        let c = chars[i];
        // whitespace / newlines
        if c == '\n' || c == ' ' || c == '\t' || c == '\r' {
            bump!();
            continue;
        }
        // comment to end of line
        if c == ';' {
            while i < chars.len() && chars[i] != '\n' {
                bump!();
            }
            continue;
        }
        let (tl, tc) = (line, col);
        // arrows used by the legacy MACRO syntax
        if c == '-' && i + 1 < chars.len() && chars[i + 1] == '>' {
            bump!();
            bump!();
            out.push(Token { tok: Tok::Arrow, line: tl, col: tc });
            continue;
        }
        if c == '<' && i + 1 < chars.len() && chars[i + 1] == '-' {
            bump!();
            bump!();
            out.push(Token { tok: Tok::LArrow, line: tl, col: tc });
            continue;
        }
        match c {
            ',' => { bump!(); out.push(Token { tok: Tok::Comma, line: tl, col: tc }); continue; }
            ':' => { bump!(); out.push(Token { tok: Tok::Colon, line: tl, col: tc }); continue; }
            '[' => { bump!(); out.push(Token { tok: Tok::LBracket, line: tl, col: tc }); continue; }
            ']' => { bump!(); out.push(Token { tok: Tok::RBracket, line: tl, col: tc }); continue; }
            '(' => { bump!(); out.push(Token { tok: Tok::LParen, line: tl, col: tc }); continue; }
            ')' => { bump!(); out.push(Token { tok: Tok::RParen, line: tl, col: tc }); continue; }
            '+' => { bump!(); out.push(Token { tok: Tok::Plus, line: tl, col: tc }); continue; }
            '-' => { bump!(); out.push(Token { tok: Tok::Minus, line: tl, col: tc }); continue; }
            '*' => { bump!(); out.push(Token { tok: Tok::Star, line: tl, col: tc }); continue; }
            '.' => { bump!(); out.push(Token { tok: Tok::Dot, line: tl, col: tc }); continue; }
            _ => {}
        }
        // string literal
        if c == '"' || c == '\'' {
            let quote = c;
            bump!();
            let mut s = String::new();
            let mut closed = false;
            while i < chars.len() {
                if chars[i] == quote {
                    if i + 1 < chars.len() && chars[i + 1] == quote {
                        // doubled quote escape
                        s.push(quote);
                        bump!();
                        bump!();
                        continue;
                    }
                    bump!();
                    closed = true;
                    break;
                }
                if chars[i] == '\n' {
                    return Err(LexError { line: tl, col: tc, msg: "Unterminated string literal".into() });
                }
                s.push(chars[i]);
                bump!();
            }
            if !closed {
                return Err(LexError { line: tl, col: tc, msg: "Unterminated string literal".into() });
            }
            if quote == '"' {
                out.push(Token { tok: Tok::Str(s), line: tl, col: tc });
            } else {
                // single quoted: char constant (parser decides number vs string)
                out.push(Token { tok: Tok::Str(s), line: tl, col: tc });
            }
            continue;
        }
        // identifier (letter/._?@$ start) - includes directives like .DATA
        if is_ident_start(c) {
            let mut s = String::new();
            while i < chars.len() && is_ident_cont(chars[i]) {
                s.push(chars[i]);
                bump!();
            }
            out.push(Token { tok: Tok::Ident(s), line: tl, col: tc });
            continue;
        }
        // number literal (digit start)
        if c.is_ascii_digit() {
            let mut s = String::new();
            while i < chars.len() && chars[i].is_ascii_alphanumeric() {
                s.push(chars[i]);
                bump!();
            }
            let v = parse_number(&s).map_err(|m| LexError { line: tl, col: tc, msg: m })?;
            out.push(Token { tok: Tok::Num(v), line: tl, col: tc });
            continue;
        }
        return Err(LexError { line: tl, col: tc, msg: format!("Unexpected character '{}'", c) });
    }
    Ok(out)
}

/// Parse a digit-initial literal. Supported forms:
/// decimal `1234`, hex `0x21`/`21H`/`0FFh`, binary `0b1010`/`1010B`.
/// Letter-initial forms such as `FFh` arrive as identifiers; the parser
/// reinterprets them as numbers only in operand (expression) contexts.
pub fn parse_number(s: &str) -> Result<i32, String> {
    let lower = s.to_ascii_lowercase();
    // `h` suffix wins: 0005h, 21H, 0BCh, 0FAh
    if lower.len() >= 2 && lower.ends_with('h') {
        let body = &lower[..lower.len() - 1];
        if body.starts_with("0x") || body.is_empty() || !body.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("Invalid hex literal '{}'", s));
        }
        return i32::from_str_radix(body, 16).map_err(|_| format!("Hex literal '{}' out of range", s));
    }
    if lower.starts_with("0x") {
        let digits = &lower[2..];
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("Invalid hex literal '{}'", s));
        }
        return i32::from_str_radix(digits, 16).map_err(|_| format!("Hex literal '{}' out of range", s));
    }
    // `0b` binary prefix (only when the tail is binary digits)
    if lower.starts_with("0b") {
        let digits = &lower[2..];
        if !digits.is_empty() && digits.chars().all(|c| c == '0' || c == '1') {
            return i32::from_str_radix(digits, 2).map_err(|_| format!("Binary literal '{}' out of range", s));
        }
    }
    // `b` suffix: 1010B
    if lower.len() >= 2 && lower.ends_with('b') {
        let body = &lower[..lower.len() - 1];
        if body.chars().all(|c| c == '0' || c == '1') {
            return i32::from_str_radix(body, 2).map_err(|_| format!("Binary literal '{}' out of range", s));
        }
        return Err(format!("Invalid binary literal '{}'", s));
    }
    // plain decimal
    if !lower.is_empty() && lower.chars().all(|c| c.is_ascii_digit()) {
        return lower
            .parse::<i32>()
            .map_err(|_| format!("Decimal literal '{}' out of range", s));
    }
    Err(format!("Invalid numeric literal '{}'", s))
}

/// True when an identifier looks like a MASM hex constant (`FFh`, `0ABCh`...).
pub fn looks_like_hex_ident(s: &str) -> bool {
    if s.len() < 2 {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    if !lower.ends_with('h') {
        return false;
    }
    let body = &lower[..lower.len() - 1];
    !body.is_empty() && body.chars().all(|c| c.is_ascii_hexdigit())
}

/// True when an identifier looks like a MASM binary constant (`1010B` cannot
/// happen here because those start with a digit; kept for symmetry).
pub fn looks_like_binary_ident(s: &str) -> bool {
    if s.len() < 2 {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    if !lower.ends_with('b') {
        return false;
    }
    let body = &lower[..lower.len() - 1];
    !body.is_empty() && body.chars().all(|c| c == '0' || c == '1')
}
