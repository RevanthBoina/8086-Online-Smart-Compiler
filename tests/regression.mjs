/**
 * Regression tests for the 8086 Online Smart Compiler audit.
 *
 * Drives the REAL wasm engine through EmulatorAdapter — the same contract the
 * browser controller uses — so these verify the actual step/history/INT 21h
 * behaviour end to end.
 *
 * Coverage:
 *   - Repeated Step/Run after HLT must not append duplicate history entries.
 *   - INT 21h AH=02 side effect (AL = DL) must appear in the INT 21h step's
 *     own history snapshot, not only in a later step.
 *   - INT 21h AH=01 input supplied after the step must be reflected in the
 *     refreshed history snapshot (AL = input character).
 *   - Test A: word MUL overflow  (DX=0001h, AX=86A0h, CF=1, OF=1)
 *   - Test B: word DIV           (AX=0021h, DX=000Ah)
 *   - Test C: DOS input/output   (enter "A", console prints "A", AL=41h)
 *
 * Run:  node tests/regression.mjs
 * Requires a wasm-pack generated `pkg/` (wasm-pack build --release --target web --out-dir pkg).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EmulatorAdapter } from '../webapp/src/services/EmulatorAdapter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'pkg');
const gluePath = path.join(pkgDir, 'emulator_8086_web.js');
const wasmPath = path.join(pkgDir, 'emulator_8086_web_bg.wasm');
if (!fs.existsSync(gluePath) || !fs.existsSync(wasmPath)) {
  console.error('FAIL: pkg/ missing (run wasm-pack build --release --target web --out-dir pkg)');
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
const hex16 = (v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0') + 'h';
const hex8 = (v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0') + 'h';

function prepare(code) {
  const adapter = new EmulatorAdapter(glue);
  const res = adapter.prepare(code);
  if (!res.success) throw new Error(res.error);
  return adapter;
}

function snapOf(adapter) {
  return JSON.parse(adapter.driver.get_state_snapshot());
}

// ------------------------------------------------------------------
// 1. HALT behaviour: repeated step/run after HLT adds no entries
// ------------------------------------------------------------------
console.log('\nRegression 1: no duplicate history entries after HLT');
{
  const adapter = prepare('MOV AX, 0005h\nHLT\nMOV BX, 9999h  ; must never execute');
  const snapshots = [];
  let halted = false;
  let stepsAfterHalt = 0;
  for (let i = 0; i < 10; i += 1) {
    const res = adapter.step();
    if (res.snapshot) snapshots.push(res.snapshot);
    if (res.isHalted) halted = true;
    if (halted) stepsAfterHalt += 1; // every further call returns halted without a snapshot
  }
  check('program halts after HLT', halted, `halted=${halted}`);
  check('exactly one step snapshot (HLT state), no duplicates', snapshots.length === 1, `count=${snapshots.length}`);
  check('snapshot registers AX=0005h', snapshots[0].registers.AX === 0x0005, hex16(snapshots[0].registers.AX));
  check('snapshot instruction is HLT', /HLT/i.test(snapshots[0].instruction), snapshots[0].instruction);
}

// ------------------------------------------------------------------
// 2. INT 21h AH=02 output side effect appears in its own snapshot
// ------------------------------------------------------------------
console.log('\nRegression 2: INT 21h AH=02 leaves AL = DL in history');
{
  const adapter = prepare(`MOV DL,'A'\nMOV AH,02H\nINT 21H\nHLT`);
  const outputs = [];
  let intStepSnap = null;
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    const res = adapter.step();
    if (!res.success) throw new Error(res.error);
    last = res;
    if (res.intNum === 21 && res.ahVal === 2) {
      // Mirror the controller: apply/output, then re-snapshot like the
      // adapter does so the history shows AL = DL for this step.
      const out = adapter.getInt21Output();
      if (out) outputs.push(out);
      intStepSnap = snapOf(adapter);
    }
    if (res.isHalted) break;
  }
  check('console output is "A"', outputs.join('') === 'A', JSON.stringify(outputs));
  check('INT 21h step captured', intStepSnap !== null, 'no INT 21h step observed');
  if (intStepSnap) {
    check('AL = DL = 41h in the INT 21h step snapshot', (intStepSnap.registers.AX & 0xff) === 0x41, hex16(intStepSnap.registers.AX));
    check('DL = 41h in the INT 21h step snapshot', (intStepSnap.registers.DX & 0xff) === 0x41, hex16(intStepSnap.registers.DX));
  }
}

// ------------------------------------------------------------------
// 3. INT 21h AH=01 input supplied after the step is reflected in history
// ------------------------------------------------------------------
console.log('\nRegression 3: INT 21h AH=01 input appears in refreshed history');
{
  const adapter = prepare(`MOV AH,01H\nINT 21H\nMOV DL,AL\nMOV AH,02H\nINT 21H\nHLT`);
  const outputs = [];
  let last = null;
  for (let i = 0; i < 12; i += 1) {
    const res = adapter.step();
    if (!res.success) throw new Error(res.error);
    last = res;
    if (res.intNum === 21) {
      if (res.ahVal === 1) {
        // UI flow: program paused waiting for input; supply "A" and refresh
        // the last snapshot (what compiler.js handleInput does).
        adapter.setInt21Input('A');
        const refreshed = snapOf(adapter);
        check('refreshed input step shows AL = 41h', (refreshed.registers.AX & 0xff) === 0x41, hex16(refreshed.registers.AX));
      } else if (res.ahVal === 2) {
        const out = adapter.getInt21Output();
        if (out) outputs.push(out);
      }
    }
    if (res.isHalted) break;
  }
  check('console output is "A"', outputs.join('') === 'A', JSON.stringify(outputs));
  check('program halted', last && last.isHalted === true);
}

// ------------------------------------------------------------------
// 4. Test A — word MUL overflow: 1000 * 100 = 0x186A0
// ------------------------------------------------------------------
console.log('\nValidation A: word MUL overflow (1000 * 100)');
{
  const adapter = prepare('MOV AX, 1000\nMOV BX, 100\nMUL BX\nHLT');
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    const res = adapter.step();
    if (!res.success) throw new Error(res.error);
    last = res;
    if (res.isHalted) break;
  }
  const r = last.snapshot.registers;
  check('DX = 0001h', r.DX === 0x0001, hex16(r.DX));
  check('AX = 86A0h', r.AX === 0x86a0, hex16(r.AX));
  check('CF = 1', last.snapshot.flags.CF === true, JSON.stringify(last.snapshot.flags));
  check('OF = 1', last.snapshot.flags.OF === true, JSON.stringify(last.snapshot.flags));
}

// ------------------------------------------------------------------
// 5. Test B — word DIV: 1000 / 30 = 33 rem 10
// ------------------------------------------------------------------
console.log('\nValidation B: word DIV (1000 / 30)');
{
  const adapter = prepare('MOV DX, 0\nMOV AX, 1000\nMOV BX, 30\nDIV BX\nHLT');
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    const res = adapter.step();
    if (!res.success) throw new Error(res.error);
    last = res;
    if (res.isHalted) break;
  }
  const r = last.snapshot.registers;
  check('AX = 0021h', r.AX === 0x0021, hex16(r.AX));
  check('DX = 000Ah', r.DX === 0x000a, hex16(r.DX));
}

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failed checks:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
