// FX from ECB reference rates. Every rate is an ECB quote: units of currency
// per 1 EUR, kept as the published decimal string. Conversions and cross rates
// are exact ratios in BigInt; only the final amount is rounded (half-up).
// A missing rate is an error, never a guess.

import type { CalcStep, ISODate } from "@/lib/erp/types";
import { type Currency, divRound, exponentOf } from "@/lib/money";

export const MAX_FALLBACK_DAYS = 5;

export type RateTable = {
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  /** Inclusive window the table was requested for. Dates after `to` have no rate yet. */
  from: ISODate;
  to: ISODate;
  /** ECB business day → currency → units per 1 EUR (decimal string). EUR is implicit. */
  days: Readonly<Record<ISODate, Readonly<Record<string, string>>>>;
};

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxError";
  }
}

type Ratio = { num: bigint; den: bigint };

function parseRate(text: string): Ratio {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new FxError(`bad rate "${text}"`);
  const frac = m[2] ?? "";
  const num = BigInt(m[1] + frac);
  if (num === 0n) throw new FxError(`zero rate "${text}"`);
  return { num, den: 10n ** BigInt(frac.length) };
}

function addDays(date: ISODate, n: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type QuotedRate = { ccy: Currency; perEUR: string; rateDate: ISODate };

/** ECB rate for ccy on date, falling back to the latest prior ECB business day. */
export function rateOn(table: RateTable, ccy: Currency, date: ISODate): QuotedRate {
  if (ccy === "EUR") return { ccy, perEUR: "1", rateDate: date };
  if (date < table.from || date > table.to) {
    throw new FxError(`no ${ccy} rate for ${date}: outside cached window ${table.from}..${table.to}`);
  }
  for (let back = 0; back <= MAX_FALLBACK_DAYS; back++) {
    const d = addDays(date, -back);
    if (d < table.from) break;
    const day = table.days[d];
    if (!day) continue;
    const rate = day[ccy];
    if (rate === undefined) throw new FxError(`ECB published no ${ccy} rate on ${d}`);
    return { ccy, perEUR: rate, rateDate: d };
  }
  throw new FxError(`no ECB rate within ${MAX_FALLBACK_DAYS} days before ${date}`);
}

export type Conversion = {
  amountMinor: number;
  from: Currency;
  to: Currency;
  rateDate: ISODate;
  /** "to per 1 from", 6 dp, for display only — the amount uses the exact ratio. */
  displayRate: string;
  step: CalcStep;
};

/** Exact (to per from) ratio from the two ECB quotes. */
function crossRatio(fromQ: QuotedRate, toQ: QuotedRate): Ratio {
  const f = parseRate(fromQ.perEUR);
  const t = parseRate(toQ.perEUR);
  return { num: t.num * f.den, den: t.den * f.num };
}

function displayRatio(r: Ratio, dp = 6): string {
  const scaled = divRound(r.num * 10n ** BigInt(dp), r.den);
  const s = scaled.toString().padStart(dp + 1, "0");
  return `${s.slice(0, -dp)}.${s.slice(-dp)}`;
}

export function convert(
  table: RateTable,
  amountMinor: number,
  from: Currency,
  to: Currency,
  date: ISODate,
): Conversion {
  if (!Number.isSafeInteger(amountMinor)) throw new FxError(`amount must be integer minor units, got ${amountMinor}`);
  if (from === to) {
    return {
      amountMinor,
      from,
      to,
      rateDate: date,
      displayRate: "1.000000",
      step: { label: `No conversion (${from})`, inputs: { amountMinor, from }, result: amountMinor, ruleRef: "same currency" },
    };
  }
  const fromQ = rateOn(table, from, date);
  const toQ = rateOn(table, to, date);
  const rateDate = from === "EUR" ? toQ.rateDate : fromQ.rateDate;
  const r = crossRatio(fromQ, toQ);
  const num = BigInt(amountMinor) * r.num * 10n ** BigInt(exponentOf(to));
  const den = r.den * 10n ** BigInt(exponentOf(from));
  const out = Number(divRound(num, den));
  const displayRate = displayRatio(r);
  return {
    amountMinor: out,
    from,
    to,
    rateDate,
    displayRate,
    step: {
      label: `Convert ${from} → ${to} at ECB reference rate of ${rateDate}`,
      inputs: {
        amountMinor,
        from,
        to,
        [`ecb:${from}/EUR`]: fromQ.perEUR,
        [`ecb:${to}/EUR`]: toQ.perEUR,
        rateDate,
        [`cross:${to}/${from}`]: displayRate,
      },
      result: out,
      ruleRef: `${table.source} (${table.sourceUrl}, retrieved ${table.retrievedAt})`,
    },
  };
}

export type RealizedFx = {
  bookedUSDCents: number;
  paidUSDCents: number;
  /** Positive = gain. For a payable, paying fewer dollars than booked is a gain. */
  gainCents: number;
  steps: CalcStep[];
};

/** Realized FX on settling a foreign-currency payable booked at bookedDate. */
export function realizedFx(
  table: RateTable,
  foreignMinor: number,
  ccy: Currency,
  bookedDate: ISODate,
  paidDate: ISODate,
): RealizedFx {
  const booked = convert(table, foreignMinor, ccy, "USD", bookedDate);
  const paid = convert(table, foreignMinor, ccy, "USD", paidDate);
  const gainCents = booked.amountMinor - paid.amountMinor;
  return {
    bookedUSDCents: booked.amountMinor,
    paidUSDCents: paid.amountMinor,
    gainCents,
    steps: [
      booked.step,
      paid.step,
      {
        label: "Realized FX gain (+) / loss (−) on payable = booked USD − paid USD",
        inputs: { bookedUSDCents: booked.amountMinor, paidUSDCents: paid.amountMinor },
        result: gainCents,
        ruleRef: "FX remeasurement of monetary liabilities (USD functional currency)",
      },
    ],
  };
}

export type Revaluation = {
  revaluedUSDCents: number;
  /** Positive = gain. */
  gainCents: number;
  steps: CalcStep[];
};

/** Period-end revaluation of an open foreign-currency payable carried at bookedUSDCents. */
export function revalue(
  table: RateTable,
  openForeignMinor: number,
  ccy: Currency,
  bookedUSDCents: number,
  periodEnd: ISODate,
): Revaluation {
  const now = convert(table, openForeignMinor, ccy, "USD", periodEnd);
  const gainCents = bookedUSDCents - now.amountMinor;
  return {
    revaluedUSDCents: now.amountMinor,
    gainCents,
    steps: [
      now.step,
      {
        label: "Unrealized FX gain (+) / loss (−) on open payable = carrying USD − revalued USD",
        inputs: { bookedUSDCents, revaluedUSDCents: now.amountMinor },
        result: gainCents,
        ruleRef: "Period-end remeasurement of open monetary liabilities",
      },
    ],
  };
}
