/**
 * Mandatory acceptance tests for Intel/MASM 8086 compatibility (task section 6)
 * plus literal-form, directive, invalid-input and shipped-sample checks.
 * Everything runs against the real CI-built WASM engine.
 *
 * Run: node tests/intel8086.test.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

function compile(src) {
  return mod.preprocess(src);
}

/** step to HLT/interrupt/error, return {snapshots, last, driver, intInfo} */
function run(src, maxSteps = 5000) {
  const driver = compile(src);
  const snapshots = [];
  let halted = false;
  let intInfo = null;
  for (let i = 0; i < maxSteps && !halted; i += 1) {
    let res;
    try {
      res = driver.next();
    } catch (e) {
      throw new Error(String((e && e.message) || e));
    }
    snapshots.push(JSON.parse(driver.get_state_snapshot()));
    if (res.int !== undefined && res.int !== null) {
      intInfo = { int: res.int, ah: res.ah };
      if (res.int === 10 || res.int === 21) {
        // consume output like the frontend controller does
        const out = res.int === 10 ? driver.int_10() : driver.get_int_21();
        intInfo.out = out;
      }
      if (res.int === 21 && (res.ah === 1 || res.ah === 0x0a)) break; // needs input
    }
    halted = res.halt === true;
  }
  if (!halted && !intInfo) throw new Error('program did not finish within step budget');
  return { snapshots, driver, intInfo, last: snapshots[snapshots.length - 1] };
}

function expectError(label, src, needle) {
  try {
    compile(src);
    check(label, false, 'expected an error, none thrown');
  } catch (e) {
    const msg = String((e && e.message) || e);
    check(label, msg.includes(needle), `message: ${JSON.stringify(msg.slice(0, 220))}`);
  }
}

/* 1. Basic execution ------------------------------------------------------------ */
console.log('\nAcceptance 1: basic execution');
{
  const src = ['MOV AX, 0005H', 'MOV BX, 0003H', 'ADD AX, BX', 'HLT'].join('\n');
  const { last } = run(src);
  check('AX = 0008H', last.registers.AX === 0x0008, `AX=${hex16(last.registers.AX)}`);
  check('BX = 0003H', last.registers.BX === 0x0003, `BX=${hex16(last.registers.BX)}`);
}

/* 2. Memory and addressing ------------------------------------------------------ */
console.log('\nAcceptance 2: memory and addressing');
{
  const src = [
    'MOV BX, 2000H',
    'MOV SI, 0004H',
    'MOV WORD PTR [BX+SI+02H], 1234H',
    'MOV AX, WORD PTR [BX+SI+02H]',
    'HLT',
  ].join('\n');
  const { last, driver } = run(src);
  check('AX = 1234H', last.registers.AX === 0x1234, `AX=${hex16(last.registers.AX)}`);
  const mem = driver.get_mem(0x2006, 0x2007);
  check('little-endian word at DS:2006 = 34 12', mem[0] === 0x34 && mem[1] === 0x12, JSON.stringify(mem));
}

/* 3. Data and OFFSET -------------------------------------------------------------- */
console.log('\nAcceptance 3: data and OFFSET');
{
  const src = ['.DATA', 'VALUE DW 1234H', '.CODE', 'MOV SI, OFFSET VALUE', 'MOV AX, WORD PTR [SI]', 'HLT'].join(
    '\n'
  );
  const { last } = run(src);
  check('AX = 1234H', last.registers.AX === 0x1234, `AX=${hex16(last.registers.AX)}`);
  check('SI = 0000H (first data item)', last.registers.SI === 0x0000, `SI=${hex16(last.registers.SI)}`);
}

/* 4. Loop without mandatory entry label ------------------------------------------- */
console.log('\nAcceptance 4: loop without entry label');
{
  const src = ['MOV CX, 05H', 'MOV AX, 0000H', 'AGAIN:', 'INC AX', 'LOOP AGAIN', 'HLT'].join('\n');
  const { last, snapshots } = run(src);
  check('AX = 0005H', last.registers.AX === 0x0005, `AX=${hex16(last.registers.AX)}`);
  check('CX = 0000H', last.registers.CX === 0x0000, `CX=${hex16(last.registers.CX)}`);
  check('LOOP executed 5 times', snapshots.filter((s) => /^LOOP/i.test(s.instruction)).length === 5);
}

/* 5. DOS character output ----------------------------------------------------------- */
console.log('\nAcceptance 5: DOS character output (INT 21H, AH=02H)');
{
  const src = ["MOV DL, 'A'", 'MOV AH, 02H', 'INT 21H', 'HLT'].join('\n');
  const { intInfo, last } = run(src);
  check('interrupt 21H/02H observed', !!intInfo && intInfo.int === 21 && intInfo.ah === 2, JSON.stringify(intInfo));
  check('output is "A"', intInfo && intInfo.out === 'A', intInfo && JSON.stringify(intInfo.out));
  check('AL mirrors DL on output', (last.registers.AX & 0xff) === 0x41, hex16(last.registers.AX));
}

/* 6. Directives: PROC/ENDP/END, BYTE/WORD PTR variants ------------------------------ */
console.log('\n6. Directives and size keywords');
{
  const src = [
    '.DATA',
    'VALUE DW 1234H',
    'BUF DB 41H, 42H, 43H',
    '.CODE',
    'main PROC',
    'MOV SI, OFFSET VALUE',
    'MOV AX, WORD PTR [SI]',
    'MOV BL, BYTE PTR [SI+2]',
    'main ENDP',
    'END main',
  ].join('\n');
  const { last } = run(src);
  check('AX = 1234H through PROC/ENDP/END program', last.registers.AX === 0x1234, hex16(last.registers.AX));
  check('BL = 41H (first BUF byte at VALUE+2)', (last.registers.BX & 0xff) === 0x41, hex16(last.registers.BX));
}
{
  const src = ['MOV AX, 1', 'MOV CX, 2'].join('\n'); // no HLT: implicit termination
  const { last, snapshots } = run(src);
  check('missing HLT terminates with implicit halt step', /HLT/i.test(last.instruction), last.instruction);
  check('both instructions executed', snapshots.length === 3, snapshots.length);
}

/* 7. Literal forms ------------------------------------------------------------------- */
console.log('\n7. Literal forms');
{
  const src = ['MOV AX, 21H', 'ADD AX, 0x21', 'ADD AX, 0005h', 'ADD AX, 1010b', 'ADD AX, FFh', 'HLT'].join('\n');
  const { last } = run(src);
  // 0x21 + 0x21 + 5 + 10 + 255 = 0x21+0x21=0x42; +5=0x47; +10=0x51; +255=0x14E
  check('21H/0x21/0005h/1010b/FFh all compile and add up', last.registers.AX === 0x014e, hex16(last.registers.AX));
}
{
  const src = ["MOV DL, 'B'", 'MOV AH, 02H', 'INT 21H', 'HLT'].join('\n');
  const { intInfo } = run(src);
  check('single-quoted char immediate works', intInfo && intInfo.out === 'B', JSON.stringify(intInfo));
}

/* 8. Invalid programs ----------------------------------------------------------------- */
console.log('\n8. Invalid instruction / size / addressing diagnostics');
expectError('invalid instruction rejected', 'start:\nFOO AX, BX\nHLT', 'FOO');
expectError('undefined label rejected', 'start:\nJMP nowhere\nHLT', 'nowhere');
expectError(
  'immediate does not fit byte register',
  'MOV AL, 1234H\nHLT',
  '1234'
);
expectError(
  'operand size mismatch (word reg, byte memory)',
  'MOV AX, BYTE PTR [SI]\nHLT',
  'mismatch'
);
expectError('two base registers rejected', 'MOV AX, [BX+BP]\nHLT', 'base registers');
expectError('two index registers rejected', 'MOV AX, [SI+DI]\nHLT', 'index registers');
expectError('AX not allowed in memory operand', 'MOV AX, [AX]\nHLT', 'not allowed');
expectError('memory store without size rejected', 'MOV [SI], 1234H\nHLT', 'BYTE PTR');
expectError('PUSH immediate rejected (8086)', 'PUSH 1234H\nHLT', '8086');
expectError('shift count must be 1 or CL', 'SHL AL, 2\nHLT', '8086');
expectError('data beyond declaration rejected', 'DB 300\nstart:\nHLT', '300');
{
  // runtime: divide by zero still reports at step time
  const driver = compile('MOV AX, 0005H\nMOV BL, 00H\nDIV BL\nHLT');
  let msg = '';
  try {
    for (let i = 0; i < 10; i += 1) driver.next();
  } catch (e) {
    msg = String((e && e.message) || e);
  }
  check('divide by zero detected at runtime', /divide by 0/i.test(msg), JSON.stringify(msg.slice(0, 200)));
}

/* 9. Backwards-compatible program (previous default) ---------------------------------- */
console.log('\n9. Legacy default program still compiles');
{
  const src = [
    '; 8086 Learning Lab — Example Program',
    'start:',
    'MOV AX, 0005h        ; Load 5 into AX',
    'MOV BX, 0003h        ; Load 3 into BX',
    'ADD AX, BX           ; AX = AX + BX (5 + 3 = 8)',
    'SUB AX, 0002h        ; AX = AX - 2 (8 - 2 = 6)',
    'HLT                  ; Halt execution',
  ].join('\n');
  const { last } = run(src);
  check('AX = 0006h, BX = 0003h', last.registers.AX === 6 && last.registers.BX === 3, hex16(last.registers.AX));
}

/* 10. Shipped sample programs ----------------------------------------------------------- */
console.log('\n10. Existing project samples');
const examplesDir = path.join(root, 'webapp', 'public', 'examples');
const samples = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.s'));
check('found shipped samples', samples.length >= 8, samples.length);
for (const f of samples) {
  const src = fs.readFileSync(path.join(examplesDir, f), 'utf8');
  try {
    const driver = compile(src);
    // run to completion (interrupt programs keep stepping after int results)
    let halted = false;
    let steps = 0;
    for (; steps < 20000 && !halted; steps += 1) {
      const res = driver.next();
      halted = res.halt === true;
    }
    check(`${f} compiles and runs to completion`, halted, `steps=${steps}`);
  } catch (e) {
    const msg = String((e && e.message) || e);
    check(`${f} compiles and runs to completion`, false, JSON.stringify(msg.slice(0, 200)));
  }
}
{
  // result checks for two deterministic samples
  const addSrc = fs.readFileSync(path.join(examplesDir, 'addition.s'), 'utf8');
  const { driver } = run(addSrc);
  const mem = driver.get_mem(4, 5); // RESULT is the third DW
  check('addition.s computes 6969h+0420h=6D89h', mem[0] === 0x89 && mem[1] === 0x6d, JSON.stringify(mem));

  const factSrc = fs.readFileSync(path.join(examplesDir, 'factorial.s'), 'utf8');
  const { driver: fd } = run(factSrc);
  const fm = fd.get_mem(2, 3); // RESULT is the second DW
  check('factorial.s computes 6! = 02D0h', fm[0] === 0xd0 && fm[1] === 0x02, JSON.stringify(fm));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failed checks:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
