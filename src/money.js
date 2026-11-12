// Exact decimal arithmetic for money and percentages, on BigInt. No floating point in any calculation.
// Values arrive as numbers (from JSON) or strings (Postgres NUMERIC comes back as a string, e.g. "180000.0000").

const DEC_RE = /^(\d+)(?:\.(\d+))?$/;

/** Parse a non-negative decimal into integer units of 10^-scale. Throws if it has more decimals than `scale`
 *  (unless the extra digits are zeros) or is not a plain decimal. */
export function toUnits(value, scale) {
  if (typeof value === 'bigint') return value * 10n ** BigInt(scale);
  const s = typeof value === 'number' ? numberToPlain(value) : String(value).trim();
  const m = DEC_RE.exec(s);
  if (!m) throw new RangeError(`Not a plain non-negative decimal: ${value}`);
  const frac = m[2] || '';
  const extra = frac.slice(scale);
  if (extra && /[^0]/.test(extra)) throw new RangeError(`Too many decimal places (max ${scale}): ${value}`);
  return BigInt(m[1] + frac.slice(0, scale).padEnd(scale, '0'));
}

function numberToPlain(n) {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Not a non-negative finite number: ${n}`);
  const s = String(n);
  if (/e/i.test(s)) throw new RangeError(`Number out of supported range: ${n}`);
  return s;
}

/** Number of decimal places a currency uses (INR 2, AED 2, JPY 0, KWD 3). Falls back to 2. */
export function minorDigits(currency) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
}

/** n / d rounded half up (all LeaseIntel amounts are non-negative). */
export function divRound(n, d) {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  return (n * 2n + d) / (2n * d);
}

/** Re-express units from one scale to another, rounding half up when reducing precision. */
export function rescale(units, from, to) {
  if (to === from) return units;
  if (to > from) return units * 10n ** BigInt(to - from);
  return divRound(units, 10n ** BigInt(from - to));
}

/** Units → canonical decimal string without trailing zeros ("104737.5", "180000"). */
export function unitsToString(units, scale) {
  const neg = units < 0n;
  let s = (neg ? -units : units).toString().padStart(scale + 1, '0');
  if (scale > 0) {
    const int = s.slice(0, -scale);
    const frac = s.slice(-scale).replace(/0+$/, '');
    s = frac ? `${int}.${frac}` : int;
  }
  return (neg ? '-' : '') + s;
}

/** Units → JS number, only for JSON/display at the edge. Exact for every amount LeaseIntel handles (< 1e15). */
export const unitsToNumber = (units, scale) => Number(unitsToString(units, scale));

/** Canonical form of a stored decimal ("180000.0000" → "180000"); null stays null. */
export function canonical(value, scale = 4) {
  if (value === null || value === undefined || value === '') return null;
  return unitsToString(toUnits(value, scale), scale);
}

/** Percentages are held with 4 decimals; rate(amount) = amount * pctUnits / 1,000,000. */
export const PCT_SCALE = 4;
export const PCT_DENOM = 1_000_000n;
