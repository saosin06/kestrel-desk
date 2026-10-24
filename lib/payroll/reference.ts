// 2026 federal payroll reference data (data/payroll/federal-2026.json), parsed
// to integer cents and basis points. Every value is cited to an IRS source.

import ref from "@/data/payroll/federal-2026.json";
import { parseMoney, parsePercentToBp } from "@/lib/money";
import type { FilingStatus } from "./types";

export type ScheduleRow = { atLeastCents: number; lessThanCents: number | null; baseCents: number; rateBp: number };

export type PayrollReference = {
  periodsPerYear: Record<string, number>;
  line1gCents: Record<FilingStatus, number>;
  schedules: Record<FilingStatus, ScheduleRow[]>;
  ssRateBp: number;
  ssWageBaseCents: number;
  medicareRateBp: number;
  addlMedicareRateBp: number;
  addlMedicareThresholdCents: number;
  k401LimitCents: number;
  overtimeWeeklyHoursE2: number;
  /** overtime multiplier ×10, e.g. 15 = 1.5× */
  overtimeMultiplierX10: number;
  sources: { withholding: string; fica: string; retirement: string; overtime: string };
};

const usd = (s: string) => parseMoney(s, "USD");

function schedule(rows: { atLeast: string; lessThan: string | null; base: string; ratePct: string }[]): ScheduleRow[] {
  return rows.map((r) => ({
    atLeastCents: usd(r.atLeast),
    lessThanCents: r.lessThan === null ? null : usd(r.lessThan),
    baseCents: usd(r.base),
    rateBp: parsePercentToBp(r.ratePct),
  }));
}

export function loadPayrollReference(): PayrollReference {
  const w = ref.incomeTaxWithholding;
  const cite = (s: { doc: string; url: string; retrievedAt: string; pages?: number[] }) =>
    `${s.doc}${s.pages ? ` p.${s.pages.join(",")}` : ""} (${s.url}, retrieved ${s.retrievedAt})`;
  return {
    periodsPerYear: w.payPeriodsPerYear,
    line1gCents: {
      married_filing_jointly: usd(w.line1gAdjustment.married_filing_jointly),
      single_or_mfs: usd(w.line1gAdjustment.other),
      head_of_household: usd(w.line1gAdjustment.other),
    },
    schedules: {
      married_filing_jointly: schedule(w.standardSchedules.married_filing_jointly),
      single_or_mfs: schedule(w.standardSchedules.single_or_mfs),
      head_of_household: schedule(w.standardSchedules.head_of_household),
    },
    ssRateBp: parsePercentToBp(ref.fica.socialSecurityRatePct),
    ssWageBaseCents: usd(ref.fica.socialSecurityWageBase),
    medicareRateBp: parsePercentToBp(ref.fica.medicareRatePct),
    addlMedicareRateBp: parsePercentToBp(ref.fica.additionalMedicareRatePct),
    addlMedicareThresholdCents: usd(ref.fica.additionalMedicareThreshold),
    k401LimitCents: usd(ref.retirement.electiveDeferralLimit),
    overtimeWeeklyHoursE2: ref.overtime.weeklyHoursThreshold * 100,
    overtimeMultiplierX10: Math.round(Number(ref.overtime.multiplier) * 10),
    sources: {
      withholding: cite(w.source),
      fica: cite(ref.fica.source),
      retirement: cite(ref.retirement.source),
      overtime: cite(ref.overtime.source),
    },
  };
}
