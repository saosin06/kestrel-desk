// Deterministic payroll math: gross with per-workweek overtime, the three
// taxable-wage bases, Worksheet 1A federal withholding, FICA with the wage
// base and Additional Medicare, and the 401(k) limit. Exact BigInt ratios,
// rounded half-up to the cent once per amount.

import type { CalcStep, ISODate } from "@/lib/erp/types";
import { divRound, pctOf } from "@/lib/money";
import type { PayrollReference } from "./reference";
import type { Employee, Pay, PayPeriod, Timesheet, W4, Workweek, Ytd } from "./types";

export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollError";
  }
}

export function inForce<T extends { effectiveFrom: ISODate }>(history: readonly T[], date: ISODate): T {
  const hit = [...history].reverse().find((h) => h.effectiveFrom <= date);
  if (!hit) throw new PayrollError(`nothing in force on ${date}`);
  return hit;
}

// ---- gross ----

export type Gross = { regularHoursE2: number; overtimeHoursE2: number; grossCents: number; steps: CalcStep[] };

/** Overtime is per workweek (FLSA): hours over 40 in a week at 1.5×. Never averaged across the period. */
export function hourlyGross(rateE4: number, weeks: readonly Workweek[], ref: PayrollReference, exempt = false): Gross {
  let regular = 0;
  let overtime = 0;
  for (const w of weeks) {
    const ot = exempt ? 0 : Math.max(0, w.hoursE2 - ref.overtimeWeeklyHoursE2);
    regular += w.hoursE2 - ot;
    overtime += ot;
  }
  // rate (E4 dollars) × hours (E2) → cents: rate × hours / 10^4
  const regularCents = Number(divRound(BigInt(rateE4) * BigInt(regular), 10_000n));
  const overtimeCents = Number(divRound(BigInt(rateE4) * BigInt(overtime) * BigInt(ref.overtimeMultiplierX10), 100_000n));
  const grossCents = regularCents + overtimeCents;
  return {
    regularHoursE2: regular,
    overtimeHoursE2: overtime,
    grossCents,
    steps: [
      {
        label: "Gross = regular hours × rate + overtime hours × rate × 1.5 (overtime per workweek over 40 h)",
        inputs: { rateE4, regularHoursE2: regular, overtimeHoursE2: overtime, weeks: weeks.map((w) => w.hoursE2 / 100).join("+") },
        result: grossCents,
        ruleRef: ref.sources.overtime,
      },
    ],
  };
}

export function salaryGross(annualCents: number, ref: PayrollReference, periods = ref.periodsPerYear.biweekly): Gross {
  const grossCents = Number(divRound(BigInt(annualCents), BigInt(periods)));
  return {
    regularHoursE2: 0,
    overtimeHoursE2: 0,
    grossCents,
    steps: [{ label: "Salary gross = annual salary ÷ pay periods", inputs: { annualCents, periods }, result: grossCents, ruleRef: "Kestrel pay policy (biweekly)" }],
  };
}

export function grossFor(emp: Employee, pay: Pay, timesheet: Timesheet | undefined, ref: PayrollReference): Gross {
  if (pay.type === "salary") return salaryGross(pay.annualCents, ref);
  if (!timesheet) throw new PayrollError(`no approved timesheet for hourly employee ${emp.id}`);
  return hourlyGross(pay.rateE4, timesheet.weeks, ref, emp.flsa === "exempt");
}

// ---- federal income tax withholding (Pub 15-T 2026, Worksheet 1A) ----

export function federalWithholding(fitWagesCents: number, w4: W4, ref: PayrollReference, periods = ref.periodsPerYear.biweekly): { cents: number; step: CalcStep } {
  const P = BigInt(periods);
  const line1c = BigInt(fitWagesCents) * P;
  const line1e = line1c + BigInt(w4.step4aCents);
  const line1h = BigInt(w4.step4bCents) + BigInt(ref.line1gCents[w4.filingStatus]);
  const adjusted = line1e - line1h > 0n ? line1e - line1h : 0n;

  const rows = ref.schedules[w4.filingStatus];
  const row = rows.find((r) => BigInt(r.atLeastCents) <= adjusted && (r.lessThanCents === null || adjusted < BigInt(r.lessThanCents)));
  if (!row) throw new PayrollError(`no schedule row for ${adjusted}`);

  // annual tentative, in cents × 10^4: base + (adjusted − A) × rate
  const annualE4 = BigInt(row.baseCents) * 10_000n + (adjusted - BigInt(row.atLeastCents)) * BigInt(row.rateBp);
  const afterCredits = annualE4 - BigInt(w4.step3Cents) * 10_000n;
  const perPeriod = afterCredits > 0n ? divRound(afterCredits, 10_000n * P) : 0n;
  const cents = Number(perPeriod) + w4.step4cCents;
  return {
    cents,
    step: {
      label: `Federal income tax (Worksheet 1A, ${w4.filingStatus}, STANDARD schedule)`,
      inputs: {
        fitWagesCents,
        periods,
        adjustedAnnualCents: Number(adjusted),
        rowAtLeastCents: row.atLeastCents,
        rowBaseCents: row.baseCents,
        rowRateBp: row.rateBp,
        step3Cents: w4.step3Cents,
        step4cCents: w4.step4cCents,
      },
      result: cents,
      ruleRef: ref.sources.withholding,
    },
  };
}

// ---- FICA ----

export type Fica = { ssCents: number; medicareCents: number; addlMedicareCents: number; employerSsCents: number; employerMedicareCents: number; steps: CalcStep[] };

export function fica(ficaWagesCents: number, ytd: Pick<Ytd, "ssWagesCents" | "medicareWagesCents">, ref: PayrollReference): Fica {
  const roomUnderBase = Math.max(0, ref.ssWageBaseCents - ytd.ssWagesCents);
  const ssWages = Math.min(ficaWagesCents, roomUnderBase);
  const ssCents = pctOf(ssWages, ref.ssRateBp);
  const medicareCents = pctOf(ficaWagesCents, ref.medicareRateBp);
  const over = (x: number) => Math.max(0, x - ref.addlMedicareThresholdCents);
  const addlWages = over(ytd.medicareWagesCents + ficaWagesCents) - over(ytd.medicareWagesCents);
  const addlMedicareCents = pctOf(addlWages, ref.addlMedicareRateBp);
  return {
    ssCents,
    medicareCents,
    addlMedicareCents,
    employerSsCents: ssCents,
    employerMedicareCents: medicareCents,
    steps: [
      {
        label: "Social Security 6.2% on wages up to the annual wage base",
        inputs: { ficaWagesCents, ytdSsWagesCents: ytd.ssWagesCents, wageBaseCents: ref.ssWageBaseCents, taxedCents: ssWages, rateBp: ref.ssRateBp },
        result: ssCents,
        ruleRef: ref.sources.fica,
      },
      { label: "Medicare 1.45%, no wage base", inputs: { ficaWagesCents, rateBp: ref.medicareRateBp }, result: medicareCents, ruleRef: ref.sources.fica },
      {
        label: "Additional Medicare 0.9% on calendar-year wages over $200,000 (employee only)",
        inputs: { ytdMedicareWagesCents: ytd.medicareWagesCents, ficaWagesCents, thresholdCents: ref.addlMedicareThresholdCents, taxedCents: addlWages },
        result: addlMedicareCents,
        ruleRef: ref.sources.fica,
      },
    ],
  };
}

// ---- deductions ----

export function k401Deferral(grossCents: number, electionBp: number, ytdK401Cents: number, ref: PayrollReference): { cents: number; step: CalcStep } {
  const elected = pctOf(grossCents, electionBp);
  const room = Math.max(0, ref.k401LimitCents - ytdK401Cents);
  const cents = Math.min(elected, room);
  return {
    cents,
    step: {
      label: "401(k) elective deferral, capped at the annual limit (catch-up not modeled)",
      inputs: { grossCents, electionBp, ytdK401Cents, limitCents: ref.k401LimitCents },
      result: cents,
      ruleRef: ref.sources.retirement,
    },
  };
}

// ---- one employee, one period ----

export type PayCalc = {
  employeeId: string;
  workState: string;
  regularHoursE2: number;
  overtimeHoursE2: number;
  grossCents: number;
  k401Cents: number;
  healthCents: number;
  fitWagesCents: number;
  ficaWagesCents: number;
  fitCents: number;
  ssCents: number;
  medicareCents: number;
  addlMedicareCents: number;
  employerSsCents: number;
  employerMedicareCents: number;
  netCents: number;
  steps: CalcStep[];
};

/**
 * Taxable bases (Pub 15 2026 p.51, p.47, p.50): a 401(k) deferral reduces
 * income-tax wages only; a section 125 health premium reduces income-tax and
 * FICA wages.
 */
export function computePay(emp: Employee, period: PayPeriod, timesheet: Timesheet | undefined, ytd: Ytd, ref: PayrollReference): PayCalc {
  const pay = inForce(emp.compensation, period.start).pay;
  const workState = inForce(emp.workLocations, period.start).state;
  const gross = grossFor(emp, pay, timesheet, ref);
  const k401 = k401Deferral(gross.grossCents, emp.k401Bp, ytd.k401Cents, ref);
  const healthCents = Math.min(emp.healthPremiumCents, gross.grossCents - k401.cents);
  const fitWagesCents = gross.grossCents - k401.cents - healthCents;
  const ficaWagesCents = gross.grossCents - healthCents;
  const fit = federalWithholding(fitWagesCents, emp.w4, ref);
  const f = fica(ficaWagesCents, ytd, ref);
  const netCents = gross.grossCents - k401.cents - healthCents - fit.cents - f.ssCents - f.medicareCents - f.addlMedicareCents;
  return {
    employeeId: emp.id,
    workState,
    regularHoursE2: gross.regularHoursE2,
    overtimeHoursE2: gross.overtimeHoursE2,
    grossCents: gross.grossCents,
    k401Cents: k401.cents,
    healthCents,
    fitWagesCents,
    ficaWagesCents,
    fitCents: fit.cents,
    ssCents: f.ssCents,
    medicareCents: f.medicareCents,
    addlMedicareCents: f.addlMedicareCents,
    employerSsCents: f.employerSsCents,
    employerMedicareCents: f.employerMedicareCents,
    netCents,
    steps: [...gross.steps, k401.step, fit.step, ...f.steps],
  };
}

export function addToYtd(ytd: Ytd, c: Pick<PayCalc, "grossCents" | "fitWagesCents" | "ficaWagesCents" | "k401Cents">): Ytd {
  return {
    grossCents: ytd.grossCents + c.grossCents,
    fitWagesCents: ytd.fitWagesCents + c.fitWagesCents,
    ssWagesCents: ytd.ssWagesCents + c.ficaWagesCents,
    medicareWagesCents: ytd.medicareWagesCents + c.ficaWagesCents,
    k401Cents: ytd.k401Cents + c.k401Cents,
  };
}
