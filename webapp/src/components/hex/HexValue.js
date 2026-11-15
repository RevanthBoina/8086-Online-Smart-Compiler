import React from 'react';
import { useEmulator } from '../../context/EmulatorContext';
import { parseHex } from '../../utils/hexConversion';

/**
 * HexValue
 *
 * Renders a displayed hexadecimal value (e.g. "0006h", "3Ch", "00") as a
 * keyboard-accessible clickable control. Clicking it (or pressing Enter/Space
 * while focused) opens the shared hexadecimal-to-decimal popover showing the
 * original value, its unsigned decimal equivalent and the positional
 * calculation behind it.
 *
 * The original display text and the execution state are never altered.
 *
 * @param {string} hex        Displayed hexadecimal text ("0006h", "3C", …)
 * @param {string} [id]       Stable identity of this value. Defaults to `hex`;
 *                            use it when the same text appears at different
 *                            positions (memory cells, timeline steps, …).
 * @param {number} [x]        Pointer X coordinate (from a click event); the
 *                            popover is anchored here.
 * @param {number} [y]        Pointer Y coordinate.
 * @param {string} [ariaLabel] Accessible name; defaults to describing the value.
 * @param {string} [className] Extra class name.
 * @param {object} [style]    Inline styles merged with the default look.
 */
export default function HexValue({ hex, id, x, y, ariaLabel, className, style }) {
  const { state, setHexConverter } = useEmulator();
  const hexConverter = state && state.hexConverter;
  const key = id !== undefined ? id : hex;
  const isOpen = hexConverter !== null && hexConverter.key === key;

  const value = parseHex(hex);
  const clickable = value !== null;

  const handleClick = (event) => {
    if (!clickable) return;
    event.stopPropagation();
    if (isOpen) {
      setHexConverter(null);
    } else {
      setHexConverter({ key, hex, x: event.clientX, y: event.clientY });
    }
  };

  const handleKeyDown = (event) => {
    if (!clickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      handleClick(event);
    }
  };

  const baseStyle = {
    color: '#1d4ed8',
    textDecoration: 'underline dotted',
    cursor: clickable ? 'pointer' : 'default',
    borderBottom: '1px dotted transparent',
    padding: '0 2px',
    borderRadius: 2,
    ...style,
  };
  if (isOpen) {
    baseStyle.backgroundColor = '#dbeafe';
    baseStyle.borderBottom = '1px solid #1d4ed8';
  }

  return (
    <span
      role="button"
      tabIndex={clickable ? 0 : -1}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label={
        ariaLabel ||
        `Hexadecimal ${hex}${clickable ? `, unsigned decimal ${value}` : ''}`
      }
      className={className}
      style={baseStyle}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {hex}
    </span>
  );
}
