import React, { useEffect, useRef } from 'react';
import { useEmulator } from '../../context/EmulatorContext';
import { buildPositionalExpression } from '../../utils/hexConversion';

/**
 * HexConverterPopover
 *
 * Compact, single shared popover for the click-to-convert feature. Anchored
 * at the pointer position of the last clicked HexValue and showing:
 *   1. the original hexadecimal value,
 *   2. its unsigned decimal equivalent,
 *   3. the positional calculation (e.g. (3 × 16¹) + (12 × 16⁰) = 48 + 12 = 60).
 *
 * Closes when the user presses Escape, clicks outside it, or selects another
 * hexadecimal value (handled by HexValue resetting/sharing the single context
 * slot so only one popover is ever open).
 *
 * Renders nothing when no conversion is open.
 */
export default function HexConverterPopover() {
  const { state, setHexConverter } = useEmulator();
  const hexConverter = state && state.hexConverter;
  const ref = useRef(null);

  useEffect(() => {
    if (!hexConverter) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setHexConverter(null);
    };
    const handleMouseDown = (event) => {
      const isHexControl = event.target.closest(
        '[role="button"][aria-haspopup="dialog"]'
      );
      // Letting HexValue's own click handler manage hex controls keeps
      // "click the open value to close" and "pick another value" working.
      // Anything outside the popover and outside a hex control closes it.
      if (!isHexControl && !(ref.current && ref.current.contains(event.target))) {
        setHexConverter(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [hexConverter, setHexConverter]);

  if (!hexConverter) return null;

  const conversion = buildPositionalExpression(hexConverter.hex);
  const margin = 12;
  const popoverWidth = 260;
  const popoverHeight = 110;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;

  let left = Math.min(Math.max(hexConverter.x + margin, margin), viewportWidth - popoverWidth - margin);
  let top = Math.min(Math.max(hexConverter.y + margin, margin), viewportHeight - popoverHeight - margin);

  const style = {
    position: 'fixed',
    left,
    top,
    minWidth: popoverWidth,
    backgroundColor: 'var(--popover-bg, #ffffff)',
    border: '1px solid var(--border-color, #cbd5e1)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
    padding: '10px 12px',
    zIndex: 2000,
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: 'var(--text-color, #000000)',
  };

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Hexadecimal to decimal conversion" style={style}>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 700,
          marginBottom: '6px',
          color: 'var(--muted-color, #64748b)',
          letterSpacing: '0.4px',
        }}
      >
        Hexadecimal → Decimal
      </div>
      <div style={{ fontSize: '13px', marginBottom: '4px' }}>
        <strong>Original:</strong> <span style={{ fontFamily: 'monospace' }}>{hexConverter.hex}</span>
      </div>
      <div style={{ fontSize: '13px', marginBottom: '6px' }}>
        <strong>Decimal (unsigned):</strong>{' '}
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#16a34a' }}>
          {conversion ? conversion.decimal : '—'}
        </span>
      </div>
      {conversion && (
        <div
          style={{
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            color: 'var(--text-color, #000000)',
          }}
        >
          {conversion.expression}
        </div>
      )}
      <div
        style={{
          marginTop: '8px',
          fontSize: '11px',
          color: 'var(--muted-color, #64748b)',
          textAlign: 'right',
        }}
      >
        Press Esc or click outside to close
      </div>
    </div>
  );
}
