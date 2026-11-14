// WebDriver: the wasm-facing execution driver (unchanged JS contract):
// preprocess() -> driver, next() -> {halt,int,ah}, get_state_snapshot(),
// get_reg/get_flags/get_mem, int_10/get_int_21/set_int_21, public `line`.

use crate::exec::{Cpu, MEM_SIZE};
use crate::frontend::sema::Program;
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// One byte of RAM touched by the last executed instruction, with its value
/// before and after the instruction (used to rebuild historical RAM exactly).
#[derive(Serialize, Clone, Debug)]
pub struct MemChange {
    pub address: u32,
    pub before: u8,
    pub after: u8,
}

#[allow(non_snake_case)]
#[derive(Serialize, Clone, Debug)]
pub struct RegistersSnapshot {
    pub AX: u16,
    pub BX: u16,
    pub CX: u16,
    pub DX: u16,
    pub SI: u16,
    pub DI: u16,
    pub SP: u16,
    pub BP: u16,
    pub CS: u16,
    pub DS: u16,
    pub SS: u16,
    pub ES: u16,
    pub IP: u16,
}

#[allow(non_snake_case)]
#[derive(Serialize, Clone, Debug)]
pub struct FlagsSnapshot {
    pub CF: bool,
    pub PF: bool,
    pub AF: bool,
    pub ZF: bool,
    pub SF: bool,
    pub TF: bool,
    pub IF: bool,
    pub DF: bool,
    pub OF: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct StateSnapshot {
    pub instruction: String,
    pub registers: RegistersSnapshot,
    pub flags: FlagsSnapshot,
    pub changed_memory: Vec<MemChange>,
}

#[wasm_bindgen]
pub struct InterpreterResult {
    pub halt: Option<bool>,
    pub int: Option<u8>,
    pub ah: Option<u8>,
}

impl InterpreterResult {
    pub fn new() -> Self {
        InterpreterResult { halt: None, int: None, ah: None }
    }
}

#[wasm_bindgen]
pub struct WebDriver {
    pub line: usize,
    prog: Program,
    cpu: Cpu,
    prev_memory: Vec<u8>,
    last_instruction: String,
    last_changed_memory: Vec<MemChange>,
}

impl WebDriver {
    pub fn new(prog: Program) -> Self {
        let mut cpu = Cpu::new();
        for (addr, byte) in &prog.data_init {
            cpu.write8(*addr as usize, *byte);
        }
        cpu.ip = prog.entry;
        let prev_memory = cpu.mem.clone();
        let last_line = prog.lines.len();
        let mut wd = WebDriver {
            line: last_line,
            prog,
            cpu,
            prev_memory,
            last_instruction: String::new(),
            last_changed_memory: Vec::new(),
        };
        wd.update_line();
        wd
    }

    fn update_line(&mut self) {
        self.line = if self.cpu.ip < self.prog.instrs.len() {
            self.prog.instrs[self.cpu.ip].line
        } else {
            self.prog.lines.len()
        };
    }

    fn record_step(&mut self, executed: String) {
        self.last_instruction = executed;
        let prev = &self.prev_memory;
        let changed: Vec<MemChange> = self
            .cpu
            .mem
            .iter()
            .enumerate()
            .filter(|(i, &after)| after != prev[*i])
            .map(|(i, &after)| MemChange {
                address: i as u32,
                before: prev[i],
                after,
            })
            .collect();
        self.prev_memory.copy_from_slice(&self.cpu.mem);
        self.last_changed_memory = changed;
    }
}

#[wasm_bindgen]
impl WebDriver {
    pub fn next(&mut self) -> Result<InterpreterResult, JsValue> {
        let executed = if self.cpu.ip < self.prog.instrs.len() {
            self.prog.instrs[self.cpu.ip].text.clone()
        } else {
            "HLT".to_string()
        };
        let ip_before = self.cpu.ip;
        match self.cpu.step(&self.prog) {
            Ok(out) => {
                self.record_step(executed);
                self.update_line();
                Ok(InterpreterResult {
                    halt: if out.halt { Some(true) } else { None },
                    int: out.int,
                    ah: out.ah,
                })
            }
            Err(msg) => {
                // keep the driver on the failing instruction so the UI and a
                // repeated step see the same error instead of skipping ahead
                self.cpu.ip = ip_before;
                self.record_step(executed);
                self.update_line();
                Err(JsValue::from(msg))
            }
        }
    }

    #[wasm_bindgen]
    pub fn get_state_snapshot(&self) -> JsValue {
        let flags = &self.cpu.flags;
        let snapshot = StateSnapshot {
            instruction: self.last_instruction.clone(),
            registers: RegistersSnapshot {
                AX: self.cpu.r16(crate::frontend::ast::Reg::AX),
                BX: self.cpu.r16(crate::frontend::ast::Reg::BX),
                CX: self.cpu.r16(crate::frontend::ast::Reg::CX),
                DX: self.cpu.r16(crate::frontend::ast::Reg::DX),
                SI: self.cpu.r16(crate::frontend::ast::Reg::SI),
                DI: self.cpu.r16(crate::frontend::ast::Reg::DI),
                SP: self.cpu.r16(crate::frontend::ast::Reg::SP),
                BP: self.cpu.r16(crate::frontend::ast::Reg::BP),
                CS: self.cpu.r16(crate::frontend::ast::Reg::CS),
                DS: self.cpu.r16(crate::frontend::ast::Reg::DS),
                SS: self.cpu.r16(crate::frontend::ast::Reg::SS),
                ES: self.cpu.r16(crate::frontend::ast::Reg::ES),
                IP: self.cpu.ip as u16,
            },
            flags: FlagsSnapshot {
                CF: flags & crate::exec::CF != 0,
                PF: flags & crate::exec::PF != 0,
                AF: flags & crate::exec::AF != 0,
                ZF: flags & crate::exec::ZF != 0,
                SF: flags & crate::exec::SF != 0,
                TF: flags & crate::exec::TF != 0,
                IF: flags & crate::exec::IF != 0,
                DF: flags & crate::exec::DF != 0,
                OF: flags & crate::exec::OF != 0,
            },
            changed_memory: self.last_changed_memory.clone(),
        };
        JsValue::from_str(&serde_json::to_string(&snapshot).unwrap())
    }

    pub fn get_flags(&self) -> super::util::JSFlags {
        super::util::get_flags(&self.cpu)
    }

    pub fn get_reg(&self) -> super::util::JSReg {
        super::util::get_reg(&self.cpu)
    }

    pub fn get_mem(&self, start: usize, end: usize) -> Vec<u8> {
        if end < start {
            return Vec::new();
        }
        (start..=end).map(|i| self.cpu.read8(i)).collect()
    }

    pub fn int_10(&self) -> JsValue {
        let ah = self.cpu.r8(crate::frontend::ast::R8::AH);
        let mut ret = String::new();
        if ah == 0xA {
            let al = self.cpu.r8(crate::frontend::ast::R8::AL);
            let count = self.cpu.r16(crate::frontend::ast::Reg::CX);
            for _ in 0..count {
                ret.push(al as char);
            }
        }
        if ah == 0x13 {
            let len = self.cpu.r16(crate::frontend::ast::Reg::CX) as usize;
            let col = self.cpu.r8(crate::frontend::ast::R8::DL) as usize;
            let es = self.cpu.r16(crate::frontend::ast::Reg::ES);
            let bp = self.cpu.r16(crate::frontend::ast::Reg::BP);
            let start = es as usize * 0x10 + bp as usize;
            for _ in 0..col {
                ret.push(' ');
            }
            for i in 0..len {
                ret.push(self.cpu.read8(start + i) as char);
            }
        }
        JsValue::from(ret)
    }

    pub fn get_int_21(&mut self) -> JsValue {
        use crate::frontend::ast::R8;
        use crate::frontend::ast::Reg;
        let ah = self.cpu.r8(R8::AH);
        let mut ret = String::new();
        if ah == 0x2 {
            let dl = self.cpu.r8(R8::DL);
            ret.push(dl as char);
            self.cpu.set_r8(R8::AL, dl);
        } else if ah == 0x9 {
            let ds = self.cpu.r16(Reg::DS);
            let dx = self.cpu.r16(Reg::DX);
            let mut addr = ds as usize * 0x10 + dx as usize;
            // DOS prints until '$'; cap keeps runaway buffers harmless
            for _ in 0..0xFFFF {
                let b = self.cpu.read8(addr);
                if b == b'$' {
                    break;
                }
                ret.push(b as char);
                addr += 1;
            }
        }
        JsValue::from(ret)
    }

    pub fn set_int_21(&mut self, input: String) {
        use crate::frontend::ast::R8;
        use crate::frontend::ast::Reg;
        let ah = self.cpu.r8(R8::AH);
        let bytes: Vec<u8> = input.bytes().collect();
        if ah == 0x1 {
            let b = bytes.first().copied().unwrap_or(0);
            self.cpu.set_r8(R8::AL, b);
        }
        if ah == 0xA {
            let ds = self.cpu.r16(Reg::DS);
            let dx = self.cpu.r16(Reg::DX);
            let start = ds as usize * 0x10 + dx as usize;
            let required = self.cpu.read8(start) as usize;
            let n = bytes.len().min(required);
            self.cpu.write8(start + 1, n as u8);
            for (i, b) in bytes.iter().take(n).enumerate() {
                self.cpu.write8(start + 2 + i, *b);
            }
        }
    }
}

// silence unused-constant style helpers kept for parity with the old API
#[allow(dead_code)]
const _MEM_SIZE: usize = MEM_SIZE;
