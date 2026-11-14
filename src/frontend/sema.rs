// Semantic analysis: symbol resolution, operand/addressing-mode validation
// and lowering of statements into the executable `Program`.

use super::ast::*;
use std::collections::HashMap;

pub struct SemaError {
    pub line: usize,
    pub col: usize,
    pub msg: String,
}

fn err<T>(line: usize, col: usize, msg: impl Into<String>) -> Result<T, SemaError> {
    Err(SemaError { line, col, msg: msg.into() })
}

pub struct Program {
    pub instrs: Vec<Instr>,
    pub entry: usize,
    pub data_init: Vec<(u32, u8)>,
    pub data_labels: HashMap<String, u16>,
    pub code_labels: HashMap<String, usize>,
    pub lines: Vec<String>,
    /// `.STACK n` initial SP (None = the DOS default of FFFEh).
    pub stack_size: Option<u16>,
}

/// MASM predefined segment constants. The runtime is one flat 1 MB segment,
/// so every segment starts at paragraph 0.
pub fn is_segment_const(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "@DATA" | "@CODE" | "@STACK" | "@CONST" | "@FARDATA" | "@DATA?" | "@CODE?"
    )
}

fn op_size(o: &Operand) -> Option<Size> {
    match o {
        Operand::R8(_) => Some(Size::Byte),
        Operand::R16(_) | Operand::Seg(_) => Some(Size::Word),
        Operand::Mem(m) => m.size,
        Operand::Imm(_) | Operand::Label(_) => None,
    }
}

fn op_is_mem(o: &Operand) -> bool {
    matches!(o, Operand::Mem(_))
}

fn check_imm(v: i32, size: Size, line: usize, col: usize, what: &str) -> Result<(), SemaError> {
    let ok = match size {
        Size::Byte => (-128..=255).contains(&v),
        Size::Word => (-32768..=65535).contains(&v),
    };
    if !ok {
        return err(
            line,
            col,
            format!("Immediate {} does not fit in {} operand ({})", v, match size { Size::Byte => "byte", Size::Word => "word" }, what),
        );
    }
    Ok(())
}

/// Fold memory terms into (base, index, displacement) after resolving symbols,
/// enforcing the original 8086 effective-address combinations.
fn fold_mem(
    m: &MemOperand,
    data_labels: &HashMap<String, u16>,
    code_labels: &HashMap<String, usize>,
) -> Result<(Option<Reg>, Option<Reg>, i32), SemaError> {
    let mut base: Option<Reg> = None;
    let mut index: Option<Reg> = None;
    let mut disp: i32 = 0;
    for t in &m.terms {
        match t {
            Term::Num(v) => disp = disp.saturating_add(*v),
            Term::Sym(name) => {
                if is_segment_const(name) {
                    // @DATA etc. are paragraph 0 in the flat memory model
                } else if code_labels.contains_key(name) {
                    return err(m.line, m.col, format!("Label '{}' is code, not data", name));
                } else {
                    match data_labels.get(name) {
                        Some(v) => disp = disp.saturating_add(*v as i32),
                        None => {
                            return err(m.line, m.col, format!("Label '{}' used but not defined", name))
                        }
                    }
                }
            }
            Term::Reg(r) => match r {
                Reg::BX | Reg::BP => {
                    if base.is_some() {
                        return err(
                            m.line,
                            m.col,
                            "Invalid memory operand: cannot combine two base registers (BX/BP)",
                        );
                    }
                    base = Some(*r);
                }
                Reg::SI | Reg::DI => {
                    if index.is_some() {
                        return err(
                            m.line,
                            m.col,
                            "Invalid memory operand: cannot combine two index registers (SI/DI)",
                        );
                    }
                    index = Some(*r);
                }
                other => {
                    return err(
                        m.line,
                        m.col,
                        format!("Register {} is not allowed in a memory operand", reg_name16(*other)),
                    )
                }
            },
        }
    }
    // BX+BP or SI+DI are already rejected above (two bases / two indexes).
    if disp < -32768 || disp > 65535 {
        return err(m.line, m.col, format!("Displacement {} out of 16-bit range", disp));
    }
    Ok((base, index, disp))
}

fn reg_name16(r: Reg) -> &'static str {
    match r {
        Reg::AX => "AX",
        Reg::CX => "CX",
        Reg::DX => "DX",
        Reg::BX => "BX",
        Reg::SP => "SP",
        Reg::BP => "BP",
        Reg::SI => "SI",
        Reg::DI => "DI",
        Reg::ES => "ES",
        Reg::CS => "CS",
        Reg::SS => "SS",
        Reg::DS => "DS",
    }
}

/// Resolve an operand in place: symbols -> numbers, labels stay for jumps.
fn resolve_operand(
    o: &mut Operand,
    data_labels: &HashMap<String, u16>,
    code_labels: &HashMap<String, usize>,
    fallback_line: usize,
) -> Result<(), SemaError> {
    let (line, col) = match o {
        Operand::Mem(m) => (m.line, m.col),
        _ => (fallback_line, 0),
    };
    match o {
        Operand::Imm(e) => match e {
            Expr::Num(_) => Ok(()),
            Expr::Offset(name) => {
                if is_segment_const(name) {
                    *e = Expr::Num(0);
                    return Ok(());
                }
                if code_labels.contains_key(name) {
                    return err(line, col, format!("OFFSET requires data, '{}' is code", name));
                }
                match data_labels.get(name) {
                    Some(v) => {
                        *e = Expr::Num(*v as i32);
                        Ok(())
                    }
                    None => err(line, col, format!("Label '{}' used but not defined", name)),
                }
            }
            Expr::Seg(_) => err(line, col, "SEG operator is not supported (use OFFSET)"),
        },
        Operand::Mem(m) => {
            // validate + resolve symbols, folding to base/index/disp
            let (base, index, disp) = fold_mem(m, data_labels, code_labels)?;
            let mut new_terms = Vec::new();
            if let Some(b) = base {
                new_terms.push(Term::Reg(b));
            }
            if let Some(i) = index {
                new_terms.push(Term::Reg(i));
            }
            new_terms.push(Term::Num(disp));
            m.terms = new_terms;
            Ok(())
        }
        Operand::Label(_) => Ok(()),
        Operand::R8(_) | Operand::R16(_) | Operand::Seg(_) => Ok(()),
    }
}

fn resolve_symbolic_line(o: &Operand) -> (usize, usize) {
    match o {
        Operand::Mem(m) => (m.line, m.col),
        _ => (0, 0),
    }
}

fn resolve_pending_data(
    origin: u32,
    data_labels: &mut HashMap<String, u16>,
    code_labels: &HashMap<String, usize>,
    pending: &mut Vec<(String, usize)>,
) -> Result<(), SemaError> {
    for (name, pline) in pending.drain(..) {
        if code_labels.contains_key(&name) || data_labels.contains_key(&name) {
            return err(pline, 0, format!("Label '{}' already defined", name));
        }
        if origin > 0xFFFF {
            return err(pline, 0, format!("Label '{}' beyond 64 KB data segment", name));
        }
        data_labels.insert(name, origin as u16);
    }
    Ok(())
}

pub fn analyze(stmts: Vec<Stmt>, lines: Vec<String>) -> Result<Program, SemaError> {
    let mut instrs: Vec<Instr> = Vec::new();
    let mut data_init: Vec<(u32, u8)> = Vec::new();
    let mut data_labels: HashMap<String, u16> = HashMap::new();
    let mut code_labels: HashMap<String, usize> = HashMap::new();
    let mut origin: u32 = 0;
    let mut stack_size: Option<u16> = None;
    let mut pending: Vec<(String, usize)> = Vec::new();
    let mut end_target: Option<String> = None;
    let mut end_line: usize = 1;
    let last_line = lines.len();

    for stmt in stmts {
        match stmt {
            Stmt::DefLabel { name, line } => {
                pending.push((name, line));
            }
            Stmt::Marker { .. } => {}
            Stmt::SetAddr { line, value } => {
                resolve_pending_data(origin, &mut data_labels, &code_labels, &mut pending)?;
                if value < 0 {
                    return err(line, 0, "SET expects a non-negative paragraph number");
                }
                let new_origin = (value as u32) * 16;
                if new_origin > 0xFFFFF {
                    return err(line, 0, "SET address beyond 1 MB");
                }
                origin = new_origin;
            }
            Stmt::SetStack { line, size } => {
                if stack_size.is_some() {
                    return err(line, 0, "duplicate .STACK directive");
                }
                stack_size = Some(size);
            }
            Stmt::End { line, target } => {
                end_target = target;
                end_line = line;
            }
            Stmt::Data { line, label, size, items } => {
                if let Some(l) = label {
                    pending.push((l, line));
                }
                resolve_pending_data(origin, &mut data_labels, &code_labels, &mut pending)?;
                for item in items {
                    match item {
                        DataItem::Bytes(v) => {
                            for b in v {
                                if origin > 0xFFFFF {
                                    return err(line, 0, "Program data exceeds 1 MB");
                                }
                                data_init.push((origin, b));
                                origin += 1;
                            }
                        }
                        DataItem::Words(ws) => {
                            for w in ws {
                                if origin > 0xFFFFF {
                                    return err(line, 0, "Program data exceeds 1 MB");
                                }
                                data_init.push((origin, (w & 0xff) as u8));
                                data_init.push((origin + 1, (w >> 8) as u8));
                                origin += 2;
                            }
                        }
                    }
                }
            }
            Stmt::Instr { label, mut instr } => {
                if let Some(l) = label {
                    pending.push((l, instr.line));
                }
                for (name, pline) in pending.drain(..) {
                    if code_labels.contains_key(&name) || data_labels.contains_key(&name) {
                        return err(pline, 0, format!("Label '{}' already defined", name));
                    }
                    code_labels.insert(name, instrs.len());
                }
                // validation happens in a second pass once every symbol
                // (including forward jumps and later data) is known
                instrs.push(instr);
            }
        }
    }
    // dangling labels at end of file
    if !pending.is_empty() {
        if !instrs.is_empty() {
            for (name, pline) in pending.drain(..) {
                if code_labels.contains_key(&name) || data_labels.contains_key(&name) {
                    return err(pline, 0, format!("Label '{}' already defined", name));
                }
                code_labels.insert(name, instrs.len());
            }
        } else {
            resolve_pending_data(origin, &mut data_labels, &code_labels, &mut pending)?;
        }
    }

    if instrs.is_empty() {
        return err(end_line, 0, "Program contains no instructions");
    }

    // second pass: resolve symbols + validate operands (all labels exist now)
    for instr in instrs.iter_mut() {
        validate_and_resolve(instr, &data_labels, &code_labels)?;
    }

    // entry point: END label wins, otherwise the first instruction
    let entry = match end_target {
        Some(t) => match code_labels.get(&t) {
            Some(i) => *i,
            None => {
                if data_labels.contains_key(&t) {
                    return err(end_line, 0, format!("Cannot start execution at data label '{}'", t));
                }
                return err(end_line, 0, format!("Label '{}' used but not defined", t));
            }
        },
        None => 0,
    };

    // implicit halt so programs without HLT terminate deterministically
    let halt_line = instrs.last().map(|i| i.line).unwrap_or(last_line);
    instrs.push(Instr {
        op: Op::Hlt,
        line: halt_line,
        text: "HLT".to_string(),
        dst: None,
        src: None,
        size: None,
        rep: None,
    });

    Ok(Program { instrs, entry, data_init, data_labels, code_labels, lines, stack_size })
}

fn validate_and_resolve(
    instr: &mut Instr,
    data_labels: &HashMap<String, u16>,
    code_labels: &HashMap<String, usize>,
) -> Result<(), SemaError> {
    let line = instr.line;
    let col = 0usize;
    // resolve symbolic operands first (offsets/symbols)
    if let Some(o) = instr.dst.as_mut() {
        resolve_operand_quiet(o, data_labels, code_labels, instr.line)?;
    }
    if let Some(o) = instr.src.as_mut() {
        resolve_operand_quiet(o, data_labels, code_labels, instr.line)?;
    }

    let op = instr.op;
    let dst = instr.dst.as_ref();
    let src = instr.src.as_ref();

    // jump targets
    if op.is_jump() {
        match dst {
            Some(Operand::Label(name)) => {
                if code_labels.contains_key(name) {
                    return Ok(());
                }
                if data_labels.contains_key(name) {
                    return err(line, col, format!("Cannot jump to data label '{}'", name));
                }
                return err(line, col, format!("Label '{}' used but not defined", name));
            }
            _ => return err(line, col, "Jumps require a label target"),
        }
    }

    let need = |n: usize| -> Result<(), SemaError> {
        let got = usize::from(dst.is_some()) + usize::from(src.is_some());
        if got != n {
            return err(
                line,
                col,
                format!("{} expects {} operand(s), got {}", mnemonic_name(op), n, got),
            );
        }
        Ok(())
    };

    match op {
        Op::Print => need(0),
        Op::Mov => {
            need(2)?;
            let d = dst.unwrap();
            let s = src.unwrap();
            validate_mov(d, s, line, col, data_labels)
        }
        Op::Add | Op::Adc | Op::Sub | Op::Sbb | Op::Cmp | Op::And | Op::Or | Op::Xor => {
            need(2)?;
            validate_alu(dst.unwrap(), src.unwrap(), line, col)
        }
        Op::Test => {
            need(2)?;
            let d = dst.unwrap();
            let s = src.unwrap();
            match (d, s) {
                (Operand::Seg(_), _) | (_, Operand::Seg(_)) => {
                    err(line, col, "TEST cannot use segment registers")
                }
                (Operand::Imm(_), _) => err(line, col, "TEST destination must be a register or memory"),
                _ => {
                    let ds = op_size(d).unwrap();
                    match op_size(s) {
                        None => {
                            // immediate
                            if let Operand::Imm(Expr::Num(v)) = s {
                                check_imm(*v, ds, line, col, "TEST")?;
                            }
                            if op_is_mem(d) && d_mem_size(d).is_none() {
                                return err(line, col, "Specify BYTE PTR or WORD PTR for TEST memory operand");
                            }
                            Ok(())
                        }
                        Some(ss) if ss == ds => {
                            if op_is_mem(d) && op_is_mem(s) {
                                return err(line, col, "TEST cannot take two memory operands");
                            }
                            Ok(())
                        }
                        Some(_) => err(line, col, "Operand size mismatch in TEST"),
                    }
                }
            }
        }
        Op::Inc | Op::Dec | Op::Neg | Op::Not => {
            need(1)?;
            match dst.unwrap() {
                Operand::Seg(_) | Operand::Imm(_) => {
                    err(line, col, format!("{} requires a register or memory operand", mnemonic_name(op)))
                }
                Operand::Mem(m) => {
                    if m.size.is_none() {
                        err(line, col, format!("Specify BYTE PTR or WORD PTR for {} memory operand", mnemonic_name(op)))
                    } else {
                        Ok(())
                    }
                }
                _ => Ok(()),
            }
        }
        Op::Push | Op::Pop => {
            need(1)?;
            let d = dst.unwrap();
            match d {
                Operand::Imm(_) if op == Op::Push => {
                    err(line, col, "PUSH immediate is not supported on the original Intel 8086")
                }
                Operand::Imm(_) => err(line, col, "POP requires a register or memory operand"),
                Operand::R8(_) => {
                    err(line, col, "PUSH/POP require 16-bit or segment registers")
                }
                Operand::Seg(_) | Operand::R16(_) => Ok(()),
                Operand::Mem(m) => match m.size {
                    Some(Size::Word) => Ok(()),
                    Some(Size::Byte) => err(line, col, "PUSH/POP memory operand must be 16-bit"),
                    None => err(line, col, "Specify WORD PTR for PUSH/POP memory operand"),
                },
                Operand::Label(_) => err(line, col, "PUSH/POP require a value operand"),
            }
        }
        Op::Mul | Op::Imul | Op::Div | Op::Idiv => {
            need(1)?;
            match dst.unwrap() {
                Operand::Seg(_) | Operand::Imm(_) => err(
                    line,
                    col,
                    format!("{} requires a register or memory operand", mnemonic_name(op)),
                ),
                Operand::Mem(m) => {
                    if m.size.is_none() {
                        err(line, col, format!("Specify BYTE PTR or WORD PTR for {} memory operand", mnemonic_name(op)))
                    } else {
                        Ok(())
                    }
                }
                _ => Ok(()),
            }
        }
        Op::Xchg => {
            need(2)?;
            let d = dst.unwrap();
            let s = src.unwrap();
            match (d, s) {
                (Operand::Seg(_), _) | (_, Operand::Seg(_)) => {
                    err(line, col, "XCHG cannot use segment registers")
                }
                (Operand::Imm(_), _) | (_, Operand::Imm(_)) => {
                    err(line, col, "XCHG requires register or memory operands")
                }
                _ => {
                    let ds = op_size(d).unwrap();
                    let ss = op_size(s).unwrap();
                    if ds != ss {
                        return err(line, col, "Operand size mismatch in XCHG");
                    }
                    if op_is_mem(d) && op_is_mem(s) {
                        return err(line, col, "XCHG cannot take two memory operands");
                    }
                    Ok(())
                }
            }
        }
        Op::Lea => {
            need(2)?;
            match (dst.unwrap(), src.unwrap()) {
                (Operand::R16(_), Operand::Mem(_)) => Ok(()),
                (Operand::R16(_), _) => err(line, col, "LEA source must be a memory operand"),
                _ => err(line, col, "LEA destination must be a 16-bit register"),
            }
        }
        Op::Rol | Op::Ror | Op::Rcl | Op::Rcr | Op::Shl | Op::Shr | Op::Sar => {
            need(2)?;
            let d = dst.unwrap();
            let s = src.unwrap();
            match d {
                Operand::Seg(_) | Operand::Imm(_) => {
                    return err(line, col, "Shift destination must be a register or memory");
                }
                Operand::Mem(m) => {
                    if m.size.is_none() {
                        return err(line, col, "Specify BYTE PTR or WORD PTR for shift memory operand");
                    }
                }
                _ => {}
            }
            match s {
                Operand::Imm(Expr::Num(v)) => {
                    if *v != 1 {
                        return err(
                            line,
                            col,
                            "8086 shift count must be 1 (use CL for variable counts)",
                        );
                    }
                    Ok(())
                }
                Operand::R8(R8::CL) => Ok(()),
                Operand::R8(_) | Operand::R16(_) => {
                    err(line, col, "Shift count must be 1 or CL")
                }
                _ => err(line, col, "Shift count must be 1 or CL"),
            }
        }
        Op::Int => {
            need(1)?;
            match dst.unwrap() {
                Operand::Imm(Expr::Num(v)) if (0..=255).contains(v) => Ok(()),
                Operand::Imm(Expr::Num(v)) => err(line, col, format!("INT vector {} out of range", v)),
                _ => err(line, col, "INT requires an 8-bit immediate vector"),
            }
        }
        Op::Ret => {
            if src.is_some() {
                return err(line, col, "RET takes at most one operand");
            }
            match dst {
                None => Ok(()),
                Some(Operand::Imm(Expr::Num(v))) => {
                    if (0..=0xFFFF).contains(v) {
                        Ok(())
                    } else {
                        err(line, col, "RET stack adjustment out of range")
                    }
                }
                _ => err(line, col, "RET operand must be an immediate"),
            }
        }
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
        | Op::Popf => {
            if dst.is_some() || src.is_some() {
                err(line, col, format!("{} takes no operands", mnemonic_name(op)))
            } else {
                Ok(())
            }
        }
        _ => {
            if op.is_string_op() {
                if dst.is_some() || src.is_some() {
                    return err(line, col, "String instructions take no operands");
                }
            }
            Ok(())
        }
    }
}

fn d_mem_size(o: &Operand) -> Option<Size> {
    match o {
        Operand::Mem(m) => m.size,
        _ => None,
    }
}

fn validate_mov(d: &Operand, s: &Operand, line: usize, col: usize, _dl: &HashMap<String, u16>) -> Result<(), SemaError> {
    match (d, s) {
        (Operand::R8(a), Operand::R8(_)) => {
            let _ = a;
            Ok(())
        }
        (Operand::R16(a), Operand::R16(_)) if !a.is_seg() => Ok(()),
        (Operand::Seg(_), Operand::R16(b)) if !b.is_seg() => Ok(()),
        (Operand::Seg(_), Operand::Seg(_)) => Ok(()),
        (Operand::R16(b), Operand::Seg(_)) if !b.is_seg() => Ok(()),
        (Operand::R8(_), Operand::Seg(_)) | (Operand::Seg(_), Operand::R8(_)) => {
            err(line, col, "Cannot move segment registers to/from 8-bit registers")
        }
        (Operand::R8(_), Operand::Imm(Expr::Num(v))) => check_imm(*v, Size::Byte, line, col, "MOV"),
        (Operand::R16(b), Operand::Imm(Expr::Num(v))) if !b.is_seg() => {
            check_imm(*v, Size::Word, line, col, "MOV")
        }
        (Operand::Seg(_), Operand::Imm(Expr::Num(v))) => check_imm(*v, Size::Word, line, col, "MOV"),
        (Operand::R8(_), Operand::Mem(m)) => match m.size {
            Some(Size::Byte) => Ok(()),
            Some(Size::Word) => err(line, col, "Operand size mismatch: byte register, word memory"),
            None => Ok(()),
        },
        (Operand::R16(b), Operand::Mem(m)) if !b.is_seg() => match m.size {
            Some(Size::Word) => Ok(()),
            Some(Size::Byte) => err(line, col, "Operand size mismatch: word register, byte memory"),
            None => Ok(()),
        },
        (Operand::Seg(_), Operand::Mem(m)) => match m.size {
            Some(Size::Word) | None => Ok(()),
            Some(Size::Byte) => err(line, col, "Segment move requires a word operand"),
        },
        (Operand::Mem(m), Operand::R8(_)) => match m.size {
            Some(Size::Byte) | None => Ok(()),
            Some(Size::Word) => err(line, col, "Operand size mismatch: byte register, word memory"),
        },
        (Operand::Mem(m), Operand::R16(b)) if !b.is_seg() => match m.size {
            Some(Size::Word) | None => Ok(()),
            Some(Size::Byte) => err(line, col, "Operand size mismatch: word register, byte memory"),
        },
        (Operand::Mem(m), Operand::Seg(_)) => match m.size {
            Some(Size::Word) | None => Ok(()),
            Some(Size::Byte) => err(line, col, "Segment move requires a word operand"),
        },
        (Operand::Mem(m), Operand::Imm(Expr::Num(v))) => match m.size {
            Some(sz) => check_imm(*v, sz, line, col, "MOV"),
            None => err(line, col, "Specify BYTE PTR or WORD PTR when storing an immediate"),
        },
        (Operand::Mem(_), Operand::Mem(_)) => err(line, col, "MOV cannot take two memory operands"),
        _ => err(
            line,
            col,
            format!(
                "Invalid MOV operands ({}, {})",
                operand_desc(d),
                operand_desc(s)
            ),
        ),
    }
}

fn validate_alu(d: &Operand, s: &Operand, line: usize, col: usize) -> Result<(), SemaError> {
    match (d, s) {
        (Operand::Imm(_), _) => err(line, col, "Immediate value cannot be the destination"),
        (Operand::Seg(_), _) | (_, Operand::Seg(_)) => {
            err(line, col, "Arithmetic/logic operations cannot use segment registers")
        }
        (Operand::Mem(_), Operand::Mem(_)) => err(line, col, "Two memory operands are not allowed"),
        _ => {
            let ds = match op_size(d) {
                Some(s) => s,
                None => return err(line, col, "Internal: missing destination size"),
            };
            match s {
                Operand::Imm(Expr::Num(v)) => {
                    if op_is_mem(d) && d_mem_size(d).is_none() {
                        return err(line, col, "Specify BYTE PTR or WORD PTR for memory operand");
                    }
                    check_imm(*v, ds, line, col, "ALU")
                }
                _ => {
                    let ss = op_size(s).expect("src size");
                    if ss != ds {
                        return err(line, col, "Operand size mismatch");
                    }
                    Ok(())
                }
            }
        }
    }
}

fn operand_desc(o: &Operand) -> &'static str {
    match o {
        Operand::R8(_) => "byte register",
        Operand::R16(_) => "word register",
        Operand::Seg(_) => "segment register",
        Operand::Imm(_) => "immediate",
        Operand::Mem(_) => "memory",
        Operand::Label(_) => "label",
    }
}

fn mnemonic_name(op: Op) -> &'static str {
    use Op::*;
    match op {
        Mov => "MOV",
        Add => "ADD",
        Adc => "ADC",
        Sub => "SUB",
        Sbb => "SBB",
        Cmp => "CMP",
        Inc => "INC",
        Dec => "DEC",
        Neg => "NEG",
        Not => "NOT",
        Mul => "MUL",
        Imul => "IMUL",
        Div => "DIV",
        Idiv => "IDIV",
        And => "AND",
        Or => "OR",
        Xor => "XOR",
        Test => "TEST",
        Xchg => "XCHG",
        Lea => "LEA",
        Push => "PUSH",
        Pop => "POP",
        Rol => "ROL",
        Ror => "ROR",
        Rcl => "RCL",
        Rcr => "RCR",
        Shl => "SHL",
        Shr => "SHR",
        Sar => "SAR",
        Jmp => "JMP",
        Call => "CALL",
        Ret => "RET",
        Int => "INT",
        Hlt => "HLT",
        _ => "instruction",
    }
}

fn resolve_operand_quiet(
    o: &mut Operand,
    data_labels: &HashMap<String, u16>,
    code_labels: &HashMap<String, usize>,
    fallback_line: usize,
) -> Result<(), SemaError> {
    let (l2, c2) = resolve_symbolic_line(o);
    resolve_operand(o, data_labels, code_labels, fallback_line).map_err(|e| SemaError {
        line: if e.line == 0 || e.line == usize::MAX { l2.max(fallback_line) } else { e.line },
        col: e.col,
        msg: e.msg,
    })
}
