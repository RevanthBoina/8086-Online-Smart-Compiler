import React from 'react';
import { useEmulator } from '../context/EmulatorContext';
import { toHex2, toHex4, toBin8, toBin16 } from '../utils/numberFormat';

/**
 * ALU Operation Breakdown.
 *
 * Everything shown here is derived from the real WASM snapshots: operand
 * values come from the *previous* snapshot and results/flags from the
 * *current* one. Nothing is simulated in the frontend — if an operand cannot
 * be resolved reliably the panel says so instead of inventing a number.
 */

const BYTE_REGS = new Set([
  'AH', 'AL', 'BH', 'BL', 'CH', 'CL', 'DH', 'DL',
]);
const WORD_REGS = new Set([
  'AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'SP', 'BP',
  'CS', 'DS', 'SS', 'ES',
]);
const BYTE_PARENT = {
  AH: 'AX', AL: 'AX',
  BH: 'BX', BL: 'BX',
  CH: 'CX', CL: 'CX',
  DH: 'DX', DL: 'DX',
};

const BINARY_OPS = new Set([
  'ADD', 'SUB', 'CMP', 'AND', 'OR', 'XOR', 'ADC', 'SBB', 'TEST',
]);
const SHIFT_OPS = new Set([
  'SHL', 'SHR', 'SAR', 'ROL', 'ROR', 'RCL', 'RCR',
]);
const WIDE_OPS = new Set(['MUL', 'IMUL', 'DIV', 'IDIV']);
const UNARY_OPS = new Set(['INC', 'DEC', 'NOT', 'NEG']);

const FLAG_EXPLANATIONS = {
  ADD: 'CF = unsigned carry out, OF = signed overflow.',
  ADC: 'CF = unsigned carry in/out, OF = signed overflow.',
  SUB: 'CF = unsigned borrow, OF = signed overflow.',
  SBB: 'CF = borrow in/out, OF = signed overflow.',
  CMP: 'CF = unsigned borrow, OF = signed overflow; result is discarded.',
  AND: 'CF and OF cleared to 0.',
  OR: 'CF and OF cleared to 0.',
  XOR: 'CF and OF cleared to 0.',
  TEST: 'CF and OF cleared to 0; result is discarded.',
  SHL: 'CF = last bit shifted out of the destination.',
  SHR: 'CF = last bit shifted out of the destination.',
  SAR: 'CF = last bit shifted out of the destination.',
  ROL: 'CF = last bit rotated into the destination.',
  ROR: 'CF = last bit rotated into the destination.',
  RCL: 'CF participates in the rotate chain.',
  RCR: 'CF participates in the rotate chain.',
  INC: 'CF is preserved by INC.',
  DEC: 'CF is preserved by DEC.',
  NOT: 'NOT does not affect any flag.',
  NEG: 'CF is set when the operand is non-zero, OF set for the most-negative value.',
  MUL: 'CF = OF = 1 when the upper half of the product is non-zero, otherwise both 0.',
  IMUL: 'CF = OF = 1 when the upper half of the product is not a sign extension.',
  DIV: '8086 leaves AF, CF, OF, PF, SF and ZF undefined after DIV.',
  IDIV: '8086 leaves AF, CF, OF, PF, SF and ZF undefined after IDIV.',
};

/* ------------------------------------------------------------------ */
/* operand helpers                                                     */
/* ------------------------------------------------------------------ */

function readRegister(regs, name) {
  if (!regs || !name) return undefined;
  const up = String(name).toUpperCase();
  if (BYTE_REGS.has(up)) {
    const parent = regs[BYTE_PARENT[up]];
    if (parent === undefined) return undefined;
    return up[1] === 'H' ? (parent >> 8) & 0xff : parent & 0xff;
  }
  if (WORD_REGS.has(up)) {
    const v = regs[up];
    return v === undefined ? undefined : v & 0xffff;
  }
  return undefined;
}

function parseImmediate(token) {
  const t = String(token).trim().toUpperCase();
  if (/^[0-9A-F]+H$/.test(t)) return parseInt(t.slice(0, -1), 16);
  if (/^0X[0-9A-F]+$/.test(t)) return parseInt(t, 16);
  if (/^[01]+B$/.test(t)) return parseInt(t.slice(0, -1), 2);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return undefined;
}

/**
 * @returns {{kind:'reg'|'imm'|'mem'|'unknown', name:string,
 *            value:?number, isByte:?boolean}|null} null = unresolvable
 */
function parseOperand(token, regs) {
  if (!token) return null;
  const t = String(token).trim();
  const up = t.toUpperCase();
  if (BYTE_REGS.has(up) || WORD_REGS.has(up)) {
    const value = readRegister(regs, up);
    if (value === undefined) return null;
    return {
      kind: 'reg',
      name: up,
      value,
      isByte: BYTE_REGS.has(up),
    };
  }
  if (/^\[.*\]$/.test(t)) {
    return { kind: 'mem', name: t, value: null, isByte: null };
  }
  const imm = parseImmediate(t);
  if (imm !== undefined) {
    return { kind: 'imm', name: t, value: imm & 0xffff, isByte: null };
  }
  return { kind: 'unknown', name: t, value: null, isByte: null };
}

function fmt(value, isByte) {
  return isByte ? toHex2(value) : toHex4(value);
}

function fmtBin(value, isByte) {
  return isByte ? toBin8(value) : toBin16(value);
}

function unavailable(raw, reason) {
  return { unavailable: true, raw, reason };
}

/* ------------------------------------------------------------------ */
/* breakdown builders                                                  */
/* ------------------------------------------------------------------ */

function buildBinary(mnemonic, destToken, srcToken, prevRegs, curRegs, flags) {
  const destBefore = parseOperand(destToken, prevRegs);
  const src = parseOperand(srcToken, prevRegs);
  if (!destBefore || !src) {
    return unavailable(
      `${mnemonic} ${destToken}, ${srcToken}`,
      'an operand value is not present in the recorded CPU state'
    );
  }
  if (destBefore.kind === 'mem') {
    return unavailable(
      `${mnemonic} ${destToken}, ${srcToken}`,
      'memory operands have no explicit size in this instruction, so the operand width cannot be determined'
    );
  }
  if (destBefore.kind !== 'reg') {
    return unavailable(
      `${mnemonic} ${destToken}, ${srcToken}`,
      'the destination is not a register'
    );
  }
  if (src.kind === 'mem') {
    return unavailable(
      `${mnemonic} ${destToken}, ${srcToken}`,
      'memory operands have no explicit size in this instruction, so the operand width cannot be determined'
    );
  }
  if (src.kind === 'reg' && src.isByte !== destBefore.isByte) {
    return unavailable(
      `${mnemonic} ${destToken}, ${srcToken}`,
      'operand widths do not match'
    );
  }

  const isByte = destBefore.isByte;
  const destAfter = parseOperand(destToken, curRegs);
  if (!destAfter) {
    return unavailable(
      `${mnemonic} ${destToken}, ${srcToken}`,
      'the destination register is missing from the current CPU state'
    );
  }

  const storesResult = mnemonic !== 'CMP' && mnemonic !== 'TEST';
  return {
    unavailable: false,
    mnemonic,
    isByte,
    op1Label: storesResult ? `${destToken} (before)` : `${destToken} (unchanged)`,
    op1: destBefore.value,
    op1IsByte: isByte,
    op2Label: src.kind === 'imm' ? `${srcToken} (immediate)` : `${srcToken}`,
    op2: src.value,
    op2IsByte: isByte,
    resultLabel: storesResult ? `${destToken} (after)` : 'No result stored',
    result: storesResult ? destAfter.value : null,
    resultIsByte: isByte,
    note: FLAG_EXPLANATIONS[mnemonic] || '',
    flags,
  };
}

function buildUnary(mnemonic, destToken, prevRegs, curRegs, flags) {
  const before = parseOperand(destToken, prevRegs);
  if (!before) {
    return unavailable(`${mnemonic} ${destToken}`, 'operand value is not present in the recorded CPU state');
  }
  if (before.kind === 'mem') {
    return unavailable(
      `${mnemonic} ${destToken}`,
      'memory operands have no explicit size in this instruction, so the operand width cannot be determined'
    );
  }
  if (before.kind !== 'reg') {
    return unavailable(`${mnemonic} ${destToken}`, 'the operand is not a register');
  }
  const after = parseOperand(destToken, curRegs);
  if (!after) {
    return unavailable(`${mnemonic} ${destToken}`, 'the register is missing from the current CPU state');
  }
  const isByte = before.isByte;
  return {
    unavailable: false,
    mnemonic,
    isByte,
    op1Label: `${destToken} (before)`,
    op1: before.value,
    op1IsByte: isByte,
    op2Label:
      mnemonic === 'INC' || mnemonic === 'DEC'
        ? 'Constant 1'
        : 'Constant 0 / mask',
    op2: mnemonic === 'INC' || mnemonic === 'DEC' ? 1 : 0,
    op2IsByte: isByte,
    resultLabel: `${destToken} (after)`,
    result: after.value,
    resultIsByte: isByte,
    note: FLAG_EXPLANATIONS[mnemonic] || '',
    flags,
  };
}

function buildShift(mnemonic, destToken, countToken, prevRegs, curRegs, flags) {
  const before = parseOperand(destToken, prevRegs);
  const count = parseOperand(countToken, prevRegs);
  if (!before || !count) {
    return unavailable(`${mnemonic} ${destToken}, ${countToken}`, 'operand value is not present in the recorded CPU state');
  }
  if (before.kind !== 'reg') {
    return unavailable(
      `${mnemonic} ${destToken}, ${countToken}`,
      'only register destinations can be broken down here'
    );
  }
  if (count.kind === 'mem' || count.kind === 'unknown') {
    return unavailable(`${mnemonic} ${destToken}, ${countToken}`, 'the shift count could not be resolved');
  }
  const after = parseOperand(destToken, curRegs);
  if (!after) {
    return unavailable(`${mnemonic} ${destToken}, ${countToken}`, 'the register is missing from the current CPU state');
  }
  const isByte = before.isByte;
  return {
    unavailable: false,
    mnemonic,
    isByte,
    op1Label: `${destToken} (before)`,
    op1: before.value,
    op1IsByte: isByte,
    op2Label: `${countToken} (count)`,
    op2: count.value,
    op2IsByte: count.kind === 'reg' && count.isByte ? true : false,
    resultLabel: `${destToken} (after)`,
    result: after.value,
    resultIsByte: isByte,
    note: FLAG_EXPLANATIONS[mnemonic] || '',
    flags,
  };
}

function buildWide(mnemonic, operandToken, prevRegs, curRegs, flags) {
  const operand = parseOperand(operandToken, prevRegs);
  if (!operand) {
    return unavailable(`${mnemonic} ${operandToken}`, 'operand value is not present in the recorded CPU state');
  }
  if (operand.kind !== 'reg') {
    return unavailable(
      `${mnemonic} ${operandToken}`,
      'only register operands have a fixed width, so the operation size cannot be determined'
    );
  }

  const isByte = operand.isByte;
  const isMul = mnemonic === 'MUL' || mnemonic === 'IMUL';

  if (isMul) {
    // 8-bit: AL * r8      -> AX
    // 16-bit: AX * r16    -> DX:AX
    const implicitName = isByte ? 'AL' : 'AX';
    const implicit = readRegister(prevRegs, implicitName);
    const lo = readRegister(curRegs, 'AX');
    const hi = readRegister(curRegs, 'DX');
    if (implicit === undefined || lo === undefined || hi === undefined) {
      return unavailable(`${mnemonic} ${operandToken}`, 'the accumulator registers are missing from the CPU state');
    }
    return {
      unavailable: false,
      mnemonic,
      isByte,
      op1Label: `${implicitName} (implicit)`,
      op1: implicit,
      op1IsByte: isByte,
      op2Label: operandToken,
      op2: operand.value,
      op2IsByte: isByte,
      resultLabel: isByte ? 'AX (product)' : 'DX:AX (product)',
      result: isByte ? lo : null,
      resultIsByte: false,
      resultText: isByte ? null : `${toHex4(hi)}:${toHex4(lo)}`,
      wideParts: isByte
        ? [{ label: 'AX (16-bit product)', value: lo, isByte: false }]
        : [
            { label: 'DX (high half)', value: hi, isByte: false },
            { label: 'AX (low half)', value: lo, isByte: false },
          ],
      note: FLAG_EXPLANATIONS[mnemonic] || '',
      flags,
    };
  }

  // DIV / IDIV
  // 8-bit: AX / r8  -> quotient AL, remainder AH
  // 16-bit: DX:AX / r16 -> quotient AX, remainder DX
  const ax = readRegister(prevRegs, 'AX');
  const dx = readRegister(prevRegs, 'DX');
  const axAfter = readRegister(curRegs, 'AX');
  const dxAfter = readRegister(curRegs, 'DX');
  if (ax === undefined || dx === undefined || axAfter === undefined || dxAfter === undefined) {
    return unavailable(`${mnemonic} ${operandToken}`, 'the accumulator registers are missing from the CPU state');
  }

  const quotient = isByte ? axAfter & 0xff : axAfter;
  const remainder = isByte ? (axAfter >> 8) & 0xff : dxAfter;

  return {
    unavailable: false,
    mnemonic,
    isByte,
    op1Label: isByte
      ? 'AX (dividend, implicit)'
      : 'DX:AX (dividend, implicit)',
    op1: isByte ? ax : null,
    op1IsByte: false,
    op1Text: isByte ? null : `${toHex4(dx)}:${toHex4(ax)}`,
    op2Label: `${operandToken} (divisor)`,
    op2: operand.value,
    op2IsByte: isByte,
    resultLabel: isByte ? 'AL (quotient)' : 'AX (quotient)',
    result: quotient,
    resultIsByte: isByte,
    wideParts: isByte
      ? [
          { label: 'AL (quotient)', value: quotient, isByte: true },
          { label: 'AH (remainder)', value: remainder, isByte: true },
        ]
      : [
          { label: 'AX (quotient)', value: quotient, isByte: false },
          { label: 'DX (remainder)', value: remainder, isByte: false },
        ],
    note: FLAG_EXPLANATIONS[mnemonic] || '',
    flags,
  };
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

function OperandBox({ label, value, isByte, valueText }) {
  if (valueText !== undefined && valueText !== null) {
    return (
      <div>
        <div style={labelStyle}>{label}</div>
        <div style={{ ...hexStyle, fontSize: 14, fontWeight: 700 }}>
          {valueText}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div className="alu-binary" style={binaryStyle}>
        {fmtBin(value, isByte)}
      </div>
      <div className="alu-hex" style={hexStyle}>
        ({fmt(value, isByte)})
      </div>
    </div>
  );
}

export default function ALUPanel() {
  const { state } = useEmulator();
  const current =
    state && state.currentIndex >= 0 ? state.history[state.currentIndex] : null;
  const prev =
    state && state.currentIndex > 0 ? state.history[state.currentIndex - 1] : null;

  if (!current || !current.instruction || current.isBaseline) {
    return (
      <div className="alu-panel" style={panelStyle}>
        <div style={titleStyle}>⚙️ ALU Operation Breakdown</div>
        <div className="alu-inactive" style={inactiveStyle}>
          Run or step through an arithmetic/logical instruction to view ALU state.
        </div>
      </div>
    );
  }

  const raw = current.instruction.trim();
  const spaceIdx = raw.indexOf(' ');
  const mnemonic = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx))
    .toUpperCase()
    .trim();
  const operandStr = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1).trim();
  const parts = operandStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const currentRegs = current.registers || {};
  const flags = current.flags || {};
  const flagSummary = `CF=${flags.CF ? 1 : 0}  ZF=${flags.ZF ? 1 : 0}  SF=${
    flags.SF ? 1 : 0
  }  OF=${flags.OF ? 1 : 0}  PF=${flags.PF ? 1 : 0}  AF=${flags.AF ? 1 : 0}`;

  const renderInactive = (text) => (
    <div className="alu-panel" style={panelStyle}>
      <div style={titleStyle}>⚙️ ALU Operation Breakdown</div>
      <div className="alu-inactive" style={inactiveStyle}>
        {text}
      </div>
    </div>
  );

  if (!BINARY_OPS.has(mnemonic) && !SHIFT_OPS.has(mnemonic) &&
      !WIDE_OPS.has(mnemonic) && !UNARY_OPS.has(mnemonic)) {
    return renderInactive(
      <span>
        No ALU operation in this instruction.
        <br />({mnemonic} is a data transfer / control instruction.)
      </span>
    );
  }

  if (!prev) {
    return renderInactive('No previous CPU state recorded yet — step forward once to compare operands.');
  }
  const prevRegs = prev.registers || {};

  let breakdown = null;
  if (BINARY_OPS.has(mnemonic)) {
    if (parts.length < 2) {
      return renderInactive(`${mnemonic} needs two operands, but only ${parts.length} was recorded.`);
    }
    breakdown = buildBinary(mnemonic, parts[0], parts[1], prevRegs, currentRegs, flags);
  } else if (UNARY_OPS.has(mnemonic)) {
    if (parts.length < 1) {
      return renderInactive(`${mnemonic} needs an operand.`);
    }
    breakdown = buildUnary(mnemonic, parts[0], prevRegs, currentRegs, flags);
  } else if (SHIFT_OPS.has(mnemonic)) {
    if (parts.length < 2) {
      return renderInactive(`${mnemonic} needs a destination and a count.`);
    }
    breakdown = buildShift(mnemonic, parts[0], parts[1], prevRegs, currentRegs, flags);
  } else {
    if (parts.length < 1) {
      return renderInactive(`${mnemonic} needs an operand.`);
    }
    breakdown = buildWide(mnemonic, parts[0], prevRegs, currentRegs, flags);
  }

  if (breakdown.unavailable) {
    return renderInactive(
      <span>
        Breakdown unavailable for <strong>{breakdown.raw}</strong>: {breakdown.reason}.
        <br />
        <span style={{ fontSize: 11 }}>
          Observed CPU state: AX={toHex4(currentRegs.AX)} BX={toHex4(
            currentRegs.BX
          )} CX={toHex4(currentRegs.CX)} DX={toHex4(currentRegs.DX)}
        </span>
      </span>
    );
  }

  const isByte = breakdown.isByte;

  return (
    <div className="alu-panel" style={panelStyle}>
      <div style={titleStyle}>⚙️ ALU Operation Breakdown</div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: '8px',
          alignItems: 'center',
          textAlign: 'center',
          marginTop: '8px',
        }}
      >
        <OperandBox
          label={breakdown.op1Label}
          value={breakdown.op1}
          isByte={breakdown.op1IsByte !== undefined ? breakdown.op1IsByte : isByte}
          valueText={breakdown.op1Text}
        />

        <div
          style={{
            fontWeight: 'bold',
            padding: '4px 10px',
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            borderRadius: '4px',
            color: '#2563eb',
            fontSize: '13px',
          }}
        >
          [{mnemonic}]
        </div>

        <OperandBox
          label={breakdown.op2Label}
          value={breakdown.op2}
          isByte={breakdown.op2IsByte !== undefined ? breakdown.op2IsByte : isByte}
        />
      </div>

      <div style={{ textAlign: 'center', margin: '6px 0', fontSize: '16px', color: '#2563eb' }}>
        ↓
      </div>

      {/* Result / result locations */}
      <div style={{ textAlign: 'center' }}>
        <div style={labelStyle}>{breakdown.resultLabel}</div>

        {breakdown.result === null && !breakdown.resultText ? (
          <div style={{ ...hexStyle, fontSize: 13 }}>
            destination register left unchanged
          </div>
        ) : breakdown.resultText ? (
          <div>
            <div style={{ ...binaryStyle, fontSize: 16 }}>
              {breakdown.resultText}
            </div>
            <div style={hexStyle}>(explicit operand and accumulator above)</div>
          </div>
        ) : (
          <div>
            <div className="alu-binary" style={binaryStyle}>
              {fmtBin(
                breakdown.result,
                breakdown.resultIsByte !== undefined
                  ? breakdown.resultIsByte
                  : isByte
              )}
            </div>
            <div className="alu-hex" style={hexStyle}>
              ({fmt(
                breakdown.result,
                breakdown.resultIsByte !== undefined
                  ? breakdown.resultIsByte
                  : isByte
              )})
            </div>
          </div>
        )}

        {breakdown.wideParts && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
              marginTop: '8px',
              flexWrap: 'wrap',
            }}
          >
            {breakdown.wideParts.map((p) => (
              <div key={p.label} style={{ minWidth: '110px' }}>
                <div style={{ ...labelStyle, marginBottom: 2 }}>{p.label}</div>
                <div style={{ ...binaryStyle, margin: 0 }}>
                  {fmt(p.value, p.isByte)}
                </div>
              </div>
            ))}
          </div>
        )}

        {breakdown.note && (
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>
            {breakdown.note}
          </div>
        )}
      </div>

      {/* Actual flags from the current snapshot */}
      <div
        style={{
          marginTop: '10px',
          paddingTop: '8px',
          borderTop: '1px solid rgba(128,128,128,0.2)',
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#475569',
          textAlign: 'center',
        }}
      >
        Flags after execution: {flagSummary}
      </div>
    </div>
  );
}

const panelStyle = {
  border: '1px solid #3b82f6',
  borderRadius: '8px',
  padding: '14px',
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '13px',
  backgroundColor: 'var(--card-bg, rgba(0,0,0,0.03))',
  color: 'var(--text-color, inherit)',
  boxSizing: 'border-box',
};

const titleStyle = {
  fontWeight: 'bold',
  fontSize: '14px',
  textAlign: 'center',
  paddingBottom: '8px',
  borderBottom: '1px solid rgba(128,128,128,0.2)',
  marginBottom: '8px',
};

const labelStyle = {
  fontSize: '11px',
  color: '#94a3b8',
};

const binaryStyle = {
  fontSize: '13px',
  letterSpacing: '1px',
  color: '#16a34a',
  fontWeight: 'bold',
  margin: '2px 0',
};

const hexStyle = {
  fontSize: '11px',
  color: '#64748b',
};

const inactiveStyle = {
  color: '#64748b',
  fontStyle: 'italic',
  textAlign: 'center',
  padding: '16px 8px',
  fontSize: '12px',
  lineHeight: '1.5',
};
