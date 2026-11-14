// Abstract syntax tree for Intel/MASM style 8086 assembly programs.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Size {
    Byte,
    Word,
}

/// 16-bit general registers (Intel reg-field order) plus segment registers
/// (ES=8, CS=9, SS=10, DS=11 keep the Intel encoding offset).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reg {
    AX = 0,
    CX = 1,
    DX = 2,
    BX = 3,
    SP = 4,
    BP = 5,
    SI = 6,
    DI = 7,
    ES = 8,
    CS = 9,
    SS = 10,
    DS = 11,
}

impl Reg {
    pub fn is_seg(self) -> bool {
        (self as i32) >= 8
    }
    pub fn code(self) -> u8 {
        self as u8
    }
}

/// 8-bit registers in Intel encoding order (AL CL DL BL AH CH DH BH).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum R8 {
    AL = 0,
    CL = 1,
    DL = 2,
    BL = 3,
    AH = 4,
    CH = 5,
    DH = 6,
    BH = 7,
}

impl R8 {
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn parent(self) -> Reg {
        match self {
            R8::AL | R8::AH => Reg::AX,
            R8::CL | R8::CH => Reg::CX,
            R8::DL | R8::DH => Reg::DX,
            R8::BL | R8::BH => Reg::BX,
        }
    }
    pub fn is_high(self) -> bool {
        matches!(self, R8::AH | R8::CH | R8::DH | R8::BH)
    }
}

#[derive(Debug, Clone)]
pub enum Expr {
    Num(i32),
    Offset(String),
    Seg(String),
}

#[derive(Debug, Clone)]
pub enum Term {
    Reg(Reg), // only BX BP SI DI legal inside brackets (validated in sema)
    Num(i32),
    Sym(String),
}

#[derive(Debug, Clone)]
pub struct MemOperand {
    pub seg: Option<Reg>,
    pub size: Option<Size>,
    pub terms: Vec<Term>,
    pub line: usize,
    pub col: usize,
}

#[derive(Debug, Clone)]
pub enum Operand {
    R8(R8),
    R16(Reg),
    Seg(Reg),
    Imm(Expr),
    Mem(MemOperand),
    /// jump/call target by name (resolved in sema)
    Label(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepKind {
    Rep,
    Repe,
    Repne,
}

/// Mnemonics understood by the executor (original 8086 set only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Mov,
    Movsb,
    Movsw,
    Lodsb,
    Lodsw,
    Stosb,
    Stosw,
    Cmpsb,
    Cmpsw,
    Scasb,
    Scasw,
    Xchg,
    Lea,
    Push,
    Pop,
    Pushf,
    Popf,
    Add,
    Adc,
    Sub,
    Sbb,
    Cmp,
    Inc,
    Dec,
    Neg,
    Mul,
    Imul,
    Div,
    Idiv,
    And,
    Or,
    Xor,
    Not,
    Test,
    Rol,
    Ror,
    Rcl,
    Rcr,
    Shl,
    Shr,
    Sar,
    Jmp,
    Call,
    Ret,
    Jo,
    Jno,
    Jb,
    Jae,
    Je,
    Jne,
    Jbe,
    Ja,
    Js,
    Jns,
    Jp,
    Jnp,
    Jl,
    Jge,
    Jle,
    Jg,
    Loop,
    Loope,
    Loopne,
    Jcxz,
    Int,
    Hlt,
    Nop,
    Cbw,
    Cwd,
    Clc,
    Stc,
    Cmc,
    Cld,
    Std,
    Sti,
    Cli,
    /// legacy `print` pseudo statement (no runtime effect - preserved so the
    /// shipped sample programs keep compiling, as in the previous engine)
    Print,
}

impl Op {
    pub fn is_jump(self) -> bool {
        matches!(
            self,
            Op::Jmp
                | Op::Call
                | Op::Jo
                | Op::Jno
                | Op::Jb
                | Op::Jae
                | Op::Je
                | Op::Jne
                | Op::Jbe
                | Op::Ja
                | Op::Js
                | Op::Jns
                | Op::Jp
                | Op::Jnp
                | Op::Jl
                | Op::Jge
                | Op::Jle
                | Op::Jg
                | Op::Loop
                | Op::Loope
                | Op::Loopne
                | Op::Jcxz
        )
    }
    pub fn is_string_op(self) -> bool {
        matches!(
            self,
            Op::Movsb
                | Op::Movsw
                | Op::Lodsb
                | Op::Lodsw
                | Op::Stosb
                | Op::Stosw
                | Op::Cmpsb
                | Op::Cmpsw
                | Op::Scasb
                | Op::Scasw
        )
    }
}

#[derive(Debug, Clone)]
pub struct Instr {
    pub op: Op,
    pub line: usize,
    pub text: String,
    pub dst: Option<Operand>,
    pub src: Option<Operand>,
    pub size: Option<Size>,
    pub rep: Option<RepKind>,
}

#[derive(Debug)]
pub enum DataItem {
    Bytes(Vec<u8>),
    Words(Vec<u16>),
}

#[derive(Debug)]
pub enum Stmt {
    /// standalone `name:` line; resolved by sema against the next real statement
    DefLabel {
        name: String,
        line: usize,
    },
    Instr {
        label: Option<String>,
        instr: Instr,
    },
    Data {
        line: usize,
        label: Option<String>,
        size: Size,
        items: Vec<DataItem>,
    },
    /// `SET n` - move the data origin to paragraph n (n * 16), matching the
    /// legacy engine's segment-oriented sample programs.
    SetAddr {
        line: usize,
        value: i32,
    },
    /// PROC/ENDP/.CODE/.DATA style markers - no runtime effect.
    Marker {
        line: usize,
    },
    /// `END [label]`
    End {
        line: usize,
        target: Option<String>,
    },
}
