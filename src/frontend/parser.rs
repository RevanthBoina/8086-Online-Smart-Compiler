// Recursive-descent parser: tokens -> statements (labels, data, directives,
// instructions). Semantic checks (symbols, sizes, addressing rules) happen in
// `sema`, which lowers statements into the executable program.

use super::ast::*;
use super::lexer::{looks_like_binary_ident, looks_like_hex_ident, Tok, Token};

pub struct ParseError {
    pub line: usize,
    pub col: usize,
    pub msg: String,
}

fn err<T>(line: usize, col: usize, msg: impl Into<String>) -> Result<T, ParseError> {
    Err(ParseError { line, col, msg: msg.into() })
}

fn up(s: &str) -> String {
    s.to_ascii_uppercase()
}

struct MacroDef {
    name: String, // lowercase
    params: Vec<String>,
    body: Vec<Token>,
}

pub struct Parser {
    toks: Vec<Token>,
    pos: usize,
    lines: Vec<String>,
    macros: Vec<MacroDef>,
    pending_data_size: Size,
}

pub fn token_str(t: &Tok) -> String {
    match t {
        Tok::Ident(s) => s.clone(),
        Tok::Num(v) => format!("{}", v),
        Tok::Str(s) => format!("\"{}\"", s),
        Tok::Comma => ",".into(),
        Tok::Colon => ":".into(),
        Tok::LBracket => "[".into(),
        Tok::RBracket => "]".into(),
        Tok::LParen => "(".into(),
        Tok::RParen => ")".into(),
        Tok::Plus => "+".into(),
        Tok::Minus => "-".into(),
        Tok::Star => "*".into(),
        Tok::Arrow => "->".into(),
        Tok::LArrow => "<-".into(),
        Tok::Dot => ".".into(),
    }
}

pub fn reg16_from_name(s: &str) -> Option<Reg> {
    match up(s).as_str() {
        "AX" => Some(Reg::AX),
        "CX" => Some(Reg::CX),
        "DX" => Some(Reg::DX),
        "BX" => Some(Reg::BX),
        "SP" => Some(Reg::SP),
        "BP" => Some(Reg::BP),
        "SI" => Some(Reg::SI),
        "DI" => Some(Reg::DI),
        "ES" => Some(Reg::ES),
        "CS" => Some(Reg::CS),
        "SS" => Some(Reg::SS),
        "DS" => Some(Reg::DS),
        _ => None,
    }
}

pub fn reg8_from_name(s: &str) -> Option<R8> {
    match up(s).as_str() {
        "AL" => Some(R8::AL),
        "CL" => Some(R8::CL),
        "DL" => Some(R8::DL),
        "BL" => Some(R8::BL),
        "AH" => Some(R8::AH),
        "CH" => Some(R8::CH),
        "DH" => Some(R8::DH),
        "BH" => Some(R8::BH),
        _ => None,
    }
}

pub fn seg_from_name(s: &str) -> Option<Reg> {
    reg16_from_name(s).filter(|r| r.is_seg())
}

pub fn op_from_mnemonic(u: &str) -> Option<Op> {
    let m = match u {
        "MOV" => Op::Mov,
        "MOVSB" => Op::Movsb,
        "MOVSW" => Op::Movsw,
        "LODSB" => Op::Lodsb,
        "LODSW" => Op::Lodsw,
        "STOSB" => Op::Stosb,
        "STOSW" => Op::Stosw,
        "CMPSB" => Op::Cmpsb,
        "CMPSW" => Op::Cmpsw,
        "SCASB" => Op::Scasb,
        "SCASW" => Op::Scasw,
        "XCHG" => Op::Xchg,
        "LEA" => Op::Lea,
        "PUSH" => Op::Push,
        "POP" => Op::Pop,
        "PUSHF" => Op::Pushf,
        "POPF" => Op::Popf,
        "ADD" => Op::Add,
        "ADC" => Op::Adc,
        "SUB" => Op::Sub,
        "SBB" => Op::Sbb,
        "CMP" => Op::Cmp,
        "INC" => Op::Inc,
        "DEC" => Op::Dec,
        "NEG" => Op::Neg,
        "MUL" => Op::Mul,
        "IMUL" => Op::Imul,
        "DIV" => Op::Div,
        "IDIV" => Op::Idiv,
        "AND" => Op::And,
        "OR" => Op::Or,
        "XOR" => Op::Xor,
        "NOT" => Op::Not,
        "TEST" => Op::Test,
        "ROL" => Op::Rol,
        "ROR" => Op::Ror,
        "RCL" => Op::Rcl,
        "RCR" => Op::Rcr,
        "SHL" | "SAL" => Op::Shl,
        "SHR" => Op::Shr,
        "SAR" => Op::Sar,
        "JMP" => Op::Jmp,
        "CALL" => Op::Call,
        "RET" | "RETN" => Op::Ret,
        "JO" => Op::Jo,
        "JNO" => Op::Jno,
        "JB" | "JC" | "JNAE" => Op::Jb,
        "JAE" | "JNB" | "JNC" => Op::Jae,
        "JE" | "JZ" => Op::Je,
        "JNE" | "JNZ" => Op::Jne,
        "JBE" | "JNA" => Op::Jbe,
        "JA" | "JNBE" => Op::Ja,
        "JS" => Op::Js,
        "JNS" => Op::Jns,
        "JP" | "JPE" => Op::Jp,
        "JNP" | "JPO" => Op::Jnp,
        "JL" | "JNGE" => Op::Jl,
        "JGE" | "JNL" => Op::Jge,
        "JLE" | "JNG" => Op::Jle,
        "JG" | "JNLE" => Op::Jg,
        "LOOP" => Op::Loop,
        "LOOPE" | "LOOPZ" => Op::Loope,
        "LOOPNE" | "LOOPNZ" => Op::Loopne,
        "JCXZ" => Op::Jcxz,
        "INT" => Op::Int,
        "HLT" => Op::Hlt,
        "NOP" => Op::Nop,
        "CBW" => Op::Cbw,
        "CWD" => Op::Cwd,
        "CLC" => Op::Clc,
        "STC" => Op::Stc,
        "CMC" => Op::Cmc,
        "CLD" => Op::Cld,
        "STD" => Op::Std,
        "STI" => Op::Sti,
        "CLI" => Op::Cli,
        _ => return None,
    };
    Some(m)
}

fn takes_operands(op: Op) -> bool {
    !op.is_jump()
        && !matches!(
            op,
            Op::Hlt
                | Op::Nop
                | Op::Cbw
                | Op::Cwd
                | Op::Clc
                | Op::Stc
                | Op::Cmc
                | Op::Cld
                | Op::Std
                | Op::Sti
                | Op::Cli
                | Op::Pushf
                | Op::Popf
                | Op::Print
        )
        && !op.is_string_op()
}

impl Parser {
    pub fn new(toks: Vec<Token>, lines: Vec<String>) -> Self {
        Parser { toks, pos: 0, lines, macros: Vec::new(), pending_data_size: Size::Byte }
    }

    fn peek(&self) -> Option<&Token> {
        self.toks.get(self.pos)
    }
    fn peek_at(&self, off: usize) -> Option<&Token> {
        self.toks.get(self.pos + off)
    }
    fn cur_line(&self) -> usize {
        self.peek().map(|t| t.line).unwrap_or(self.lines.len())
    }
    fn is_ident(&self, off: usize, word: &str) -> bool {
        matches!(self.peek_at(off), Some(Token { tok: Tok::Ident(s), .. }) if up(s) == up(word))
    }
    fn line_text(&self, line: usize) -> String {
        self.lines.get(line - 1).cloned().unwrap_or_default()
    }
    /// Instruction text shown in the UI: source line from the mnemonic column
    /// onwards, with any trailing comment removed.
    fn instr_text(&self, line: usize, col: usize) -> String {
        let raw = self.line_text(line);
        let no_comment = match raw.find(';') {
            Some(i) => raw[..i].to_string(),
            None => raw,
        };
        let start = no_comment
            .char_indices()
            .nth(col.saturating_sub(1))
            .map(|(i, _)| i)
            .unwrap_or(0);
        no_comment[start..].trim().to_string()
    }
    fn skip_line(&mut self) {
        if let Some(l) = self.peek().map(|t| t.line) {
            while let Some(t) = self.peek() {
                if t.line != l {
                    break;
                }
                self.pos += 1;
            }
        }
    }

    // ------------------------------------------------------------- macros
    /// Expand legacy `MACRO name(a,b) -> body <-` definitions and calls at
    /// token level so the rest of the parser only sees concrete instructions.
    fn expand_macros(&mut self) -> Result<(), ParseError> {
        let mut i = 0usize;
        let mut defs: Vec<MacroDef> = Vec::new();
        let mut remove: Vec<usize> = Vec::new();
        while i < self.toks.len() {
            if let Token { tok: Tok::Ident(s), line, col } = &self.toks[i] {
                if up(s) == "MACRO" {
                    let (mline, mcol) = (*line, *col);
                    let mut j = i + 1;
                    let name = match self.toks.get(j) {
                        Some(Token { tok: Tok::Ident(n), .. }) => n.to_ascii_lowercase(),
                        _ => return err(mline, mcol, "Syntax: MACRO name(params) -> body <-"),
                    };
                    j += 1;
                    if !matches!(self.toks.get(j), Some(Token { tok: Tok::LParen, .. })) {
                        return err(mline, mcol, "Syntax: MACRO name(params) -> body <-");
                    }
                    j += 1;
                    let mut params = Vec::new();
                    loop {
                        match self.toks.get(j) {
                            Some(Token { tok: Tok::RParen, .. }) => {
                                j += 1;
                                break;
                            }
                            Some(Token { tok: Tok::Ident(p), .. }) => {
                                params.push(p.to_ascii_lowercase());
                                j += 1;
                                if matches!(self.toks.get(j), Some(Token { tok: Tok::Comma, .. })) {
                                    j += 1;
                                }
                            }
                            Some(t) => {
                                return err(t.line, t.col, "Syntax: MACRO name(params) -> body <-")
                            }
                            None => return err(mline, mcol, "Unterminated MACRO definition"),
                        }
                    }
                    if !matches!(self.toks.get(j), Some(Token { tok: Tok::Arrow, .. })) {
                        return err(mline, mcol, "MACRO definition must use '-> body <-'");
                    }
                    j += 1;
                    let body_start = j;
                    while j < self.toks.len()
                        && !matches!(self.toks.get(j), Some(Token { tok: Tok::LArrow, .. }))
                    {
                        j += 1;
                    }
                    if j >= self.toks.len() {
                        return err(mline, mcol, "Unterminated MACRO definition ('<-')");
                    }
                    let body = self.toks[body_start..j].to_vec();
                    defs.push(MacroDef { name, params, body });
                    for k in i..=j {
                        remove.push(k);
                    }
                    i = j + 1;
                    continue;
                }
            }
            i += 1;
        }
        if !remove.is_empty() {
            let set: std::collections::HashSet<usize> = remove.into_iter().collect();
            self.toks = self
                .toks
                .iter()
                .enumerate()
                .filter(|(k, _)| !set.contains(k))
                .map(|(_, t)| t.clone())
                .collect();
        }
        self.macros = defs;
        if self.macros.is_empty() {
            return Ok(());
        }
        for _ in 0..10 {
            let mut expanded = false;
            let mut out: Vec<Token> = Vec::new();
            let mut i = 0usize;
            while i < self.toks.len() {
                let is_call = match &self.toks[i] {
                    Token { tok: Tok::Ident(s), line, col }
                        if self.macros.iter().any(|m| m.name == s.to_ascii_lowercase()) =>
                    {
                        if matches!(self.toks.get(i + 1).map(|t| &t.tok), Some(Tok::LParen)) {
                            Some((*line, *col))
                        } else {
                            None
                        }
                    }
                    _ => None,
                };
                if let Some((line, col)) = is_call {
                    let name = match &self.toks[i].tok {
                        Tok::Ident(s) => s.to_ascii_lowercase(),
                        _ => unreachable!(),
                    };
                    let mut depth = 0usize;
                    let mut j = i + 1;
                    let mut close = None;
                    while j < self.toks.len() {
                        match self.toks[j].tok {
                            Tok::LParen => depth += 1,
                            Tok::RParen => {
                                depth -= 1;
                                if depth == 0 {
                                    close = Some(j);
                                    break;
                                }
                            }
                            _ => {}
                        }
                        j += 1;
                    }
                    let close = match close {
                        Some(c) => c,
                        None => return err(line, col, "Unterminated macro call"),
                    };
                    let mut args: Vec<Vec<Token>> = Vec::new();
                    let mut cur: Vec<Token> = Vec::new();
                    let mut d = 0i32;
                    for t in &self.toks[i + 2..close] {
                        match t.tok {
                            Tok::LParen => {
                                d += 1;
                                cur.push(t.clone());
                            }
                            Tok::RParen => {
                                d -= 1;
                                cur.push(t.clone());
                            }
                            Tok::Comma if d == 0 => {
                                args.push(std::mem::take(&mut cur));
                            }
                            _ => cur.push(t.clone()),
                        }
                    }
                    if !cur.is_empty() {
                        args.push(cur);
                    }
                    let def = self.macros.iter().find(|m| m.name == name).unwrap();
                    if args.len() != def.params.len() {
                        return err(
                            line,
                            col,
                            format!(
                                "Macro '{}' expects {} argument(s), got {}",
                                def.name,
                                def.params.len(),
                                args.len()
                            ),
                        );
                    }
                    for bt in &def.body {
                        if let Tok::Ident(p) = &bt.tok {
                            if let Some(idx) =
                                def.params.iter().position(|x| x == &p.to_ascii_lowercase())
                            {
                                out.extend(args[idx].iter().cloned());
                                continue;
                            }
                        }
                        out.push(bt.clone());
                    }
                    i = close + 1;
                    expanded = true;
                    continue;
                }
                out.push(self.toks[i].clone());
                i += 1;
            }
            self.toks = out;
            if !expanded {
                break;
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------ statements
    pub fn parse(mut self) -> Result<Vec<Stmt>, ParseError> {
        self.expand_macros()?;
        let mut stmts: Vec<Stmt> = Vec::new();
        while self.peek().is_some() {
            self.parse_statement(&mut stmts)?;
        }
        Ok(stmts)
    }

    fn parse_statement(&mut self, stmts: &mut Vec<Stmt>) -> Result<(), ParseError> {
        // optional label: IDENT ':'
        let mut label: Option<String> = None;
        let label_pair = matches!(
            (self.peek(), self.peek_at(1)),
            (Some(Token { tok: Tok::Ident(s), line, .. }), Some(Token { tok: Tok::Colon, .. }))
                if !s.starts_with('.')
        );
        if label_pair {
            let (s, line, col) = match (self.peek().cloned(), self.peek_at(1).cloned()) {
                (Some(Token { tok: Tok::Ident(s), line, col, .. }), _) => (s, line, col),
                _ => unreachable!(),
            };
            if s.starts_with('.') {
                return err(line, col, "Labels cannot start with '.'");
            }
            self.pos += 2;
            let same_line = self.peek().map(|t| t.line == line).unwrap_or(false);
            if !same_line {
                // standalone label line
                stmts.push(Stmt::DefLabel { name: s, line });
                return Ok(());
            }
            label = Some(s);
        }

        // colon-less data label (MASM): `VALUE DW 1234H`
        if label.is_none() {
            let pair = match (self.peek().cloned(), self.peek_at(1).cloned()) {
                (
                    Some(Token { tok: Tok::Ident(n), line: l1, .. }),
                    Some(Token { tok: Tok::Ident(w), line: l2, .. }),
                ) => Some((n, l1, w, l2)),
                _ => None,
            };
            if let Some((n, l1, w, l2)) = pair {
                let wu = up(&w);
                if l1 == l2 && !n.starts_with('.') && (wu == "DB" || wu == "DW") {
                    label = Some(n);
                    self.pos += 1;
                }
            }
        }

        let t = match self.peek().cloned() {
            Some(t) => t,
            None => return Ok(()),
        };
        let (line, col) = (t.line, t.col);
        let word = match &t.tok {
            Tok::Ident(s) => s.clone(),
            _ => return err(line, col, "Expected a statement"),
        };
        let u = up(&word);

        // directives / markers -------------------------------------------------
        if u == ".DATA" || u == ".CODE" {
            self.pos += 1;
            stmts.push(Stmt::Marker { line });
            return Ok(());
        }
        if word.starts_with('.') {
            // .STACK n / .MODEL ... : accept and skip the rest of the line
            self.pos += 1;
            self.skip_line();
            stmts.push(Stmt::Marker { line });
            return Ok(());
        }
        if u == "END" {
            self.pos += 1;
            let mut target = None;
            if let Some(Token { tok: Tok::Ident(s), line: l2, .. }) = self.peek().cloned() {
                if l2 == line {
                    target = Some(s);
                    self.pos += 1;
                }
            }
            stmts.push(Stmt::End { line, target });
            return Ok(());
        }
        if self.is_ident(1, "PROC") {
            // `name PROC [NEAR|FAR]` - define the routine label where its
            // first instruction will be (resolved by sema as a code label)
            if let Some(l) = label.take() {
                stmts.push(Stmt::DefLabel { name: l, line });
            }
            if let Some(Token { tok: Tok::Ident(n), .. }) = self.peek().cloned() {
                stmts.push(Stmt::DefLabel { name: n, line });
            }
            self.pos += 2;
            if let Some(Token { tok: Tok::Ident(s), .. }) = self.peek().cloned() {
                let uu = up(&s);
                if (uu == "NEAR" || uu == "FAR") && self.cur_line() == line {
                    self.pos += 1;
                }
            }
            stmts.push(Stmt::Marker { line });
            return Ok(());
        }
        if u == "ENDP" || self.is_ident(1, "ENDP") {
            // both `ENDP` and `name ENDP` forms
            self.pos += if u == "ENDP" { 1 } else { 2 };
            stmts.push(Stmt::Marker { line });
            return Ok(());
        }
        if u == "SET" {
            self.pos += 1;
            let v = match self.peek().cloned() {
                Some(Token { tok: Tok::Num(v), .. }) => {
                    self.pos += 1;
                    v
                }
                Some(t2) => {
                    return err(t2.line, t2.col, "SET expects a numeric paragraph number")
                }
                None => return err(line, col, "SET expects a value"),
            };
            stmts.push(Stmt::SetAddr { line, value: v });
            return Ok(());
        }
        if u == "PRINT" {
            self.pos += 1;
            self.skip_line();
            stmts.push(Stmt::Instr {
                label,
                instr: Instr {
                    op: Op::Print,
                    line,
                    text: self.instr_text(line, col),
                    dst: None,
                    src: None,
                    size: None,
                    rep: None,
                },
            });
            return Ok(());
        }
        // data ---------------------------------------------------------------
        if u == "DB" || u == "DW" {
            self.pos += 1;
            let size = if u == "DB" { Size::Byte } else { Size::Word };
            self.pending_data_size = size;
            let items = self.parse_data_items()?;
            stmts.push(Stmt::Data { line, label, size, items });
            return Ok(());
        }

        // REP prefix ----------------------------------------------------------
        let mut rep: Option<RepKind> = None;
        if u == "REP" {
            rep = Some(RepKind::Rep);
            self.pos += 1;
        } else if u == "REPE" || u == "REPZ" {
            rep = Some(RepKind::Repe);
            self.pos += 1;
        } else if u == "REPNE" || u == "REPNZ" {
            rep = Some(RepKind::Repne);
            self.pos += 1;
        }
        let mnem_tok = match self.peek().cloned() {
            Some(t) => t,
            None => return err(line, col, "Unexpected end of program"),
        };
        let mnem = match &mnem_tok.tok {
            Tok::Ident(s) => up(s),
            _ => {
                return err(
                    mnem_tok.line,
                    mnem_tok.col,
                    format!("Unexpected '{}'", token_str(&mnem_tok.tok)),
                )
            }
        };
        let op = match op_from_mnemonic(&mnem) {
            Some(op) => op,
            None => {
                return err(
                    mnem_tok.line,
                    mnem_tok.col,
                    format!("Unknown instruction or directive '{}'", mnem),
                )
            }
        };
        if rep.is_some() && !op.is_string_op() {
            return err(line, col, "REP prefix is only allowed on string instructions");
        }
        self.pos += 1;
        let text = self.instr_text(mnem_tok.line, mnem_tok.col);

        // operands -------------------------------------------------------------
        let mut dst = None;
        let mut src = None;
        if op.is_jump() {
            while self.is_ident(0, "SHORT")
                || self.is_ident(0, "NEAR")
                || self.is_ident(0, "FAR")
                || self.is_ident(0, "PTR")
            {
                self.pos += 1;
            }
            match self.peek().cloned() {
                Some(Token { tok: Tok::Ident(s), .. }) => {
                    self.pos += 1;
                    dst = Some(Operand::Label(s));
                }
                Some(t) => return err(t.line, t.col, "Jumps require a label target"),
                None => return err(mnem_tok.line, mnem_tok.col, "Jumps require a label target"),
            }
        } else if op == Op::Int {
            dst = Some(self.parse_operand()?);
        } else if op == Op::Ret {
            // optional immediate (RET n) pops the return address then adds n to SP
            if let Some(Token { tok: Tok::Num(v), line: l2, col: c2 }) = self.peek().cloned() {
                if l2 == mnem_tok.line {
                    self.pos += 1;
                    dst = Some(Operand::Imm(Expr::Num(v)));
                    let _ = (l2, c2);
                }
            }
        } else if takes_operands(op) {
            dst = Some(self.parse_operand()?);
            if self.peek().map(|t| t.tok == Tok::Comma).unwrap_or(false) {
                self.pos += 1;
                src = Some(self.parse_operand()?);
                if self.peek().map(|t| t.tok == Tok::Comma).unwrap_or(false) {
                    return err(line, col, "8086 instructions take at most two operands");
                }
            }
        } else {
            // no-operand operations: reject leftover junk on the same line
            if let Some(t3) = self.peek().cloned() {
                if t3.line == mnem_tok.line {
                    return err(t3.line, t3.col, format!("Unexpected '{}'", token_str(&t3.tok)));
                }
            }
        }

        stmts.push(Stmt::Instr {
            label,
            instr: Instr { op, line: mnem_tok.line, text, dst, src, size: None, rep },
        });
        Ok(())
    }

    // ------------------------------------------------------------- operands
    fn parse_operand(&mut self) -> Result<Operand, ParseError> {
        // size keyword: BYTE/WORD [PTR]
        let mut size: Option<Size> = None;
        let mut size_pos: (usize, usize) = (0, 0);
        if let Some(Token { tok: Tok::Ident(s), line, col }) = self.peek().cloned() {
            let u = up(&s);
            if u == "BYTE" || u == "WORD" {
                size = Some(if u == "BYTE" { Size::Byte } else { Size::Word });
                size_pos = (line, col);
                self.pos += 1;
                if self.is_ident(0, "PTR") {
                    self.pos += 1;
                }
            }
        }
        // segment override: DS:[..], DS[..], ES:name
        let mut seg: Option<Reg> = None;
        if let Some(Token { tok: Tok::Ident(s), .. }) = self.peek().cloned() {
            if let Some(sr) = seg_from_name(&s) {
                let next_is_override = matches!(
                    self.peek_at(1).map(|t| &t.tok),
                    Some(Tok::Colon) | Some(Tok::LBracket)
                );
                if next_is_override {
                    seg = Some(sr);
                    self.pos += 1;
                    if self.peek().map(|t| t.tok == Tok::Colon).unwrap_or(false) {
                        self.pos += 1;
                    }
                }
            }
        }
        let t = match self.peek().cloned() {
            Some(t) => t,
            None => return err(0, 0, "Expected an operand"),
        };
        let (line, col) = (t.line, t.col);
        match t.tok {
            Tok::Num(v) => {
                self.pos += 1;
                if size.is_some() {
                    return err(size_pos.0, size_pos.1, "Size keyword requires a register or memory operand");
                }
                Ok(Operand::Imm(Expr::Num(v)))
            }
            Tok::Str(s) => {
                self.pos += 1;
                if size.is_some() {
                    return err(size_pos.0, size_pos.1, "Size keyword requires a register or memory operand");
                }
                let b = s.as_bytes();
                match b.len() {
                    1 => Ok(Operand::Imm(Expr::Num(b[0] as i32))),
                    2 => Ok(Operand::Imm(Expr::Num(((b[0] as i32) << 8) | b[1] as i32))),
                    _ => err(line, col, "Character constant too long (max 2 characters)"),
                }
            }
            Tok::LBracket => {
                let terms = self.parse_bracket()?;
                Ok(Operand::Mem(MemOperand { seg, size, terms, line, col }))
            }
            Tok::Ident(s) => {
                let u = up(&s);
                if u == "OFFSET" {
                    self.pos += 1;
                    return match self.advance_tok() {
                        Some(Token { tok: Tok::Ident(name), .. }) => {
                            if size.is_some() {
                                return err(size_pos.0, size_pos.1, "Size keyword cannot be used with OFFSET");
                            }
                            if seg.is_some() {
                                return err(line, col, "Segment override cannot be used with OFFSET");
                            }
                            Ok(Operand::Imm(Expr::Offset(name)))
                        }
                        Some(t2) => err(t2.line, t2.col, "OFFSET requires a symbol"),
                        None => err(line, col, "OFFSET requires a symbol"),
                    };
                }
                if u == "SEG" {
                    self.pos += 1;
                    return match self.advance_tok() {
                        Some(Token { tok: Tok::Ident(name), .. }) => {
                            if size.is_some() {
                                return err(size_pos.0, size_pos.1, "Size keyword cannot be used with SEG");
                            }
                            Ok(Operand::Imm(Expr::Seg(name)))
                        }
                        Some(t2) => err(t2.line, t2.col, "SEG requires a symbol"),
                        None => err(line, col, "SEG requires a symbol"),
                    };
                }
                if let Some(r) = reg16_from_name(&s) {
                    self.pos += 1;
                    if size.is_some() {
                        return err(size_pos.0, size_pos.1, format!("Size keyword conflicts with register '{}'", s));
                    }
                    if seg.is_some() {
                        return err(line, col, "Unexpected segment override before register");
                    }
                    if r.is_seg() {
                        return Ok(Operand::Seg(r));
                    }
                    return Ok(Operand::R16(r));
                }
                if let Some(r) = reg8_from_name(&s) {
                    self.pos += 1;
                    if size.is_some() {
                        return err(size_pos.0, size_pos.1, format!("Size keyword conflicts with register '{}'", s));
                    }
                    if seg.is_some() {
                        return err(line, col, "Unexpected segment override before register");
                    }
                    return Ok(Operand::R8(r));
                }
                // direct memory or letter-initial numeric constant
                self.pos += 1;
                if size.is_none() && seg.is_none() && (looks_like_hex_ident(&s) || looks_like_binary_ident(&s)) {
                    let v = super::lexer::parse_number(&s)
                        .map_err(|m| ParseError { line, col, msg: m })?;
                    return Ok(Operand::Imm(Expr::Num(v)));
                }
                Ok(Operand::Mem(MemOperand {
                    seg,
                    size,
                    terms: vec![Term::Sym(s)],
                    line,
                    col,
                }))
            }
            _ => err(line, col, format!("Unexpected '{}'", token_str(&t.tok))),
        }
    }

    fn advance_tok(&mut self) -> Option<Token> {
        let t = self.toks.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn parse_bracket(&mut self) -> Result<Vec<Term>, ParseError> {
        let open = self.advance_tok().unwrap(); // '['
        let (line, col) = (open.line, open.col);
        let mut terms: Vec<Term> = Vec::new();
        let mut expect_term = true;
        let mut negate = false;
        loop {
            let t = match self.peek().cloned() {
                Some(t) => t,
                None => return err(line, col, "Unterminated '['"),
            };
            match t.tok {
                Tok::RBracket => {
                    if expect_term {
                        if terms.is_empty() {
                            return err(line, col, "Empty memory operand '[]'");
                        }
                        return err(t.line, t.col, "Expected a term before ']'");
                    }
                    self.pos += 1;
                    break;
                }
                Tok::Plus => {
                    if expect_term {
                        return err(t.line, t.col, "Unexpected '+'");
                    }
                    self.pos += 1;
                    expect_term = true;
                    negate = false;
                }
                Tok::Minus => {
                    if !expect_term {
                        return err(t.line, t.col, "Unexpected '-'");
                    }
                    self.pos += 1;
                    negate = true;
                }
                Tok::Num(v) => {
                    if !expect_term {
                        return err(t.line, t.col, "Expected '+' or '-' between terms");
                    }
                    self.pos += 1;
                    terms.push(Term::Num(if negate { -v } else { v }));
                    expect_term = false;
                    negate = false;
                }
                Tok::Ident(ref s) => {
                    if !expect_term {
                        return err(t.line, t.col, "Expected '+' or '-' between terms");
                    }
                    if let Some(r) = reg16_from_name(s) {
                        if r.is_seg() {
                            return err(t.line, t.col, "Segment register cannot appear inside '[]'");
                        }
                        self.pos += 1;
                        terms.push(Term::Reg(r));
                        expect_term = false;
                        negate = false;
                    } else if reg8_from_name(s).is_some() {
                        return err(t.line, t.col, "8-bit registers cannot appear inside '[]'");
                    } else if looks_like_hex_ident(s) || looks_like_binary_ident(s) {
                        let v = super::lexer::parse_number(s)
                            .map_err(|m| ParseError { line: t.line, col: t.col, msg: m })?;
                        self.pos += 1;
                        terms.push(Term::Num(if negate { -v } else { v }));
                        expect_term = false;
                        negate = false;
                    } else {
                        self.pos += 1;
                        terms.push(Term::Sym(s.clone()));
                        expect_term = false;
                        negate = false;
                    }
                }
                _ => {
                    return err(
                        t.line,
                        t.col,
                        format!("Unexpected '{}' in memory operand", token_str(&t.tok)),
                    )
                }
            }
        }
        Ok(terms)
    }

    // ----------------------------------------------------------------- data
    fn parse_data_items(&mut self) -> Result<Vec<DataItem>, ParseError> {
        let mut items: Vec<DataItem> = Vec::new();
        loop {
            let t = match self.peek().cloned() {
                Some(t) => t,
                None => break,
            };
            if t.tok == Tok::LBracket {
                // array literal [a, b, c] - size comes from the DB/DW keyword
                self.pos += 1;
                let size = self.pending_data_size;
                let mut vals: Vec<i32> = Vec::new();
                loop {
                    match self.peek().cloned() {
                        Some(Token { tok: Tok::RBracket, .. }) => {
                            self.pos += 1;
                            break;
                        }
                        Some(Token { tok: Tok::Num(v), .. }) => {
                            vals.push(v);
                            self.pos += 1;
                            if self.peek().map(|x| x.tok == Tok::Comma).unwrap_or(false) {
                                self.pos += 1;
                            }
                        }
                        Some(t2) => return err(t2.line, t2.col, "Array literal expects numbers"),
                        None => return err(t.line, t.col, "Unterminated array literal"),
                    }
                }
                match size {
                    Size::Byte => items.push(DataItem::Bytes(vals.into_iter().map(|v| v as u8).collect())),
                    Size::Word => items.push(DataItem::Words(vals.into_iter().map(|v| v as u16).collect())),
                }
            } else if let Tok::Str(s) = t.tok.clone() {
                self.pos += 1;
                match self.pending_data_size {
                    Size::Byte => items.push(DataItem::Bytes(s.as_bytes().to_vec())),
                    Size::Word => return err(t.line, t.col, "Strings are only allowed with DB"),
                }
            } else {
                let v = self.parse_additive()?;
                if self.is_ident(0, "DUP") {
                    let count_line = t.line;
                    self.pos += 1;
                    if !matches!(self.peek().map(|x| &x.tok), Some(Tok::LParen)) {
                        return err(count_line, t.col, "DUP expects parentheses: n DUP(...)");
                    }
                    self.pos += 1;
                    let inner = self.parse_data_items()?;
                    if !matches!(self.peek().map(|x| &x.tok), Some(Tok::RParen)) {
                        return err(count_line, t.col, "DUP expects a closing ')'");
                    }
                    self.pos += 1;
                    if v < 0 || v > 65535 {
                        return err(count_line, t.col, "DUP count out of range");
                    }
                    for _ in 0..v {
                        for it in &inner {
                            items.push(it.clone());
                        }
                    }
                } else {
                    match self.pending_data_size {
                        Size::Byte => {
                            if v < -128 || v > 255 {
                                return err(t.line, t.col, format!("Value {} does not fit in DB", v));
                            }
                            items.push(DataItem::Bytes(vec![v as u8]));
                        }
                        Size::Word => {
                            if v < -32768 || v > 65535 {
                                return err(t.line, t.col, format!("Value {} does not fit in DW", v));
                            }
                            items.push(DataItem::Words(vec![v as u16]));
                        }
                    }
                }
            }
            match self.peek().map(|t| t.tok.clone()) {
                Some(Tok::Comma) => {
                    self.pos += 1;
                    continue;
                }
                _ => break,
            }
        }
        if items.is_empty() {
            return err(0, 0, "Data declaration requires at least one value");
        }
        Ok(items)
    }

    /// additive expression of numeric terms (data values, DUP counts)
    fn parse_additive(&mut self) -> Result<i32, ParseError> {
        let mut acc: Option<i32> = None;
        let mut sign = 1i32;
        loop {
            let t = match self.peek().cloned() {
                Some(t) => t,
                None => break,
            };
            match t.tok {
                Tok::Plus => {
                    if acc.is_none() {
                        return err(t.line, t.col, "Unexpected '+'");
                    }
                    sign = 1;
                    self.pos += 1;
                }
                Tok::Minus => {
                    if acc.is_none() {
                        sign = -1;
                        self.pos += 1;
                        continue;
                    }
                    sign = -1;
                    self.pos += 1;
                }
                Tok::Num(v) => {
                    self.pos += 1;
                    let v = v * sign;
                    acc = Some(match acc {
                        None => v,
                        Some(a) => a + v,
                    });
                    sign = 1;
                }
                Tok::Ident(ref s) => {
                    if looks_like_hex_ident(s) || looks_like_binary_ident(s) {
                        let v = super::lexer::parse_number(s)
                            .map_err(|m| ParseError { line: t.line, col: t.col, msg: m })?;
                        self.pos += 1;
                        let v = v * sign;
                        acc = Some(match acc {
                            None => v,
                            Some(a) => a + v,
                        });
                        sign = 1;
                    } else {
                        break;
                    }
                }
                _ => break,
            }
        }
        match acc {
            Some(v) => Ok(v),
            None => match self.peek().cloned() {
                Some(t2) => err(t2.line, t2.col, "Expected a numeric expression"),
                None => err(0, 0, "Expected a numeric expression"),
            },
        }
    }
}
