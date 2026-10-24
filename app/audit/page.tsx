"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Empty, PageHeader, Panel, Rec } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, roleLabel } from "@/lib/ui/format";

export default function Audit() {
  const rows = useQuery(api.desk.audit, { limit: 1000 });
  const [actor, setActor] = useState("all");
  const [q, setQ] = useState("");
  const actors = [...new Set((rows ?? []).map((r) => r.actor))].sort();
  const shown = (rows ?? []).filter((r) => (actor === "all" || r.actor === actor) && (!q || `${r.action} ${r.refs.join(" ")} ${r.detail}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only. Every tool call, request, escalation and decision, in order."
        actions={
          <>
            <input className="input w-[220px]" placeholder="Filter by id or text" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="all">All actors</option>
              {actors.map((a) => <option key={a} value={a}>{roleLabel(a)}</option>)}
            </select>
          </>
        }
      />
      <Panel flush note={`${shown.length} of ${rows?.length ?? 0} events`}>
        {rows === undefined ? <Empty>Loading…</Empty> : (
          <table className="tbl">
            <thead><tr><th className="num">Seq</th><th>Date</th><th>Actor</th><th>Action</th><th>References</th><th>Detail</th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.seq}>
                  <td className="num id text-muted">{a.seq}</td>
                  <td className="whitespace-nowrap text-ink-2">{date(a.at)}</td>
                  <td className="whitespace-nowrap">{roleLabel(a.actor)}</td>
                  <td className="id whitespace-nowrap">{a.action}</td>
                  <td><span className="flex flex-wrap gap-x-2">{a.refs.slice(0, 3).map((r) => <Rec key={r} id={r} />)}</span></td>
                  <td className="text-ink-2">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
