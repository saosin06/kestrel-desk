// Recomputes every line of every provider preview register from the HRIS,
// approved timesheets, and the 2026 tax reference, and reports one root-cause
// finding per disagreeing line. HRIS is the system of record for who is
// employed and what they're paid; timekeeping for hours.

import { addToYtd, computePay, inForce } from "@/lib/payroll/compute";
import { loadPayrollReference } from "@/lib/payroll/reference";
import type { PayLine, Ytd } from "@/lib/payroll/types";
import { formatMoney } from "@/lib/money";
import type { Evidence, FindingFacts } from "@/lib/rules/types";
import { type PayrollWorld, REGISTERED_STATES } from "./payroll";

export type PayrollFinding = FindingFacts & { source: "payroll"; detail: string; evidence?: Evidence };

const hoursOf = (l: PayLine) => l.regularHoursE2 + l.overtimeHoursE2;

const $ = (cents: number) => formatMoney(cents, "USD").replace("USD ", "$");

export function payrollSweep(pw: PayrollWorld): PayrollFinding[] {
  const ref = loadPayrollReference();
  const emps = new Map(pw.employees.map((e) => [e.id, e]));
  const ytd: Record<string, Ytd> = structuredClone(pw.openingYtd);
  const paid = new Map<string, Set<string>>();
  const findings: PayrollFinding[] = [];
  const add = (f: Omit<PayrollFinding, "source" | "attrs"> & { attrs?: PayrollFinding["attrs"] }) => {
    if (!findings.some((x) => x.kind === f.kind && x.objectId === f.objectId)) findings.push({ ...f, attrs: f.attrs ?? {}, source: "payroll" });
  };

  for (const run of pw.runs) {
    const period = pw.periods.find((p) => p.id === run.periodId)!;
    for (const line of run.lines) {
      const at = { date: run.payDate, period: run.payDate.slice(0, 7), employeeId: line.employeeId, objectId: `${run.id}/${line.employeeId}` };
      const emp = emps.get(line.employeeId);
      if (!emp) {
        const owner = pw.employees.find((e) => e.bank.accountId === line.bankAccountId);
        add({ ...at, kind: "ghost_employee", impactUSDCents: line.netCents, detail: `${line.employeeName} (${line.employeeId}) is not in the HRIS${owner ? `; paid into ${owner.name}'s account …${owner.bank.last4}` : ""}`, evidence: { path: [run.id, `${line.employeeId} ${line.employeeName}`, "HRIS: no record", ...(owner ? [`bank account ${line.bankAccountId} = ${owner.id} ${owner.name}`] : [])], systemOfRecord: "HRIS (who is employed)" } });
        continue;
      }
      const dept = { department: emp.department };
      if (emp.termDate && emp.termDate < period.start) {
        add({ ...at, ...dept, kind: "terminated_paid", impactUSDCents: line.grossCents, detail: `HRIS: terminated ${emp.termDate}, before the period began ${period.start}`, evidence: { path: [run.id, emp.id, `HRIS term date ${emp.termDate}`, `period ${period.start}–${period.end}`], systemOfRecord: "HRIS (employment status)" } });
        continue;
      }
      const seen = paid.get(emp.id) ?? new Set<string>();
      if (seen.has(period.id)) {
        add({ ...at, ...dept, kind: "duplicate_payment", impactUSDCents: line.netCents, detail: `the ${period.start} – ${period.end} period was already paid to ${emp.id} in an earlier run`, evidence: { path: [run.id, emp.id, period.id, ...pw.runs.filter((x) => x !== run && x.periodId === period.id && x.lines.some((l) => l.employeeId === emp.id)).map((x) => `${x.id} (${x.type})`)], systemOfRecord: "payroll register history" } });
        continue;
      }
      seen.add(period.id);
      paid.set(emp.id, seen);

      const state = inForce(emp.workLocations, period.start).state;
      if (!REGISTERED_STATES.includes(state)) {
        add({ ...at, ...dept, objectId: emp.id, kind: "state_registration_missing", impactUSDCents: 0, detail: `works in ${state} from ${inForce(emp.workLocations, period.start).effectiveFrom}; Kestrel is registered only in ${REGISTERED_STATES.join(", ")}`, evidence: { path: [emp.id, `HRIS work state ${state} from ${inForce(emp.workLocations, period.start).effectiveFrom}`, run.id, `registered states: ${REGISTERED_STATES.join(", ")}`], systemOfRecord: "HRIS (work location)" } });
      }

      const ts = pw.timesheets.find((t) => t.employeeId === emp.id && t.periodId === period.id);
      const c = computePay(emp, period, ts, ytd[emp.id], ref);
      ytd[emp.id] = addToYtd(ytd[emp.id], c);

      const tsHours = ts ? ts.weeks.reduce((a, w) => a + w.hoursE2, 0) : undefined;
      const ev = (systemOfRecord: string, ruleRef?: string): Evidence => ({
        path: [run.id, emp.id, period.id, ...(ts ? [`timesheet ${ts.weeks.map((w) => w.hoursE2 / 100).join(" + ")} h`] : [])],
        ruleRef,
        systemOfRecord,
        steps: c.steps,
      });
      const gap = (a: number, b: number) => Math.abs(a - b);
      if (tsHours !== undefined && hoursOf(line) !== tsHours) {
        add({ ...at, ...dept, kind: "hours_mismatch", diffKind: "hours_mismatch", impactUSDCents: gap(line.grossCents, c.grossCents), attrs: { hoursDiffE2: gap(hoursOf(line), tsHours) }, detail: `register ${hoursOf(line) / 100} h vs approved timesheet ${tsHours / 100} h`, evidence: ev("timekeeping (approved timesheet)") });
      } else if (line.overtimeHoursE2 !== c.overtimeHoursE2) {
        add({ ...at, ...dept, kind: "overtime_error", impactUSDCents: c.grossCents - line.grossCents, detail: `overtime ${line.overtimeHoursE2 / 100} h paid vs ${c.overtimeHoursE2 / 100} h owed (per workweek)`, evidence: ev("timekeeping (hours by workweek); HRIS (rate, FLSA status)", ref.sources.overtime) });
      } else if (line.grossCents !== c.grossCents) {
        add({ ...at, ...dept, kind: "pay_rate_mismatch", impactUSDCents: gap(c.grossCents, line.grossCents), detail: `paid ${$(line.grossCents)} gross; HR's rate in force on ${period.start} gives ${$(c.grossCents)}`, evidence: ev("HRIS (pay rate in force)") });
      } else if (line.k401Cents !== c.k401Cents) {
        add({ ...at, ...dept, kind: "deduction_limit", impactUSDCents: gap(line.k401Cents, c.k401Cents), detail: `deferred ${$(line.k401Cents)}; only ${$(c.k401Cents)} was left under the $24,500 annual limit`, evidence: ev("HRIS (deferral election); payroll YTD", ref.sources.retirement) });
      } else if (line.fitCents !== c.fitCents || line.ssCents !== c.ssCents || line.medicareCents !== c.medicareCents || line.addlMedicareCents !== c.addlMedicareCents) {
        const diff = gap(line.fitCents, c.fitCents) + gap(line.ssCents, c.ssCents) + gap(line.medicareCents, c.medicareCents) + gap(line.addlMedicareCents, c.addlMedicareCents);
        add({ ...at, ...dept, kind: "payroll_tax_error", impactUSDCents: diff, detail: [
            line.fitCents !== c.fitCents && `federal tax ${$(line.fitCents)} vs ${$(c.fitCents)}`,
            line.ssCents !== c.ssCents && `Social Security ${$(line.ssCents)} vs ${$(c.ssCents)}${c.ssCents < line.ssCents ? " (wage base reached)" : ""}`,
            line.medicareCents !== c.medicareCents && `Medicare ${$(line.medicareCents)} vs ${$(c.medicareCents)}`,
            line.addlMedicareCents !== c.addlMedicareCents && `Additional Medicare ${$(line.addlMedicareCents)} vs ${$(c.addlMedicareCents)}`,
          ].filter(Boolean).join("; ") + " (withheld vs correct)", evidence: ev("IRS 2026 tables; payroll YTD", ref.sources.fica) });
      } else if (line.netCents !== c.netCents) {
        add({ ...at, ...dept, kind: "source_disagreement", diffKind: "net_pay", impactUSDCents: gap(line.netCents, c.netCents), detail: "net pay differs from recompute" });
      }
    }
  }
  return findings;
}
