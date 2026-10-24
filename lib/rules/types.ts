// Kestrel's internal rules: patterns in how the company actually handles
// exceptions, learned from its history and approved by the controller.

import type { CaseKind, ISODate, PeriodId, Role } from "@/lib/erp/types";

/** What happens to a finding. Every finding is logged; only escalations reach a person's queue. */
export type Disposition = "escalate" | "info" | "check:recount" | `route:${Role}`;

/** Numeric facts a rule can bound. */
export type FindingAttrs = {
  /** |received − invoiced| / invoiced, basis points */
  qtyVarianceBp?: number;
  /** |line amount − qty × unit price|, invoice-currency minor units */
  lineDiffMinor?: number;
  currency?: string;
};
export type RuleAttr = keyof Omit<FindingAttrs, "currency">;

/** A finding as the rule engine sees it (deterministic sweep or agent output). */
export type FindingFacts = {
  kind: CaseKind;
  objectId: string;
  date: ISODate;
  period: PeriodId;
  supplierId?: string;
  partId?: string;
  /** engine-level diff kind, e.g. "line_amount_mismatch" */
  diffKind?: string;
  impactUSDCents?: number;
  attrs: FindingAttrs;
};

export type RuleScope = {
  kind: CaseKind;
  diffKind?: string;
  supplierId?: string;
  partId?: string;
  currency?: string;
  attr?: RuleAttr;
  /** inclusive upper bound on attr */
  maxAttr?: number;
  effectiveFrom?: ISODate;
  /** the rule stops applying once the same pattern recurs this many months in a row */
  unlessConsecutiveMonths?: number;
};

export type RuleAction = { type: "info" } | { type: "require_check"; check: "recount" } | { type: "route_to"; role: Role };

export type RuleStatus = "proposed" | "approved" | "rejected" | "in_review" | "retired";

export type InternalRule = {
  id: string;
  statement: string;
  scope: RuleScope;
  action: RuleAction;
  status: RuleStatus;
  source: "statistics" | "memo";
  support: number;
  counterexamples: string[];
  confidence: number;
  /** history event ids behind the rule */
  evidence: string[];
};

// ---- company history (exception-log level) ----

export type HistoryDecision = "accepted" | "rejected" | "recount_corrected" | "debit_memo";

export type HistoryException = {
  id: string;
  date: ISODate;
  supplierId: string;
  partId?: string;
  kind: CaseKind;
  diffKind?: string;
  impactUSDCents: number;
  attrs: { qtyVarianceBp?: number; lineDiffMinor?: number; currency?: string };
  summary: string;
  raisedBy: Role;
  resolution: { decidedBy: Role; decision: HistoryDecision; reason: string; date: ISODate };
};

export type HistoryIncident = { id: string; date: ISODate; title: string; narrative: string; refs: string[] };
export type HistoryMemo = { id: string; date: ISODate; from: Role; subject: string; body: string };
export type HistoryVolume = { period: string; supplierId: string; invoices: number; spendUSDCents: number };

export type History = {
  window: { from: ISODate; to: ISODate };
  exceptions: HistoryException[];
  incidents: HistoryIncident[];
  memos: HistoryMemo[];
  volumes: HistoryVolume[];
};
