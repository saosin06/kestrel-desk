"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { useActingAs } from "@/app/providers";
import { DecisionControls } from "@/components/decision";
import { Empty, PageHeader, Panel, Pill, Summary } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, requestTitle, roleLabel, statusLabel, statusTone, usd, usdCompact } from "@/lib/ui/format";

const ROUTINE = new Set(["payment", "payroll_run_approval"]);

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.desk.requests>>>[number];

function Table({ rows, cases }: { rows: Row[]; cases: Map<string, { kind: string; objectIds: string[] }> }) {
  return (
    <table className="tbl">
      <thead><tr><th>Request</th><th className="num">Amount (USD)</th><th>Needs</th><th>Requested</th><th>Status</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => {
          const c = r.caseId ? cases.get(r.caseId) : undefined;
          return (
            <tr key={r.reqId}>
              <td>
                <div className="text-ink">{requestTitle(r, c)}</div>
                <div className="text-[11px] text-muted"><span className="id">{r.reqId}</span> · from {roleLabel(r.requestedBy)}{r.caseId && <> · <Link href={`/cases/${r.caseId}`}>{r.caseId}</Link></>}</div>
              </td>
              <td className="num">{usd(r.amountUSDCents)}</td>
              <td className="whitespace-nowrap text-ink-2">
                {r.requiredApprovers.length === 0 ? "No approval (below threshold)" : r.requiredApprovers.map((a) => (
                  <span key={a} className={`mr-1.5 ${r.approvals.some((x) => x.by === a && x.decision === "approve") ? "text-[var(--good)]" : ""}`}>{roleLabel(a).split(" · ")[0]}</span>
                ))}
              </td>
              <td className="whitespace-nowrap text-ink-2">{date(r.requestedOn)}</td>
              <td><Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill></td>
              <td><DecisionControls r={r} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Approvals() {
  const { role } = useActingAs();
  const [mineOnly, setMineOnly] = useState(true);
  const pending = useQuery(api.desk.requests, { status: "pending" });
  const cases = new Map((useQuery(api.desk.cases) ?? []).map((c) => [c.caseId, c]));
  const who = roleLabel(role).split(" · ")[0];
  const rows = (pending ?? []).filter((r) => !mineOnly || (r.requiredApprovers.includes(role) && !r.approvals.some((a) => a.by === role)));
  const judgment = rows.filter((r) => !ROUTINE.has(r.kind));
  const routine = rows.filter((r) => ROUTINE.has(r.kind));
  const held = judgment.filter((r) => r.kind.endsWith("hold")).reduce((a, r) => a + (r.amountUSDCents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Approvals"
        actions={
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only what {who} can decide
          </label>
        }
      />
      <Summary
        text={<>The agents can only <b>request</b>. Here a person decides. Switch who you are with <b>Acting as</b> at the top right — you can only decide what your role is allowed to, and never your own request. <b>Ask why</b> gets a live answer from the agent.</>}
        figures={[
          { label: "need judgment", value: judgment.length, tone: judgment.length ? "warn" : "good" },
          { label: "on hold", value: usdCompact(held), tone: "crit" },
          { label: "routine to sign off", value: routine.length },
        ]}
      />
      <Panel title="Needs judgment — holds, debit memos, substitutions" flush>
        {pending === undefined ? <Empty>Loading…</Empty> : judgment.length === 0 ? <Empty>Nothing needs {who}&apos;s judgment.</Empty> : <Table rows={judgment} cases={cases} />}
      </Panel>
      <details className="mb-4 card">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">Routine — clean invoices and payroll runs to sign off ({routine.length})</summary>
        <div className="border-t border-line">{routine.length === 0 ? <Empty>None.</Empty> : <Table rows={routine} cases={cases} />}</div>
      </details>
    </>
  );
}
