"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { useActingAs } from "@/app/providers";
import { Pill } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, roleLabel, statusLabel, statusTone } from "@/lib/ui/format";
import type { RuleView } from "@/lib/ui/rules";

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="flex-1 border-r border-line px-3 py-2.5 last:border-r-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">{n}. {title}</div>
      <div className="mt-0.5 text-[12.5px] text-ink-2">{text}</div>
    </div>
  );
}

export function RulesBoard({ views, historyCount, totalEffect }: { views: RuleView[]; historyCount: number; totalEffect: number }) {
  const rows = useQuery(api.desk.rules);
  const corrections = useQuery(api.learning.corrections);
  const setStatus = useMutation(api.decisions.setRuleStatus);
  const { role } = useActingAs();
  const [editing, setEditing] = useState<{ id: string; status: "approved" | "rejected" | "in_review" } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const live = new Map((rows ?? []).map((r) => [r.ruleId, r]));

  const submit = async () => {
    if (!editing) return;
    try {
      setError(null);
      await setStatus({ ruleId: editing.id, by: role, status: editing.status, reason });
      setEditing(null);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
    }
  };

  return (
    <>
      <section className="mb-4 card">
        <div className="flex">
          <Step n={1} title="History" text={`${historyCount} past exceptions with Dana's decision and reason (Jan 2025 – Feb 2026)`} />
          <Step n={2} title="Pattern" text="Found when the same kind of exception recurs 5+ times and Dana's decisions agree ≥ 75% of the time" />
          <Step n={3} title="Proposed" text="Limits, exceptions and changes over time come from the records; decoys with too little support are dropped" />
          <Step n={4} title="Approved" text="Only the controller can approve, send back for review, or reject a rule" />
          <Step n={5} title="Applied" text={`${totalEffect} findings handled without escalating to Dana, Mar–Sep — each still logged`} />
        </div>
      </section>

      {error && <div className="mb-3 rounded-lg border border-[var(--crit)] bg-[var(--crit-bg)] px-3 py-2 text-[var(--crit)]">{error}</div>}

      <section className="mb-4 card px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Every correction becomes precedent</h2>
          <span className="text-[12px] text-muted">Same thresholds and guardrails as the history</span>
        </div>
        {corrections === undefined || corrections.length === 0 ? (
          <p className="m-0 mt-1 text-[13px] text-ink-2">
            When Dana decides a hold, her decision is recorded like a past exception and the desk re-mines its rules: a matching rule gains support, a rule she overrules goes back to review, and a pattern that reaches 5 cases becomes a proposed rule. Try it: release the hold on <Link href="/cases/CASE-0001">CASE-0001</Link> (Hoshi rounding) or <Link href="/cases/CASE-0018">CASE-0018</Link> (Atlas, third month in a row).
          </p>
        ) : (
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {corrections.map((x) => (
              <li key={x.corrId} className="rounded-[12px] bg-subtle px-3 py-2">
                <div className="text-[12px] text-muted"><span className="id">{x.corrId}</span> · {date(x.at)} · {roleLabel(x.by).split(" · ")[0]} on {x.caseId ? <Link href={`/cases/${x.caseId}`} className="id">{x.caseId}</Link> : x.reqId}: “{x.reason}”</div>
                <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4 text-[13px]">{x.effects.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(rows ?? []).filter((r) => r.source === "correction" && !views.some((v) => v.id === r.ruleId)).map((r) => (
        <section key={r.ruleId} className="mb-3 card">
          <header className="flex items-start justify-between gap-4 border-b border-line px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h2 className="text-[14px] font-semibold text-ink">New rule from corrections</h2><Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill></div>
              <div className="mt-0.5 truncate text-[11.5px] text-muted"><span className="id">{r.ruleId}</span></div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {(["approved", "in_review", "rejected"] as const).map((st) => (
                <button key={st} className="btn" disabled={role !== "controller" || r.status === st} title={role !== "controller" ? "Only the controller decides internal rules" : ""} onClick={() => { setEditing({ id: r.ruleId, status: st }); setReason(""); }}>
                  {st === "approved" ? "Approve" : st === "in_review" ? "Send to review" : "Reject"}
                </button>
              ))}
            </div>
          </header>
          {editing?.id === r.ruleId && (
            <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2">
              <input autoFocus className="input flex-1" placeholder={`Reason (${statusLabel(editing.status).toLowerCase()})`} value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reason.trim() && submit()} />
              <button className="btn btn-primary" disabled={!reason.trim()} onClick={submit}>Confirm</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          )}
          <div className="px-3 py-2.5 text-[13px]">{r.statement}<div className="mt-1 text-[12px] text-ink-2">Support {r.support} · confidence {r.confidence.toFixed(2)} · evidence includes {r.evidence.filter((e) => e.startsWith("LC-")).join(", ")}</div></div>
        </section>
      ))}

      {views.map((v) => {
        const r = live.get(v.id);
        const status = r?.status ?? "proposed";
        return (
          <section key={v.id} className="mb-3 card">
            <header className="flex items-start justify-between gap-4 border-b border-line px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[14px] font-semibold text-ink">{v.title}</h2>
                  <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">
                  <span className="id">{v.id}</span>
                  {r?.decidedAt && <> · {statusLabel(status)} by {roleLabel(r.decidedBy ?? "").split(" · ")[0]} on {date(r.decidedAt)}{r.decisionReason ? ` — “${r.decisionReason}”` : ""}</>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {(["approved", "in_review", "rejected"] as const).map((s) => (
                  <button key={s} className="btn" disabled={role !== "controller" || status === s} title={role !== "controller" ? "Only the controller decides internal rules" : ""} onClick={() => { setEditing({ id: v.id, status: s }); setReason(""); }}>
                    {s === "approved" ? "Approve" : s === "in_review" ? "Send to review" : "Reject"}
                  </button>
                ))}
              </div>
            </header>
            {editing?.id === v.id && (
              <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2">
                <input autoFocus className="input flex-1" placeholder={`Reason (${statusLabel(editing.status).toLowerCase()})`} value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reason.trim() && submit()} />
                <button className="btn btn-primary" disabled={!reason.trim()} onClick={submit}>Confirm</button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="border-r border-line px-3 py-2.5">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">What the desk does</div>
                <p className="m-0 text-[13px] leading-relaxed text-ink">{v.does}</p>
                {v.exception && <p className="mb-0 mt-1.5 text-[12.5px] text-ink-2"><span className="font-semibold text-ink">Exception.</span> {v.exception}</p>}
                {v.tightened && <p className="mb-0 mt-1.5 text-[12.5px] text-ink-2"><span className="font-semibold text-ink">Changed over time.</span> {v.tightened}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
                  <span><span className="text-muted">Action</span> {v.action}</span>
                  <span><span className="text-muted">Applies to</span> {v.appliesTo}</span>
                  <span><span className="text-muted">Effect, Mar–Sep</span> {v.effect} {v.effect === 1 ? "item" : "items"} kept off Dana&apos;s desk</span>
                </div>
              </div>
              <div className="px-3 py-2.5">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">Why the desk believes it</div>
                <div className="text-[13px] text-ink">
                  Seen <b>{v.seen}</b> times ({v.period}); Dana {v.agreed === v.seen ? "decided this way every time" : <>decided this way <b>{v.agreed}</b> of {v.seen} times</>}. Confidence {v.confidence.toFixed(2)}.
                </div>
                {r && r.evidence.some((e) => e.startsWith("LC-")) && (
                  <div className="mt-1.5 rounded-[10px] bg-[var(--good-bg)] px-2 py-1 text-[12.5px] text-[var(--good)]">
                    Updated by live corrections ({r.evidence.filter((e) => e.startsWith("LC-")).join(", ")}): support now <b>{r.support}</b>, confidence {r.confidence.toFixed(2)}.
                  </div>
                )}
                {v.explained.length > 0 && (
                  <div className="mt-1.5 text-[12px] text-ink-2">
                    <div className="text-muted">Other decisions, explained by the rule&apos;s exception or limit:</div>
                    <ul className="m-0 mt-0.5 list-disc space-y-0.5 pl-4">{v.explained.map((e, i) => <li key={i}><span className="whitespace-nowrap">{e.date}</span> — {e.text}</li>)}</ul>
                  </div>
                )}
                {v.counter.length > 0 && (
                  <div className="mt-1.5 text-[12px] text-ink-2">
                    <div className="text-muted">Counter-examples (lower the confidence):</div>
                    <ul className="m-0 mt-0.5 list-disc space-y-0.5 pl-4">{v.counter.map((e, i) => <li key={i}><span className="whitespace-nowrap">{e.date}</span> — {e.text}</li>)}</ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}

      <section className="card-muted px-3 py-2.5 text-[12.5px] text-ink-2">
        <span className="font-semibold text-ink">Never learnable.</span> Compliance (restricted origins, missing certificates), bank and direct-deposit changes, duplicate invoices and payments, unknown suppliers, ghost or terminated employees, and segregation of duties. Patterns found in history about these are discarded — including the time in Nov 2025 Dana approved an emailed bank change that turned out to be a near-miss.
      </section>
    </>
  );
}
