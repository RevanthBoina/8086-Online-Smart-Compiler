/**
 * Smoke tests for the click-to-convert integration in the existing panels.
 * Renders the real components against EmulatorContext with no engine — pure
 * UI verification that HexValue slots render and the shared popover works.
 *
 * Run: npx react-app-rewired test --watchAll=false --testPathPattern hexComponentsSmoke
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { EmulatorProvider, useEmulator } from '../../context/EmulatorContext';
import RegisterPanel from '../simulator/RegisterPanel';
import HistoryTimeline from '../HistoryTimeline';
import HexValue from './HexValue';
import HexConverterPopover from './HexConverterPopover';

const baseline = {
  isBaseline: true,
  instruction: 'Program Prepared (Baseline)',
  line: 1,
  registers: { AX: 0, BX: 0, CX: 0, DX: 0, IP: 0 },
  flags: { CF: false, ZF: false, SF: false, OF: false, PF: false, AF: false, DF: false, IF: false, TF: false },
  changed_memory: [],
};

const stepSnap = {
  instruction: 'MOV AX, 003Ch',
  line: 2,
  registers: { AX: 0x003c, BX: 0x0001, CX: 0, DX: 0, IP: 1 },
  flags: { CF: false, ZF: false, SF: false, OF: true, PF: false, AF: false, DF: false, IF: false, TF: false },
  changed_memory: [],
};

const HistoryFiller = () => {
  const { setBaseline: sb, pushSnapshot: ps } = useEmulator();
  // Run once on mount. Empty deps are intentional: the context action
  // closures get a new identity on every provider re-render.
  React.useEffect(() => {
    sb(baseline);
    ps(stepSnap);
  }, []);
  return null;
};

describe('panel rendering with clickable hex values', () => {
  it('RegisterPanel renders register values as clickable hex controls', () => {
    render(
      <EmulatorProvider>
        <RegisterPanel liveRegisters={{ AX: 0x003c, BX: 0x0001 }} />
      </EmulatorProvider>
    );
    expect(screen.getByText('CPU Registers')).toBeInTheDocument();
    const ax = screen.getByText('003Ch');
    expect(ax).toHaveAttribute('role', 'button');
    expect(ax).toHaveAttribute('tabindex', '0');
  });

  it('HistoryTimeline renders clickable register diffs after a step', () => {
    render(
      <EmulatorProvider>
        <HistoryFiller />
        <HistoryTimeline />
      </EmulatorProvider>
    );
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    const curr = screen.getByText('003Ch');
    expect(curr).toHaveAttribute('role', 'button');
    const prev = screen.getAllByText('0000h');
    expect(prev.length).toBeGreaterThanOrEqual(1);
    prev.forEach((node) => expect(node).toHaveAttribute('tabindex', '0'));
  });

  it('HexValue + HexConverterPopover interaction end to end', () => {
    render(
      <EmulatorProvider>
        <HexValue hex="86A0h" id="dx" />
        <HexConverterPopover />
      </EmulatorProvider>
    );
    fireEvent.click(screen.getByText('86A0h'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('86A0h');
    expect(dialog).toHaveTextContent('34464');
    expect(dialog).toHaveTextContent('(8 × 16³) + (6 × 16²) + (10 × 16¹) = 32768 + 1536 + 160 = 34464');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
