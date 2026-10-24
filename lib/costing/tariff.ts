// Duty rates. Column-1 ("general") rates come from the USITC HTS. Chapter 99
// additional duties come from data/additional-duties.json and apply only when
// a person has verified the entry against the cited HTS revision.

import type { CalcStep, ISODate } from "@/lib/erp/types";
import { formatBp, parsePercentToBp } from "@/lib/money";

export type HtsEntry = {
  htsno: string;
  description: string;
  /** Rate text exactly as published, e.g. "3.4%" or "Free". */
  general: string;
  generalRateBp: number;
  footnotes: string[];
  sourceUrl: string;
  retrievedAt: string;
};

export type HtsTable = Readonly<Record<string, HtsEntry>>;

export class TariffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TariffError";
  }
}

/**
 * Parses a column-1 rate. Only "Free" and plain ad valorem "N%" are supported;
 * specific or compound rates ("2.5% + 10¢/kg") throw rather than being guessed.
 */
export function parseGeneralRate(text: string): number {
  const t = text.trim();
  if (/^free$/i.test(t)) return 0;
  if (/^\d+(\.\d{1,2})?%$/.test(t)) return parsePercentToBp(t);
  throw new TariffError(`unsupported duty rate "${text}" (only Free or ad valorem N% are modeled)`);
}

export function htsEntry(table: HtsTable, hts: string): HtsEntry {
  const e = table[hts];
  if (!e) throw new TariffError(`HTS ${hts} is not in data/hts.json`);
  return e;
}

export type AdditionalDutyHeading = {
  heading: string;
  rateBp: number;
  effectiveFrom: ISODate;
  /** null = still in effect as of the cited revision */
  effectiveTo: ISODate | null;
  usNoteRef: string;
  htsRevision: string;
  sourceUrl: string;
  retrievedAt: string;
};

export type AdditionalDutyEntry = {
  origin: string;
  hts: string;
  /** Date range the research covers. Outside it the entry says nothing. */
  coverage: { from: ISODate; to: ISODate };
  headings: AdditionalDutyHeading[];
  /** true = researched and no Chapter 99 duty applies in the coverage window */
  none?: boolean;
  verified: boolean;
  verifiedBy?: string;
  note?: string;
};

export type AdditionalDutyResult = {
  /** headings applied (verified and in effect on the date) */
  applied: AdditionalDutyHeading[];
  /** true when an extra duty may apply but we can't confirm it */
  unverified: boolean;
  reason: string;
};

export function resolveAdditionalDuties(
  entries: readonly AdditionalDutyEntry[],
  origin: string,
  hts: string,
  date: ISODate,
): AdditionalDutyResult {
  if (origin === "US") return { applied: [], unverified: false, reason: "domestic origin" };
  const entry = entries.find((e) => e.origin === origin && e.hts === hts);
  if (!entry) return { applied: [], unverified: true, reason: `no Chapter 99 entry for ${origin} × ${hts}` };
  if (!entry.verified) return { applied: [], unverified: true, reason: `Chapter 99 entry for ${origin} × ${hts} not verified` };
  if (date < entry.coverage.from || date > entry.coverage.to) {
    return {
      applied: [],
      unverified: true,
      reason: `${date} is outside the verified window ${entry.coverage.from}..${entry.coverage.to}`,
    };
  }
  if (entry.none) return { applied: [], unverified: false, reason: "verified: no Chapter 99 duty applies" };
  const applied = entry.headings.filter(
    (h) => h.effectiveFrom <= date && (h.effectiveTo === null || date <= h.effectiveTo),
  );
  return { applied, unverified: false, reason: `verified; ${applied.length} heading(s) in effect on ${date}` };
}

export function generalRateStep(entry: HtsEntry, valueUSDCents: number, dutyCents: number): CalcStep {
  return {
    label: `Column-1 duty, HTS ${entry.htsno} (${entry.general})`,
    inputs: { valueUSDCents, hts: entry.htsno, rate: entry.general, rateBp: entry.generalRateBp },
    result: dutyCents,
    ruleRef: `USITC HTS ${entry.htsno} general rate (${entry.sourceUrl}, retrieved ${entry.retrievedAt})`,
  };
}

export function additionalDutyStep(h: AdditionalDutyHeading, valueUSDCents: number, dutyCents: number): CalcStep {
  return {
    label: `Chapter 99 duty, heading ${h.heading} (+${formatBp(h.rateBp)})`,
    inputs: { valueUSDCents, heading: h.heading, rateBp: h.rateBp, usNoteRef: h.usNoteRef, htsRevision: h.htsRevision },
    result: dutyCents,
    ruleRef: `USITC HTS ${h.heading}, ${h.usNoteRef}, ${h.htsRevision} (${h.sourceUrl}, retrieved ${h.retrievedAt})`,
  };
}
