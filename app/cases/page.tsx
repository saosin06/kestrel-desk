"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Empty, PageHeader, Panel, Pill, Rec } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, dispositionLabel, dispositionTone, kindLabel, roleLabel, statusLabel, statusTone, usd } from "@/lib/ui/format";

export default function Cases() {
  const cases = useQuery(api.desk.cases);
  const [seat, setSeat] = useState("all");
  const rows = (cases ?? []).filter((c) => seat === "all" || c.openedBy === seat);
  return (
    <>
      <PageHeader
        title="Cases"
        subtitle="Every exception the desk opened, with the evidence behind it."
        actions={
          <select className="select" value={seat} onChange={(e) => setSeat(e.target.value)}>
            <option value="all">All seats</option>
            <option value="ap_clerk">AP clerk</option>
            <option value="payroll_specialist">Payroll specialist</option>
          </select>
        }
      />
      <Panel flush note={`${rows.length} cases`}>
        {cases === undefined ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>No cases.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Case</th><th>Opened</th><th>Type</th><th>Subject</th><th>Seat</th><th className="num">Amount (USD)</th><th>Disposition</th><th>Rule</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.caseId}>
                  <td><Link href={`/cases/${c.caseId}`} className="id">{c.caseId}</Link></td>
                  <td className="whitespace-nowrap text-ink-2">{date(c.openedOn)}</td>
                  <td className="whitespace-nowrap">{kindLabel(c.kind)}</td>
                  <td><Rec id={c.objectIds[0]} /></td>
                  <td className="whitespace-nowrap text-ink-2">{roleLabel(c.openedBy)}</td>
                  <td className="num">{usd(c.impactUSDCents)}</td>
                  <td><Pill tone={dispositionTone(c.disposition)}>{dispositionLabel(c.disposition)}</Pill></td>
                  <td>{c.ruleIds.length ? <span className="id text-ink-2">{c.ruleIds.join(", ")}</span> : <span className="text-muted">—</span>}</td>
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
