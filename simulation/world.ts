// Generates the simulated company's Mar–Sep 2026 documents and the answer key
// for the problems planted in them. Pure and seeded: the same seed always
// produces the same world. Every amount comes from the deterministic engines,
// so a baseline document never disagrees with another by accident; each
// planted problem is applied in the same function that writes its key entry.

import { convert, type RateTable } from "@/lib/costing/fx";
import { loadEcbRates, loadHtsTable } from "@/lib/costing/reference";
import { type HtsTable, htsEntry } from "@/lib/costing/tariff";
import { loadBom, loadParts, loadSuppliers } from "@/lib/erp/master";
import type {
  BomLine,
  CaseKind,
  CertificateOfOrigin,
  Contract,
  CustomsEntry,
  InboxMessage,
  Invoice,
  InvoiceLine,
  ISODate,
  PackingSlip,
  Part,
  PeriodId,
  PO,
  ProductionPlanLine,
  Receipt,
  Supplier,
  VendorRecord,
} from "@/lib/erp/types";
import { UNREGISTERED_SUPPLIER } from "@/lib/erp/types";
import { type Currency, lineAmount, parseUnitPrice, pctOf } from "@/lib/money";

export const DEFAULT_SEED = 42;
export const SIM_WINDOW = { from: "2026-03-01", to: "2026-09-30" } as const;
export const MONTHS: PeriodId[] = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

const PLAN_UNITS: Record<PeriodId, number> = {
  "2026-03": 180,
  "2026-04": 200,
  "2026-05": 210,
  "2026-06": 200,
  "2026-07": 220,
  "2026-08": 200,
  "2026-09": 190,
};

/**
 * P07 motors are bought in bulk: safety stock in March, the 3,000-unit buy in
 * April (planted problem #2), nothing in May/June. Leaves ~8 weeks of cover
 * when the June export restriction (#11, Tier 2) lands.
 */
const P07_QTY: Record<PeriodId, number> = { "2026-03": 1_200, "2026-04": 3_000, "2026-05": 0, "2026-06": 0 };

const BROKER_FEE_USD_CENTS = 15_000;

type ContractSpec = { id: string; partId: string; supplierId: string; price: string; currency: Currency };
const CONTRACTS: ContractSpec[] = [
  { id: "C-01", partId: "P01", supplierId: "S-CAS", price: "185.00", currency: "USD" },
  { id: "C-02", partId: "P02", supplierId: "S-CAS", price: "9.50", currency: "USD" },
  { id: "C-03", partId: "P03", supplierId: "S-CAS", price: "24.00", currency: "USD" },
  { id: "C-04", partId: "P04", supplierId: "S-VIR", price: "185.00", currency: "USD" },
  { id: "C-05", partId: "P05", supplierId: "S-VIR", price: "42.00", currency: "USD" },
  { id: "C-06", partId: "P06", supplierId: "S-RDG", price: "210.00", currency: "USD" },
  { id: "C-07", partId: "P07", supplierId: "S-CAS", price: "11.80", currency: "USD" }, // backup source
  { id: "C-08", partId: "P08", supplierId: "S-RDG", price: "95.00", currency: "USD" },
  { id: "C-09", partId: "P09", supplierId: "S-RDG", price: "160.00", currency: "USD" },
  { id: "C-10", partId: "P10", supplierId: "S-HOS", price: "96000", currency: "JPY" },
  { id: "C-11", partId: "P11", supplierId: "S-HOS", price: "18500", currency: "JPY" },
  { id: "C-12", partId: "P07", supplierId: "S-ATL", price: "11.00", currency: "USD" },
  { id: "C-13", partId: "P12", supplierId: "S-NW", price: "11.00", currency: "USD" },
  { id: "C-14", partId: "P13", supplierId: "S-NW", price: "3.20", currency: "USD" },
  { id: "C-15", partId: "P14", supplierId: "S-ATL", price: "0.035", currency: "USD" },
  { id: "C-16", partId: "P15", supplierId: "S-NW", price: "18.00", currency: "USD" },
];

const INVOICE_NO_START: Record<string, [prefix: string, start: number]> = {
  "S-NW": ["NW-", 1038],
  "S-ATL": ["INV-", 2040],
  "S-VIR": ["VA26-", 311],
  "S-HOS": ["HO-", 7710],
  "S-RDG": ["RDG-", 5510],
  "S-CAS": ["CC-", 4402],
};

const VENDORS: VendorRecord[] = [
  { supplierId: "S-NW", legalName: "Northwind Components, Inc.", remitTo: { id: "VM-NW", bankName: "Pacific Commerce Bank", accountLast4: "4821", routingLast4: "0072" }, verifiedOn: "2025-11-04", verifiedBy: "controller" },
  { supplierId: "S-ATL", legalName: "Atlas Motors S.A. de C.V.", remitTo: { id: "VM-ATL", bankName: "Banco del Norte (USD account)", accountLast4: "9930", routingLast4: "1186" }, verifiedOn: "2025-09-18", verifiedBy: "controller" },
  { supplierId: "S-VIR", legalName: "Vireo Avionics Co., Ltd.", remitTo: { id: "VM-VIR", bankName: "Formosa Trade Bank (USD account)", accountLast4: "5507", routingLast4: "3301" }, verifiedOn: "2025-10-02", verifiedBy: "controller" },
  { supplierId: "S-HOS", legalName: "Hoshi Optics K.K.", remitTo: { id: "VM-HOS", bankName: "Kansai Industrial Bank", accountLast4: "2246", routingLast4: "0419" }, verifiedOn: "2025-08-27", verifiedBy: "controller" },
  { supplierId: "S-RDG", legalName: "Ridgeline Power & Radio LLC", remitTo: { id: "VM-RDG", bankName: "Front Range Savings", accountLast4: "7314", routingLast4: "0951" }, verifiedOn: "2026-01-12", verifiedBy: "controller" },
  { supplierId: "S-CAS", legalName: "Cascade Composites & Motion, Inc.", remitTo: { id: "VM-CAS", bankName: "Columbia Valley Bank", accountLast4: "6650", routingLast4: "0233" }, verifiedOn: "2025-12-01", verifiedBy: "controller" },
];

// ---------------------------------------------------------------- types ----

export type AnswerKeyEntry = {
  id: string;
  problem: number;
  title: string;
  kind: CaseKind;
  /** the object a correct case must cite */
  objectId: string;
  relatedIds: string[];
  period: PeriodId;
  supplierId: string;
  partId?: string;
  impactUSDCents: number;
  expectedHandling: string;
  /** other finding kinds the same object legitimately raises */
  secondaryKinds?: CaseKind[];
  note?: string;
};

export type AnswerKey = {
  seed: number;
  window: typeof SIM_WINDOW;
  entries: AnswerKeyEntry[];
  /** suppliers whose documents must produce zero findings */
  cleanSuppliers: string[];
  /** CLAUDE.md §11 problems not planted yet (Tier 2) */
  deferredProblems: number[];
};

export type World = {
  seed: number;
  window: typeof SIM_WINDOW;
  productionPlan: ProductionPlanLine[];
  contracts: Contract[];
  vendors: VendorRecord[];
  pos: PO[];
  receipts: Receipt[];
  packingSlips: PackingSlip[];
  invoices: Invoice[];
  certificates: CertificateOfOrigin[];
  customsEntries: CustomsEntry[];
  bank: { account: string; openingBalanceCents: number; asOf: ISODate; transactions: never[] };
  inbox: InboxMessage[];
  answerKey: AnswerKey;
};

// ---------------------------------------------------------------- helpers ----

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Rng = { int: (min: number, max: number) => number };
function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return { int: (min, max) => min + Math.floor(next() * (max - min + 1)) };
}

function addDays(date: ISODate, n: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isWeekend = (date: ISODate) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
function onOrAfterBusinessDay(date: ISODate): ISODate {
  let d = date;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
function addBusinessDays(date: ISODate, n: number): ISODate {
  let d = date;
  for (let i = 0; i < n; i++) d = onOrAfterBusinessDay(addDays(d, 1));
  return d;
}
const dayOf = (period: PeriodId, day: number) => `${period}-${String(day).padStart(2, "0")}`;
const yymm = (period: PeriodId) => period.slice(2, 4) + period.slice(5, 7);
const short = (supplierId: string) => supplierId.replace(/^S-/, "");

const COVERED_CLASSES = new Set(["flight_controller", "radio_datalink", "camera", "gimbal"]);

type Ctx = {
  rng: Rng;
  fx: RateTable;
  hts: HtsTable;
  parts: Record<string, Part>;
  suppliers: Record<string, Supplier>;
  bom: Record<string, BomLine>;
  contracts: Contract[];
};

function contractFor(ctx: Ctx, supplierId: string, partId: string): Contract {
  const c = ctx.contracts.find((k) => k.supplierId === supplierId && k.partId === partId);
  if (!c) throw new Error(`no contract for ${supplierId} × ${partId}`);
  return c;
}

function invoiceLine(ctx: Ctx, supplier: Supplier, partId: string, qty: number, unitPriceE4: number): InvoiceLine {
  const part = ctx.parts[partId];
  return {
    partId,
    description: part.name,
    qty,
    unitPriceE4,
    amountMinor: lineAmount(qty, unitPriceE4, supplier.currency),
    countryOfOrigin: supplier.country,
    manufacturerPartNo: ctx.bom[partId].approvedMpn,
  };
}

/** Recomputes line amounts and the total after a plant edits quantities or prices. */
function reprice(inv: Invoice): void {
  for (const l of inv.lines) l.amountMinor = lineAmount(l.qty, l.unitPriceE4, inv.currency);
  inv.totalMinor = inv.lines.reduce((a, l) => a + l.amountMinor, 0);
}

function usdOf(ctx: Ctx, amountMinor: number, ccy: Currency, date: ISODate): number {
  return convert(ctx.fx, amountMinor, ccy, "USD", date).amountMinor;
}

// ---------------------------------------------------------------- world ----

type MonthDocs = {
  period: PeriodId;
  supplier: Supplier;
  po: PO;
  receipt: Receipt;
  slip: PackingSlip;
  invoice: Invoice;
  certs: CertificateOfOrigin[];
};

export function generate(seed: number = DEFAULT_SEED): World {
  const parts = Object.fromEntries(loadParts().map((p) => [p.id, p]));
  const suppliers = Object.fromEntries(loadSuppliers().map((s) => [s.id, s]));
  const bom = Object.fromEntries(loadBom().map((b) => [b.partId, b]));
  const contracts: Contract[] = CONTRACTS.map((c) => ({
    id: c.id,
    supplierId: c.supplierId,
    partId: c.partId,
    currency: c.currency,
    prices: [{ unitPriceE4: parseUnitPrice(c.price), validFrom: "2026-01-01", validTo: "2026-12-31", clauseRef: `${c.id} §4.2` }],
    incoterm: suppliers[c.supplierId].country === "US" ? "DAP" : "FCA",
    leadTimeDays: suppliers[c.supplierId].country === "US" ? 14 : 28,
  }));
  const ctx: Ctx = { rng: makeRng(seed), fx: loadEcbRates(), hts: loadHtsTable(), parts, suppliers, bom, contracts };
  const invoiceSeq: Record<string, number> = Object.fromEntries(Object.entries(INVOICE_NO_START).map(([s, [, n]]) => [s, n]));
  const nextInvoiceNo = (supplierId: string) => `${INVOICE_NO_START[supplierId][0]}${invoiceSeq[supplierId]++}`;

  const productionPlan: ProductionPlanLine[] = MONTHS.map((period) => ({ period, productId: "K2", units: PLAN_UNITS[period] }));

  // Baseline: one PO per supplier per month for that month's build, from the primary source.
  const months: MonthDocs[] = [];
  for (const period of MONTHS) {
    for (const supplier of Object.values(suppliers)) {
      const lines = Object.values(parts)
        .filter((p) => p.approvedSuppliers[0] === supplier.id)
        .map((p) => ({ part: p, qty: p.id === "P07" && period in P07_QTY ? P07_QTY[period] : PLAN_UNITS[period] * bom[p.id].qtyPer }))
        .filter((l) => l.qty > 0);
      if (lines.length === 0) continue;

      const imported = supplier.country !== "US";
      const tag = `${yymm(period)}-${short(supplier.id)}`;
      const poDate = onOrAfterBusinessDay(dayOf(period, 1));
      const receiptDate = onOrAfterBusinessDay(dayOf(period, imported ? ctx.rng.int(15, 21) : ctx.rng.int(10, 16)));
      const invoiceDate = imported ? addDays(receiptDate, -ctx.rng.int(6, 9)) : addBusinessDays(receiptDate, ctx.rng.int(1, 3));

      const po: PO = {
        id: `PO-${tag}`,
        supplierId: supplier.id,
        currency: supplier.currency,
        date: poDate,
        status: "open",
        lines: lines.map((l) => ({ partId: l.part.id, qty: l.qty, unitPriceE4: contractFor(ctx, supplier.id, l.part.id).prices[0].unitPriceE4 })),
      };
      const slip: PackingSlip = {
        id: `PS-${tag}`,
        poId: po.id,
        supplierId: supplier.id,
        date: imported ? invoiceDate : addDays(receiptDate, -1),
        lines: lines.map((l) => ({ partId: l.part.id, description: l.part.name, qty: l.qty, manufacturerPartNo: bom[l.part.id].approvedMpn })),
        sourceFile: `simulated:${`PS-${tag}`}`,
      };
      const receipt: Receipt = {
        id: `R-${tag}`,
        poId: po.id,
        date: receiptDate,
        enteredBy: "receiving",
        packingSlipRef: slip.id,
        lines: lines.map((l) => ({ partId: l.part.id, qty: l.qty, lot: `LOT-${tag}-${l.part.id}` })),
      };
      const invLines = po.lines.map((l) => invoiceLine(ctx, supplier, l.partId, l.qty, l.unitPriceE4));
      const invoice: Invoice = {
        id: `VI-${tag}`,
        invoiceNo: nextInvoiceNo(supplier.id),
        supplierId: supplier.id,
        supplierName: VENDORS.find((v) => v.supplierId === supplier.id)!.legalName,
        poId: po.id,
        date: invoiceDate,
        currency: supplier.currency,
        lines: invLines,
        totalMinor: invLines.reduce((a, l) => a + l.amountMinor, 0),
        remitTo: supplier.remitToId,
        sourceFile: `simulated:VI-${tag}`,
        simulated: true,
      };
      const certs: CertificateOfOrigin[] = invLines
        .filter((l) => COVERED_CLASSES.has(parts[l.partId!].componentClass))
        .map((l) => ({
          id: `COO-${tag}-${l.partId}`,
          invoiceId: invoice.id,
          partId: l.partId!,
          manufacturer: VENDORS.find((v) => v.supplierId === supplier.id)!.legalName,
          manufacturerPartNo: l.manufacturerPartNo,
          countryOfOrigin: supplier.country,
          sourceFile: `simulated:COO-${tag}-${l.partId}`,
        }));
      months.push({ period, supplier, po, receipt, slip, invoice, certs });
    }
  }

  const find = (period: PeriodId, supplierId: string) => {
    const m = months.find((x) => x.period === period && x.supplier.id === supplierId);
    if (!m) throw new Error(`no ${supplierId} documents in ${period}`);
    return m;
  };
  const extraInvoices: Invoice[] = [];
  const extraCerts: CertificateOfOrigin[] = [];
  /** customs HTS overrides: invoice id → line index → HTS the broker entered */
  const brokerHts: Record<string, Record<number, string>> = {};
  const entries: AnswerKeyEntry[] = [];
  const afterCustoms: ((customs: CustomsEntry[]) => void)[] = [];

  // #1 Noncompliant substitution (headline): Vireo ships a cheaper flight
  // controller from a restricted origin under a different MPN.
  {
    const m = find("2026-04", "S-VIR");
    const idx = m.invoice.lines.findIndex((l) => l.partId === "P04");
    const line = m.invoice.lines[idx];
    line.unitPriceE4 = parseUnitPrice("162.00");
    line.manufacturerPartNo = "VFC-2-LC";
    line.description = "Flight controller FC-2 Lite (functional equivalent of VFC-2)";
    reprice(m.invoice);
    const slipLine = m.slip.lines.find((l) => l.partId === "P04")!;
    slipLine.manufacturerPartNo = "VFC-2-LC";
    slipLine.description = line.description;
    const cert = m.certs.find((c) => c.partId === "P04")!;
    cert.manufacturer = "Lianchuang Electronics Co., Ltd. (Shenzhen)";
    cert.manufacturerPartNo = "VFC-2-LC";
    cert.countryOfOrigin = "CN";
    entries.push({
      id: "AK-01",
      problem: 1,
      title: "Substituted flight controller with restricted origin",
      kind: "noncompliant_substitution",
      objectId: m.invoice.id,
      relatedIds: [cert.id, m.slip.id, m.po.id, m.receipt.id, "P04", "KESTREL-UAS-1"],
      period: m.period,
      supplierId: "S-VIR",
      partId: "P04",
      impactUSDCents: line.amountMinor,
      expectedHandling:
        "Payment hold on the line; noncompliant_substitution case; required approvers engineering (Mei) + controller (Dana); government-contract eligibility flagged. Not a price saving.",
      note: "Three-way match passes (price is below contract: info only); only the compliance check catches it. Invoice line says TW, certificate says CN — certificate is the system of record for origin. Expected duty on the customs entry is column 1 only until the CN × 8537.10.91 Chapter 99 entry is verified.",
    });
  }

  // #2 Price vs contract: Atlas invoices $14.00 vs C-12 §4.2 $11.00 on 3,000 motors.
  {
    const m = find("2026-04", "S-ATL");
    const line = m.invoice.lines.find((l) => l.partId === "P07")!;
    const contractPrice = line.unitPriceE4;
    line.unitPriceE4 = parseUnitPrice("14.00");
    reprice(m.invoice);
    entries.push({
      id: "AK-02",
      problem: 2,
      title: "Invoice price above contract (C-12 §4.2)",
      kind: "price_variance_vs_contract",
      objectId: m.invoice.id,
      relatedIds: ["C-12", m.po.id, m.receipt.id, "P07"],
      period: m.period,
      supplierId: "S-ATL",
      partId: "P07",
      impactUSDCents: lineAmount(line.qty, line.unitPriceE4 - contractPrice, "USD"),
      expectedHandling: "Hold the invoice; defend with C-12 §4.2; request a corrected invoice or a debit memo for the difference.",
    });
  }

  // #4 Quantity mismatch: Luis enters 480 propeller sets; slip and invoice say 400.
  {
    const m = find("2026-04", "S-CAS");
    const rl = m.receipt.lines.find((l) => l.partId === "P02")!;
    const slipQty = m.slip.lines.find((l) => l.partId === "P02")!.qty;
    rl.qty = 480;
    entries.push({
      id: "AK-04",
      problem: 4,
      title: "Receipt quantity disagrees with packing slip and invoice",
      kind: "qty_mismatch",
      objectId: m.invoice.id,
      relatedIds: [m.receipt.id, m.slip.id, m.po.id, "P02"],
      period: m.period,
      supplierId: "S-CAS",
      partId: "P02",
      impactUSDCents: lineAmount(rl.qty - slipQty, contractFor(ctx, "S-CAS", "P02").prices[0].unitPriceE4, "USD"),
      expectedHandling: "Hold; packing slip and invoice agree (400), so the dock receipt is the outlier — ask receiving (Luis) to recount before paying. Impact = inventory overstated by 80 units.",
    });
  }

  // #5 Duplicate invoice: Ridgeline re-sends June's invoice a week later with a suffix.
  {
    const m = find("2026-06", "S-RDG");
    const resend: Invoice = structuredClone(m.invoice);
    resend.id = `${m.invoice.id}-2`;
    resend.invoiceNo = `${m.invoice.invoiceNo}-A`;
    resend.date = addDays(m.invoice.date, 7);
    resend.sourceFile = `simulated:${resend.id}`;
    extraInvoices.push(resend);
    for (const c of m.certs) extraCerts.push({ ...c, id: `${c.id}-2`, invoiceId: resend.id, sourceFile: `simulated:${c.id}-2` });
    entries.push({
      id: "AK-05",
      problem: 5,
      title: "Duplicate invoice re-sent with a suffixed number",
      kind: "duplicate_invoice",
      objectId: resend.id,
      relatedIds: [m.invoice.id, m.po.id],
      period: resend.date.slice(0, 7),
      supplierId: "S-RDG",
      impactUSDCents: resend.totalMinor,
      expectedHandling: "Block payment of the re-send; cite the original invoice; no new payment request.",
      secondaryKinds: ["qty_mismatch"],
      note: "The re-send also fails three-way match (nothing received awaits invoicing).",
    });
  }

  // #6 Duty overcharge: the broker's system classifies Atlas's M3 screws as
  // ≥ 6 mm (7318.15.80, 8.5%) on every entry from June.
  {
    const affected = months.filter((m) => m.supplier.id === "S-ATL" && m.period >= "2026-06");
    for (const m of affected) {
      const idx = m.invoice.lines.findIndex((l) => l.partId === "P14");
      (brokerHts[m.invoice.id] ??= {})[idx] = "7318.15.80";
    }
    afterCustoms.push((customs) => {
      affected.forEach((m, i) => {
        const entry = customs.find((c) => c.invoiceId === m.invoice.id)!;
        const el = entry.lines.find((l) => l.hts === "7318.15.80")!;
        const expected = pctOf(el.valueUSDCents, htsEntry(ctx.hts, "7318.15.60").generalRateBp);
        const occurrence = i + 1;
        entries.push({
          id: `AK-06-${occurrence}`,
          problem: 6,
          title: `Duty overcharge: P14 entered as 7318.15.80 (occurrence ${occurrence})`,
          kind: "duty_overcharge",
          objectId: entry.id,
          relatedIds: [m.invoice.id, "P14", "7318.15.60", "7318.15.80"],
          period: entry.date.slice(0, 7),
          supplierId: "S-ATL",
          partId: "P14",
          impactUSDCents: el.dutyUSDCents - expected,
          expectedHandling:
            occurrence < 3
              ? "Below $250 materiality: log as info, no case yet."
              : "Recurring 3+ times: open a duty_overcharge case covering every affected entry; ask the broker for post-summary corrections.",
        });
      });
    });
  }

  // #13a Unknown supplier: an invoice from a name that isn't in the vendor master.
  {
    const date = "2026-07-14";
    const inv: Invoice = {
      id: "VI-2607-UNREG",
      invoiceNo: "AUS-00981",
      supplierId: UNREGISTERED_SUPPLIER,
      supplierName: "Apex UAV Supply LLC",
      date,
      currency: "USD",
      lines: [{ description: "Rotor arm set — expedited", qty: 10, unitPriceE4: parseUnitPrice("185.00"), amountMinor: lineAmount(10, parseUnitPrice("185.00"), "USD") }],
      totalMinor: lineAmount(10, parseUnitPrice("185.00"), "USD"),
      sourceFile: "simulated:VI-2607-UNREG",
      simulated: true,
    };
    extraInvoices.push(inv);
    entries.push({
      id: "AK-13a",
      problem: 13,
      title: "Invoice from a supplier not in the vendor master",
      kind: "unknown_supplier",
      objectId: inv.id,
      relatedIds: [],
      period: "2026-07",
      supplierId: UNREGISTERED_SUPPLIER,
      impactUSDCents: inv.totalMinor,
      expectedHandling: "Escalate to the controller; no PO, no vendor-master record — do not pay or create a vendor.",
    });
  }

  // #13b Missing certificate of origin for a covered component (camera).
  {
    const m = find("2026-07", "S-HOS");
    const cert = m.certs.find((c) => c.partId === "P10")!;
    m.certs = m.certs.filter((c) => c !== cert);
    const line = m.invoice.lines.find((l) => l.partId === "P10")!;
    entries.push({
      id: "AK-13b",
      problem: 13,
      title: "No certificate of origin for a covered component",
      kind: "missing_document",
      objectId: m.invoice.id,
      relatedIds: ["P10", m.po.id, m.receipt.id],
      period: m.period,
      supplierId: "S-HOS",
      partId: "P10",
      impactUSDCents: usdOf(ctx, line.amountMinor, m.invoice.currency, m.invoice.date),
      expectedHandling: "Compliance status unknown: hold the P10 line and request the certificate from the supplier; escalate rather than assume compliant.",
    });
  }

  // ---- customs entries for every import invoice (after plants) ----
  const invoices = [...months.map((m) => m.invoice), ...extraInvoices].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const certificates = [...months.flatMap((m) => m.certs), ...extraCerts].sort((a, b) => a.id.localeCompare(b.id));
  const customsEntries: CustomsEntry[] = months
    .filter((m) => m.supplier.country !== "US")
    .map((m) => {
      const lines = m.invoice.lines.map((l, i) => {
        const hts = brokerHts[m.invoice.id]?.[i] ?? parts[l.partId!].hts;
        const rateBp = htsEntry(ctx.hts, hts).generalRateBp;
        const valueUSDCents = usdOf(ctx, l.amountMinor, m.invoice.currency, m.invoice.date);
        const origin = certificates.find((c) => c.invoiceId === m.invoice.id && c.partId === l.partId)?.countryOfOrigin ?? m.supplier.country;
        return { invoiceLineIndex: i, hts, countryOfOrigin: origin, valueUSDCents, dutyRateBp: rateBp, dutyUSDCents: pctOf(valueUSDCents, rateBp) };
      });
      const duty = lines.reduce((a, l) => a + l.dutyUSDCents, 0);
      return { id: `CE-${yymm(m.period)}-${short(m.supplier.id)}`, invoiceId: m.invoice.id, date: addDays(m.receipt.date, -1), lines, brokerFeeUSDCents: BROKER_FEE_USD_CENTS, totalUSDCents: duty + BROKER_FEE_USD_CENTS };
    });
  for (const f of afterCustoms) f(customsEntries);

  const byDateThenId = <T extends { date: string; id: string }>(xs: T[]) => xs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    seed,
    window: SIM_WINDOW,
    productionPlan,
    contracts,
    vendors: VENDORS,
    pos: byDateThenId(months.map((m) => m.po)),
    receipts: byDateThenId(months.map((m) => m.receipt)),
    packingSlips: byDateThenId(months.map((m) => m.slip)),
    invoices,
    certificates,
    customsEntries: byDateThenId(customsEntries),
    bank: { account: "1000", openingBalanceCents: 250_000_000, asOf: "2026-02-28", transactions: [] },
    inbox: [],
    answerKey: {
      seed,
      window: SIM_WINDOW,
      entries: entries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
      cleanSuppliers: ["S-NW"],
      deferredProblems: [3, 7, 8, 9, 10, 11],
    },
  };
}

/** File layout under data/ (CLAUDE.md §5). Keys are paths relative to the repo root. */
export function serializeWorld(w: World): Record<string, string> {
  const doc = (items: unknown) =>
    JSON.stringify({ generatedBy: "scripts/generate.ts", seed: w.seed, simulated: true, items }, null, 2) + "\n";
  return {
    "data/erp/production-plan.json": doc(w.productionPlan),
    "data/erp/contracts.json": doc(w.contracts),
    "data/erp/pos.json": doc(w.pos),
    "data/receipts/receipts.json": doc(w.receipts),
    "data/docs/packing-slips.json": doc(w.packingSlips),
    "data/docs/invoices.json": doc(w.invoices),
    "data/docs/certificates.json": doc(w.certificates),
    "data/customs/entries.json": doc(w.customsEntries),
    "data/vendors.json": doc(w.vendors),
    "data/bank/bank.json": doc(w.bank),
    "data/inbox/messages.json": doc(w.inbox),
    "data/answer_key.json": JSON.stringify(w.answerKey, null, 2) + "\n",
  };
}
