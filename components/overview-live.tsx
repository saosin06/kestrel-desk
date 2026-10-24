"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useActingAs } from "@/app/providers";
import { Empty, Panel, Pill, Rec, Stat } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, kindLabel, requestLabel, roleLabel, usd, usdCompact } from "@/lib/ui/format";

export function OverviewStats() {
  const o = useQuery(api.desk.overview);
  const pending = useQuery(api.desk.requests, { status: "pending" });
  const { role } = useActingAs();
  const mine = pending?.filter((r) => r.requiredApprovers.includes(role) && !r.approvals.some((a) => a.by === role));
  return (
    <div className="mb-4 grid grid-cols-4 gap-3">
      <Stat label="Open cases" value={o ? o.openCases : "—"} sub={o ? `${o.totalCases} opened Mar–Sep` : " "} />
      <Stat label="Awaiting approval" value={o ? o.pendingApprovals : "—"} sub={mine ? `${mine.length} need ${roleLabel(role).split(" · ")[0]}` : " "} />
      <Stat label="Held from payment" value={o ? usdCompact(o.heldUSDCents) : "—"} sub="Supplier lines and payroll lines on hold" />
      <Stat label="Desk source" value={<span className="text-[15px]">{o?.source === "agents" ? "Agent seats" : "Rules engine"}</span>} sub={o?.source === "agents" ? "Claude seats, deterministic tools" : "Deterministic baseline run"} />
    </div>
  );
}

export function ExposureByKind() {
  const o = useQuery(api.desk.overview);
  const rows = (o?.byKind ?? []).sort((a, b) => b.impact - a.impact);
  return (
    <Panel title="Exposure by case type" flush>
      {rows.length === 0 ? <Empty>No cases.</Empty> : (
        <table className="tbl">
          <thead><tr><th>Type</th><th className="num">Cases</th><th className="num">Amount (USD)</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.kind}><td>{kindLabel(r.kind)}</td><td className="num">{r.count}</td><td className="num">{usd(r.impact)}</td></tr>)}</tbody>
        </table>
      )}
    </Panel>
  );
}

export function AwaitingMe() {
  const pending = useQuery(api.desk.requests, { status: "pending" });
  const { role } = useActingAs();
  const mine = (pending ?? []).filter((r) => r.requiredApprovers.includes(role) && !r.approvals.some((a) => a.by === role)).slice(0, 8);
  return (
    <Panel title={`Awaiting ${roleLabel(role).split(" · ")[0]}`} actions={<Link href="/approvals" className="text-[12px]">All approvals</Link>} flush>
      {mine.length === 0 ? <Empty>Nothing awaiting this approver.</Empty> : (
        <table className="tbl">
          <thead><tr><th>Request</th><th>Type</th><th>Subject</th><th className="num">Amount</th><th>Requested</th></tr></thead>
          <tbody>
            {mine.map((r) => (
              <tr key={r.reqId}>
                <td className="id">{r.reqId}</td>
                <td>{requestLabel(r.kind)}</td>
                <td><Rec id={r.caseId ?? String((r.payload as Record<string, unknown>).invoiceId ?? (r.payload as Record<string, unknown>).runId ?? "")} /></td>
                <td className="num">{usd(r.amountUSDCents)}</td>
                <td className="whitespace-nowrap text-ink-2">{date(r.requestedOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function RecentActivity() {
  const audit = useQuery(api.desk.audit, { limit: 12 });
  return (
    <Panel title="Recent activity" actions={<Link href="/audit" className="text-[12px]">Audit log</Link>} flush>
      <table className="tbl">
        <tbody>
          {(audit ?? []).map((a) => (
            <tr key={a.seq}>
              <td className="w-[92px] whitespace-nowrap text-ink-2">{date(a.at)}</td>
              <td className="w-[170px] whitespace-nowrap">{roleLabel(a.actor)}</td>
              <td className="max-w-[260px] truncate"><span className="id text-ink-2">{a.action}</span> {a.refs[0] && <Rec id={a.refs[0]} />}</td>
              <td className="num"><Pill tone={a.action.startsWith("decision:approve") ? "good" : a.action.startsWith("escalate") ? "warn" : "neutral"}>#{a.seq}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
