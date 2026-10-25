// Display formatting for the back office. Integer cents in, strings out.

const usdFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 4200000 → "42,000.00"; negatives in parentheses. */
export function usd(cents: number | null | undefined, opts: { symbol?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "—";
  const s = usdFmt.format(Math.abs(cents) / 100);
  const body = opts.symbol ? `$${s}` : s;
  return cents < 0 ? `(${body})` : body;
}

/** 42600000 → "$426.0K"; for tiles and chart labels only. */
export function usdCompact(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(2)}`;
}

/** Minor units of any currency. */
export function money(minor: number, ccy: string): string {
  const exp = ccy === "JPY" || ccy === "KRW" ? 0 : 2;
  const s = new Intl.NumberFormat("en-US", { minimumFractionDigits: exp, maximumFractionDigits: exp }).format(Math.abs(minor) / 10 ** exp);
  return `${minor < 0 ? "(" : ""}${s}${minor < 0 ? ")" : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function date(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
}
export const monthLabel = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1];

export const KIND_LABEL: Record<string, string> = {
  noncompliant_substitution: "Noncompliant substitution",
  price_variance_vs_contract: "Price above contract",
  qty_mismatch: "Quantity mismatch",
  duplicate_invoice: "Duplicate invoice",
  duty_overcharge: "Duty overcharge",
  unknown_supplier: "Unknown supplier",
  missing_document: "Missing certificate of origin",
  source_disagreement: "Source disagreement",
  remittance_change_unverified: "Remittance change (unverified)",
  ghost_employee: "Ghost employee",
  terminated_paid: "Terminated employee paid",
  pay_rate_mismatch: "Pay rate mismatch",
  overtime_error: "Overtime error",
  payroll_tax_error: "Payroll tax error",
  deduction_limit: "Deduction over limit",
  direct_deposit_change_unverified: "Direct deposit change (unverified)",
  state_registration_missing: "State registration missing",
  duplicate_payment: "Duplicate payment",
  hours_mismatch: "Hours mismatch",
};
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replaceAll("_", " ");

export const REQUEST_LABEL: Record<string, string> = {
  payment: "Payment",
  payment_hold: "Payment hold",
  debit_memo: "Debit memo",
  substitution_approval: "Substitution approval",
  vendor_change: "Vendor master change",
  payroll_line_hold: "Payroll line hold",
  payroll_run_approval: "Payroll run approval",
  hris_change: "HRIS change",
  journal_entry: "Journal entry",
  po: "Purchase order",
  supplier_switch: "Supplier switch",
};
export const requestLabel = (k: string) => REQUEST_LABEL[k] ?? k;

export const ROLE_LABEL: Record<string, string> = {
  controller: "Dana · Controller",
  engineering: "Mei · Engineering",
  hr: "Priya · HR",
  procurement_mgr: "Raj · Procurement",
  receiving: "Luis · Receiving",
  ap_clerk: "AP clerk (agent)",
  payroll_specialist: "Payroll specialist (agent)",
  buyer: "Buyer (agent)",
  staff_accountant: "Staff accountant (agent)",
  inventory_accountant: "Staff accountant (agent)",
  system: "System",
  gateway: "Gateway",
};
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

export type Tone = "crit" | "warn" | "good" | "info" | "neutral";
export function dispositionTone(d: string): Tone {
  if (d === "escalate") return "crit";
  if (d === "info") return "neutral";
  return "warn";
}
export function dispositionLabel(d: string): string {
  if (d === "escalate") return "Escalated";
  if (d === "info") return "Logged";
  if (d === "check:recount") return "Recount requested";
  if (d.startsWith("route:")) return `Routed to ${roleLabel(d.slice(6)).split(" · ")[0]}`;
  return d;
}
export function statusTone(s: string): Tone {
  return s === "approved" || s === "resolved" ? "good" : s === "rejected" ? "crit" : s === "pending" || s === "awaiting_approval" ? "warn" : "neutral";
}
export function statusLabel(s: string): string {
  return { awaiting_approval: "Awaiting decision", pending: "Pending", approved: "Approved", rejected: "Rejected", resolved: "Resolved", open: "Open", dismissed: "Dismissed", in_review: "In review", proposed: "Proposed", retired: "Retired" }[s] ?? s;
}

/** Where a record id lives in the app (ids share yymm-supplier tags). */
export function recordHref(id: string): string | null {
  if (/INTAKE-\d+/.test(id)) return `/intake#${id.match(/INTAKE-\d+/)![0]}`;
  const tag = id.match(/^(?:VI|PO|R|PS|CE|COO)-(\d{4}-[A-Z]+)/)?.[1];
  if (id.startsWith("VI-")) return `/payables/${id.split(" ")[0]}`;
  if (tag) return `/payables/VI-${tag}`;
  if (id.startsWith("RUN-")) return `/payroll/${id.split("/")[0]}`;
  if (id.startsWith("CASE-")) return `/cases/${id}`;
  if (/^(HR|R-)/.test(id)) return "/rules";
  return null;
}

// ---- plain-language titles ----

const TAG_SUPPLIER: Record<string, string> = { NW: "Northwind", ATL: "Atlas Motors", VIR: "Vireo", HOS: "Hoshi Optics", RDG: "Ridgeline", CAS: "Cascade", UNREG: "Unknown supplier" };

export const WHAT_HAPPENED: Record<string, string> = {
  noncompliant_substitution: "part swapped for a restricted-origin one",
  price_variance_vs_contract: "billed above contract price",
  qty_mismatch: "quantities don't agree",
  duplicate_invoice: "same invoice sent twice",
  duty_overcharge: "customs duty overcharged",
  unknown_supplier: "invoice from a supplier not in the vendor master",
  missing_document: "certificate of origin missing",
  source_disagreement: "records disagree",
  remittance_change_unverified: "bank-change request by email",
  ghost_employee: "paycheck for someone not in HR",
  terminated_paid: "paycheck for a terminated employee",
  pay_rate_mismatch: "raise not applied",
  overtime_error: "overtime underpaid",
  payroll_tax_error: "tax withheld incorrectly",
  deduction_limit: "401(k) over the annual limit",
  direct_deposit_change_unverified: "direct-deposit change by email",
  state_registration_missing: "employee moved to a state we're not registered in",
  duplicate_payment: "same pay period paid twice",
  hours_mismatch: "hours differ from the approved timesheet",
};

/** "Vireo · Apr 2026 invoice", "Payroll · Apr 17 · E-0018", "Email MSG-…". */
export function subjectLabel(id: string): string {
  const intake = id.match(/INTAKE-\d+/)?.[0];
  if (intake) return id.startsWith("MSG") ? `Live email ${intake}` : `Live invoice ${intake}`;
  const m = id.match(/^(?:VI|CE|PO|R|PS|COO)-(\d{2})(\d{2})-([A-Z]+)/);
  if (m) {
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
    const what = id.startsWith("CE-") ? "customs entry" : id.endsWith("-2") ? "invoice (re-sent)" : "invoice";
    return `${TAG_SUPPLIER[m[3]] ?? m[3]} · ${month} ${what}`;
  }
  const run = id.match(/^RUN-(\d{4}-\d{2}-\d{2})(-OC)?(?:\/(E-\d+))?/);
  if (run) return `Payroll ${date(run[1]).replace(/, \d{4}$/, "")}${run[2] ? " off-cycle" : ""}${run[3] ? ` · ${run[3]}` : ""}`;
  if (/^E-\d+$/.test(id)) return `Employee ${id}`;
  if (id.startsWith("MSG-")) return `Email ${id}`;
  return id;
}

export function caseTitle(c: { kind: string; objectIds: string[] }): string {
  const what = WHAT_HAPPENED[c.kind] ?? kindLabel(c.kind).toLowerCase();
  const subject = c.objectIds.find((o) => /^(VI|RUN|E-|CE)/.test(o)) ?? c.objectIds[0];
  const s = subjectLabel(subject);
  return `${s.split(" · ")[0]} — ${what}`;
}

export function requestTitle(r: { kind: string; payload: unknown }, caseInfo?: { kind: string; objectIds: string[] }): string {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const subject = String(p.invoiceId ?? p.runId ?? (Array.isArray(p.objectIds) ? p.objectIds[0] : "") ?? p.employeeId ?? "");
  const why = caseInfo ? `: ${WHAT_HAPPENED[caseInfo.kind] ?? kindLabel(caseInfo.kind).toLowerCase()}` : "";
  switch (r.kind) {
    case "payment":
      return `Pay ${subjectLabel(subject)}`;
    case "payment_hold":
      return `Hold payment — ${subjectLabel(subject).split(" · ")[0]}${why}`;
    case "debit_memo":
      return `Debit memo to ${subjectLabel(subject).split(" · ")[0]}${why}`;
    case "substitution_approval":
      return `Approve or reject part substitution — ${subjectLabel(subject).split(" · ")[0]}`;
    case "payroll_run_approval":
      return `Approve ${subjectLabel(subject)} (${Array.isArray(p.excluded) && p.excluded.length ? `${p.excluded.length} line${p.excluded.length > 1 ? "s" : ""} held` : "all lines"})`;
    case "payroll_line_hold":
      return `Hold paycheck — ${String(p.employeeId ?? "")}${why}`;
    case "hris_change":
      return `HR: ${String(p.change ?? "verify a change")} (${String(p.employeeId ?? "")})`;
    default:
      return requestLabel(r.kind);
  }
}

/** Audit actions as sentences. */
export function auditSentence(a: { actor: string; action: string; refs: string[]; detail: string }): string {
  const who = roleLabel(a.actor).replace(" (agent)", "");
  const subj = a.refs.find((r) => !/^(CASE|REQ)-/.test(r));
  const on = subj ? ` on ${subjectLabel(subj)}` : "";
  if (a.action === "open_case") return `${who} opened a case${on}`;
  if (a.action === "escalate") return `${who} escalated ${a.refs[0] ?? ""} ${a.detail.replace("to ", "to ")}`;
  if (a.action.startsWith("request:")) return `${who} requested: ${requestLabel(a.action.slice(8)).toLowerCase()} (${a.detail})`;
  if (a.action.startsWith("decision:")) return `${who} ${a.action.endsWith("approve") ? "approved" : "rejected"} ${a.refs[0]} — “${a.detail}”`;
  if (a.action === "learn:precedent") return `Learned from ${a.refs[2] ?? a.refs[1]}: ${a.detail}`;
  if (a.action === "learn:rule") return a.detail;
  if (a.action === "learn:proposed") return `Proposed rule ${a.refs[0]} from corrections: ${a.detail}`;
  if (a.action === "post") return `POSTED ${a.refs[0]} to ${a.detail}`;
  if (a.action.startsWith("denied:")) return `REFUSED: ${who} tried to ${a.action.slice(7)} ${a.refs[0]}; the gateway blocked it (${a.detail.replace(/^REFUSED by the gateway: /, "")})`;
  if (a.action === "log:info") return `${who} logged a routine item${on} (no escalation)`;
  if (a.action.startsWith("tool:")) return `${who} used ${a.action.slice(5).replaceAll("_", " ")}${a.detail !== "ok" ? ` — ${a.detail}` : ""}`;
  if (a.action === "ask_why") return `${who} asked why on ${a.refs[0]}: “${a.detail}”`;
  if (a.action === "answer_why") return `${who} answered on ${a.refs[0]}`;
  if (a.action.startsWith("rule:")) return `${who} set rule ${a.refs[0]} to ${a.action.slice(5).replace("_", " ")} — “${a.detail}”`;
  if (a.action.startsWith("intake:")) return `Live ${a.action.slice(7)} received: ${a.detail}`;
  if (a.action === "case_seen_again") return `${who} saw an open issue again (no duplicate case)`;
  return `${who}: ${a.action}`;
}
