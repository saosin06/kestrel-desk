"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { useActingAs } from "@/app/providers";
import { DecisionControls } from "@/components/decision";
import { Empty, PageHeader, Panel, Pill, Rec } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, requestLabel, roleLabel, statusLabel, statusTone, usd } from "@/lib/ui/format";

function subject(p: Record<string, unknown>): string {
  return String(p.invoiceId ?? p.runId ?? (Array.isArray(p.objectIds) ? p.objectIds[0] : "") ?? p.employeeId ?? "");
}

export default function Approvals() {
  const { role } = useActingAs();
  const [scope, setScope] = useState<"mine" | "pending" | "all">("mine");
  const all = useQuery(api.desk.requests, scope === "all" ? {} : { status: "pending" });
  const rows = (all ?? []).filter((r) => scope !== "mine" || (r.requiredApprovers.includes(role) && !r.approvals.some((a) => a.by === role)));
  const total = rows.reduce((a, r) => a + (r.amountUSDCents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Seats request; people approve. Approvers come from thresholds in data/controls.json, and a requester can never approve its own request."
        actions={
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="mine">Awaiting {roleLabel(role).split(" · ")[0]}</option>
            <option value="pending">All pending</option>
            <option value="all">All requests</option>
          </select>
        }
      />
      <Panel flush note={`${rows.length} requests · ${usd(total, { symbol: true })} total`}>
        {all === undefined ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>Nothing here.</Empty> : (
          <table className="tbl">
            <thead>
              <tr><th>Request</th><th>Type</th><th>Subject</th><th>Case</th><th>Requested by</th><th>Needs</th><th className="num">Amount (USD)</th><th>Requested</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reqId}>
                  <td className="id">{r.reqId}</td>
                  <td className="whitespace-nowrap">{requestLabel(r.kind)}</td>
                  <td><Rec id={subject(r.payload as Record<string, unknown>)} /></td>
                  <td>{r.caseId ? <Rec id={r.caseId} /> : <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap text-ink-2">{roleLabel(r.requestedBy)}</td>
                  <td className="whitespace-nowrap text-ink-2">
                    {r.requiredApprovers.map((a) => (
                      <span key={a} className={`mr-1.5 ${r.approvals.some((x) => x.by === a && x.decision === "approve") ? "text-[var(--good)]" : ""}`}>{roleLabel(a).split(" · ")[0]}</span>
                    ))}
                  </td>
                  <td className="num">{usd(r.amountUSDCents)}</td>
                  <td className="whitespace-nowrap text-ink-2">{date(r.requestedOn)}</td>
                  <td><Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill></td>
                  <td><DecisionControls r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
