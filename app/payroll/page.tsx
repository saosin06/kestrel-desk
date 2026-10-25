import Link from "next/link";
import { PageHeader, Panel, Pill, Summary } from "@/components/ui";
import { date, dispositionLabel, dispositionTone, subjectLabel, usd, usdCompact, WHAT_HAPPENED } from "@/lib/ui/format";
import { desk, findingsFor } from "@/lib/ui/world";

export const metadata = { title: "Payroll" };

export default function Payroll() {
  const { world } = desk();
  const runs = [...world.payroll.runs].sort((a, b) => b.payDate.localeCompare(a.payDate));
  const emps = world.payroll.employees;
  const byId = new Map(emps.map((e) => [e.id, e]));
  const flagged = runs.flatMap((r) => findingsFor([r.id]).filter((f) => f.disposition !== "info").map((f) => ({ r, f })));
  const stateFlags = findingsFor(emps.map((e) => e.id)).filter((f) => f.kind === "state_registration_missing");
  const totalNet = runs.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.netCents, 0), 0);
  return (
    <>
      <PageHeader title="Payroll" />
      <Summary
        text={<>Before each payday the payroll specialist recomputes every paycheck from HR records, approved timesheets and the 2026 IRS tables, and holds anything that doesn&apos;t match the payroll provider&apos;s numbers.</>}
        figures={[
          { label: "employees", value: emps.length },
          { label: "pay runs", value: runs.length },
          { label: "paychecks held", value: flagged.length, tone: "crit" },
          { label: "net pay, Mar–Sep", value: usdCompact(totalNet) },
        ]}
      />
      <Panel title="Paychecks held and other payroll problems" flush>
        <table className="tbl">
          <thead><tr><th>What happened</th><th>Employee</th><th>Pay date</th><th className="num">Amount (USD)</th><th>Handled as</th></tr></thead>
          <tbody>
            {[...flagged, ...stateFlags.map((f) => ({ r: runs.find((x) => x.payDate === f.date)!, f }))].map(({ r, f }, i) => {
              const e = byId.get(f.employeeId ?? f.objectId);
              return (
                <tr key={i}>
                  <td><a href={`/payroll/${r.id}`} className="text-ink">{(WHAT_HAPPENED[f.kind] ?? f.kind).replace(/^./, (c) => c.toUpperCase())}</a><div className="text-[11.5px] text-muted">{f.detail}</div></td>
                  <td className="whitespace-nowrap">{e ? e.name : <span className="text-[var(--crit)]">not in HR</span>}<div className="text-[11px] text-muted">{e?.department ?? subjectLabel(f.objectId)}</div></td>
                  <td className="whitespace-nowrap text-ink-2">{date(r.payDate)}</td>
                  <td className="num">{usd(f.impactUSDCents)}</td>
                  <td><Pill tone={dispositionTone(f.disposition)}>{dispositionLabel(f.disposition)}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <Panel title="Pay runs" flush note="Federal income tax per IRS Pub 15-T (2026), FICA per Pub 15 (2026), 401(k) limit per IRS; overtime per 29 U.S.C. § 207 by workweek. WA has no state income tax; WA PFML and WA Cares not modeled.">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Pay date</th><th>Run</th><th>Type</th><th>Period</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">Net</th><th className="num">Employer FICA</th><th>Review</th></tr></thead>
          <tbody>
            {runs.map((r) => {
              const p = world.payroll.periods.find((x) => x.id === r.periodId)!;
              const gross = r.lines.reduce((a, l) => a + l.grossCents, 0);
              const netT = r.lines.reduce((a, l) => a + l.netCents, 0);
              const er = r.lines.reduce((a, l) => a + l.employerSsCents + l.employerMedicareCents, 0);
              const flags = findingsFor([r.id]).filter((f) => f.disposition !== "info");
              const info = findingsFor([r.id]).length - flags.length;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{date(r.payDate)}</td>
                  <td><Link href={`/payroll/${r.id}`} className="id">{r.id}</Link></td>
                  <td className="text-ink-2">{r.type === "regular" ? "Regular" : "Off-cycle"}</td>
                  <td className="whitespace-nowrap text-ink-2">{date(p.start)} – {date(p.end)}</td>
                  <td className="num">{r.lines.length}</td>
                  <td className="num">{usd(gross)}</td>
                  <td className="num">{usd(netT)}</td>
                  <td className="num">{usd(er)}</td>
                  <td className="whitespace-nowrap">{flags.length ? <Pill tone="crit">{flags.length} held</Pill> : <Pill tone="good">Matches</Pill>}{info > 0 && <span className="ml-1.5 text-[11.5px] text-muted">{info} logged</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}
