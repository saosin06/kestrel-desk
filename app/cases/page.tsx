"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Empty, PageHeader, Panel, Pill, Summary } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { caseTitle, date, dispositionLabel, dispositionTone, roleLabel, statusLabel, statusTone, usd, usdCompact } from "@/lib/ui/format";

const PAYROLL_SEAT = "payroll_specialist";

export default function Cases() {
  const cases = useQuery(api.desk.cases);
  const [seat, setSeat] = useState("all");
  const rows = (cases ?? []).filter((c) => seat === "all" || c.openedBy === seat);
  const ap = (cases ?? []).filter((c) => c.openedBy !== PAYROLL_SEAT);
  const pay = (cases ?? []).filter((c) => c.openedBy === PAYROLL_SEAT);
  const sum = (xs: typeof rows) => xs.reduce((a, c) => a + c.impactUSDCents, 0);
  return (
    <>
      <PageHeader
        title="Cases"
        actions={
          <select className="select" value={seat} onChange={(e) => setSeat(e.target.value)}>
            <option value="all">Suppliers and payroll</option>
            <option value="ap_clerk">Supplier invoices (AP clerk)</option>
            <option value={PAYROLL_SEAT}>Payroll (payroll specialist)</option>
          </select>
        }
      />
      <Summary
        text={<>Every problem the agents found and held. Open one to see <b>why</b>: the path through the records, the rule it applied, which source it trusted, and who has to decide.</>}
        figures={[
          { label: "supplier cases", value: ap.length },
          { label: "payroll cases", value: pay.length },
          { label: "amount involved", value: cases ? usdCompact(sum(cases)) : "—", tone: "crit" },
        ]}
      />
      <Panel flush>
        {cases === undefined ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>No cases.</Empty> : (
          <table className="tbl">
            <thead><tr><th>What happened</th><th className="num">Amount (USD)</th><th>Handled as</th><th>Opened</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.caseId}>
                  <td>
                    <Link href={`/cases/${c.caseId}`} className="text-ink">{caseTitle(c)}</Link>
                    <div className="text-[11px] text-muted"><span className="id">{c.caseId}</span> · {roleLabel(c.openedBy)}{c.ruleIds.length > 0 && " · learned rule applied"}</div>
                  </td>
                  <td className="num">{usd(c.impactUSDCents)}</td>
                  <td><Pill tone={dispositionTone(c.disposition)}>{dispositionLabel(c.disposition)}</Pill></td>
                  <td className="whitespace-nowrap text-ink-2">{date(c.openedOn)}</td>
                  <td><Pill tone={statusTone(c.status)}>{statusLabel(c.status)}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
