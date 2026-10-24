import Link from "next/link";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { date, usd } from "@/lib/ui/format";
import { desk, findingsFor } from "@/lib/ui/world";

export const metadata = { title: "Payroll" };

export default function Payroll() {
  const { world } = desk();
  const runs = [...world.payroll.runs].sort((a, b) => b.payDate.localeCompare(a.payDate));
  const emps = world.payroll.employees;
  const depts = [...new Set(emps.map((e) => e.department))];
  return (
    <>
      <PageHeader title="Payroll" subtitle={`Biweekly payroll for ${emps.length} employees in Washington. The payroll specialist recomputes every line of the provider's preview register before Dana approves the run.`} />
      <div className="mb-4 grid grid-cols-6 gap-3">
        {depts.map((d) => (
          <div key={d} className="rounded-[4px] border border-line bg-panel px-3 py-2"><div className="text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">{d}</div><div className="mt-0.5 text-[16px] font-semibold">{emps.filter((e) => e.department === d).length}</div></div>
        ))}
      </div>
      <Panel flush note="Federal income tax per IRS Pub 15-T (2026), FICA per Pub 15 (2026), 401(k) limit per IRS; overtime per 29 U.S.C. § 207 by workweek. WA has no state income tax; WA PFML and WA Cares not modeled.">
        <table className="tbl">
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
                  <td className="whitespace-nowrap">{flags.length ? <Pill tone="crit">{flags.length} held</Pill> : <Pill tone="good">Recomputed, matches</Pill>}{info > 0 && <span className="ml-1.5 text-[11.5px] text-muted">{info} logged</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
