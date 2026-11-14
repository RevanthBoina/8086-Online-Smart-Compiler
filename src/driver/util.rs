// JS-facing register/flag snapshots. Field names are part of the frontend
// contract (compiler.js reads reg.ah...es and flg.iflag) and must not change.

use crate::exec::{Cpu, AF, CF, DF, IF, OF, PF, SF, TF, ZF};
use crate::frontend::ast::{Reg, R8};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct JSFlags {
    pub of: u8,
    pub df: u8,
    pub iflag: u8,
    pub tf: u8,
    pub sf: u8,
    pub zf: u8,
    pub af: u8,
    pub pf: u8,
    pub cf: u8,
}

#[wasm_bindgen]
pub struct JSReg {
    pub ah: u8,
    pub al: u8,
    pub bh: u8,
    pub bl: u8,
    pub ch: u8,
    pub cl: u8,
    pub dh: u8,
    pub dl: u8,
    pub si: u16,
    pub di: u16,
    pub bp: u16,
    pub sp: u16,
    pub ss: u16,
    pub ds: u16,
    pub es: u16,
}

pub fn get_flags(cpu: &Cpu) -> JSFlags {
    JSFlags {
        of: u8::from(cpu.flag(OF)),
        df: u8::from(cpu.flag(DF)),
        iflag: u8::from(cpu.flag(IF)),
        tf: u8::from(cpu.flag(TF)),
        sf: u8::from(cpu.flag(SF)),
        zf: u8::from(cpu.flag(ZF)),
        af: u8::from(cpu.flag(AF)),
        pf: u8::from(cpu.flag(PF)),
        cf: u8::from(cpu.flag(CF)),
    }
}

pub fn get_reg(cpu: &Cpu) -> JSReg {
    JSReg {
        ah: cpu.r8(R8::AH),
        al: cpu.r8(R8::AL),
        bh: cpu.r8(R8::BH),
        bl: cpu.r8(R8::BL),
        ch: cpu.r8(R8::CH),
        cl: cpu.r8(R8::CL),
        dh: cpu.r8(R8::DH),
        dl: cpu.r8(R8::DL),
        si: cpu.r16(Reg::SI),
        di: cpu.r16(Reg::DI),
        bp: cpu.r16(Reg::BP),
        sp: cpu.r16(Reg::SP),
        ss: cpu.r16(Reg::SS),
        ds: cpu.r16(Reg::DS),
        es: cpu.r16(Reg::ES),
    }
}
