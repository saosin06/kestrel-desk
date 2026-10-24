// Three-way match: PO ↔ receipt ↔ invoice, plus the contract price in force on
// the invoice date. Deterministic; returns line-level diffs, each naming the
// rule applied and the system of record for the fact in question.

import { convert, type RateTable } from "@/lib/costing/fx";
import { type Currency, exponentOf, lineAmount } from "@/lib/money";
import type { Contract, ContractPrice, Invoice, ISODate, PackingSlip, PO, Receipt } from "./types";

/** Price tolerance: the larger of 1% of the expected price or $0.05/unit. */
export const PRICE_TOLERANCE_PCT = 1;
export const PRICE_TOLERANCE_USD_CENTS = 5;
export const TOLERANCE_RULE = "Three-way match tolerance: larger of ±1% or $0.05/unit (CLAUDE.md §9)";

export type DiffKind =
  | "supplier_mismatch"
  | "currency_mismatch"
  | "total_mismatch"
  | "line_amount_mismatch"
  | "unmatched_line"
  | "no_receipt"
  | "qty_mismatch"
  | "over_po"
  | "price_over_tolerance"
  | "contract_price_missing"
  | "favorable_price"
  | "po_price_differs_from_contract";

export type Diff = {
  kind: DiffKind;
  severity: "hold" | "info";
  lineIndex?: number;
  partId?: string;
  expected: number | string;
  actual: number | string;
  /** money impact in invoice-currency minor units, where one applies */
  deltaMinor?: number;
  tolerance?: string;
  ruleRef: string;
  systemOfRecord: string;
  /** for quantity disagreements: which source is the outlier, if the others agree */
  suspect?: "receipt" | "invoice" | "packing_slip";
  note: string;
};

export type MatchInput = {
  po: PO;
  /** receipts against this PO */
  receipts: readonly Receipt[];
  packingSlips: readonly PackingSlip[];
  invoice: Invoice;
  /** invoices already accepted against this PO */
  priorInvoices: readonly Invoice[];
  /** contracts for this supplier (any part) */
  contracts: readonly Contract[];
  /** needed to express the $0.05 tolerance in a non-USD invoice currency */
  fx?: RateTable;
};

export type MatchResult = {
  invoiceId: string;
  poId: string;
  status: "match" | "hold";
  diffs: Diff[];
};

export function priceInForce(contract: Contract, date: ISODate): ContractPrice | undefined {
  return contract.prices.find((p) => p.validFrom <= date && date <= p.validTo);
}

/** $0.05 expressed in ten-thousandths of the invoice currency. */
function absToleranceE4(ccy: Currency, date: ISODate, fx?: RateTable): number {
  if (ccy === "USD") return PRICE_TOLERANCE_USD_CENTS * 100;
  if (!fx) throw new Error(`need FX rates to express the $0.05 tolerance in ${ccy}`);
  const minor = convert(fx, PRICE_TOLERANCE_USD_CENTS, "USD", ccy, date).amountMinor;
  return minor * 10 ** (4 - exponentOf(ccy));
}

function withinTolerance(diffE4: number, expectedE4: number, absTolE4: number): boolean {
  const d = Math.abs(diffE4);
  // exact integer comparison: d ≤ abs, or d ≤ 1% of expected
  return d <= absTolE4 || d * 100 <= expectedE4 * PRICE_TOLERANCE_PCT;
}

const sumQty = (lines: readonly { partId?: string; qty: number }[], partId: string) =>
  lines.filter((l) => l.partId === partId).reduce((a, l) => a + l.qty, 0);

export function threeWayMatch(input: MatchInput): MatchResult {
  const { po, invoice } = input;
  const diffs: Diff[] = [];
  const hold = (d: Omit<Diff, "severity">) => diffs.push({ ...d, severity: "hold" });
  const info = (d: Omit<Diff, "severity">) => diffs.push({ ...d, severity: "info" });

  // ---- header ----
  if (invoice.supplierId !== po.supplierId) {
    hold({
      kind: "supplier_mismatch",
      expected: po.supplierId,
      actual: invoice.supplierId,
      ruleRef: `${po.id} supplier`,
      systemOfRecord: "ERP core (PO)",
      note: "invoice supplier differs from the PO supplier",
    });
  }
  if (invoice.currency !== po.currency) {
    hold({
      kind: "currency_mismatch",
      expected: po.currency,
      actual: invoice.currency,
      ruleRef: `${po.id} currency`,
      systemOfRecord: "ERP core (PO)",
      note: "invoice currency differs from the PO currency",
    });
  }
  const lineSum = invoice.lines.reduce((a, l) => a + l.amountMinor, 0);
  if (lineSum !== invoice.totalMinor) {
    hold({
      kind: "total_mismatch",
      expected: lineSum,
      actual: invoice.totalMinor,
      deltaMinor: invoice.totalMinor - lineSum,
      ruleRef: "Invoice arithmetic: total = Σ line amounts",
      systemOfRecord: "supplier invoice",
      note: "invoice total does not equal the sum of its lines",
    });
  }

  // Prices in different currencies aren't comparable; the currency hold covers it.
  const absTol = invoice.currency === po.currency ? absToleranceE4(invoice.currency, invoice.date, input.fx) : null;
  const slipLines = input.packingSlips.filter((s) => s.poId === po.id).flatMap((s) => s.lines);
  const receiptLines = input.receipts.filter((r) => r.poId === po.id).flatMap((r) => r.lines);
  const priorLines = input.priorInvoices.filter((i) => i.id !== invoice.id).flatMap((i) => i.lines);

  invoice.lines.forEach((line, lineIndex) => {
    const at = { lineIndex, partId: line.partId };

    const computed = lineAmount(line.qty, line.unitPriceE4, invoice.currency);
    if (computed !== line.amountMinor) {
      hold({
        ...at,
        kind: "line_amount_mismatch",
        expected: computed,
        actual: line.amountMinor,
        deltaMinor: line.amountMinor - computed,
        ruleRef: "Invoice arithmetic: amount = qty × unit price",
        systemOfRecord: "supplier invoice",
        note: "line amount does not equal qty × unit price",
      });
    }

    const poLine = line.partId ? po.lines.find((l) => l.partId === line.partId) : undefined;
    if (!poLine || !line.partId) {
      hold({
        ...at,
        kind: "unmatched_line",
        expected: "a part on " + po.id,
        actual: line.partId ?? line.description,
        ruleRef: `${po.id} lines`,
        systemOfRecord: "ERP core (PO)",
        note: "invoice line does not correspond to any PO line",
      });
      return;
    }
    const partId = line.partId;

    // ---- quantity ----
    const received = sumQty(receiptLines, partId);
    const prevInvoiced = sumQty(priorLines, partId);
    const available = received - prevInvoiced;
    const slipQty = slipLines.some((l) => l.partId === partId) ? sumQty(slipLines, partId) : undefined;

    if (prevInvoiced + line.qty > poLine.qty) {
      hold({
        ...at,
        kind: "over_po",
        expected: poLine.qty - prevInvoiced,
        actual: line.qty,
        ruleRef: `${po.id}: cumulative invoiced qty ≤ ordered qty`,
        systemOfRecord: "ERP core (PO)",
        note: `already invoiced ${prevInvoiced} of ${poLine.qty}; this invoice adds ${line.qty}`,
      });
    } else if (available <= 0) {
      hold({
        ...at,
        kind: "no_receipt",
        expected: 0,
        actual: line.qty,
        ruleRef: "Three-way match: pay only for goods received",
        systemOfRecord: "receiving (dock receipts)",
        note: `received ${received}, already invoiced ${prevInvoiced}: nothing received awaits invoicing`,
      });
    } else if (line.qty !== available) {
      let suspect: Diff["suspect"];
      let note = `received-not-invoiced ${available}, invoiced ${line.qty}`;
      if (slipQty !== undefined) {
        // Compare like with like: the slip covers the whole PO, as do receipts.
        const invoicedTotal = prevInvoiced + line.qty;
        if (slipQty === invoicedTotal && slipQty !== received) {
          suspect = "receipt";
          note += `; packing slip (${slipQty}) agrees with the invoice — ask receiving to recount`;
        } else if (slipQty === received && slipQty !== invoicedTotal) {
          suspect = "invoice";
          note += `; packing slip (${slipQty}) agrees with the receipt — invoice qty looks wrong`;
        } else {
          note += `; packing slip says ${slipQty} — no two sources agree`;
        }
      }
      hold({
        ...at,
        kind: "qty_mismatch",
        expected: available,
        actual: line.qty,
        ruleRef: "Three-way match: quantity must match exactly",
        systemOfRecord: "receiving (dock receipt), cross-checked with packing slip",
        suspect,
        note,
      });
    }

    // ---- price ----
    if (absTol === null) return;
    const contract = input.contracts.find((c) => c.supplierId === invoice.supplierId && c.partId === partId);
    if (contract && contract.currency !== invoice.currency) {
      hold({
        ...at,
        kind: "currency_mismatch",
        expected: contract.currency,
        actual: invoice.currency,
        ruleRef: contract.id,
        systemOfRecord: `ERP core (contract ${contract.id})`,
        note: `contract ${contract.id} is priced in ${contract.currency}`,
      });
      return;
    }
    let expectedE4 = poLine.unitPriceE4;
    let priceRef = `${po.id} unit price`;
    let priceSource = "ERP core (PO; no contract for this part)";
    if (contract) {
      const p = priceInForce(contract, invoice.date);
      if (!p) {
        hold({
          ...at,
          kind: "contract_price_missing",
          expected: "a price window covering " + invoice.date,
          actual: invoice.date,
          ruleRef: contract.id,
          systemOfRecord: "ERP core (contract)",
          note: `contract ${contract.id} has no price in force on ${invoice.date}`,
        });
        return;
      }
      expectedE4 = p.unitPriceE4;
      priceRef = p.clauseRef;
      priceSource = `ERP core (contract ${contract.id})`;
      if (poLine.unitPriceE4 !== p.unitPriceE4) {
        info({
          ...at,
          kind: "po_price_differs_from_contract",
          expected: p.unitPriceE4,
          actual: poLine.unitPriceE4,
          ruleRef: p.clauseRef,
          systemOfRecord: priceSource,
          note: `PO price is stale vs ${p.clauseRef}; the contract price in force on the invoice date governs`,
        });
      }
    }

    const diffE4 = line.unitPriceE4 - expectedE4;
    if (diffE4 !== 0 && !withinTolerance(diffE4, expectedE4, absTol)) {
      const d = {
        ...at,
        expected: expectedE4,
        actual: line.unitPriceE4,
        deltaMinor: lineAmount(line.qty, diffE4, invoice.currency),
        tolerance: TOLERANCE_RULE,
        ruleRef: priceRef,
        systemOfRecord: priceSource,
      };
      if (diffE4 > 0) {
        hold({ ...d, kind: "price_over_tolerance", note: `invoiced above ${priceRef} beyond tolerance` });
      } else {
        info({ ...d, kind: "favorable_price", note: `invoiced below ${priceRef}; supplier may re-bill` });
      }
    }
  });

  return {
    invoiceId: invoice.id,
    poId: po.id,
    status: diffs.some((d) => d.severity === "hold") ? "hold" : "match",
    diffs,
  };
}

/**
 * Strips one trailing re-send marker: a separator plus one digit or 1–2
 * letters ("-A", "-1", "/R"), or a single trailing letter after a digit
 * ("1041R"). Two-digit suffixes are kept so "2026-04" ≠ "2026-05".
 */
export function normalizeInvoiceNo(no: string): string {
  const n = no.toUpperCase().replace(/\s+/g, "");
  const stripped = n.replace(/[-_/.](\d|[A-Z]{1,2})$/, "").replace(/(\d)[A-Z]$/, "$1");
  return stripped.length >= 4 ? stripped : n;
}

/** Earlier invoices that look like the same bill: same supplier, same amount, same normalized number. */
export function findDuplicates(invoice: Invoice, history: readonly Invoice[]): Invoice[] {
  const key = normalizeInvoiceNo(invoice.invoiceNo);
  return history.filter(
    (h) =>
      h.id !== invoice.id &&
      h.supplierId === invoice.supplierId &&
      h.totalMinor === invoice.totalMinor &&
      h.currency === invoice.currency &&
      normalizeInvoiceNo(h.invoiceNo) === key,
  );
}
