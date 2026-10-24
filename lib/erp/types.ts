// Core company model (CLAUDE.md §6). Money fields follow lib/money.ts:
// *Minor / *Cents = integer minor units, *E4 = ten-thousandths, *Bp = basis points.
// Dates are ISO "YYYY-MM-DD"; periods are "YYYY-MM".

import type { Currency } from "@/lib/money";

export type ISODate = string;
export type PeriodId = string;

export type Role =
  | "buyer"
  | "ap_clerk"
  | "payroll_specialist"
  | "staff_accountant"
  | "inventory_accountant"
  | "controller"
  | "hr"
  | "procurement_mgr"
  | "engineering"
  | "receiving"
  | "system";

export type CustomerType = "federal" | "state_local" | "commercial";

export type Product = {
  id: string;
  name: string;
  /** Customer types this product is sold to; drives compliance applicability. */
  customerTypes: CustomerType[];
};

export type BomLine = {
  productId: string;
  partId: string;
  qtyPer: number;
  /** Manufacturer part number engineering approved for this BOM line. */
  approvedMpn: string;
};

export type Part = {
  id: string;
  name: string;
  hts: string;
  /** Document facts that decide the HTS subheading, e.g. "M3 thread (3 mm) < 6 mm". */
  htsBasis?: string;
  componentClass: string;
  standardCostE4: number;
  approvedSuppliers: string[];
  criticality: "critical" | "standard";
};

export type Supplier = {
  id: string;
  name: string;
  country: string;
  currency: Currency;
  publicTicker?: string;
  cik?: string;
  remitToId: string;
};

export type ContractPrice = {
  unitPriceE4: number;
  validFrom: ISODate;
  validTo: ISODate;
  clauseRef: string;
};

export type Contract = {
  id: string;
  supplierId: string;
  partId: string;
  currency: Currency;
  /** Price schedule, original terms first; amendments add later windows. */
  prices: ContractPrice[];
  incoterm: string;
  leadTimeDays: number;
};

export type POLine = { partId: string; qty: number; unitPriceE4: number };

export type PO = {
  id: string;
  supplierId: string;
  currency: Currency;
  lines: POLine[];
  date: ISODate;
  status: "pending_approval" | "open" | "partially_received" | "received" | "closed";
};

export type Receipt = {
  id: string;
  poId: string;
  date: ISODate;
  lines: { partId: string; qty: number; lot: string }[];
  enteredBy: "receiving";
  packingSlipRef?: string;
};

export type PackingSlip = {
  id: string;
  poId: string;
  supplierId: string;
  date: ISODate;
  lines: { partId?: string; description: string; qty: number; manufacturerPartNo?: string }[];
  sourceFile: string;
};

export type InvoiceLine = {
  partId?: string;
  description: string;
  qty: number;
  unitPriceE4: number;
  amountMinor: number;
  countryOfOrigin?: string;
  manufacturerPartNo?: string;
};

export type Invoice = {
  id: string;
  /** Supplier's own invoice number as printed. */
  invoiceNo: string;
  /** Vendor-master id, or UNREGISTERED_SUPPLIER when the name matches no vendor. */
  supplierId: string;
  /** Supplier name as printed on the invoice. */
  supplierName: string;
  poId?: string;
  date: ISODate;
  currency: Currency;
  lines: InvoiceLine[];
  totalMinor: number;
  remitTo?: string;
  sourceFile: string;
  simulated: true;
};

export type CertificateOfOrigin = {
  id: string;
  invoiceId: string;
  partId: string;
  manufacturer: string;
  manufacturerPartNo?: string;
  countryOfOrigin: string;
  sourceFile: string;
};

export type CustomsEntryLine = {
  invoiceLineIndex: number;
  hts: string;
  countryOfOrigin: string;
  valueUSDCents: number;
  dutyRateBp: number;
  dutyUSDCents: number;
};

export type CustomsEntry = {
  id: string;
  invoiceId: string;
  date: ISODate;
  lines: CustomsEntryLine[];
  brokerFeeUSDCents: number;
  totalUSDCents: number;
};

export type CompliancePolicyRule = {
  id: string;
  ruleRef: string;
  componentClasses: string[];
  restrictedOrigins: string[];
  restrictedManufacturerCategories: string[];
};

export type CompliancePolicy = {
  id: string;
  label: string;
  disclaimer: string;
  appliesToCustomerTypes: CustomerType[];
  rules: CompliancePolicyRule[];
};

export type ComplianceRecord = {
  partId: string;
  manufacturer: string;
  manufacturerPartNo: string;
  countryOfOrigin: string;
  manufacturerCategories: string[];
  source: string;
};

export type CalcStep = {
  label: string;
  inputs: Record<string, number | string>;
  result: number;
  ruleRef: string;
};

export type CaseKind =
  | "price_variance_vs_contract"
  | "qty_mismatch"
  | "duplicate_invoice"
  | "noncompliant_substitution"
  | "duty_overcharge"
  | "remittance_change_unverified"
  | "export_restriction_exposure"
  | "defect_return"
  | "fx_variance"
  | "grni_accrual"
  | "unknown_supplier"
  | "missing_document"
  | "source_disagreement"
  // payroll
  | "ghost_employee"
  | "terminated_paid"
  | "pay_rate_mismatch"
  | "overtime_error"
  | "payroll_tax_error"
  | "deduction_limit"
  | "direct_deposit_change_unverified"
  | "state_registration_missing"
  | "duplicate_payment"
  | "hours_mismatch";

export type CaseStatus = "open" | "awaiting_approval" | "on_hold" | "resolved" | "dismissed";

export type Case = {
  id: string;
  kind: CaseKind;
  openedPeriod: PeriodId;
  status: CaseStatus;
  impactUSDCents: number | null;
  confidence: number;
  evidence: { objects: string[]; calcSteps?: CalcStep[]; quotes?: string[]; sources?: string[] };
  history: { at: ISODate; actor: Role; event: string; refs: string[] }[];
};

export type RequestKind =
  | "po"
  | "payment"
  | "payment_hold"
  | "payroll_line_hold"
  | "payroll_run_approval"
  | "hris_change"
  | "debit_memo"
  | "journal_entry"
  | "supplier_switch"
  | "substitution_approval"
  | "vendor_change";

export type Approval = { by: Role; decision: "approve" | "reject"; reason: string; at: ISODate };

export type Request<P = unknown> = {
  id: string;
  kind: RequestKind;
  requestedBy: Role;
  requiredApprovers: Role[];
  approvals: Approval[];
  amountUSDCents?: number;
  caseId?: string;
  payload: P;
  status: "pending" | "approved" | "rejected" | "expired";
};

export const UNREGISTERED_SUPPLIER = "UNREGISTERED";

/** Vendor master: the system of record for where money goes. */
export type VendorRecord = {
  supplierId: string;
  legalName: string;
  remitTo: { id: string; bankName: string; accountLast4: string; routingLast4: string };
  verifiedOn: ISODate;
  verifiedBy: string;
};

export type InboxMessage = {
  id: string;
  date: ISODate;
  from: string;
  to: string;
  subject: string;
  body: string;
  refs: string[];
};

export type ProductionPlanLine = { period: PeriodId; productId: string; units: number };

// ---- General ledger ----

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type LedgerAccount = { code: string; name: string; type: AccountType };

export type JournalLine = {
  account: string;
  debitCents: number;
  creditCents: number;
  memo?: string;
};

export type JournalEntry = {
  id: string;
  period: PeriodId;
  date: ISODate;
  memo: string;
  lines: JournalLine[];
  /** Company-graph object ids this entry is based on. */
  sourceRefs: string[];
  requestId: string;
  reversesId?: string;
  postedBy: Role;
};

export type Period = { id: PeriodId; status: "open" | "locked" };
