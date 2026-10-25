"use client";

// What the gateway wrote to the systems of record after approvals, and the audit diffs.
import { useQuery } from "convex/react";
import Link from "next/link";
import { Empty, Panel } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, roleLabel, usd } from "@/lib/ui/format";

type Line = { account: string; name: string; debitCents: number; creditCents: number };
type PostingRow = { ref: string; at: string; system: string; reqId: string; caseId?: string; approvedBy: string[]; memo: string; lines?: Line[] };

/** before → after, one line per field. */
export function Diff({ diff }: { diff?: { field: string; before: string; after: string }[] }) {
  if (!diff || diff.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 font-mono text-[11.5px]">
      {diff.map((d, i) => (
        <div key={i}>
          <span className="text-muted">{d.field}: </span>
          <span className="text-[var(--crit)]">{d.before || "∅"}</span>
          <span className="text-muted"> → </span>
          <span className="text-[var(--good)]">{d.after || "∅"}</span>
        </div>
      ))}
    </div>
  );
}

export function PostingsTable({ rows, empty }: { rows: PostingRow[]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Ref</th><th>System of record</th><th>What was written</th><th>Approved by</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.ref}>
              <td className="whitespace-nowrap"><span className="id text-ink">{p.ref}</span><div className="text-[11.5px] text-muted">{date(p.at)}</div></td>
              <td className="whitespace-nowrap text-ink-2">{p.system}</td>
              <td className="min-w-[280px]">
                {p.memo}
                {p.caseId && <> · <Link href={`/cases/${p.caseId}`} className="id">{p.caseId}</Link></>}
                {p.lines && (
                  <table className="mt-2 w-full text-[12px]">
                    <tbody>
                      {p.lines.map((l) => (
                        <tr key={l.account}>
                          <td className={`id w-[52px] ${l.creditCents ? "pl-5" : ""}`}>{l.account}</td>
                          <td className={`text-ink-2 ${l.creditCents ? "pl-5" : ""}`}>{l.creditCents ? "Cr " : "Dr "}{l.name}</td>
                          <td className="num w-[120px]">{usd(l.debitCents || l.creditCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </td>
              <td className="whitespace-nowrap text-ink-2">{p.approvedBy.map((a) => roleLabel(a).split(" · ")[0]).join(" + ")}<div className="id text-[11px]">{p.reqId}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every posting, newest first (ledger page). */
export function GatewayPostings() {
  const rows = useQuery(api.desk.postings);
  return (
    <Panel
      title="Posted by the gateway"
      note="Agents only request. When every required approver has signed, the gateway writes to the system of record, in the same transaction as the approval, and logs it with a diff. Nothing else writes."
      flush
    >
      {rows === undefined ? <Empty>Loading…</Empty> : <PostingsTable rows={rows} empty="Nothing posted yet. Approve a request on the Approvals page and it appears here." />}
    </Panel>
  );
}
