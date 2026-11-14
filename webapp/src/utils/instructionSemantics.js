import { toHex4, toHex2 } from './numberFormat';

const BYTE_PARENT = {
  AH: 'AX', AL: 'AX',
  BH: 'BX', BL: 'BX',
  CH: 'CX', CL: 'CX',
  DH: 'DX', DL: 'DX',
};
const WORD_REGS = [
  'AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'SP', 'BP',
  'CS', 'DS', 'SS', 'ES', 'IP',
];

function isByteToken(token) {
  return Object.prototype.hasOwnProperty.call(
    BYTE_PARENT,
    String(token || '').trim().toUpperCase()
  );
}

/** Read a register (16-bit or 8-bit alias) from a snapshot register map. */
function readRegister(regs, token) {
  if (!regs || !token) return undefined;
  const up = String(token).trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(BYTE_PARENT, up)) {
    const word = regs[BYTE_PARENT[up]];
    if (word === undefined) return undefined;
    return up[1] === 'H' ? (word >> 8) & 0xff : word & 0xff;
  }
  if (WORD_REGS.indexOf(up) >= 0) {
    const v = regs[up];
    return v === undefined ? undefined : v & 0xffff;
  }
  return undefined;
}

/**
 * Render an operand as it is observed in `regs`: registers show their real
 * value with the right width, immediates/labels are echoed verbatim.
 */
function formatOperand(regs, token) {
  if (token === undefined || token === null || token === '') return '';
  const up = String(token).trim().toUpperCase();
  const value = readRegister(regs, up);
  if (value !== undefined) {
    return isByteToken(up) ? toHex2(value) : toHex4(value);
  }
  return up;
}

export const FLAG_NAMES = {
  CF: 'Carry Flag (unsigned overflow/borrow)',
  ZF: 'Zero Flag (result is zero)',
  SF: 'Sign Flag (high bit is 1, negative in signed interpretation)',
  OF: 'Overflow Flag (signed overflow)',
  PF: 'Parity Flag (even number of 1-bits in low byte)',
  AF: 'Auxiliary Carry Flag (BCD carry from bit 3 to 4)',
  TF: 'Trap Flag (single-step debug mode)',
  IF: 'Interrupt Enable Flag',
  DF: 'Direction Flag (string operation direction)',
};

/**
 * Classify flag behavior for a given mnemonic
 */
export function getFlagSemantics(mnemonic) {
  const m = (mnemonic || '').toUpperCase();
  switch (m) {
    case 'MOV':
    case 'LEA':
    case 'PUSH':
    case 'POP':
    case 'XCHG':
      return { affects: [], preserves: ['CF', 'ZF', 'SF', 'OF', 'PF', 'AF'] };

    case 'INC':
    case 'DEC':
      return { affects: ['ZF', 'SF', 'OF', 'PF', 'AF'], preserves: ['CF'] };

    case 'ADD':
    case 'SUB':
    case 'CMP':
      return { affects: ['CF', 'ZF', 'SF', 'OF', 'PF', 'AF'], preserves: [] };

    case 'AND':
    case 'OR':
    case 'XOR':
      return { affects: ['CF', 'OF', 'ZF', 'SF', 'PF'], preserves: ['AF'], notes: 'CF and OF cleared to 0' };

    case 'NOT':
      return { affects: [], preserves: ['CF', 'ZF', 'SF', 'OF', 'PF', 'AF'] };

    default:
      return { affects: [], preserves: [] };
  }
}

/**
 * Answer the three core student questions:
 * 1. What executed?
 * 2. What changed?
 * 3. Why?
 */
export function generateExplanation(current, prev) {
  if (!current || !current.instruction) {
    return {
      title: 'Ready to Execute',
      what: 'No instruction executed yet.',
      changes: 'CPU is at its initial prepared state.',
      why: 'Press Step to execute one instruction or Run to execute continuously.',
    };
  }

  if (current.isBaseline) {
    return {
      title: 'Program Prepared',
      what: 'Assembly program parsed and initialized in interpreter memory.',
      changes: 'Registers initialized; baseline state captured.',
      why: 'Click Step to begin execution with the first instruction.',
    };
  }

  const raw = current.instruction.trim();
  const spaceIdx = raw.indexOf(' ');
  const mnemonic = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toUpperCase().trim();
  const operandStr = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1).trim();
  const operands = operandStr.split(',').map((s) => s.trim()).filter(Boolean);
  const dest = operands[0] || '';
  const src = operands[1] || '';

  const regs = current.registers || {};
  const prevRegs = prev ? prev.registers || {} : regs;
  const flags = current.flags || {};
  const prevFlags = prev ? prev.flags || {} : flags;

  // Real values from the snapshots — never substituted with AX as a fallback.
  const destVal = formatOperand(regs, dest);
  const prevDestVal = formatOperand(prevRegs, dest) || destVal;
  const srcVal = formatOperand(regs, src) || formatOperand(prevRegs, src);

  // Width of the executed operation, taken from the destination register.
  const opIsByte = isByteToken(dest);

  // Detect which flags actually flipped
  const flagChanges = [];
  ['CF', 'ZF', 'SF', 'OF'].forEach((fl) => {
    if (flags[fl] !== undefined && prevFlags[fl] !== undefined) {
      if (flags[fl] !== prevFlags[fl]) {
        flagChanges.push(`${fl}: ${prevFlags[fl] ? 1 : 0} → ${flags[fl] ? 1 : 0}`);
      }
    }
  });

  const flagStatusStr = `CF=${flags.CF ? 1 : 0}, ZF=${flags.ZF ? 1 : 0}, SF=${flags.SF ? 1 : 0}, OF=${flags.OF ? 1 : 0}`;
  const flagChangeStr = flagChanges.length > 0 ? `Flag transitions: ${flagChanges.join(', ')}.` : 'No key flags (CF, ZF, SF, OF) changed state.';

  switch (mnemonic) {
    case 'MOV':
      return {
        title: `MOV ${dest}, ${src}`,
        what: `Copied ${srcVal || src} into ${dest}.`,
        changes: `${dest} changed from ${prevDestVal} to ${destVal}. Flags unchanged (MOV preserves all CPU flags).`,
        why: 'MOV transfers data without arithmetic evaluation.',
      };

    case 'ADD':
      return {
        title: `ADD ${dest}, ${src}`,
        what: `Added ${srcVal || src} to ${dest}.`,
        changes: `${dest} is now ${destVal} (was ${prevDestVal}). ${flagStatusStr}.`,
        why: `Addition computed by ALU. ${flagChangeStr}`,
      };

    case 'SUB':
      return {
        title: `SUB ${dest}, ${src}`,
        what: `Subtracted ${srcVal || src} from ${dest}.`,
        changes: `${dest} is now ${destVal} (was ${prevDestVal}). ${flagStatusStr}.`,
        why: `Subtraction computed by ALU (dest - src). ${flagChangeStr}`,
      };

    case 'CMP':
      return {
        title: `CMP ${dest}, ${src}`,
        what: `Compared ${dest} with ${srcVal || src}.`,
        changes: `Registers unchanged (${dest} remains ${destVal}). Flags updated: ${flagStatusStr}.`,
        why: `CMP performs a temporary subtraction (${dest} - ${srcVal || src}) and sets CPU flags without storing the result. ${flagChangeStr}`,
      };

    case 'INC':
      return {
        title: `INC ${dest}`,
        what: `Incremented ${dest} by 1.`,
        changes: `${dest} changed from ${prevDestVal} to ${destVal}. ${flagStatusStr}.`,
        why: 'ALU added 1 to destination. Note: INC updates ZF, SF, OF, but preserves the Carry Flag (CF).',
      };

    case 'DEC':
      return {
        title: `DEC ${dest}`,
        what: `Decremented ${dest} by 1.`,
        changes: `${dest} changed from ${prevDestVal} to ${destVal}. ${flagStatusStr}.`,
        why: 'ALU subtracted 1 from destination. Note: DEC updates ZF, SF, OF, but preserves the Carry Flag (CF).',
      };

    case 'MUL': {
      const byteOp = isByteToken(dest);
      const al = readRegister(regs, 'AL');
      const ax = readRegister(regs, 'AX');
      const dx = readRegister(regs, 'DX');
      const prevAl = readRegister(prevRegs, 'AL');
      const prevAx = readRegister(prevRegs, 'AX');
      return {
        title: `MUL ${dest || 'operand'}`,
        what: byteOp
          ? `Unsigned byte multiplication: AL (${toHex2(prevAl)}) × ${dest}.`
          : `Unsigned word multiplication: AX (${toHex4(prevAx)}) × ${dest}.`,
        changes: byteOp
          ? `Product placed in AX = ${toHex4(ax)} (AL=${toHex2(al & 0xff)}, AH=${toHex2((ax >> 8) & 0xff)}). CF=${flags.CF ? 1 : 0}, OF=${flags.OF ? 1 : 0}.`
          : `Product placed in DX:AX = ${toHex4(dx)}:${toHex4(ax)}. CF=${flags.CF ? 1 : 0}, OF=${flags.OF ? 1 : 0}.`,
        why: byteOp
          ? 'An 8-bit MUL always multiplies AL by its operand and stores the 16-bit result in AX.'
          : 'A 16-bit MUL always multiplies AX by its operand and stores the 32-bit result in DX:AX.',
      };
    }

    case 'DIV': {
      const byteOp = isByteToken(dest);
      const ax = readRegister(regs, 'AX');
      const dx = readRegister(regs, 'DX');
      return {
        title: `DIV ${dest || 'operand'}`,
        what: byteOp
          ? `Unsigned byte division: AX (${toHex4(ax)}) ÷ ${dest}.`
          : `Unsigned word division: DX:AX (${toHex4(dx)}:${toHex4(ax)}) ÷ ${dest}.`,
        changes: byteOp
          ? `Quotient in AL = ${toHex2(ax & 0xff)}, remainder in AH = ${toHex2((ax >> 8) & 0xff)}.`
          : `Quotient in AX = ${toHex4(ax)}, remainder in DX = ${toHex4(dx)}.`,
        why: byteOp
          ? 'An 8-bit DIV divides AX by its operand: AL receives the quotient and AH the remainder.'
          : 'A 16-bit DIV divides DX:AX by its operand: AX receives the quotient and DX the remainder. Arithmetic flags are undefined after DIV.',
      };
    }

    case 'ADC':
      return {
        title: `ADC ${dest}, ${src}`,
        what: `Added ${srcVal || src} and the Carry Flag to ${dest}.`,
        changes: `${dest} changed from ${prevDestVal} to ${destVal}. ${flagStatusStr}.`,
        why: `Add-with-carry computed by the ALU (dest + src + CF). ${flagChangeStr}`,
      };

    case 'SBB':
      return {
        title: `SBB ${dest}, ${src}`,
        what: `Subtracted ${srcVal || src} and the Carry Flag from ${dest}.`,
        changes: `${dest} changed from ${prevDestVal} to ${destVal}. ${flagStatusStr}.`,
        why: `Subtract-with-borrow computed by the ALU (dest - src - CF). ${flagChangeStr}`,
      };

    case 'TEST':
      return {
        title: `TEST ${dest}, ${src}`,
        what: `Bitwise AND of ${dest} and ${srcVal || src} without storing the result.`,
        changes: `${dest} unchanged (${destVal}). Flags updated: ${flagStatusStr}.`,
        why: 'TEST only updates flags (CF and OF are cleared); no destination value is written.',
      };

    case 'SHL':
    case 'SHR':
    case 'SAR':
      return {
        title: `${mnemonic} ${dest}, ${src}`,
        what: `Shifted ${dest} ${mnemonic === 'SHL' ? 'left' : 'right'} by ${srcVal || src} position(s).`,
        changes: `${dest} changed from ${prevDestVal} to ${destVal}. ${flagStatusStr}.`,
        why: `${mnemonic} moves bits through the Carry Flag; CF ends up holding the last bit shifted out.`,
      };

    case 'NEG':
      return {
        title: `NEG ${dest}`,
        what: `Two's complement negation of ${dest}.`,
        changes: `${dest} changed from ${prevDestVal} to ${destVal}. ${flagStatusStr}.`,
        why: 'NEG computes 0 - operand. CF is set when the operand was not zero.',
      };

    case 'CALL':
      return {
        title: `CALL ${dest}`,
        what: `Called subroutine at ${dest}.`,
        changes: `Return address pushed onto the stack; SP is now ${toHex4(regs.SP)}.`,
        why: 'CALL pushes the address of the next instruction so RET can resume execution there.',
      };

    case 'RET':
      return {
        title: 'RET',
        what: 'Returned from a subroutine.',
        changes: `Return address popped from the stack; SP is now ${toHex4(regs.SP)}.`,
        why: 'RET pops the address that CALL pushed and continues execution from it.',
      };

    case 'AND':
      return {
        title: `AND ${dest}, ${src}`,
        what: `Bitwise AND of ${dest} and ${srcVal || src}.`,
        changes: `${dest} is now ${destVal}. ${flagStatusStr}.`,
        why: 'Each bit is 1 only if corresponding bits in both operands are 1. CF and OF are cleared.',
      };

    case 'OR':
      return {
        title: `OR ${dest}, ${src}`,
        what: `Bitwise OR of ${dest} and ${srcVal || src}.`,
        changes: `${dest} is now ${destVal}. ${flagStatusStr}.`,
        why: 'Each bit is 1 if either bit in the operands is 1. CF and OF are cleared.',
      };

    case 'XOR':
      return {
        title: `XOR ${dest}, ${src}`,
        what: `Bitwise XOR of ${dest} and ${srcVal || src}.`,
        changes: `${dest} is now ${destVal}. ${flagStatusStr}.`,
        why: 'Each bit is 1 if exactly one operand bit is 1. If operands are identical, result is 0 and ZF=1.',
      };

    case 'NOT':
      return {
        title: `NOT ${dest}`,
        what: `Bitwise NOT (one's complement) of ${dest}.`,
        changes: `${dest} is now ${destVal} (all bits inverted). Flags unchanged.`,
        why: 'Every bit flipped (0 → 1, 1 → 0). NOT does not affect any CPU flags.',
      };

    case 'JMP':
      return {
        title: `JMP ${dest}`,
        what: `Unconditional jump to label ${dest}.`,
        changes: `Execution position branched to ${dest}. Flags unchanged.`,
        why: 'Unconditional transfer of interpreter control.',
      };

    case 'JZ':
    case 'JE': {
      const taken = flags.ZF;
      return {
        title: `${mnemonic} ${dest}`,
        what: `Jump if Zero / Equal (ZF=1).`,
        changes: taken ? `Branch TAKEN to ${dest} (ZF is 1).` : `Branch NOT taken; continued sequentially (ZF is 0).`,
        why: `Evaluated Zero Flag (ZF=${flags.ZF ? 1 : 0}).`,
      };
    }

    case 'JNZ':
    case 'JNE': {
      const taken = !flags.ZF;
      return {
        title: `${mnemonic} ${dest}`,
        what: `Jump if Not Zero / Not Equal (ZF=0).`,
        changes: taken ? `Branch TAKEN to ${dest} (ZF is 0).` : `Branch NOT taken; continued sequentially (ZF is 1).`,
        why: `Evaluated Zero Flag (ZF=${flags.ZF ? 1 : 0}).`,
      };
    }

    case 'JC':
    case 'JB': {
      const taken = flags.CF;
      return {
        title: `${mnemonic} ${dest}`,
        what: `Jump if Carry / Below (CF=1).`,
        changes: taken ? `Branch TAKEN to ${dest} (CF is 1).` : `Branch NOT taken (CF is 0).`,
        why: `Evaluated Carry Flag (CF=${flags.CF ? 1 : 0}).`,
      };
    }

    case 'JNC':
    case 'JAE': {
      const taken = !flags.CF;
      return {
        title: `${mnemonic} ${dest}`,
        what: `Jump if Not Carry / Above or Equal (CF=0).`,
        changes: taken ? `Branch TAKEN to ${dest} (CF is 0).` : `Branch NOT taken (CF is 1).`,
        why: `Evaluated Carry Flag (CF=${flags.CF ? 1 : 0}).`,
      };
    }

    case 'LOOP':
      return {
        title: `LOOP ${dest}`,
        what: `Loop iteration: decrement CX and branch if CX != 0.`,
        changes: `CX is now ${toHex4(regs.CX)}. ${regs.CX !== 0 ? 'Branch taken to ' + dest : 'Loop completed; sequential execution continues'}.`,
        why: 'Hardware loop instruction checks CX counter register.',
      };

    case 'PUSH':
      return {
        title: `PUSH ${dest}`,
        what: `Pushed ${dest} (${destVal || 'value'}) onto the stack.`,
        changes: `SP changed from ${toHex4(prevRegs.SP)} to ${toHex4(
          regs.SP
        )}. The word was written at SS:SP = ${toHex4(regs.SS)}:${toHex4(
          regs.SP
        )}.`,
        why: 'The 8086 stack grows downward: PUSH subtracts 2 from SP before storing the word at SS:SP.',
      };

    case 'POP':
      return {
        title: `POP ${dest}`,
        what: `Popped the word at SS:SP into ${dest}.`,
        changes: `${dest} now holds ${destVal || 'the popped value'} (was ${prevDestVal}). SP changed from ${toHex4(
          prevRegs.SP
        )} to ${toHex4(regs.SP)}.`,
        why: 'The 8086 stack shrinks upward: POP reads the word at SS:SP and then adds 2 to SP.',
      };

    case 'INT':
      return {
        title: `INT ${dest}`,
        what: `Software interrupt call ${dest}.`,
        changes: 'Called system BIOS/DOS service.',
        why: `Triggered software interrupt handler for INT ${dest}.`,
      };

    case 'HLT':
      return {
        title: 'HLT',
        what: 'Halt CPU instruction execution.',
        changes: 'Program execution halted.',
        why: 'Execution reached end of program or explicit HLT.',
      };

    default:
      return {
        title: raw,
        what: `Executed: ${raw}`,
        changes: dest
          ? `${dest} (${opIsByte ? 8 : 16}-bit) = ${
              destVal || 'state updated'
            }. ${flagStatusStr}.`
          : `State updated. ${flagStatusStr}.`,
        why: 'State updated according to 8086 interpreter rules.',
      };
  }
}
