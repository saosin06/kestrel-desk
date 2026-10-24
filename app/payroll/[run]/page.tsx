import { notFound } from "next/navigation";
import { Kv, PageHeader, Panel, Pill } from "@/components/ui";
import { date, dispositionLabel, dispositionTone, kindLabel, usd } from "@/lib/ui/format";
import { desk, findingsFor } from "@/lib/ui/world";

export function generateStaticParams() {
  return desk().world.payroll.runs.map((r) => ({ run: r.id }));
}

export default async function RunPage({ params }: PageProps<"/payroll/[run]">) {
  const { run: id } = await params;
  const { world } = desk();
  const run = world.payroll.runs.find((r) => r.id === id);
  if (!run) notFound();
  const p = world.payroll.periods.find((x) => x.id === run.periodId)!;
  const emps = new Map(world.payroll.employees.map((e) => [e.id, e]));
  const findings = findingsFor([run.id, ...run.lines.map((l) => l.employeeId)]).filter((f) => f.objectId.startsWith(`${run.id}/`) || (f.kind === "state_registration_missing" && f.date === run.payDate));
  const sum = (k: "grossCents" | "netCents" | "fitCents" | "ssCents" | "medicareCents" | "k401Cents", lines = run.lines) => lines.reduce((a, l) => a + l[k], 0);
  const byDept = [...new Set(run.lines.map((l) => emps.get(l.employeeId)?.department ?? "Not in HRIS"))].map((d) => {
    const lines = run.lines.filter((l) => (emps.get(l.employeeId)?.department ?? "Not in HRIS") === d);
    return { d, n: lines.length, gross: sum("grossCents", lines), net: sum("netCents", lines), ot: lines.reduce((a, l) => a + l.overtimeHoursE2, 0) };
  });

  return (
    <>
      <PageHeader crumbs={[{ href: "/payroll", label: "Payroll" }]} title={<span><span className="id mr-2 text-[15px] text-ink-2">{run.id}</span>{run.type === "regular" ? "Regular run" : "Off-cycle run"}</span>} subtitle={`Pay date ${date(run.payDate)} · period ${date(p.start)} – ${date(p.end)}${run.note ? ` · ${run.note}` : ""}`} />
      <div className="grid grid-cols-[1fr_320px] gap-4">
        <div>
          <Panel title="Lines held for review" flush>
            {findings.length === 0 ? <div className="p-3 text-ink-2">Every line recomputed from the HRIS, approved timesheets and the IRS 2026 tables matches the provider's preview.</div> : (
              <table className="tbl">
                <thead><tr><th>Employee</th><th>Department</th><th>Finding</th><th>Detail</th><th className="num">Amount (USD)</th><th>Disposition</th></tr></thead>
                <tbody>
                  {findings.map((f, i) => {
                    const e = emps.get(f.employeeId ?? "");
                    return (
                      <tr key={i}>
                        <td className="whitespace-nowrap"><span className="id">{f.employeeId}</span> {e ? e.name : <span className="text-[var(--crit)]">not in HRIS</span>}</td>
                        <td className="text-ink-2">{e?.department ?? "—"}</td>
                        <td className="whitespace-nowrap">{kindLabel(f.kind)}</td>
                        <td className="text-ink-2">{f.detail}{f.ruleId && <div className="mt-0.5 text-[11.5px] text-muted">Internal rule {f.ruleId}</div>}</td>
                        <td className="num">{usd(f.impactUSDCents)}</td>
                        <td><Pill tone={dispositionTone(f.disposition)}>{dispositionLabel(f.disposition)}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="By department" flush>
            <table className="tbl">
              <thead><tr><th>Department</th><th className="num">Employees</th><th className="num">Overtime hours</th><th className="num">Gross</th><th className="num">Net</th></tr></thead>
              <tbody>{byDept.map((r) => <tr key={r.d}><td>{r.d}</td><td className="num">{r.n}</td><td className="num">{(r.ot / 100).toFixed(2)}</td><td className="num">{usd(r.gross)}</td><td className="num">{usd(r.net)}</td></tr>)}</tbody>
              <tfoot><tr><td>Total</td><td className="num">{run.lines.length}</td><td className="num">{(run.lines.reduce((a, l) => a + l.overtimeHoursE2, 0) / 100).toFixed(2)}</td><td className="num">{usd(sum("grossCents"))}</td><td className="num">{usd(sum("netCents"))}</td></tr></tfoot>
            </table>
          </Panel>
        </div>
        <Panel title="Run totals">
          <Kv items={[["Gross pay", usd(sum("grossCents"), { symbol: true })], ["401(k) deferrals", usd(sum("k401Cents"), { symbol: true })], ["Federal income tax", usd(sum("fitCents"), { symbol: true })], ["Social Security", usd(sum("ssCents"), { symbol: true })], ["Medicare", usd(sum("medicareCents"), { symbol: true })], ["Net pay", usd(sum("netCents"), { symbol: true })]]} />
        </Panel>
      </div>
    </>
  );
}
