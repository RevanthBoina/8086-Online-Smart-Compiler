/**
 * Engine verification tests (tests A-G of the 8086 Learning Lab task).
 *
 * Drives the REAL wasm engine (pkg/emulator_8086_web.js + its .wasm) exactly
 * the way webapp/src/services/EmulatorAdapter.js does:
 *   preprocess(source) -> WebDriver -> next() per step -> get_state_snapshot().
 *
 * Run:  node tests/engine.test.mjs
 * Requires a wasm-pack generated `pkg/` (npm install / CI build first).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'pkg');

const gluePath = path.join(pkgDir, 'emulator_8086_web.js');
const wasmPath = path.join(pkgDir, 'emulator_8086_web_bg.wasm');
if (!fs.existsSync(gluePath) || !fs.existsSync(wasmPath)) {
  console.error('FAIL: pkg/ is missing. Build it first (wasm-pack build --release --target web --out-dir pkg).');
  process.exit(2);
}

const glue = fs.readFileSync(gluePath, 'utf8');
const wasm = fs.readFileSync(wasmPath);
const mod = await import('data:text/javascript;base64,' + Buffer.from(glue).toString('base64'));
await mod.default(new Uint8Array(wasm));

let pass = 0;
let fail = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  FAIL ${label}${detail !== undefined ? ' :: ' + detail : ''}`);
  }
}

function hex16(v) {
  return v.toString(16).toUpperCase().padStart(4, '0') + 'h';
}
function hex8(v) {
  return v.toString(16).toUpperCase().padStart(2, '0') + 'h';
}

/** Preprocess a program, returning the WebDriver. */
function compile(source) {
  return mod.preprocess(source);
}

/** Execute one instruction, returning { snapshot, result } or throwing. */
function step(driver) {
  const result = driver.next();
  const snapshot = JSON.parse(driver.get_state_snapshot());
  return { snapshot, result };
}

/** Run a program to completion. Returns all snapshots. */
function runProgram(source, maxSteps = 400) {
  const driver = compile(source);
  const snapshots = [];
  let halted = false;
  for (let i = 0; i < maxSteps && !halted; i += 1) {
    const { snapshot, result } = step(driver);
    snapshots.push(snapshot);
    halted = result.halt === true;
  }
  if (!halted) throw new Error('program did not halt within ' + maxSteps + ' steps');
  return { snapshots, driver };
}

function last(snapshots) {
  return snapshots[snapshots.length - 1];
}

function expectThrows(label, fn, needle) {
  try {
    fn();
    check(label, false, 'expected an error, none thrown');
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    check(label, msg.includes(needle), `message: ${JSON.stringify(msg.slice(0, 200))}`);
  }
}

/* ------------------------------------------------------------------ *
 * A. Arithmetic (default program of the task)                         *
 * ------------------------------------------------------------------ */
console.log('\nA. Arithmetic (MOV/INC/SUB with 0005h literals)');
{
  const source = [
    'start:',
    'MOV AX, 0005h',
    'INC AX',
    'MOV BX, AX',
    'MOV CX, 0003h',
    'SUB BX, CX',
    'HLT',
  ].join('\n');
  const { snapshots: snaps } = runProgram(source);
  const r = last(snaps).registers;
  check('AX = 0006h', r.AX === 0x0006, `AX=${hex16(r.AX)}`);
  check('BX = 0003h', r.BX === 0x0003, `BX=${hex16(r.BX)}`);
  check('CX = 0003h', r.CX === 0x0003, `CX=${hex16(r.CX)}`);
}

/* ------------------------------------------------------------------ *
 * B. 8-bit register aliases                                           *
 * ------------------------------------------------------------------ */
console.log('\nB. 8-bit register aliases');
{
  const source = [
    'start:',
    'MOV AH, 12h',
    'MOV AL, 34h',
    'MOV BH, 56h',
    'MOV BL, 78h',
    'MOV CH, 9Ah',
    'MOV CL, 0BCh',
    'MOV DH, 0DEh',
    'MOV DL, 0F0h',
    'HLT',
  ].join('\n');
  const { snapshots: snaps } = runProgram(source);
  const r = last(snaps).registers;
  check('AX = 1234h', r.AX === 0x1234, `AX=${hex16(r.AX)}`);
  check('BX = 5678h', r.BX === 0x5678, `BX=${hex16(r.BX)}`);
  check('CX = 9ABCh', r.CX === 0x9abc, `CX=${hex16(r.CX)}`);
  check('DX = DEF0h', r.DX === 0xdef0, `DX=${hex16(r.DX)}`);
}

/* ------------------------------------------------------------------ *
 * C. Memory write/rewrite + backward reconstruction                   *
 * ------------------------------------------------------------------ */
console.log('\nC. Memory write/rewrite + historical reconstruction');
{
  const source = [
    'start:',
    'MOV AX, 1111h',
    'MOV byte [0500h], AL',
    'MOV AX, 2222h',
    'MOV byte [0500h], AL',
    'MOV AX, 3333h',
    'MOV byte [0600h], AL',
    'HLT',
  ].join('\n');
  const { snapshots: snaps, driver } = runProgram(source);

  // Every memory change must carry address/before/after (not value).
  let shapeOk = true;
  for (const s of snaps) {
    for (const cm of s.changed_memory) {
      if (typeof cm.address !== 'number' || typeof cm.before !== 'number' || typeof cm.after !== 'number') {
        shapeOk = false;
      }
      if ('value' in cm) shapeOk = false;
    }
  }
  check('changed_memory entries have {address,before,after}', shapeOk);

  // Forward application of the change log reproduces the final image.
  const forward = new Map();
  for (const s of snaps) for (const cm of s.changed_memory) forward.set(cm.address, cm.after);
  const cells22 = [...forward.entries()].filter(([, v]) => v === 0x22);
  const cells33 = [...forward.entries()].filter(([, v]) => v === 0x33);
  check('exactly one cell ends at 22h (the twice-written one)', cells22.length === 1, JSON.stringify(cells22));
  check('exactly one cell ends at 33h (the second target)', cells33.length === 1, JSON.stringify(cells33));
  const addrTwice = cells22.length ? cells22[0][0] : -1;
  const addrOther = cells33.length ? cells33[0][0] : -1;

  // Direct RAM reads must agree with the change log (ground truth).
  if (addrTwice >= 0) {
    const live = driver.get_mem(addrTwice, addrTwice + 2);
    check('direct RAM read of the rewritten cell = 22h', live[0] === 0x22, `got ${live[0]}`);
  }
  if (addrOther >= 0) {
    const live = driver.get_mem(addrOther, addrOther + 2);
    check('direct RAM read of the second cell = 33h', live[0] === 0x33, `got ${live[0]}`);
  }
  if (addrTwice >= 0 && addrOther >= 0) {
    check('the two writes target different addresses', addrTwice !== addrOther);
    const fresh = compile(source);
    check(
      'baseline RAM of the rewritten cell is 00h',
      fresh.get_mem(addrTwice, addrTwice + 2)[0] === 0x00,
      `got ${fresh.get_mem(addrTwice, addrTwice + 2)[0]}`
    );
  }

  // The twice-written cell must be written twice with a correct before/after chain.
  const writes = snaps.flatMap((s) => s.changed_memory).filter((cm) => cm.address === addrTwice);
  check('same address recorded across both writes', writes.length === 2, `count=${writes.length}`);
  if (writes.length === 2) {
    check('first write: before=00h after=11h', writes[0].before === 0x00 && writes[0].after === 0x11, JSON.stringify(writes[0]));
    check('second write: before=11h after=22h', writes[1].before === 0x11 && writes[1].after === 0x22, JSON.stringify(writes[1]));
  }

  // Backward walk from the LAST snapshot must land on the baseline (0):
  // start from the final image and undo each step in reverse order.
  const backward = new Map();
  for (const s of [...snaps].reverse()) {
    for (const cm of [...s.changed_memory].reverse()) {
      const observed = backward.has(cm.address) ? backward.get(cm.address) : forward.get(cm.address);
      if (cm.address === addrTwice || cm.address === addrOther) {
        check(
          `backward continuity @${cm.address.toString(16)} after=${hex8(cm.after)}`,
          observed === cm.after,
          `observed=${hex8(observed)}`
        );
      }
      backward.set(cm.address, cm.before);
    }
  }
  check('backward: rewritten cell restored to baseline 00h', backward.get(addrTwice) === 0x00, backward.get(addrTwice));
  check('backward: second cell restored to baseline 00h', backward.get(addrOther) === 0x00, backward.get(addrOther));
}

/* ------------------------------------------------------------------ *
 * D. Stack: PUSH/POP and SS:SP                                        *
 * ------------------------------------------------------------------ */
console.log('\nD. Stack PUSH/POP with SS:SP');
{
  const source = [
    'start:',
    'MOV AX, 1234h',
    'PUSH AX',
    'PUSH AX',
    'POP BX',
    'POP CX',
    'HLT',
  ].join('\n');
  const { snapshots: snaps } = runProgram(source);
  const spAfterMov = snaps[0].registers.SP;
  const r = last(snaps).registers;

  check('PUSH/POP are in the executed history', snaps.some((s) => /^PUSH/i.test(s.instruction)) && snaps.some((s) => /^POP/i.test(s.instruction)));
  check('BX receives the top-of-stack value 1234h', r.BX === 0x1234, `BX=${hex16(r.BX)}`);
  check('CX receives the next value 1234h', r.CX === 0x1234, `CX=${hex16(r.CX)}`);
  check('SP returns to its starting value', r.SP === spAfterMov, `SP=${hex16(r.SP)} expected=${hex16(spAfterMov)}`);

  // The stack slot SS:SP for the first push must be recorded with before/after.
  const ss = r.SS;
  const pushStep = snaps.find((s) => /^PUSH/i.test(s.instruction));
  const phys = ss * 16 + pushStep.registers.SP;
  const lowByteChange = pushStep.changed_memory.find((cm) => cm.address === phys);
  check(
    'first PUSH records byte at SS:SP with before/after',
    !!lowByteChange && lowByteChange.before === 0x00 && lowByteChange.after === 0x34,
    lowByteChange ? JSON.stringify(lowByteChange) : `no change @${phys.toString(16)}`
  );
}

/* ------------------------------------------------------------------ *
 * E. Jumps and LOOP                                                   *
 * ------------------------------------------------------------------ */
console.log('\nE. Jumps and LOOP');
{
  const source = [
    'start:',
    'MOV CX, 0004h',
    'MOV AX, 0000h',
    'again:',
    'ADD AX, 0003h',
    'LOOP again',
    'MOV DX, 0001h',
    'JMP reach',
    'MOV DX, 0002h',
    'reach:',
    'HLT',
  ].join('\n');
  const { snapshots: snaps } = runProgram(source);
  const r = last(snaps).registers;
  check('AX = 000Ch after 4 LOOP iterations', r.AX === 0x000c, `AX=${hex16(r.AX)}`);
  check('CX reaches 0', r.CX === 0, `CX=${hex16(r.CX)}`);
  check('DX = 0001h (instruction after JMP was skipped)', r.DX === 0x0001, `DX=${hex16(r.DX)}`);
  const loopRuns = snaps.filter((s) => /^LOOP/i.test(s.instruction)).length;
  check('LOOP executed 4 times', loopRuns === 4, `count=${loopRuns}`);
  const skipped = snaps.some((s) => /MOV\s+DX,\s*0002h/i.test(s.instruction));
  check('skipped instruction never executed', !skipped);
}

/* ------------------------------------------------------------------ *
 * F. ALU: ADD/SUB/CMP/MUL/DIV                                         *
 * ------------------------------------------------------------------ */
console.log('\nF. ALU operations');
{
  // ADD/SUB/CMP flags
  const { snapshots: s1 } = runProgram(
    ['start:', 'MOV AL, 06h', 'ADD AL, 07h', 'SUB AL, 03h', 'CMP AL, 0Ah', 'CMP AL, 0Bh', 'HLT'].join('\n')
  );
  const r1 = last(s1).registers;
  check('ADD/SUB: AL = 0Ah', r1.AX === 0x000a, `AX=${hex16(r1.AX)}`);
  const afterEq = s1.filter((s) => /^CMP/i.test(s.instruction));
  check('CMP equal sets ZF', afterEq[0].flags.ZF === true, JSON.stringify(afterEq[0].flags));
  check('CMP different clears ZF', afterEq[1].flags.ZF === false, JSON.stringify(afterEq[1].flags));
}
{
  // MUL 8-bit: AL * CL -> AX
  const { snapshots: s } = runProgram(['start:', 'MOV AL, 06h', 'MOV CL, 07h', 'MUL CL', 'HLT'].join('\n'));
  const r = last(s).registers;
  check('MUL byte: AX = 002Ah (6*7)', r.AX === 42 && r.DX === 0, `AX=${hex16(r.AX)} DX=${hex16(r.DX)}`);
}
{
  // MUL 16-bit: AX * BX -> DX:AX
  const { snapshots: s } = runProgram(['start:', 'MOV AX, 0006h', 'MOV BX, 0004h', 'MUL BX', 'HLT'].join('\n'));
  const r = last(s).registers;
  check('MUL word: DX:AX = 0000:0018 (6*4)', r.DX === 0 && r.AX === 24, `DX=${hex16(r.DX)} AX=${hex16(r.AX)}`);
}
{
  // DIV 8-bit: AX / BL -> AL (quotient), AH (remainder)
  const { snapshots: s } = runProgram(['start:', 'MOV AX, 001Bh', 'MOV BL, 05h', 'DIV BL', 'HLT'].join('\n'));
  const r = last(s).registers;
  const al = r.AX & 0xff;
  const ah = (r.AX >> 8) & 0xff;
  check('DIV byte: AL = 05h quotient', al === 5, `AL=${hex8(al)}`);
  check('DIV byte: AH = 02h remainder', ah === 2, `AH=${hex8(ah)}`);
}
{
  // DIV 16-bit: DX:AX / BX -> AX (quotient), DX (remainder)
  const { snapshots: s } = runProgram(['start:', 'MOV DX, 0000h', 'MOV AX, 0019h', 'MOV BX, 0006h', 'DIV BX', 'HLT'].join('\n'));
  const r = last(s).registers;
  check('DIV word: AX = 0004h quotient', r.AX === 4, `AX=${hex16(r.AX)}`);
  check('DIV word: DX = 0001h remainder', r.DX === 1, `DX=${hex16(r.DX)}`);
}

/* ------------------------------------------------------------------ *
 * G. Error handling                                                   *
 * ------------------------------------------------------------------ */
console.log('\nG. Error handling');
expectThrows('invalid instruction rejected', () => compile('start:\nFOO AX, BX\nHLT'), 'FOO');
expectThrows('undefined label rejected', () => compile('start:\nJMP nowhere\nHLT'), 'nowhere');
{
  const driver = compile('start:\nMOV BL, 00h\nDIV BL\nHLT');
  let msg = '';
  try {
    let halted = false;
    for (let i = 0; i < 20 && !halted; i += 1) {
      const res = driver.next();
      halted = res.halt === true;
    }
  } catch (e) {
    msg = String(e && e.message ? e.message : e);
  }
  check('divide-by-zero raises a runtime error', /divide by 0/i.test(msg), `message: ${JSON.stringify(msg.slice(0, 200))}`);
}

/* ------------------------------------------------------------------ *
 * Summary                                                             *
 * ------------------------------------------------------------------ */
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failed checks:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
