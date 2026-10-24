"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { useActingAs } from "@/app/providers";
import { api } from "@/convex/_generated/api";
import { roleLabel } from "@/lib/ui/format";

type Req = { reqId: string; requestedBy: string; requiredApprovers: string[]; approvals: { by: string }[]; status: string };

/** Approve / Reject (reason required) / Ask why, as the acting role. Controls run server-side. */
export function DecisionControls({ r }: { r: Req }) {
  const { role } = useActingAs();
  const decide = useMutation(api.decisions.decide);
  const [mode, setMode] = useState<null | "approve" | "reject" | "why">(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (r.status !== "pending") return null;
  const canDecide = r.requiredApprovers.includes(role) && !r.approvals.some((a) => a.by === role) && r.requestedBy !== role;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "why") {
        const res = await fetch("/api/ask-why", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reqId: r.reqId, by: role, question: text }) });
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      }
      else await decide({ reqId: r.reqId, by: role, decision: mode!, reason: text });
      setMode(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (mode) {
    return (
      <div className="flex min-w-[320px] items-center gap-1.5">
        <input
          autoFocus
          className="input flex-1"
          placeholder={mode === "why" ? "Question for the requester" : mode === "approve" ? "Reason for approval" : "Reason for rejection"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && text.trim() && submit()}
        />
        <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={submit}>
          {mode === "why" ? "Send" : mode === "approve" ? "Approve" : "Reject"}
        </button>
        <button className="btn" onClick={() => setMode(null)}>Cancel</button>
        {error && <span className="text-[11.5px] text-[var(--crit)]">{error}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button className="btn btn-primary" disabled={!canDecide} title={canDecide ? "" : `${roleLabel(role)} isn't an approver of this request`} onClick={() => setMode("approve")}>Approve</button>
      <button className="btn" disabled={!canDecide} onClick={() => setMode("reject")}>Reject</button>
      <button className="btn" onClick={() => setMode("why")}>Ask why</button>
    </div>
  );
}
