"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useActingAs } from "@/app/providers";
import { Empty, PageHeader, Panel, Pill } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { date, kindLabel, roleLabel, statusLabel, statusTone } from "@/lib/ui/format";

function scopeText(s: Record<string, unknown>): string {
  const parts = [kindLabel(String(s.kind))];
  if (s.supplierId) parts.push(`supplier ${s.supplierId}`);
  if (s.department) parts.push(`${s.department}`);
  if (s.partId) parts.push(`part ${s.partId}`);
  if (s.attr && s.maxAttr !== undefined) parts.push(`${s.attr} ≤ ${s.maxAttr}`);
  if (s.effectiveFrom) parts.push(`since ${s.effectiveFrom}`);
  if (s.unlessConsecutiveMonths) parts.push(`not after ${s.unlessConsecutiveMonths} months in a row`);
  return parts.join(" · ");
}
function actionText(a: Record<string, unknown>): string {
  return a.type === "info" ? "Log as info" : a.type === "require_check" ? "Request a recount first" : `Route to ${roleLabel(String(a.role)).split(" · ")[0]}`;
}

export default function Rules() {
  const rules = useQuery(api.desk.rules);
  const setStatus = useMutation(api.decisions.setRuleStatus);
  const { role } = useActingAs();
  const [error, setError] = useState<string | null>(null);
  const act = async (ruleId: string, status: "approved" | "rejected" | "in_review") => {
    const reason = window.prompt(`Reason (${statusLabel(status).toLowerCase()})`);
    if (!reason) return;
    try {
      setError(null);
      await setStatus({ ruleId, by: role, status, reason });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
    }
  };
  return (
    <>
      <PageHeader
        title="Internal rules"
        subtitle="How Kestrel actually handles recurring exceptions, mined from 14 months of history (Jan 2025 – Feb 2026). Support, thresholds and confidence are computed, not written by a model. Only the controller approves a rule; compliance, bank details, duplicates and segregation of duties are never learnable."
      />
      {error && <div className="mb-3 rounded-[4px] border border-[var(--crit)] bg-[var(--crit-bg)] px-3 py-2 text-[var(--crit)]">{error}</div>}
      <Panel flush>
        {rules === undefined ? <Empty>Loading…</Empty> : (
          <table className="tbl">
            <thead><tr><th>Rule</th><th>What it says</th><th>Applies to</th><th>Action</th><th className="num">Support</th><th className="num">Confidence</th><th className="num">Counter-examples</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.ruleId}>
                  <td className="id max-w-[170px] break-all text-ink-2">{r.ruleId}</td>
                  <td className="max-w-[360px]">{r.statement}<div className="mt-1 text-[11px] text-muted">Evidence: {r.evidence.slice(0, 6).join(", ")}{r.evidence.length > 6 ? `, +${r.evidence.length - 6}` : ""}</div></td>
                  <td className="text-[12px] text-ink-2">{scopeText(r.scope)}</td>
                  <td className="whitespace-nowrap">{actionText(r.action)}</td>
                  <td className="num">{r.support}</td>
                  <td className="num">{r.confidence.toFixed(2)}</td>
                  <td className="num">{r.counterexamples.length}</td>
                  <td className="whitespace-nowrap"><Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill>{r.decidedAt && <div className="mt-0.5 text-[11px] text-muted">{roleLabel(r.decidedBy ?? "").split(" · ")[0]} · {date(r.decidedAt)}</div>}</td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-1.5">
                      <button className="btn" disabled={role !== "controller" || r.status === "approved"} onClick={() => act(r.ruleId, "approved")}>Approve</button>
                      <button className="btn" disabled={role !== "controller" || r.status === "in_review"} onClick={() => act(r.ruleId, "in_review")}>Review</button>
                      <button className="btn" disabled={role !== "controller" || r.status === "rejected"} onClick={() => act(r.ruleId, "rejected")}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
