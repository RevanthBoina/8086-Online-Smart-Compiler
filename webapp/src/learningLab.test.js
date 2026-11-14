/**
 * End-to-end smoke tests for the 8086 Learning Lab UI.
 *
 * These tests render the real application (routing, compiler page, panels)
 * inside jsdom and drive it against the REAL wasm engine: the very module the
 * app imports (`emulator_8086`, installed from `file:../pkg`) is initialised
 * with the generated `.wasm` bytes, so Compile/Step execute actual 8086
 * instructions — no mocks.
 *
 * Run:  npm test  (or `npx react-app-rewired test --watchAll=false`)
 */
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { EmulatorProvider } from './context/EmulatorContext';
import App from './App';

jest.setTimeout(60000);

beforeAll(async () => {
  window.history.pushState({}, '', '/compile');
  // `react-scripts test` forces PUBLIC_URL to '', so the router basename is
  // empty and the app lives at `/compile` in the test environment.
  const glue = require('emulator_8086');
  const wasmBytes = fs.readFileSync(
    path.join(__dirname, '..', '..', 'pkg', 'emulator_8086_web_bg.wasm')
  );
  await glue.default(new Uint8Array(wasmBytes));
  if (typeof glue.preprocess !== 'function') {
    throw new Error('emulator_8086 glue did not initialise');
  }
});

function button(name) {
  return screen.getByRole('button', { name });
}

function renderApp() {
  return render(
    <EmulatorProvider>
      <App />
    </EmulatorProvider>
  );
}

test('landing page renders with navigation to the lab sections', async () => {
  window.history.pushState({}, '', '/');
  renderApp();

  expect(await screen.findByText('Try Online 8086 Compiler', {}, { timeout: 20000 })).toBeInTheDocument();
  const links = screen.getAllByRole('link').map((a) => a.getAttribute('href') || '');
  expect(links.some((href) => href.endsWith('/compile'))).toBe(true);
  expect(links.some((href) => href.endsWith('/instructions'))).toBe(true);
});

test('compiler page compiles and steps the default program with the real WASM engine', async () => {
  window.history.pushState({}, '', '/compile');
  renderApp();

  // The page must come up (no infinite loading) and expose the toolbar.
  await screen.findByRole('button', { name: 'COMPILE' }, { timeout: 20000 });
  expect(button('STEP')).toBeDisabled();

  // Compile: preprocess + validate the default program through the engine.
  fireEvent.click(button('COMPILE'));
  await waitFor(() => expect(button('STEP')).not.toBeDisabled(), {
    timeout: 20000,
  });

  // Step through all 5 instructions: MOV AX / MOV BX / ADD / SUB / HLT.
  for (let i = 1; i <= 5; i += 1) {
    fireEvent.click(button('STEP'));
    await waitFor(() => expect(screen.getByText(`Step ${i}`)).toBeInTheDocument(), {
      timeout: 10000,
    });
  }

  // Expected final state (test A): AX = 0006h, BX = 0003h, shown by the
  // register panel from the engine snapshots.
  const registersPaper = screen.getByText('CPU Registers').closest('.MuiPaper-root');
  expect(registersPaper).not.toBeNull();
  const withinRegs = within(registersPaper);

  const axHeader = withinRegs.getByText('AX');
  within(axHeader.closest('div').parentElement).getByText('0006h');

  const bxHeader = withinRegs.getByText('BX');
  within(bxHeader.closest('div').parentElement).getByText('0003h');

  // Flags panel is fed from the same snapshots.
  expect(screen.getByText('Status Flags')).toBeInTheDocument();

  // All five inspector tabs exist, and the history records every instruction.
  expect(screen.getByText(/History Timeline/)).toBeInTheDocument();
  expect(screen.getByText(/Memory \(RAM\)/)).toBeInTheDocument();
  expect(screen.getByText(/Stack \(SS:SP\)/)).toBeInTheDocument();
  expect(screen.getByText(/ALU Breakdown/)).toBeInTheDocument();
  expect(screen.getByText(/Console \/ I\/O/)).toBeInTheDocument();
  expect(screen.getByText('Step 5')).toBeInTheDocument();

  // Switching tabs does not crash and shows the ALU breakdown.
  fireEvent.click(screen.getByText(/ALU Breakdown/));
  expect(screen.getByText(/ALU Breakdown/).closest('button')).toHaveAttribute(
    'aria-selected',
    'true'
  );
});
