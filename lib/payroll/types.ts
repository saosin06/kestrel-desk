// Payroll model. Money: integer cents; hourly rates: ten-thousandths (E4);
// hours: hundredths (E2); rates: basis points. Dates ISO.

import type { ISODate } from "@/lib/erp/types";

export type FilingStatus = "married_filing_jointly" | "single_or_mfs" | "head_of_household";

/** Form W-4 (2020 or later). Only the STANDARD schedules are modeled (Step 2 box unchecked). */
export type W4 = {
  filingStatus: FilingStatus;
  /** Step 3: dependents and other credits, annual */
  step3Cents: number;
  /** Step 4(a): other income, annual */
  step4aCents: number;
  /** Step 4(b): deductions, annual */
  step4bCents: number;
  /** Step 4(c): extra withholding per pay period */
  step4cCents: number;
};

export type Pay = { type: "hourly"; rateE4: number } | { type: "salary"; annualCents: number };

export type Department = "Production" | "Field Service" | "Engineering" | "Operations" | "Sales" | "Executive";

/** HRIS record: the system of record for who is employed and what they are paid. */
export type Employee = {
  id: string;
  name: string;
  department: Department;
  jobTitle: string;
  flsa: "exempt" | "nonexempt";
  /** pay history, oldest first; the entry in force on a period's start date applies */
  compensation: { effectiveFrom: ISODate; pay: Pay }[];
  /** work location history, oldest first */
  workLocations: { effectiveFrom: ISODate; state: string }[];
  w4: W4;
  hireDate: ISODate;
  termDate?: ISODate;
  birthYear: number;
  /** elective 401(k) deferral, basis points of gross */
  k401Bp: number;
  /** section 125 health premium per pay period */
  healthPremiumCents: number;
  bank: { accountId: string; last4: string };
};

export type Workweek = { weekStart: ISODate; hoursE2: number };

export type Timesheet = {
  employeeId: string;
  periodId: string;
  weeks: Workweek[];
  approvedBy: string;
};

export type PayPeriod = { id: string; start: ISODate; end: ISODate; payDate: ISODate };

/** Year-to-date taxable bases and deductions, carried run to run. */
export type Ytd = {
  grossCents: number;
  fitWagesCents: number;
  ssWagesCents: number;
  medicareWagesCents: number;
  k401Cents: number;
};
export const ZERO_YTD: Ytd = { grossCents: 0, fitWagesCents: 0, ssWagesCents: 0, medicareWagesCents: 0, k401Cents: 0 };

/** One employee's line on a payroll register. */
export type PayLine = {
  employeeId: string;
  employeeName: string;
  workState: string;
  regularHoursE2: number;
  overtimeHoursE2: number;
  grossCents: number;
  k401Cents: number;
  healthCents: number;
  fitCents: number;
  ssCents: number;
  medicareCents: number;
  addlMedicareCents: number;
  stateTaxCents: number;
  netCents: number;
  employerSsCents: number;
  employerMedicareCents: number;
  bankAccountId: string;
  bankLast4: string;
};

export type PayRun = {
  id: string;
  type: "regular" | "off_cycle";
  periodId: string;
  payDate: ISODate;
  /** provider's preview: what would be paid if approved */
  lines: PayLine[];
  note?: string;
};
