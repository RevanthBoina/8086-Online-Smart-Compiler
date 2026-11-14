/**
 * Engine integration tests: the real Rust/WASM 8086 engine driven through
 * EmulatorAdapter — the exact contract the execution controller uses
 * (snapshots, interrupt codes, DOS/BIOS output helpers, error propagation).
 *
 * No mocks: the wasm binary is loaded from ../pkg (installed `file:../pkg`).
 */
import fs from 'fs';
import path from 'path';

import { EmulatorAdapter } from './EmulatorAdapter';

jest.setTimeout(60000);

let glue = null;

beforeAll(async () => {
  glue = require('emulator_8086');
  const wasmBytes = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'pkg', 'emulator_8086_web_bg.wasm')
  );
  await glue.default(new Uint8Array(wasmBytes));
  if (typeof glue.preprocess !== 'function') {
    throw new Error('emulator_8086 glue did not initialise');
  }
});

function prepare(code) {
  const adapter = new EmulatorAdapter(glue);
  const res = adapter.prepare(code);
  if (!res.success) throw new Error(res.error);
  return adapter;
}

function runToEnd(adapter, maxSteps = 5000) {
  const outputs = [];
  let last = null;
  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    const res = adapter.step();
    if (!res.success) throw new Error(res.error);
    last = res;
    if (res.intNum === 10) {
      const out = adapter.getInt10Output();
      if (out) outputs.push(out);
    } else if (res.intNum === 21) {
      if (res.ahVal === 2) {
        const out = adapter.getInt21Output();
        if (out) outputs.push(out);
      } else if (res.ahVal === 9) {
        const out = adapter.getInt21StringOutput();
        if (out) outputs.push(out);
      }
    }
    if (res.isHalted) break;
  }
  return { last, outputs, steps };
}

function hex4(n) {
  return (n >>> 0).toString(16).toUpperCase().padStart(4, '0');
}

test('acceptance 1 through the adapter: ADD reaches AX=0008h', () => {
  const adapter = prepare(`MOV AX,0005H
MOV BX,0003H
ADD AX,BX
HLT`);
  const { last, steps } = runToEnd(adapter);
  expect(last.isHalted).toBe(true);
  expect(hex4(last.snapshot.registers.AX)).toBe('0008');
  expect(steps + 1).toBe(4); // 3 instructions + the HLT step
});

test('snapshots record before/after bytes for a WORD store', () => {
  const adapter = prepare(`MOV BX,2000H
MOV SI,0004H
MOV WORD PTR [BX+SI+02H],1234H
MOV AX, WORD PTR [BX+SI+02H]
HLT`);
  let storeSnap = null;
  let last = null;
  for (let i = 0; i < 100; i += 1) {
    const res = adapter.step();
    expect(res.success).toBe(true);
    last = res;
    if (res.snapshot && res.snapshot.changed_memory && res.snapshot.changed_memory.length) {
      storeSnap = res.snapshot;
    }
    if (res.isHalted) break;
  }
  expect(hex4(last.snapshot.registers.AX)).toBe('1234');
  expect(storeSnap).not.toBeNull();
  const byAddr = {};
  for (const m of storeSnap.changed_memory) byAddr[m.address] = m;
  expect(byAddr[0x2006]).toEqual({ address: 0x2006, before: 0, after: 0x34 });
  expect(byAddr[0x2007]).toEqual({ address: 0x2007, before: 0, after: 0x12 });
});

test('INT 21H AH=02H character output reaches the console', () => {
  const adapter = prepare(`MOV DL,'A'
MOV AH,02H
INT 21H
HLT`);
  const { outputs, last } = runToEnd(adapter);
  expect(outputs.join('')).toBe('A');
  expect(last.isHalted).toBe(true);
  // DOS leaves AL = the character just printed.
  expect(last.snapshot.registers.AX & 0xff).toBe(0x41);
});

test('INT 21H AH=09H prints a $-terminated string at DS:DX', () => {
  const adapter = prepare(`MSG DB 'Hello, 8086!'
DB '$'
MOV DX, OFFSET MSG
MOV AH, 09H
INT 21H
HLT`);
  const { outputs } = runToEnd(adapter);
  expect(outputs.join('')).toBe('Hello, 8086!');
});

test('INT 10H AH=13H BIOS string output is exposed via int_10()', () => {
  const adapter = prepare(`MSG DB 'HELLO'
MOV AX,1301H
MOV BX,0007H
MOV CX,0005H
MOV DX,0000H
MOV BP, OFFSET MSG
INT 10H
HLT`);
  const { outputs } = runToEnd(adapter);
  expect(outputs.join('')).toBe('HELLO');
});

test('entry-point selection: a leading JMP lands on its label', () => {
  const adapter = prepare(`JMP begin
MOV AX,1111H
begin: MOV AX,2222H
HLT`);
  const { last } = runToEnd(adapter);
  expect(hex4(last.snapshot.registers.AX)).toBe('2222');
});

test('invalid programs fail at prepare() with a structured error', () => {
  const adapter = new EmulatorAdapter(glue);
  const bad = adapter.prepare('FOO AX,BX\nHLT');
  expect(bad.success).toBe(false);
  expect(bad.error).toMatch(/unknown instruction/i);

  const bad2 = adapter.prepare('MOV AX,NOPE\nHLT');
  expect(bad2.success).toBe(false);
  expect(bad2.error).toMatch(/not defined/i);
});

test('runtime divide-by-zero surfaces as a step error', () => {
  const adapter = prepare('MOV AX,0000H\nMOV BL,00H\nDIV BL\nHLT');
  let error = null;
  for (let i = 0; i < 20; i += 1) {
    const res = adapter.step();
    if (!res.success) {
      error = res.error;
      break;
    }
    if (res.isHalted) break;
  }
  expect(error).toMatch(/divide by 0/i);
});
