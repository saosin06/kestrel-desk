// Kestrel's payroll for the sim: ~420 employees in the HRIS, biweekly
// timesheets by workweek, opening YTD from the Jan–Feb runs, and the payroll
// provider's preview register for each run. The preview is computed with the
// same engine and then has problems planted in it, each next to its
// answer-key entry. Names are fictional; no SSNs, bank numbers are masked.

import type { CaseKind, InboxMessage, ISODate } from "@/lib/erp/types";
import { addToYtd, computePay, inForce, type PayCalc } from "@/lib/payroll/compute";
import { loadPayrollReference } from "@/lib/payroll/reference";
import type { Department, Employee, FilingStatus, PayLine, PayPeriod, PayRun, Timesheet, Ytd } from "@/lib/payroll/types";
import { ZERO_YTD } from "@/lib/payroll/types";
import type { Disposition } from "@/lib/rules/types";

export const REGISTERED_STATES = ["WA"];
const FIRST_PAYDAY = "2026-01-09";

type Rng = { int: (min: number, max: number) => number; pick: <T>(xs: readonly T[]) => T };

export type PayrollKeyEntry = {
  id: string;
  problem: number;
  title: string;
  kind: CaseKind;
  objectId: string;
  relatedIds: string[];
  period: string;
  employeeId: string;
  department?: Department;
  impactUSDCents: number;
  expectedHandling: string;
  dispositions: { cold: Disposition; withRules: Disposition };
  /** "agent" = needs reading an email; not expected from the deterministic sweep */
  detectedBy?: "sweep" | "agent";
  note?: string;
};

export type PayrollWorld = {
  employees: Employee[];
  periods: PayPeriod[];
  openingYtd: Record<string, Ytd>;
  timesheets: Timesheet[];
  runs: PayRun[];
  inbox: InboxMessage[];
  entries: PayrollKeyEntry[];
};

function addDays(date: ISODate, n: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 2026 biweekly periods: Monday–Sunday × 2, paid the following Friday. */
export function payPeriods2026(): PayPeriod[] {
  const out: PayPeriod[] = [];
  for (let payDate = FIRST_PAYDAY; payDate.startsWith("2026"); payDate = addDays(payDate, 14)) {
    out.push({ id: `PP-${payDate}`, start: addDays(payDate, -18), end: addDays(payDate, -5), payDate });
  }
  return out;
}

const FIRST = ["Alex", "Bri", "Carmen", "Dev", "Elena", "Femi", "Grace", "Hiro", "Ines", "Jamal", "Kai", "Lena", "Mateo", "Nadia", "Omar", "Priya", "Quinn", "Rosa", "Sam", "Tariq", "Uma", "Victor", "Wren", "Ximena", "Yusuf", "Zoe", "Marcus", "Ana", "Ben", "Chloe"];
const LAST = ["Abara", "Brandt", "Castillo", "Dao", "Ellison", "Fujita", "Garza", "Haddad", "Ivanova", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Petrov", "Quintero", "Reyes", "Sato", "Thorne", "Underwood", "Varga", "Whitfield", "Xu", "Yilmaz", "Zamora", "Bishop", "Collier", "Dunmore", "Espinoza"];

type DeptSpec = { dept: Department; count: number; title: string; hourly: boolean; lo: number; hi: number };
const DEPTS: DeptSpec[] = [
  { dept: "Production", count: 230, title: "Assembly Technician", hourly: true, lo: 23, hi: 36 },
  { dept: "Field Service", count: 30, title: "Field Service Technician", hourly: true, lo: 32, hi: 44 },
  { dept: "Engineering", count: 80, title: "Engineer", hourly: false, lo: 105_000, hi: 190_000 },
  { dept: "Operations", count: 45, title: "Operations Specialist", hourly: false, lo: 70_000, hi: 120_000 },
  { dept: "Sales", count: 25, title: "Account Executive", hourly: false, lo: 110_000, hi: 240_000 },
  { dept: "Executive", count: 10, title: "Vice President", hourly: false, lo: 260_000, hi: 420_000 },
];

function makeEmployees(rng: Rng): Employee[] {
  const emps: Employee[] = [];
  let n = 1;
  for (const d of DEPTS) {
    for (let i = 0; i < d.count; i++) {
      const id = `E-${String(n).padStart(4, "0")}`;
      const status: FilingStatus = rng.pick(["single_or_mfs", "single_or_mfs", "married_filing_jointly", "married_filing_jointly", "head_of_household"]);
      const kids = status === "single_or_mfs" ? 0 : rng.int(0, 3);
      emps.push({
        id,
        name: `${FIRST[(n * 7) % FIRST.length]} ${LAST[(n * 11 + i) % LAST.length]}`,
        department: d.dept,
        jobTitle: d.title,
        flsa: d.hourly ? "nonexempt" : "exempt",
        compensation: [
          {
            effectiveFrom: "2025-01-01",
            pay: d.hourly
              ? { type: "hourly", rateE4: rng.int(d.lo * 4, d.hi * 4) * 2_500 } // quarter-dollar steps
              : { type: "salary", annualCents: rng.int(d.lo / 500, d.hi / 500) * 50_000 },
          },
        ],
        workLocations: [{ effectiveFrom: "2020-01-01", state: "WA" }],
        w4: { filingStatus: status, step3Cents: kids * 200_000, step4aCents: 0, step4bCents: 0, step4cCents: rng.int(0, 9) === 0 ? 2_500 : 0 },
        hireDate: `20${rng.int(16, 25)}-${String(rng.int(1, 12)).padStart(2, "0")}-01`,
        birthYear: rng.int(1968, 2002),
        k401Bp: rng.pick([0, 300, 400, 500, 600, 800, 1000]),
        healthPremiumCents: rng.pick([0, 8_500, 12_000, 21_000]),
        bank: { accountId: `BA-${String(10_000 + n * 37)}`, last4: String(1000 + ((n * 7919) % 9000)) },
      });
      n++;
    }
  }
  return emps;
}

const employedIn = (e: Employee, p: PayPeriod) => e.hireDate <= p.end && (!e.termDate || e.termDate >= p.start);

function workweeks(rng: Rng, e: Employee, p: PayPeriod): Timesheet["weeks"] {
  return [0, 7].map((offset) => {
    const weekStart = addDays(p.start, offset);
    const weekEnd = addDays(weekStart, 6);
    const ot = e.department === "Field Service" ? rng.int(0, 2) === 0 : rng.int(0, 5) === 0;
    let hoursE2 = ot ? rng.int(41, 48) * 100 : 4_000;
    if (e.termDate && e.termDate < weekEnd) hoursE2 = e.termDate < weekStart ? 0 : 3_200; // last week, through Friday
    return { weekStart, hoursE2 };
  });
}

function toLine(e: Employee, c: PayCalc): PayLine {
  return {
    employeeId: e.id,
    employeeName: e.name,
    workState: c.workState,
    regularHoursE2: c.regularHoursE2,
    overtimeHoursE2: c.overtimeHoursE2,
    grossCents: c.grossCents,
    k401Cents: c.k401Cents,
    healthCents: c.healthCents,
    fitCents: c.fitCents,
    ssCents: c.ssCents,
    medicareCents: c.medicareCents,
    addlMedicareCents: c.addlMedicareCents,
    stateTaxCents: 0,
    netCents: c.netCents,
    employerSsCents: c.employerSsCents,
    employerMedicareCents: c.employerMedicareCents,
    bankAccountId: e.bank.accountId,
    bankLast4: e.bank.last4,
  };
}

const net = (l: PayLine) => l.grossCents - l.k401Cents - l.healthCents - l.fitCents - l.ssCents - l.medicareCents - l.addlMedicareCents - l.stateTaxCents;

export type PayrollParams = { punchToleranceE2: number };

export function generatePayroll(rng: Rng, params: PayrollParams, simFrom: ISODate, simTo: ISODate): PayrollWorld {
  const ref = loadPayrollReference();
  const employees = makeEmployees(rng);
  const byDept = (d: Department) => employees.filter((e) => e.department === d);
  const all = payPeriods2026();
  const periods = all.filter((p) => p.payDate >= simFrom && p.payDate <= simTo);
  const opening = all.filter((p) => p.payDate < simFrom);
  const periodOn = (payDate: ISODate) => periods.find((p) => p.payDate === payDate)!;

  // ---- HRIS events that the plants depend on (HR's records are correct) ----
  const terminated = byDept("Production")[17];
  terminated.termDate = "2026-05-08";
  const raised = byDept("Production")[42];
  const raisePeriod = periodOn("2026-06-26");
  const oldRate = (raised.compensation[0].pay as { rateE4: number }).rateE4;
  raised.compensation.push({ effectiveFrom: raisePeriod.start, pay: { type: "hourly", rateE4: oldRate + 25_000 } });
  const mover = byDept("Operations")[6];
  mover.workLocations.push({ effectiveFrom: periodOn("2026-06-26").start, state: "OR" });
  const ceo = byDept("Executive")[0];
  ceo.jobTitle = "Chief Executive Officer";
  ceo.compensation[0].pay = { type: "salary", annualCents: 48_000_000 };
  const saver = byDept("Sales")[3];
  saver.jobTitle = "VP Sales";
  saver.compensation[0].pay = { type: "salary", annualCents: 24_000_000 };
  saver.k401Bp = 2_200;
  saver.birthYear = 1986; // under 50: no catch-up
  const fieldTech = byDept("Field Service")[4];
  const dupPaid = byDept("Production")[88];
  const twin = byDept("Production")[121]; // the real employee whose bank account the ghost uses
  const fraudTarget = byDept("Production")[60];
  fraudTarget.name = "Marcus Reyes";
  const punchers = [byDept("Production")[5], byDept("Production")[71], byDept("Production")[150]];

  // ---- opening YTD (Jan–Feb runs) ----
  const ytd: Record<string, Ytd> = Object.fromEntries(employees.map((e) => [e.id, ZERO_YTD]));
  for (const p of opening) {
    for (const e of employees.filter((x) => employedIn(x, p))) {
      const ts: Timesheet | undefined = e.flsa === "nonexempt" ? { employeeId: e.id, periodId: p.id, weeks: workweeks(rng, e, p), approvedBy: "supervisor" } : undefined;
      ytd[e.id] = addToYtd(ytd[e.id], computePay(e, p, ts, ytd[e.id], ref));
    }
  }
  const openingYtd = structuredClone(ytd);

  // ---- sim runs: timesheets + provider preview, correct by construction ----
  const timesheets: Timesheet[] = [];
  const runs: PayRun[] = [];
  const calcs = new Map<string, PayCalc>(); // `${period}/${employee}` → correct calc
  for (const p of periods) {
    const lines: PayLine[] = [];
    for (const e of employees.filter((x) => employedIn(x, p))) {
      let ts: Timesheet | undefined;
      if (e.flsa === "nonexempt") {
        ts = { employeeId: e.id, periodId: p.id, weeks: workweeks(rng, e, p), approvedBy: `${e.department} supervisor` };
        if (e === fieldTech && p.payDate === "2026-07-24") ts.weeks = [{ weekStart: p.start, hoursE2: 5_000 }, { weekStart: addDays(p.start, 7), hoursE2: 3_000 }];
        timesheets.push(ts);
      }
      const c = computePay(e, p, ts, ytd[e.id], ref);
      calcs.set(`${p.id}/${e.id}`, c);
      ytd[e.id] = addToYtd(ytd[e.id], c);
      lines.push(toLine(e, c));
    }
    runs.push({ id: `RUN-${p.payDate}`, type: "regular", periodId: p.id, payDate: p.payDate, lines });
  }

  const entries: PayrollKeyEntry[] = [];
  const runOn = (payDate: ISODate) => runs.find((r) => r.payDate === payDate)!;
  const lineOf = (r: PayRun, e: Employee) => r.lines.find((l) => l.employeeId === e.id)!;
  const lineId = (r: PayRun, employeeId: string) => `${r.id}/${employeeId}`;
  const esc = { cold: "escalate", withRules: "escalate" } as const;

  // PR-1 Ghost employee: a line for someone not in the HRIS, paid into a real employee's account.
  {
    const r = runOn("2026-04-17");
    const template = lineOf(r, twin);
    const ghost: PayLine = { ...template, employeeId: "E-9107", employeeName: "Jordan Vale" };
    r.lines.push(ghost);
    entries.push({
      id: "PR-01", problem: 15, title: "Ghost employee in the preview register", kind: "ghost_employee", objectId: lineId(r, ghost.employeeId),
      relatedIds: [twin.id, twin.bank.accountId, r.id], period: r.payDate.slice(0, 7), employeeId: ghost.employeeId, department: "Production",
      impactUSDCents: ghost.netCents, dispositions: esc,
      expectedHandling: `Hold the line; E-9107 isn't in the HRIS and is paid into ${twin.name}'s account (…${twin.bank.last4}). Escalate to the controller and HR; never pay a person HR hasn't hired.`,
    });
  }

  // PR-2 Terminated employee still paid a full period.
  {
    const p = periodOn("2026-05-29");
    const r = runOn(p.payDate);
    const prev = lineOf(runOn("2026-05-15"), terminated);
    const stale: PayLine = { ...prev, regularHoursE2: 8_000, overtimeHoursE2: 0 };
    r.lines.push(stale);
    entries.push({
      id: "PR-02", problem: 15, title: "Terminated employee still paid", kind: "terminated_paid", objectId: lineId(r, terminated.id),
      relatedIds: [terminated.id, r.id], period: r.payDate.slice(0, 7), employeeId: terminated.id, department: terminated.department,
      impactUSDCents: stale.grossCents, dispositions: esc,
      expectedHandling: `Hold; HRIS shows ${terminated.name} terminated ${terminated.termDate}, before the period started ${p.start}. No approved timesheet.`,
    });
  }

  // PR-3 Raise effective at the period start, provider still on the old rate.
  {
    const r = runOn(raisePeriod.payDate);
    const l = lineOf(r, raised);
    const ts = timesheets.find((t) => t.employeeId === raised.id && t.periodId === raisePeriod.id)!;
    const old = computePay({ ...raised, compensation: raised.compensation.slice(0, 1) }, raisePeriod, ts, subtractCalc(ytd, raised, calcs, periods, raisePeriod), ref);
    Object.assign(l, toLine(raised, old));
    entries.push({
      id: "PR-03", problem: 15, title: "Raise not applied", kind: "pay_rate_mismatch", objectId: lineId(r, raised.id),
      relatedIds: [raised.id, r.id], period: r.payDate.slice(0, 7), employeeId: raised.id, department: raised.department,
      impactUSDCents: calcs.get(`${raisePeriod.id}/${raised.id}`)!.grossCents - old.grossCents, dispositions: esc,
      expectedHandling: `Underpayment: HRIS raise to $${((oldRate + 25_000) / 10_000).toFixed(2)}/h effective ${raisePeriod.start} (period start). Correct before approval or pay the difference off-cycle.`,
    });
  }

  // PR-4 Overtime paid at straight time (50 + 30 hour weeks, 80 total).
  {
    const p = periodOn("2026-07-24");
    const r = runOn(p.payDate);
    const l = lineOf(r, fieldTech);
    const right = calcs.get(`${p.id}/${fieldTech.id}`)!;
    const rate = (inForce(fieldTech.compensation, p.start).pay as { rateE4: number }).rateE4;
    const straight = Math.round((rate * 8_000) / 10_000);
    l.regularHoursE2 = 8_000;
    l.overtimeHoursE2 = 0;
    l.grossCents = straight;
    l.netCents = net(l);
    entries.push({
      id: "PR-04", problem: 15, title: "Overtime paid at straight time", kind: "overtime_error", objectId: lineId(r, fieldTech.id),
      relatedIds: [fieldTech.id, r.id], period: r.payDate.slice(0, 7), employeeId: fieldTech.id, department: fieldTech.department,
      impactUSDCents: right.grossCents - straight, dispositions: esc,
      expectedHandling: "FLSA exposure: 50 h in week one owes 10 h at 1.5×, even though the period totals 80 h. Correct before approval.",
      note: "Withholding on the provider line is left as the provider computed it on the correct gross; the gross/OT gap is the finding.",
    });
  }

  // PR-5 Social Security withheld past the wage base in the crossing run.
  {
    const crossing = runs.find((r) => {
      const c = calcs.get(`${r.periodId}/${ceo.id}`);
      return c !== undefined && c.ssCents < Math.round((c.ficaWagesCents * ref.ssRateBp) / 10_000);
    })!;
    const l = lineOf(crossing, ceo);
    const right = l.ssCents;
    const c = calcs.get(`${crossing.periodId}/${ceo.id}`)!;
    l.ssCents = Math.round((c.ficaWagesCents * ref.ssRateBp) / 10_000);
    l.employerSsCents = l.ssCents;
    l.netCents = net(l);
    entries.push({
      id: "PR-05", problem: 15, title: "Social Security withheld past the $184,500 wage base", kind: "payroll_tax_error", objectId: lineId(crossing, ceo.id),
      relatedIds: [ceo.id, crossing.id], period: crossing.payDate.slice(0, 7), employeeId: ceo.id, department: ceo.department,
      impactUSDCents: l.ssCents - right, dispositions: esc,
      expectedHandling: "Over-withheld (employee and employer share). Only the wages up to the base are taxable this run (Pub 15 2026 p.29). Correct before approval.",
    });
  }

  // PR-6 401(k) deferral past the $24,500 limit in the run that crosses it.
  {
    const crossing = runs.find((r) => {
      const c = calcs.get(`${r.periodId}/${saver.id}`);
      return c !== undefined && c.k401Cents < Math.round((c.grossCents * saver.k401Bp) / 10_000);
    })!;
    const l = lineOf(crossing, saver);
    const right = l.k401Cents;
    const c = calcs.get(`${crossing.periodId}/${saver.id}`)!;
    l.k401Cents = Math.round((c.grossCents * saver.k401Bp) / 10_000);
    l.netCents = net(l);
    entries.push({
      id: "PR-06", problem: 15, title: "401(k) deferral past the $24,500 limit", kind: "deduction_limit", objectId: lineId(crossing, saver.id),
      relatedIds: [saver.id, crossing.id], period: crossing.payDate.slice(0, 7), employeeId: saver.id, department: saver.department,
      impactUSDCents: l.k401Cents - right, dispositions: esc,
      expectedHandling: "Excess deferral (employee under 50, no catch-up). Cap the deferral at the remaining room; excess must not reach the plan.",
    });
  }

  // PR-8 Work state moved to Oregon, where Kestrel isn't registered for payroll tax.
  {
    const r = runOn("2026-06-26");
    entries.push({
      id: "PR-08", problem: 15, title: "Employee now works in Oregon; Kestrel isn't registered there", kind: "state_registration_missing", objectId: mover.id,
      relatedIds: [r.id, mover.id], period: r.payDate.slice(0, 7), employeeId: mover.id, department: mover.department,
      impactUSDCents: 0, dispositions: esc,
      expectedHandling: "Escalate to the controller and HR: Oregon withholding and registration aren't set up. Don't compute Oregon tax; don't ignore it.",
    });
  }

  // PR-9 Off-cycle check for a period that the regular run pays again.
  {
    const p = periodOn("2026-07-10");
    const r = runOn(p.payDate);
    const offCycle: PayRun = { id: "RUN-2026-07-08-OC", type: "off_cycle", periodId: p.id, payDate: "2026-07-08", lines: [{ ...lineOf(r, dupPaid) }], note: "Reissue: direct deposit returned by bank" };
    runs.push(offCycle);
    entries.push({
      id: "PR-09", problem: 15, title: "Off-cycle reissue paid again in the regular run", kind: "duplicate_payment", objectId: lineId(r, dupPaid.id),
      relatedIds: [offCycle.id, dupPaid.id], period: r.payDate.slice(0, 7), employeeId: dupPaid.id, department: dupPaid.department,
      impactUSDCents: lineOf(r, dupPaid).netCents, dispositions: esc,
      expectedHandling: "Remove the line from the regular run (already paid by the Jul 8 off-cycle reissue). Never pay the same period twice.",
    });
  }

  // Pattern (HR5 in history): a supervisor fixes a late punch after approval;
  // the provider has the corrected hours, the approved timesheet doesn't.
  for (const [i, e] of punchers.entries()) {
    const r = runs.filter((x) => x.type === "regular")[3 + i * 4];
    const l = lineOf(r, e);
    const diff = Math.min(params.punchToleranceE2, 15);
    const p = periods.find((x) => x.id === r.periodId)!;
    const ts = timesheets.find((t) => t.employeeId === e.id && t.periodId === p.id)!;
    const adjusted = computePay(e, p, { ...ts, weeks: [{ ...ts.weeks[0], hoursE2: ts.weeks[0].hoursE2 + diff }, ts.weeks[1]] }, subtractCalc(ytd, e, calcs, periods, p), ref);
    Object.assign(l, toLine(e, adjusted));
    entries.push({
      id: `PAT-PUNCH-${i + 1}`, problem: 15, title: "Register hours differ from the approved timesheet by a late-punch correction", kind: "hours_mismatch", objectId: lineId(r, e.id),
      relatedIds: [e.id, r.id, "HR5"], period: r.payDate.slice(0, 7), employeeId: e.id, department: "Production",
      impactUSDCents: adjusted.grossCents - calcs.get(`${p.id}/${e.id}`)!.grossCents,
      dispositions: { cold: "escalate", withRules: "info" },
      expectedHandling: "Known Production pattern: supervisor corrected a late punch after approval (≤ a quarter hour). Log as info.",
    });
  }

  // PR-7 Direct-deposit change by email, the day before payday (fraud). Needs reading the email: agent-detected.
  const inbox: InboxMessage[] = [
    {
      id: "MSG-2026-07-23-DD",
      date: "2026-07-23",
      from: "marcus.reyes@kestrel-aerial.co",
      to: "payroll@kestrelaerial.com",
      subject: "Updated bank for my direct deposit",
      body: `Hi payroll team, I switched banks this week. Please send tomorrow's pay to my new account: routing 0219 0006 6, account ending 4471. Sorry for the short notice! — Marcus Reyes (${fraudTarget.id})`,
      refs: [fraudTarget.id],
    },
  ];
  entries.push({
    id: "PR-07", problem: 15, title: "Direct-deposit change by email the day before payday", kind: "direct_deposit_change_unverified", objectId: inbox[0].id,
    relatedIds: [fraudTarget.id, "RUN-2026-07-24", "MEMO-2025-11"], period: "2026-07", employeeId: fraudTarget.id, department: fraudTarget.department,
    impactUSDCents: lineOf(runOn("2026-07-24"), fraudTarget).netCents, dispositions: esc, detectedBy: "agent",
    expectedHandling: "Hold; never edit bank details from email. Sender domain kestrel-aerial.co isn't Kestrel's. Pay to the HRIS account on file; HR verifies via HRIS self-service and a callback (memo after the 2025 near-miss).",
  });

  for (const r of runs) r.lines.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  runs.sort((a, b) => a.payDate.localeCompare(b.payDate) || a.id.localeCompare(b.id));
  return { employees, periods, openingYtd, timesheets, runs, inbox, entries };
}

/** YTD as it stood before period p (the running map already includes p). */
function subtractCalc(ytd: Record<string, Ytd>, e: Employee, calcs: Map<string, PayCalc>, periods: PayPeriod[], p: PayPeriod): Ytd {
  let y = ytd[e.id];
  for (const q of periods.filter((x) => x.payDate >= p.payDate)) {
    const c = calcs.get(`${q.id}/${e.id}`);
    if (!c) continue;
    y = {
      grossCents: y.grossCents - c.grossCents,
      fitWagesCents: y.fitWagesCents - c.fitWagesCents,
      ssWagesCents: y.ssWagesCents - c.ficaWagesCents,
      medicareWagesCents: y.medicareWagesCents - c.ficaWagesCents,
      k401Cents: y.k401Cents - c.k401Cents,
    };
  }
  return y;
}
