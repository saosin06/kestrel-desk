// Money is never a float. Amounts are integer minor units of their currency,
// unit prices are integer ten-thousandths of a currency unit (E4), and rates
// are basis points. Intermediate products use BigInt; only final amounts are
// rounded, half away from zero ("half-up" for positive amounts).

export const CURRENCY_EXPONENT = {
  USD: 2,
  EUR: 2,
  JPY: 0,
  KRW: 0,
  MXN: 2,
  CNY: 2,
  TWD: 2,
} as const;

export type Currency = keyof typeof CURRENCY_EXPONENT;

export const UNIT_PRICE_SCALE = 4;
const E4 = 10n ** BigInt(UNIT_PRICE_SCALE);
const BP_PER_UNIT = 10_000n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function isCurrency(code: string): code is Currency {
  return Object.hasOwn(CURRENCY_EXPONENT, code);
}

export function exponentOf(ccy: Currency): number {
  return CURRENCY_EXPONENT[ccy];
}

/** Integer division of n by d (d > 0), rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new MoneyError(`divisor must be positive, got ${d}`);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = abs / d;
  const r = abs % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return neg ? -rounded : rounded;
}

function toSafeNumber(n: bigint, what: string): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${what} out of safe integer range: ${n}`);
  }
  return Number(n);
}

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${what} must be a safe integer, got ${n}`);
}

/**
 * Parses a decimal string into an integer scaled by 10^scale.
 * Rejects (never rounds) input with more decimal places than the scale allows.
 */
export function parseScaled(text: string, scale: number): number {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim().replaceAll(",", ""));
  if (!m) throw new MoneyError(`not a decimal number: "${text}"`);
  const [, sign, whole, frac = ""] = m;
  if (frac.length > scale) {
    throw new MoneyError(`"${text}" has more than ${scale} decimal places`);
  }
  const n = BigInt(whole + frac.padEnd(scale, "0"));
  return toSafeNumber(sign ? -n : n, `"${text}"`);
}

/** "14.00" USD → 1400; "1234" JPY → 1234. */
export function parseMoney(text: string, ccy: Currency): number {
  return parseScaled(text, exponentOf(ccy));
}

/** "0.035" → 350 (ten-thousandths). */
export function parseUnitPrice(text: string): number {
  return parseScaled(text, UNIT_PRICE_SCALE);
}

/** "3.4%" or "3.4" → 340 bp. */
export function parsePercentToBp(text: string): number {
  return parseScaled(text.trim().replace(/%$/, ""), 2);
}

/** qty × unit price, converted to minor units of ccy. */
export function lineAmount(qty: number, unitPriceE4: number, ccy: Currency): number {
  assertInt(qty, "qty");
  assertInt(unitPriceE4, "unitPriceE4");
  const minorPerUnit = 10n ** BigInt(exponentOf(ccy));
  const n = BigInt(qty) * BigInt(unitPriceE4) * minorPerUnit;
  return toSafeNumber(divRound(n, E4), "line amount");
}

/** amount × rate (basis points), rounded to the minor unit. */
export function pctOf(amountMinor: number, rateBp: number): number {
  assertInt(amountMinor, "amountMinor");
  assertInt(rateBp, "rateBp");
  return toSafeNumber(divRound(BigInt(amountMinor) * BigInt(rateBp), BP_PER_UNIT), "percentage");
}

/**
 * Splits total across weights by largest remainder so the parts sum to total
 * exactly. Ties go to the earlier index.
 */
export function allocate(totalMinor: number, weights: readonly number[]): number[] {
  assertInt(totalMinor, "totalMinor");
  if (totalMinor < 0) throw new MoneyError("cannot allocate a negative total");
  if (weights.length === 0) throw new MoneyError("no weights to allocate across");
  weights.forEach((w, i) => {
    assertInt(w, `weight[${i}]`);
    if (w < 0) throw new MoneyError(`weight[${i}] is negative`);
  });
  const sum = weights.reduce((a, w) => a + BigInt(w), 0n);
  if (sum === 0n) throw new MoneyError("weights sum to zero");

  const total = BigInt(totalMinor);
  const shares = weights.map((w, i) => {
    const exact = total * BigInt(w);
    return { i, base: exact / sum, rem: exact % sum };
  });
  let leftover = total - shares.reduce((a, s) => a + s.base, 0n);
  const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const s of order) {
    if (leftover === 0n) break;
    s.base += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => Number(s.base));
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatScaled(n: number, scale: number): string {
  const neg = n < 0;
  const digits = Math.abs(n).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? "." + digits.slice(digits.length - scale) : "";
  return (neg ? "-" : "") + groupThousands(whole) + frac;
}

/** 900000 USD → "USD 9,000.00". */
export function formatMoney(amountMinor: number, ccy: Currency): string {
  return `${ccy} ${formatScaled(amountMinor, exponentOf(ccy))}`;
}

/** 110000 → "11.0000". */
export function formatUnitPrice(unitPriceE4: number): string {
  return formatScaled(unitPriceE4, UNIT_PRICE_SCALE);
}

/** 340 → "3.40%". */
export function formatBp(rateBp: number): string {
  return `${formatScaled(rateBp, 2)}%`;
}
