/**
 * Hexadecimal <-> decimal conversion helpers for the click-to-convert feature.
 *
 * Supports the "nnnnh" / "0xNNNN" forms the UI already renders, 8-bit and
 * 16-bit values, leading zeros, zero itself, and multi-digit values.
 * No dependencies: pure string/number parsing and arithmetic.
 */

/** Valid hexadecimal digit characters. */
export const HEX_DIGITS = '0123456789ABCDEF';

/** Superscript code points for powers 0..9, used in the positional math line. */
const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/**
 * Parse a displayed hexadecimal value into its unsigned integer value.
 *
 * Accepts an optional trailing 'h'/'H' suffix (e.g. "3Ch", "000Ah") and an
 * optional leading "0x"/"0X" prefix (e.g. "0x00FF"). Returns null for anything
 * that is not a clean hexadecimal integer so callers can render non-hex text
 * (decimal/binary radix displays, labels, …) as non-clickable plain text.
 * @param {string} text
 * @returns {number|null} unsigned value (0..0xffffffff), or null
 */
export function parseHex(text) {
  if (text == null) return null;
  let s = String(text).trim();
  if (s === '') return null;
  if (s.startsWith('0x') || s.startsWith('0X')) {
    s = s.slice(2);
  } else if (s.endsWith('h') || s.endsWith('H')) {
    s = s.slice(0, -1);
  }
  if (s === '' || !/^[0-9A-Fa-f]+$/.test(s)) return null;
  return parseInt(s, 16) >>> 0;
}

/**
 * Unsigned decimal equivalent of a displayed hexadecimal value.
 * @param {string} text
 * @returns {number|null}
 */
export function hexToDecimal(text) {
  return parseHex(text);
}

/**
 * Build the positional (place-value) calculation for a hexadecimal value.
 *
 * Example: "3Ch" -> { hex: "3C", decimal: 60,
 *   terms: [{digit: 3, power: 1, term: 48}, {digit: 12, power: 0, term: 12}],
 *   expression: "(3 × 16¹) + (12 × 16⁰) = 48 + 12 = 60" }
 *
 * Zero-digit terms are skipped so "000Ah" renders as
 * "(10 × 16⁰) = 10" and "0000h" renders as "0 = 0".
 * @param {string} text displayed hexadecimal value
 * @returns {{hex: string, decimal: number, terms: Array, expression: string}|null}
 */
export function buildPositionalExpression(text) {
  const value = parseHex(text);
  if (value === null) return null;

  let digits = String(text);
  if (digits.startsWith('0x') || digits.startsWith('0X')) digits = digits.slice(2);
  else if (digits.endsWith('h') || digits.endsWith('H')) digits = digits.slice(0, -1);
  digits = digits.toUpperCase();

  const terms = [];
  for (let i = 0; i < digits.length; i += 1) {
    const digit = parseInt(digits[i], 16);
    if (digit === 0) continue;
    const power = digits.length - 1 - i;
    terms.push({ digit, power, term: digit * (16 ** power) });
  }

  const decimal = terms.reduce((sum, t) => sum + t.term, 0);
  const superscript = (p) => SUPERSCRIPT[p] !== undefined ? SUPERSCRIPT[p] : `^${p}`;
  const termsText = terms.map((t) => `(${t.digit} × 16${superscript(t.power)})`).join(' + ');
  const addendsText = terms.map((t) => t.term).join(' + ');
  const expression = terms.length === 0
    ? `0 = 0`
    : `${termsText} = ${addendsText} = ${decimal}`;

  return { hex: digits, decimal, terms, expression };
}
