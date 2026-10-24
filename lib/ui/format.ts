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
