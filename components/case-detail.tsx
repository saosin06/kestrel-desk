"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { Fragment } from "react";
import { DecisionControls } from "@/components/decision";
import { Empty, Kv, PageHeader, Panel, Pill, Rec } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, dispositionLabel, dispositionTone, kindLabel, requestLabel, roleLabel, statusLabel, statusTone, usd } from "@/lib/ui/format";

type Evidence = { path: string[]; ruleRef?: string; systemOfRecord?: string; steps?: { label: string; inputs: Record<string, number | string>; result: number; ruleRef: string }[] };

const COMPLIANCE = new Set(["noncompliant_substitution", "missing_document"]);

export function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const d = useQuery(api.desk.caseDetail, { caseId: id });
  if (d === undefined) return <Empty>Loading…</Empty>;
  if (d === null) return <Empty>No case {id}.</Empty>;
  const c = d.case;
  const evidence = (c.evidence ?? []) as Evidence[];

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/cases", label: "Cases" }]}
        title={<span><span className="id mr-2 text-[15px] text-ink-2">{c.caseId}</span>{kindLabel(c.kind)}</span>}
        subtitle={c.summary}
        actions={<><Pill tone={dispositionTone(c.disposition)}>{dispositionLabel(c.disposition)}</Pill><Pill tone={statusTone(c.status)}>{statusLabel(c.status)}</Pill></>}
      />
      <div className="grid grid-cols-[1fr_340px] gap-4">
        <div>
          <Panel title="Why?" note={COMPLIANCE.has(c.kind) ? "Policy modeled on federal drone component restrictions — verify with counsel." : undefined}>
            {evidence.map((e, i) => (
              <div key={i} className={i ? "mt-4 border-t border-line pt-3" : ""}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">Path through the company</div>
                <div className="flex flex-wrap items-center gap-y-1.5">
                  {e.path.map((p, j) => (
                    <Fragment key={j}>
                      {j > 0 && <span className="px-1.5 text-muted">→</span>}
                      <span className="rounded-[3px] border border-line bg-subtle px-1.5 py-[2px]">{/^[A-Z]+-\d/.test(p) ? <Rec id={p} /> : <span className="text-ink-2">{p}</span>}</span>
                    </Fragment>
                  ))}
                </div>
                <div className="mt-3">
                  <Kv items={[["Rule applied", e.ruleRef ?? <span className="text-muted">—</span>], ["System of record", e.systemOfRecord ?? c.systemOfRecord ?? "—"]]} />
                </div>
                {e.steps && e.steps.length > 0 && (
                  <table className="tbl mt-3 border border-line">
                    <thead><tr><th>Calculation</th><th>Inputs</th><th className="num">Result</th></tr></thead>
                    <tbody>
                      {e.steps.map((s, k) => (
                        <tr key={k}>
                          <td className="w-[36%]">{s.label}<div className="mt-0.5 text-[11px] text-muted">{s.ruleRef}</div></td>
                          <td className="text-[12px] text-ink-2">{Object.entries(s.inputs).map(([key, v]) => <span key={key} className="mr-3 inline-block"><span className="text-muted">{key}</span> <span className="id">{String(v)}</span></span>)}</td>
                          <td className="num id">{s.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </Panel>

          <Panel title="Requests on this case" flush>
            {d.requests.length === 0 ? <Empty>No requests.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Request</th><th>Type</th><th>Needs</th><th className="num">Amount (USD)</th><th>Decisions</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {d.requests.map((r) => (
                    <tr key={r.reqId}>
                      <td className="id">{r.reqId}</td>
                      <td className="whitespace-nowrap">{requestLabel(r.kind)}</td>
                      <td className="whitespace-nowrap text-ink-2">{r.requiredApprovers.map((a) => roleLabel(a).split(" · ")[0]).join(" + ")}</td>
                      <td className="num">{usd(r.amountUSDCents)}</td>
                      <td className="text-[12px] text-ink-2">{r.approvals.length === 0 ? "—" : r.approvals.map((a, k) => <div key={k}>{roleLabel(a.by).split(" · ")[0]}: {a.decision} — {a.reason}</div>)}</td>
                      <td><Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill></td>
                      <td><DecisionControls r={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Escalations and questions" flush>
            {d.messages.length === 0 ? <Empty>None.</Empty> : (
              <table className="tbl">
                <tbody>
                  {d.messages.map((m, k) => (
                    <tr key={k}><td className="w-[92px] whitespace-nowrap text-ink-2">{date(m.at)}</td><td className="w-[210px] whitespace-nowrap text-ink-2">{roleLabel(m.from)} → {roleLabel(m.to).split(" · ")[0]}</td><td>{m.text}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="Details">
            <Kv
              items={[
                ["Opened", date(c.openedOn)],
                ["Seat", roleLabel(c.openedBy)],
                ["Written by", c.author === "agent" ? "Agent (Claude)" : "Rules engine"],
                ["Amount", <span key="a" className="num">{usd(c.impactUSDCents, { symbol: true })}</span>],
                ["Subject", <span key="s" className="flex flex-col gap-0.5">{c.objectIds.map((o) => <Rec key={o} id={o} />)}</span>],
                ["Internal rule", c.ruleIds.length ? c.ruleIds.join(", ") : "None applied"],
              ]}
            />
          </Panel>
          {d.rules.length > 0 && (
            <Panel title="Internal rule applied">
              {d.rules.map((r) => (
                <div key={r.ruleId}>
                  <div className="id mb-1 text-ink-2">{r.ruleId}</div>
                  <div>{r.statement}</div>
                  <div className="mt-1.5 text-[11.5px] text-muted">Support {r.support} · confidence {r.confidence.toFixed(2)} · {statusLabel(r.status)} by {roleLabel(r.decidedBy ?? "controller").split(" · ")[0]}</div>
                </div>
              ))}
            </Panel>
          )}
          <Panel title="Audit trail" flush>
            <table className="tbl">
              <tbody>
                {d.audit.map((a) => (
                  <tr key={a.seq}><td className="id w-[44px] text-muted">#{a.seq}</td><td><div className="text-ink-2">{date(a.at)} · {roleLabel(a.actor).split(" · ")[0]}</div><div className="id">{a.action}</div>{a.detail && <div className="text-[12px] text-ink-2">{a.detail}</div>}</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </>
  );
}
