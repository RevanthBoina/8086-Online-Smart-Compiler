/**
 * Unit tests for the click-to-convert hexadecimal utilities.
 * Pure functions — no engine or DOM dependencies.
 *
 * Run: npx react-app-rewired test --watchAll=false --testPathPattern hexConversion
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { parseHex, hexToDecimal, buildPositionalExpression } from './hexConversion';
import { EmulatorProvider } from '../context/EmulatorContext';
import HexValue from '../components/hex/HexValue';
import HexConverterPopover from '../components/hex/HexConverterPopover';

describe('parseHex', () => {
  it('parses two-digit values with h suffix', () => {
    expect(parseHex('3Ch')).toBe(60);
    expect(parseHex('3c')).toBe(60);
    expect(parseHex('FFh')).toBe(255);
  });

  it('parses 16-bit values with leading zeros', () => {
    expect(parseHex('0000h')).toBe(0);
    expect(parseHex('000Ah')).toBe(10);
    expect(parseHex('003Ch')).toBe(60);
    expect(parseHex('00FFh')).toBe(255);
    expect(parseHex('86A0h')).toBe(34464);
    expect(parseHex('0FFFh')).toBe(4095);
  });

  it('parses values without suffix and with 0x prefix', () => {
    expect(parseHex('3C')).toBe(60);
    expect(parseHex('0x3C')).toBe(60);
    expect(parseHex('0Xff')).toBe(255);
    expect(parseHex('0x000A')).toBe(10);
  });

  it('handles zero', () => {
    expect(parseHex('0h')).toBe(0);
    expect(parseHex('0000h')).toBe(0);
    expect(parseHex('0x0')).toBe(0);
  });

  it('rejects non-hex input', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('1G')).toBeNull();
    expect(parseHex('10.5')).toBeNull();
    expect(parseHex(null)).toBeNull();
    expect(parseHex(undefined)).toBeNull();
    expect(parseHex('0x')).toBeNull();
    expect(parseHex('h')).toBeNull();
  });
});

describe('hexToDecimal', () => {
  it('returns the unsigned decimal equivalent', () => {
    expect(hexToDecimal('3Ch')).toBe(60);
    expect(hexToDecimal('0000h')).toBe(0);
    expect(hexToDecimal('000Ah')).toBe(10);
    expect(hexToDecimal('86A0h')).toBe(34464);
    expect(hexToDecimal('FFFFh')).toBe(65535);
    expect(hexToDecimal('not hex')).toBeNull();
  });
});

describe('buildPositionalExpression', () => {
  it('explains the worked example from the spec', () => {
    const e = buildPositionalExpression('3Ch');
    expect(e.hex).toBe('3C');
    expect(e.decimal).toBe(60);
    expect(e.expression).toBe('(3 × 16¹) + (12 × 16⁰) = 48 + 12 = 60');
  });

  it('skips zero terms for values with leading zeros', () => {
    expect(buildPositionalExpression('0000h').expression).toBe('0 = 0');
    expect(buildPositionalExpression('000Ah').expression).toBe('(10 × 16⁰) = 10 = 10');
    expect(buildPositionalExpression('003Ch').expression).toBe(
      '(3 × 16¹) + (12 × 16⁰) = 48 + 12 = 60'
    );
  });

  it('handles multi-digit 16-bit values', () => {
    const e = buildPositionalExpression('00FFh');
    expect(e.decimal).toBe(255);
    expect(e.expression).toBe('(15 × 16¹) + (15 × 16⁰) = 240 + 15 = 255');

    const e2 = buildPositionalExpression('86A0h');
    expect(e2.decimal).toBe(34464);
    expect(e2.expression).toBe(
      '(8 × 16³) + (6 × 16²) + (10 × 16¹) = 32768 + 1536 + 160 = 34464'
    );
  });

  it('rejects non-hex input', () => {
    expect(buildPositionalExpression('')).toBeNull();
    expect(buildPositionalExpression('1G')).toBeNull();
    expect(buildPositionalExpression(null)).toBeNull();
  });
});

describe('HexValue click-to-convert interaction', () => {
  it('opens the shared popover with hex, decimal and positional math on click', () => {
    render(
      <EmulatorProvider>
        <HexValue hex="3Ch" id="hex-3c" />
        <HexValue hex="0000h" id="hex-zero" />
        <HexConverterPopover />
      </EmulatorProvider>
    );

    const target = screen.getByText('3Ch');
    expect(target).toHaveAttribute('role', 'button');
    expect(target).toHaveAttribute('tabindex', '0');

    fireEvent.click(target);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('3Ch');
    expect(dialog).toHaveTextContent('60');
    expect(dialog).toHaveTextContent('(3 × 16¹) + (12 × 16⁰) = 48 + 12 = 60');

    // Clicking the same value closes the popover.
    fireEvent.click(target);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Selecting another value replaces the open conversion.
    fireEvent.click(screen.getByText('0000h'));
    const second = screen.getByRole('dialog');
    expect(second).toHaveTextContent('0000h');
    expect(second).toHaveTextContent('0');
    expect(second).toHaveTextContent('0 = 0');

    // Escape closes the popover.
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders non-hex text as plain, non-clickable text', () => {
    render(
      <EmulatorProvider>
        <HexValue hex="1G" id="bad" aria-label="not hex" />
        <HexConverterPopover />
      </EmulatorProvider>
    );
    const target = screen.getByText('1G');
    // Not a hexadecimal value: not focusable as a conversion control.
    expect(target).toHaveAttribute('tabindex', '-1');
    fireEvent.click(target);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
