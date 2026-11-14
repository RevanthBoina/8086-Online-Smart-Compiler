// Interpreter core for the original Intel 8086 (browser-only, no backend).
// Executes the validated program instruction by instruction against 1 MB of
// segment-wrapped memory with accurate register/flag/stack semantics.

use crate::frontend::ast::{Instr, Op, Operand, Reg, R8, RepKind, Size};
use crate::frontend::sema::Program;

pub const MEM_SIZE: usize = 0x100_000; // 1 MB

pub const CF: u16 = 0x0001;
pub const PF: u16 = 0x0004;
pub const AF: u16 = 0x0010;
pub const ZF: u16 = 0x0040;
pub const SF: u16 = 0x0080;
pub const TF: u16 = 0x0100;
pub const IF: u16 = 0x0200;
pub const DF: u16 = 0x0400;
pub const OF: u16 = 0x0800;

pub struct StepOut {
    pub halt: bool,
    pub int: Option<u8>,
    pub ah: Option<u8>,
}

impl StepOut {
    fn none() -> Self {
        StepOut { halt: false, int: None, ah: None }
    }
}

pub struct Cpu {
    pub r: [u16; 8], // AX CX DX BX SP BP SI DI (Intel order)
    pub s: [u16; 4], // ES CS SS DS
    pub flags: u16,
    pub mem: Vec<u8>,
    pub ip: usize,
    pub halted: bool,
}

impl Cpu {
    pub fn new() -> Self {
        let mut r = [0u16; 8];
        // real 8086/DOS startup: SP begins near the top of the stack segment
        r[Reg::SP as usize] = 0xfffe;
        Cpu {
            r,
            s: [0; 4],
            flags: 0x0002, // bit1 is always set on real hardware
            mem: vec![0; MEM_SIZE],
            ip: 0,
            halted: false,
        }
    }

    // ------------------------------------------------------------ registers
    pub fn r16(&self, r: Reg) -> u16 {
        if r.is_seg() {
            self.s[r as usize - 8]
        } else {
            self.r[r as usize]
        }
    }
    pub fn set_r16(&mut self, r: Reg, v: u16) {
        if r.is_seg() {
            self.s[r as usize - 8] = v;
        } else {
            self.r[r as usize] = v;
        }
    }
    pub fn r8(&self, r: R8) -> u8 {
        let parent = self.r[r.parent() as usize];
        if r.is_high() {
            (parent >> 8) as u8
        } else {
            parent as u8
        }
    }
    pub fn set_r8(&mut self, r: R8, v: u8) {
        let idx = r.parent() as usize;
        if r.is_high() {
            self.r[idx] = (self.r[idx] & 0x00ff) | ((v as u16) << 8);
        } else {
            self.r[idx] = (self.r[idx] & 0xff00) | v as u16;
        }
    }

    pub fn flag(&self, bit: u16) -> bool {
        self.flags & bit != 0
    }
    fn set_flag(&mut self, bit: u16, on: bool) {
        if on {
            self.flags |= bit;
        } else {
            self.flags &= !bit;
        }
    }

    // --------------------------------------------------------------- memory
    fn phys(seg: u16, off: u16) -> usize {
        (((seg as usize) << 4) + off as usize) & (MEM_SIZE - 1)
    }
    pub fn read8(&self, addr: usize) -> u8 {
        self.mem[addr & (MEM_SIZE - 1)]
    }
    pub fn write8(&mut self, addr: usize, v: u8) {
        self.mem[addr & (MEM_SIZE - 1)] = v;
    }
    pub fn read16(&self, addr: usize) -> u16 {
        let lo = self.read8(addr) as u16;
        let hi = self.read8(addr + 1) as u16;
        lo | (hi << 8)
    }
    pub fn write16(&mut self, addr: usize, v: u16) {
        self.write8(addr, v as u8);
        self.write8(addr + 1, (v >> 8) as u8);
    }

    // ---------------------------------------------------- effective address
    fn mem_parts(&self, terms: &[crate::frontend::ast::Term]) -> (Option<Reg>, Option<Reg>, i32) {
        use crate::frontend::ast::Term;
        let mut base = None;
        let mut index = None;
        let mut disp = 0i32;
        for t in terms {
            match t {
                Term::Reg(r) => match r {
                    Reg::BX | Reg::BP => base = Some(*r),
                    Reg::SI | Reg::DI => index = Some(*r),
                    _ => {}
                },
                Term::Num(v) => disp = disp.wrapping_add(*v),
                Term::Sym(_) => {} // resolved by sema
            }
        }
        (base, index, disp)
    }

    pub fn mem_offset(&self, m: &crate::frontend::ast::MemOperand) -> u16 {
        let (base, index, disp) = self.mem_parts(&m.terms);
        let mut off: i32 = disp;
        if let Some(b) = base {
            off += self.r16(b) as i32;
        }
        if let Some(i) = index {
            off += self.r16(i) as i32;
        }
        off as u16
    }

    fn mem_seg(&self, m: &crate::frontend::ast::MemOperand) -> u16 {
        if let Some(s) = m.seg {
            return self.r16(s);
        }
        let (base, _, _) = self.mem_parts(&m.terms);
        if base == Some(Reg::BP) {
            self.s[Reg::SS as usize - 8]
        } else {
            self.s[Reg::DS as usize - 8]
        }
    }

    pub fn mem_phys(&self, m: &crate::frontend::ast::MemOperand) -> usize {
        Self::phys(self.mem_seg(m), self.mem_offset(m))
    }

    // --------------------------------------------------------- operands I/O
    fn width_of(d: &Operand, s: Option<&Operand>) -> Result<Size, String> {
        fn w(o: &Operand) -> Option<Size> {
            match o {
                Operand::R8(_) => Some(Size::Byte),
                Operand::R16(_) | Operand::Seg(_) => Some(Size::Word),
                Operand::Mem(m) => m.size,
                _ => None,
            }
        }
        w(d).or_else(|| s.and_then(w))
            .ok_or_else(|| "Internal error: could not determine operand size".to_string())
    }

    fn read_val(&self, o: &Operand, w: Size) -> Result<u16, String> {
        match o {
            Operand::R8(r) => Ok(self.r8(*r) as u16),
            Operand::R16(r) | Operand::Seg(r) => Ok(self.r16(*r)),
            Operand::Imm(e) => match e {
                crate::frontend::ast::Expr::Num(v) => Ok(*v as u16),
                _ => Err("Internal error: unresolved immediate".into()),
            },
            Operand::Mem(m) => {
                let p = self.mem_phys(m);
                Ok(match w {
                    Size::Byte => self.read8(p) as u16,
                    Size::Word => self.read16(p),
                })
            }
            Operand::Label(_) => Err("Internal error: label used as value".into()),
        }
    }

    fn write_val(&mut self, o: &Operand, w: Size, v: u16) -> Result<(), String> {
        match o {
            Operand::R8(r) => {
                self.set_r8(*r, v as u8);
                Ok(())
            }
            Operand::R16(r) | Operand::Seg(r) => {
                self.set_r16(*r, v);
                Ok(())
            }
            Operand::Mem(m) => {
                let p = self.mem_phys(m);
                match w {
                    Size::Byte => self.write8(p, v as u8),
                    Size::Word => self.write16(p, v),
                }
                Ok(())
            }
            Operand::Imm(_) => Err("Internal error: cannot write an immediate".into()),
            Operand::Label(_) => Err("Internal error: label used as value".into()),
        }
    }

    // -------------------------------------------------------------- flags
    fn set_logic_flags(&mut self, res: u16, w: Size) {
        let m = Self::mask(w);
        self.set_flag(CF, false);
        self.set_flag(OF, false);
        self.set_flag(AF, false);
        self.set_flag(ZF, res & m == 0);
        self.set_flag(SF, res & Self::sign(w) != 0);
        self.set_flag(PF, Self::parity(res as u8));
    }

    fn mask(w: Size) -> u16 {
        match w {
            Size::Byte => 0xff,
            Size::Word => 0xffff,
        }
    }
    fn sign(w: Size) -> u16 {
        match w {
            Size::Byte => 0x80,
            Size::Word => 0x8000,
        }
    }
    fn parity(v: u8) -> bool {
        v.count_ones() % 2 == 0
    }

    fn do_add(&mut self, a: u16, b: u16, w: Size, carry: u16) -> u16 {
        let m = Self::mask(w);
        let s = Self::sign(w);
        let (a, b) = (a & m, b & m);
        let wide = a as u32 + b as u32 + carry as u32;
        let res = (wide as u16) & m;
        self.set_flag(CF, wide > m as u32);
        self.set_flag(AF, (a ^ b ^ res) & 0x10 != 0);
        self.set_flag(OF, (!(a ^ b) & (a ^ res)) & s != 0);
        self.set_flag(ZF, res == 0);
        self.set_flag(SF, res & s != 0);
        self.set_flag(PF, Self::parity(res as u8));
        res
    }

    fn do_sub(&mut self, a: u16, b: u16, w: Size, borrow: u16) -> u16 {
        let m = Self::mask(w);
        let s = Self::sign(w);
        let (a, b) = (a & m, b & m);
        let wide = a as u32
            .wrapping_sub(b as u32)
            .wrapping_sub(borrow as u32);
        let res = (wide as u16) & m;
        // carry = borrow out
        self.set_flag(CF, (b as u32 + borrow as u32) > a as u32);
        self.set_flag(AF, (a ^ b ^ res) & 0x10 != 0);
        self.set_flag(OF, ((a ^ b) & (a ^ res)) & s != 0);
        self.set_flag(ZF, res == 0);
        self.set_flag(SF, res & s != 0);
        self.set_flag(PF, Self::parity(res as u8));
        res
    }

    // ------------------------------------------------------------ execution
    pub fn step(&mut self, prog: &Program) -> Result<StepOut, String> {
        if self.halted {
            return Ok(StepOut { halt: true, int: None, ah: None });
        }
        if self.ip >= prog.instrs.len() {
            self.halted = true;
            return Ok(StepOut { halt: true, int: None, ah: None });
        }
        let instr = &prog.instrs[self.ip];
        // default: fall through to the next instruction
        self.ip += 1;
        self.execute(instr, prog)
    }

    fn at(instr: &Instr, msg: impl std::fmt::Display) -> String {
        format!("Error at line {} : {} : {}", instr.line, instr.text, msg)
    }

    fn execute(&mut self, instr: &Instr, prog: &Program) -> Result<StepOut, String> {
        let d = instr.dst.as_ref();
        let s = instr.src.as_ref();
        match instr.op {
            Op::Print => return Ok(StepOut::none()),
            Op::Nop => {}
            Op::Hlt => {
                self.halted = true;
                return Ok(StepOut { halt: true, int: None, ah: None });
            }
            Op::Mov => {
                let (d, s) = (d.ok_or_else(|| Self::at(instr, "MOV missing operands"))?,
                    s.ok_or_else(|| Self::at(instr, "MOV missing operands"))?);
                let w = Self::width_of(d, Some(s)).map_err(|e| Self::at(instr, e))?;
                let v = self.read_val(s, w).map_err(|e| Self::at(instr, e))?;
                self.write_val(d, w, v).map_err(|e| Self::at(instr, e))?;
            }
            Op::Add | Op::Adc | Op::Sub | Op::Sbb | Op::Cmp | Op::And | Op::Or | Op::Xor => {
                let (d, s) = (d.ok_or_else(|| Self::at(instr, "missing operands"))?,
                    s.ok_or_else(|| Self::at(instr, "missing operands"))?);
                let w = Self::width_of(d, Some(s)).map_err(|e| Self::at(instr, e))?;
                let b = self.read_val(s, w).map_err(|e| Self::at(instr, e))?;
                let a = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                match instr.op {
                    Op::Add => {
                        let r = self.do_add(a, b, w, 0);
                        self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
                    }
                    Op::Adc => {
                        let c = u16::from(self.flag(CF));
                        let r = self.do_add(a, b, w, c);
                        self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
                    }
                    Op::Sub => {
                        let r = self.do_sub(a, b, w, 0);
                        self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
                    }
                    Op::Sbb => {
                        let c = u16::from(self.flag(CF));
                        let r = self.do_sub(a, b, w, c);
                        self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
                    }
                    Op::Cmp => {
                        self.do_sub(a, b, w, 0);
                    }
                    Op::And => {
                        let r = a & b;
                        self.set_logic_flags(r, w);
                        self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
                    }
                    Op::Or => {
                        let r = a | b;
                        self.set_logic_flags(r, w);
                        self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
                    }
                    Op::Xor => {
                        let r = a ^ b;
                        self.set_logic_flags(r, w);
                        self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
                    }
                    _ => unreachable!(),
                }
            }
            Op::Test => {
                let (d, s) = (d.ok_or_else(|| Self::at(instr, "TEST missing operands"))?,
                    s.ok_or_else(|| Self::at(instr, "TEST missing operands"))?);
                let w = Self::width_of(d, Some(s)).map_err(|e| Self::at(instr, e))?;
                let b = self.read_val(s, w).map_err(|e| Self::at(instr, e))?;
                let a = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                let r = a & b;
                self.set_logic_flags(r, w);
            }
            Op::Inc | Op::Dec => {
                let d = d.ok_or_else(|| Self::at(instr, "missing operand"))?;
                let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                let a = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                let cf = self.flag(CF);
                let r = if instr.op == Op::Inc {
                    self.do_add(a, 1, w, 0)
                } else {
                    self.do_sub(a, 1, w, 0)
                };
                self.set_flag(CF, cf); // INC/DEC preserve CF
                self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
            }
            Op::Neg => {
                let d = d.ok_or_else(|| Self::at(instr, "missing operand"))?;
                let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                let a = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                let r = self.do_sub(0, a, w, 0);
                self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
            }
            Op::Not => {
                let d = d.ok_or_else(|| Self::at(instr, "missing operand"))?;
                let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                let a = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                let r = !a & Self::mask(w);
                self.write_val(d, w, r).map_err(|e| Self::at(instr, e))?;
            }
            Op::Mul | Op::Imul => {
                let d = d.ok_or_else(|| Self::at(instr, "missing operand"))?;
                let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                let v = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                match w {
                    Size::Byte => {
                        let a = self.r8(R8::AL) as u16;
                        let res = if instr.op == Op::Mul {
                            a.wrapping_mul(v)
                        } else {
                            ((a as i8 as i16).wrapping_mul(v as i8 as i16)) as u16
                        };
                        self.set_r16(Reg::AX, res);
                        let high = if instr.op == Op::Mul {
                            res >> 8
                        } else {
                            ((res as i16) >> 8) as u16
                        };
                        let of = if instr.op == Op::Mul {
                            high != 0
                        } else {
                            let sgn = (res as i16) < 0;
                            let sign_ok = if sgn { high == 0xff } else { high == 0 };
                            !sign_ok
                        };
                        self.set_flag(CF, of);
                        self.set_flag(OF, of);
                    }
                    Size::Word => {
                        let a = self.r16(Reg::AX);
                        let res: u32 = if instr.op == Op::Mul {
                            (a as u32).wrapping_mul(v as u32)
                        } else {
                            ((a as i16 as i32).wrapping_mul(v as i16 as i32)) as u32
                        };
                        self.set_r16(Reg::AX, res as u16);
                        self.set_r16(Reg::DX, (res >> 16) as u16);
                        let of = if instr.op == Op::Mul {
                            (res >> 16) != 0
                        } else {
                            let sgn = (res as i32) < 0;
                            let hi = (res >> 16) as i16;
                            let sign_ok = if sgn { hi == -1 } else { hi == 0 };
                            !sign_ok
                        };
                        self.set_flag(CF, of);
                        self.set_flag(OF, of);
                    }
                }
            }
            Op::Div | Op::Idiv => {
                let d = d.ok_or_else(|| Self::at(instr, "missing operand"))?;
                let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                let v = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                let div0 = || -> String {
                    format!(
                        "Attempt to divide by 0 : int 0 at line {} : {}",
                        instr.line, instr.text
                    )
                };
                match w {
                    Size::Byte => {
                        if v & 0xff == 0 {
                            return Err(div0());
                        }
                        let num = self.r16(Reg::AX);
                        if instr.op == Op::Div {
                            let q = num / v;
                            let r = num % v;
                            if q > 0xff {
                                return Err(format!(
                                    "Divide overflow at line {} : {}",
                                    instr.line, instr.text
                                ));
                            }
                            self.set_r8(R8::AL, q as u8);
                            self.set_r8(R8::AH, r as u8);
                        } else {
                            let num = num as i16;
                            let den = v as i8 as i16;
                            let q = num / den;
                            let r = num % den;
                            if q < -128 || q > 127 {
                                return Err(format!(
                                    "Divide overflow at line {} : {}",
                                    instr.line, instr.text
                                ));
                            }
                            self.set_r8(R8::AL, q as i8 as u8);
                            self.set_r8(R8::AH, r as i8 as u8);
                        }
                    }
                    Size::Word => {
                        if v == 0 {
                            return Err(div0());
                        }
                        let hi = self.r16(Reg::DX) as u32;
                        let lo = self.r16(Reg::AX) as u32;
                        let num = (hi << 16) | lo;
                        if instr.op == Op::Div {
                            let q = num / v as u32;
                            let r = num % v as u32;
                            if q > 0xffff {
                                return Err(format!(
                                    "Divide overflow at line {} : {}",
                                    instr.line, instr.text
                                ));
                            }
                            self.set_r16(Reg::AX, q as u16);
                            self.set_r16(Reg::DX, r as u16);
                        } else {
                            let num = num as i32;
                            let den = v as i16 as i32;
                            let q = num / den;
                            let r = num % den;
                            if q < -32768 || q > 32767 {
                                return Err(format!(
                                    "Divide overflow at line {} : {}",
                                    instr.line, instr.text
                                ));
                            }
                            self.set_r16(Reg::AX, q as i16 as u16);
                            self.set_r16(Reg::DX, r as i16 as u16);
                        }
                    }
                }
            }
            Op::Push => {
                let d = d.ok_or_else(|| Self::at(instr, "missing operand"))?;
                let v = match d {
                    Operand::Imm(_) => return Err(Self::at(instr, "PUSH immediate unsupported")),
                    _ => {
                        let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                        if w != Size::Word {
                            return Err(Self::at(instr, "PUSH requires a 16-bit operand"));
                        }
                        self.read_val(d, w).map_err(|e| Self::at(instr, e))?
                    }
                };
                self.r[Reg::SP as usize] = self.r[Reg::SP as usize].wrapping_sub(2);
                let sp = self.r[Reg::SP as usize];
                let ss = self.s[Reg::SS as usize - 8];
                let p = Self::phys(ss, sp);
                self.write16(p, v);
            }
            Op::Pop => {
                let d = d.ok_or_else(|| Self::at(instr, "missing operand"))?;
                let sp = self.r[Reg::SP as usize];
                let ss = self.s[Reg::SS as usize - 8];
                let p = Self::phys(ss, sp);
                let v = self.read16(p);
                self.r[Reg::SP as usize] = self.r[Reg::SP as usize].wrapping_add(2);
                let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                if w != Size::Word {
                    return Err(Self::at(instr, "POP requires a 16-bit operand"));
                }
                self.write_val(d, w, v).map_err(|e| Self::at(instr, e))?;
            }
            Op::Pushf => {
                let f = self.flags;
                self.r[Reg::SP as usize] = self.r[Reg::SP as usize].wrapping_sub(2);
                let sp = self.r[Reg::SP as usize];
                let ss = self.s[Reg::SS as usize - 8];
                self.write16(Self::phys(ss, sp), f);
            }
            Op::Popf => {
                let sp = self.r[Reg::SP as usize];
                let ss = self.s[Reg::SS as usize - 8];
                let v = self.read16(Self::phys(ss, sp));
                self.r[Reg::SP as usize] = self.r[Reg::SP as usize].wrapping_add(2);
                self.flags = v & 0x0fff;
            }
            Op::Xchg => {
                let (d, s) = (d.ok_or_else(|| Self::at(instr, "missing operands"))?,
                    s.ok_or_else(|| Self::at(instr, "missing operands"))?);
                let w = Self::width_of(d, Some(s)).map_err(|e| Self::at(instr, e))?;
                let a = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                let b = self.read_val(s, w).map_err(|e| Self::at(instr, e))?;
                self.write_val(d, w, b).map_err(|e| Self::at(instr, e))?;
                self.write_val(s, w, a).map_err(|e| Self::at(instr, e))?;
            }
            Op::Lea => {
                let (d, s) = (d.ok_or_else(|| Self::at(instr, "missing operands"))?,
                    s.ok_or_else(|| Self::at(instr, "missing operands"))?);
                let off = match s {
                    Operand::Mem(m) => self.mem_offset(m),
                    _ => return Err(Self::at(instr, "LEA source must be memory")),
                };
                match d {
                    Operand::R16(r) => self.set_r16(*r, off),
                    _ => return Err(Self::at(instr, "LEA destination must be a word register")),
                }
            }
            Op::Rol | Op::Ror | Op::Rcl | Op::Rcr | Op::Shl | Op::Shr | Op::Sar => {
                let (d, s) = (d.ok_or_else(|| Self::at(instr, "missing operands"))?,
                    s.ok_or_else(|| Self::at(instr, "missing operands"))?);
                let w = Self::width_of(d, None).map_err(|e| Self::at(instr, e))?;
                let count: usize = match s {
                    Operand::Imm(crate::frontend::ast::Expr::Num(v)) => *v as usize,
                    Operand::R8(R8::CL) => self.r8(R8::CL) as usize,
                    _ => return Err(Self::at(instr, "shift count must be 1 or CL")),
                };
                if count == 0 {
                    return Ok(StepOut::none()); // 8086: count 0 changes nothing
                }
                let mut v = self.read_val(d, w).map_err(|e| Self::at(instr, e))?;
                let m = Self::mask(w);
                let sbit = Self::sign(w);
                v &= m;
                let mut cf = self.flag(CF);
                let first_out;
                let orig_cf = cf;
                let mut outs: Vec<bool> = Vec::new();
                match instr.op {
                    Op::Shl => {
                        first_out = v & sbit != 0;
                        for _ in 0..count {
                            outs.push(v & sbit != 0);
                            v = (v << 1) & m;
                        }
                        cf = outs.last().copied().unwrap_or(orig_cf);
                    }
                    Op::Shr => {
                        first_out = v & sbit != 0;
                        for _ in 0..count {
                            outs.push(v & 1 != 0);
                            v >>= 1;
                        }
                        cf = outs.last().copied().unwrap_or(orig_cf);
                    }
                    Op::Sar => {
                        first_out = v & 1 != 0;
                        for _ in 0..count {
                            outs.push(v & 1 != 0);
                            if w == Size::Byte {
                                v = (((v as u8) as i8) >> 1) as u8 as u16;
                            } else {
                                v = ((v as i16) >> 1) as u16;
                            }
                        }
                        cf = outs.last().copied().unwrap_or(orig_cf);
                    }
                    Op::Rol => {
                        first_out = v & sbit != 0;
                        let bits = if w == Size::Byte { 8 } else { 16 };
                        for _ in 0..count {
                            let msb = v & sbit != 0;
                            outs.push(msb);
                            v = ((v << 1) & m) | u16::from(msb);
                        }
                        let _ = bits;
                        cf = outs.last().copied().unwrap_or(orig_cf);
                    }
                    Op::Ror => {
                        first_out = v & 1 != 0;
                        for _ in 0..count {
                            let lsb = v & 1 != 0;
                            outs.push(lsb);
                            v = (v >> 1) | if lsb { sbit } else { 0 };
                        }
                        cf = outs.last().copied().unwrap_or(orig_cf);
                    }
                    Op::Rcl => {
                        first_out = v & sbit != 0;
                        for _ in 0..count {
                            let msb = v & sbit != 0;
                            outs.push(msb);
                            let carry_in = u16::from(cf);
                            v = ((v << 1) & m) | carry_in;
                            cf = msb;
                        }
                        // cf already updated per iteration
                    }
                    Op::Rcr => {
                        first_out = v & 1 != 0;
                        for _ in 0..count {
                            let lsb = v & 1 != 0;
                            outs.push(lsb);
                            let carry_in = if cf { sbit } else { 0 };
                            v = (v >> 1) | carry_in;
                            cf = lsb;
                        }
                    }
                    _ => unreachable!(),
                }
                match instr.op {
                    Op::Rcl | Op::Rcr => {
                        // CF updated inside the loop
                    }
                    _ => {
                        cf = outs.last().copied().unwrap_or(cf);
                    }
                }
                self.set_flag(CF, cf);
                self.set_flag(ZF, v == 0);
                self.set_flag(SF, v & sbit != 0);
                self.set_flag(PF, Self::parity(v as u8));
                // OF is architecturally defined for count == 1 only
                if count == 1 {
                    let of = match instr.op {
                        Op::Shl => (v & sbit != 0) != cf,
                        Op::Shr => first_out,
                        Op::Sar => false,
                        Op::Rol => (v & sbit != 0) != cf,
                        Op::Ror => (v & sbit != 0) != (v & (sbit >> 1) != 0),
                        Op::Rcl => (v & sbit != 0) != cf,
                        Op::Rcr => (v & sbit != 0) != (v & (sbit >> 1) != 0),
                        _ => false,
                    };
                    self.set_flag(OF, of);
                }
                self.write_val(d, w, v).map_err(|e| Self::at(instr, e))?;
            }
            Op::Jmp => {
                let name = label_of(d)?;
                self.ip = *prog.code_labels.get(name).ok_or_else(|| Self::at(instr, "unknown label"))?;
            }
            Op::Call => {
                let name = label_of(d)?;
                let ret = self.ip as u16;
                self.r[Reg::SP as usize] = self.r[Reg::SP as usize].wrapping_sub(2);
                let sp = self.r[Reg::SP as usize];
                let ss = self.s[Reg::SS as usize - 8];
                self.write16(Self::phys(ss, sp), ret);
                self.ip = *prog.code_labels.get(name).ok_or_else(|| Self::at(instr, "unknown label"))?;
            }
            Op::Ret => {
                let sp = self.r[Reg::SP as usize];
                let ss = self.s[Reg::SS as usize - 8];
                let target = self.read16(Self::phys(ss, sp)) as usize;
                self.r[Reg::SP as usize] = self.r[Reg::SP as usize].wrapping_add(2);
                if let Some(Operand::Imm(crate::frontend::ast::Expr::Num(n))) = d {
                    self.r[Reg::SP as usize] =
                        self.r[Reg::SP as usize].wrapping_add(*n as u16);
                }
                if target >= prog.instrs.len() {
                    return Err(Self::at(
                        instr,
                        format!(
                            "Return address {} is not a valid instruction index",
                            target
                        ),
                    ));
                }
                self.ip = target;
            }
            Op::Jo | Op::Jno | Op::Jb | Op::Jae | Op::Je | Op::Jne | Op::Jbe | Op::Ja
            | Op::Js | Op::Jns | Op::Jp | Op::Jnp | Op::Jl | Op::Jge | Op::Jle | Op::Jg => {
                if self.cond(instr.op) {
                    let name = label_of(d)?;
                    self.ip = *prog
                        .code_labels
                        .get(name)
                        .ok_or_else(|| Self::at(instr, "unknown label"))?;
                }
            }
            Op::Loop | Op::Loope | Op::Loopne => {
                self.r[Reg::CX as usize] = self.r[Reg::CX as usize].wrapping_sub(1);
                let cx = self.r[Reg::CX as usize];
                let zf = self.flag(ZF);
                let jump = match instr.op {
                    Op::Loop => cx != 0,
                    Op::Loope => cx != 0 && zf,
                    _ => cx != 0 && !zf,
                };
                if jump {
                    let name = label_of(d)?;
                    self.ip = *prog
                        .code_labels
                        .get(name)
                        .ok_or_else(|| Self::at(instr, "unknown label"))?;
                }
            }
            Op::Jcxz => {
                if self.r[Reg::CX as usize] == 0 {
                    let name = label_of(d)?;
                    self.ip = *prog
                        .code_labels
                        .get(name)
                        .ok_or_else(|| Self::at(instr, "unknown label"))?;
                }
            }
            Op::Int => {
                let vec = match d {
                    Some(Operand::Imm(crate::frontend::ast::Expr::Num(v))) => *v as u8,
                    _ => return Err(Self::at(instr, "INT requires an immediate vector")),
                };
                return self.do_int(vec, instr);
            }
            Op::Cbw => {
                let al = self.r8(R8::AL);
                let ax = if al & 0x80 != 0 { 0xff00 | al as u16 } else { al as u16 };
                self.set_r16(Reg::AX, ax);
            }
            Op::Cwd => {
                let ax = self.r16(Reg::AX);
                self.set_r16(Reg::DX, if ax & 0x8000 != 0 { 0xffff } else { 0 });
            }
            Op::Clc => self.set_flag(CF, false),
            Op::Stc => self.set_flag(CF, true),
            Op::Cmc => {
                let cf = self.flag(CF);
                self.set_flag(CF, !cf);
            }
            Op::Cld => self.set_flag(DF, false),
            Op::Std => self.set_flag(DF, true),
            Op::Sti => self.set_flag(IF, true),
            Op::Cli => self.set_flag(IF, false),
            _ if instr.op.is_string_op() => {
                self.string_op(instr)?;
            }
            other => {
                return Err(Self::at(instr, format!("unsupported instruction {:?}", other)));
            }
        }
        Ok(StepOut::none())
    }

    fn cond(&self, op: Op) -> bool {
        use Op::*;
        match op {
            Jo => self.flag(OF),
            Jno => !self.flag(OF),
            Jb => self.flag(CF),
            Jae => !self.flag(CF),
            Je => self.flag(ZF),
            Jne => !self.flag(ZF),
            Jbe => self.flag(CF) || self.flag(ZF),
            Ja => !self.flag(CF) && !self.flag(ZF),
            Js => self.flag(SF),
            Jns => !self.flag(SF),
            Jp => self.flag(PF),
            Jnp => !self.flag(PF),
            Jl => self.flag(SF) != self.flag(OF),
            Jge => self.flag(SF) == self.flag(OF),
            Jle => self.flag(ZF) || (self.flag(SF) != self.flag(OF)),
            Jg => !self.flag(ZF) && (self.flag(SF) == self.flag(OF)),
            _ => false,
        }
    }

    fn do_int(&mut self, vec: u8, instr: &Instr) -> Result<StepOut, String> {
        let ah = self.r8(R8::AH);
        match vec {
            0 => Err(format!(
                "Attempt to divide by 0 : int 0 at line {} : {}",
                instr.line, instr.text
            )),
            3 => Ok(StepOut { halt: false, int: Some(3), ah: None }),
            0x10 => {
                if ah != 0x0a && ah != 0x13 {
                    return Err(Self::at(
                        instr,
                        format!("value of AH = 0x{:02X} is not supported for int 0x10", ah),
                    ));
                }
                Ok(StepOut { halt: false, int: Some(0x10), ah: Some(ah) })
            }
            0x20 => {
                self.halted = true;
                Ok(StepOut { halt: true, int: None, ah: None })
            }
            0x21 => {
                if ah != 0x01 && ah != 0x02 && ah != 0x09 && ah != 0x0a {
                    return Err(Self::at(
                        instr,
                        format!("value of AH = 0x{:02X} is not supported for int 0x21", ah),
                    ));
                }
                Ok(StepOut { halt: false, int: Some(0x21), ah: Some(ah) })
            }
            other => Err(Self::at(instr, format!("int 0x{:02X} is not supported", other))),
        }
    }

    fn string_op(&mut self, instr: &Instr) -> Result<(), String> {
        use Op::*;
        let byte = matches!(instr.op, Movsb | Lodsb | Stosb | Cmpsb | Scasb);
        let step: i32 = if byte { 1 } else { 2 };
        let dlt: i32 = if self.flag(DF) { -step } else { step };
        let rep = instr.rep;
        loop {
            if let Some(r) = rep {
                if self.r[Reg::CX as usize] == 0 {
                    break;
                }
                // REPE/REPNE only control ZF for CMPS/SCAS
                let zf = self.flag(ZF);
                if matches!(instr.op, Cmpsb | Cmpsw | Scasb | Scasw) {
                    match r {
                        RepKind::Repe if !zf => break,
                        RepKind::Repne if zf => break,
                        _ => {}
                    }
                }
            }
            match instr.op {
                Movsb | Movsw => {
                    let src = Self::phys(self.s[Reg::DS as usize - 8], self.r[Reg::SI as usize]);
                    let dst = Self::phys(self.s[Reg::ES as usize - 8], self.r[Reg::DI as usize]);
                    if byte {
                        let v = self.read8(src);
                        self.write8(dst, v);
                    } else {
                        let v = self.read16(src);
                        self.write16(dst, v);
                    }
                    self.r[Reg::SI as usize] =
                        (self.r[Reg::SI as usize] as i32 + dlt) as u16;
                    self.r[Reg::DI as usize] =
                        (self.r[Reg::DI as usize] as i32 + dlt) as u16;
                }
                Lodsb | Lodsw => {
                    let src = Self::phys(self.s[Reg::DS as usize - 8], self.r[Reg::SI as usize]);
                    if byte {
                        let v = self.read8(src);
                        self.set_r8(R8::AL, v);
                    } else {
                        let v = self.read16(src);
                        self.set_r16(Reg::AX, v);
                    }
                    self.r[Reg::SI as usize] =
                        (self.r[Reg::SI as usize] as i32 + dlt) as u16;
                }
                Stosb | Stosw => {
                    let dst = Self::phys(self.s[Reg::ES as usize - 8], self.r[Reg::DI as usize]);
                    if byte {
                        let v = self.r8(R8::AL);
                        self.write8(dst, v);
                    } else {
                        let v = self.r16(Reg::AX);
                        self.write16(dst, v);
                    }
                    self.r[Reg::DI as usize] =
                        (self.r[Reg::DI as usize] as i32 + dlt) as u16;
                }
                Cmpsb | Cmpsw => {
                    let a_phys = Self::phys(self.s[Reg::DS as usize - 8], self.r[Reg::SI as usize]);
                    let b_phys = Self::phys(self.s[Reg::ES as usize - 8], self.r[Reg::DI as usize]);
                    if byte {
                        let a = self.read8(a_phys) as u16;
                        let b = self.read8(b_phys) as u16;
                        self.do_sub(a, b, Size::Byte, 0);
                    } else {
                        let a = self.read16(a_phys);
                        let b = self.read16(b_phys);
                        self.do_sub(a, b, Size::Word, 0);
                    }
                    self.r[Reg::SI as usize] =
                        (self.r[Reg::SI as usize] as i32 + dlt) as u16;
                    self.r[Reg::DI as usize] =
                        (self.r[Reg::DI as usize] as i32 + dlt) as u16;
                }
                Scasb | Scasw => {
                    let b_phys = Self::phys(self.s[Reg::ES as usize - 8], self.r[Reg::DI as usize]);
                    if byte {
                        let a = self.r8(R8::AL) as u16;
                        let b = self.read8(b_phys) as u16;
                        self.do_sub(a, b, Size::Byte, 0);
                    } else {
                        let a = self.r16(Reg::AX);
                        let b = self.read16(b_phys);
                        self.do_sub(a, b, Size::Word, 0);
                    }
                    self.r[Reg::DI as usize] =
                        (self.r[Reg::DI as usize] as i32 + dlt) as u16;
                }
                _ => return Err(Self::at(instr, "not a string instruction")),
            }
            match rep {
                Some(_) => {
                    self.r[Reg::CX as usize] = self.r[Reg::CX as usize].wrapping_sub(1);
                    continue;
                }
                None => break,
            }
        }
        Ok(())
    }
}

fn label_of(d: Option<&Operand>) -> Result<&str, String> {
    match d {
        Some(Operand::Label(name)) => Ok(name.as_str()),
        _ => Err("jump requires a label".to_string()),
    }
}
