"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Empty, PageHeader, Panel, Summary } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { auditSentence, date } from "@/lib/ui/format";

const IMPORTANT = /^(open_case|escalate|decision:|denied:|request:payment_hold|request:debit_memo|request:substitution|request:payroll_line_hold|rule:|ask_why|answer_why|intake:)/;

export default function Audit() {
  const rows = useQuery(api.desk.audit, { limit: 2000 });
  const [scope, setScope] = useState<"important" | "all">("important");
  const [q, setQ] = useState("");
  const shown = (rows ?? []).filter((r) => (scope === "all" || IMPORTANT.test(r.action)) && (!q || `${r.action} ${r.refs.join(" ")} ${r.detail}`.toLowerCase().includes(q.toLowerCase())));
  const tools = (rows ?? []).filter((r) => r.action.startsWith("tool:")).length;
  return (
    <>
      <PageHeader
        title="Audit log"
        actions={
          <>
            <input className="input w-[220px]" placeholder="Search (e.g. Vireo, CASE-0003)" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="important">Decisions, holds and escalations</option>
              <option value="all">Everything, including each tool call</option>
            </select>
          </>
        }
      />
      <Summary
        text={<>Append-only: nothing here can be edited or deleted. Every agent action and every human decision is recorded in order, with the records it touched.</>}
        figures={[
          { label: "events", value: rows?.length ?? "—" },
          { label: "agent tool calls", value: tools },
          { label: "human decisions", value: (rows ?? []).filter((r) => r.action.startsWith("decision:") || r.action.startsWith("rule:")).length },
        ]}
      />
      <Panel flush note={`${shown.length} shown`}>
        {rows === undefined ? <Empty>Loading…</Empty> : shown.length === 0 ? <Empty>Nothing matches.</Empty> : (
          <table className="tbl">
            <thead><tr><th className="num">#</th><th>Date</th><th>What happened</th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.seq}>
                  <td className="num id w-[52px] text-muted">{a.seq}</td>
                  <td className="w-[110px] whitespace-nowrap text-ink-2">{date(a.at)}</td>
                  <td>{auditSentence(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
