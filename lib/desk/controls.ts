// Deterministic controls (CLAUDE.md §9), outside any model: who must approve
// what, segregation of duties, and guards that refuse unsafe requests.

import controlsData from "@/data/controls.json";
import type { CaseKind, ISODate, Request, RequestKind, Role } from "@/lib/erp/types";
import { audit, type DeskState } from "./state";

export class ControlViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlViolation";
  }
}

/** Which role may request which kind (the permission table in CLAUDE.md §1). */
const MAY_REQUEST: Record<RequestKind, Role[]> = {
  po: ["buyer"],
  supplier_switch: ["buyer"],
  payment: ["ap_clerk"],
  payment_hold: ["ap_clerk"],
  debit_memo: ["ap_clerk"],
  substitution_approval: ["ap_clerk"],
  vendor_change: ["ap_clerk"],
  payroll_line_hold: ["payroll_specialist"],
  payroll_run_approval: ["payroll_specialist"],
  hris_change: ["payroll_specialist"],
  journal_entry: ["staff_accountant", "inventory_accountant"],
};

/** Case kinds that keep money from moving until resolved. */
export const BLOCKING_KINDS: ReadonlySet<CaseKind> = new Set([
  "noncompliant_substitution",
  "price_variance_vs_contract",
  "qty_mismatch",
  "duplicate_invoice",
  "unknown_supplier",
  "missing_document",
  "source_disagreement",
  "remittance_change_unverified",
]);

export function requiredApprovers(kind: RequestKind, amountUSDCents: number | undefined, caseKind?: CaseKind): Role[] {
  const c = controlsData.controllerApproval;
  switch (kind) {
    case "substitution_approval":
      return ["engineering", "controller"];
    case "payment_hold":
      return caseKind === "noncompliant_substitution" ? ["engineering", "controller"] : ["controller"];
    case "payment":
      return (amountUSDCents ?? Infinity) > c.paymentsAboveUSDCents ? ["controller"] : [];
    case "po":
      return (amountUSDCents ?? Infinity) > c.posAboveUSDCents ? ["controller"] : [];
    case "hris_change":
      return ["hr"];
    case "vendor_change":
    case "debit_memo":
    case "journal_entry":
    case "payroll_line_hold":
    case "payroll_run_approval":
    case "supplier_switch":
      return ["controller"];
  }
}

let seq = 0;
export function createRequest(
  state: DeskState,
  at: ISODate,
  r: { kind: RequestKind; requestedBy: Role; amountUSDCents?: number; caseId?: string; payload: Record<string, unknown> },
): Request {
  if (!MAY_REQUEST[r.kind].includes(r.requestedBy)) {
    throw new ControlViolation(`${r.requestedBy} may not request ${r.kind}`);
  }
  const caseKind = r.caseId ? state.cases.find((c) => c.id === r.caseId)?.kind : undefined;
  if (r.kind === "payment") {
    const invoiceId = String(r.payload.invoiceId);
    const blocking = state.cases.filter((c) => c.status !== "resolved" && c.status !== "dismissed" && c.objectIds.includes(invoiceId) && BLOCKING_KINDS.has(c.kind));
    if (blocking.length > 0) {
      throw new ControlViolation(`invoice ${invoiceId} has open case(s) ${blocking.map((c) => c.id).join(", ")}; payment refused`);
    }
  }
  const approvers = requiredApprovers(r.kind, r.amountUSDCents, caseKind);
  const request: Request = {
    id: `REQ-${String(++seq).padStart(5, "0")}`,
    kind: r.kind,
    requestedBy: r.requestedBy,
    requiredApprovers: approvers,
    approvals: [],
    amountUSDCents: r.amountUSDCents,
    caseId: r.caseId,
    payload: r.payload,
    status: approvers.length === 0 ? "approved" : "pending",
  };
  state.requests.push(request);
  audit(state, { at, actor: r.requestedBy, action: `request:${r.kind}`, refs: [request.id, ...(r.caseId ? [r.caseId] : [])], detail: `requires ${approvers.join(" + ") || "no approval (below threshold)"}` });
  return request;
}

/** Records a decision. Segregation of duties: the approver is never the requester and must be required. */
export function decide(state: DeskState, at: ISODate, requestId: string, by: Role, decision: "approve" | "reject", reason: string): Request {
  const r = state.requests.find((x) => x.id === requestId);
  if (!r) throw new ControlViolation(`no request ${requestId}`);
  if (r.status !== "pending") throw new ControlViolation(`${requestId} is already ${r.status}`);
  if (by === r.requestedBy) throw new ControlViolation(`segregation of duties: ${by} requested ${requestId} and cannot decide it`);
  if (!r.requiredApprovers.includes(by)) throw new ControlViolation(`${by} is not a required approver of ${requestId}`);
  r.approvals.push({ by, decision, reason, at });
  if (decision === "reject") r.status = "rejected";
  else if (r.requiredApprovers.every((role) => r.approvals.some((a) => a.by === role && a.decision === "approve"))) r.status = "approved";
  audit(state, { at, actor: by, action: `decision:${decision}`, refs: [requestId], detail: reason });
  return r;
}
