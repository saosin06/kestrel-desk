import { describe, expect, it } from "vitest";
import type { RateTable } from "@/lib/costing/fx";
import { type Diff, findDuplicates, type MatchInput, normalizeInvoiceNo, threeWayMatch } from "./match";
import type { Contract, Invoice, InvoiceLine, PackingSlip, PO, Receipt } from "./types";

const usd = (dollars: string) => Math.round(Number(dollars) * 10_000); // test-only: unit price E4

function po(qty: number, price: string, extra: Partial<PO> = {}): PO {
  return { id: "PO-311", supplierId: "S-ATL", currency: "USD", date: "2026-04-01", status: "open", lines: [{ partId: "P07", qty, unitPriceE4: usd(price) }], ...extra };
}
function receipt(id: string, qty: number): Receipt {
  return { id, poId: "PO-311", date: "2026-04-10", enteredBy: "receiving", lines: [{ partId: "P07", qty, lot: `LOT-${id}` }] };
}
function slip(qty: number): PackingSlip {
  return { id: "PS-1", poId: "PO-311", supplierId: "S-ATL", date: "2026-04-09", lines: [{ partId: "P07", description: "motor", qty }], sourceFile: "test" };
}
function invLine(qty: number, price: string, extra: Partial<InvoiceLine> = {}): InvoiceLine {
  const unitPriceE4 = usd(price);
  return { partId: "P07", description: "Brushless motor", qty, unitPriceE4, amountMinor: Math.round((qty * unitPriceE4) / 100), ...extra };
}
function invoice(id: string, lines: InvoiceLine[], extra: Partial<Invoice> = {}): Invoice {
  return {
    id,
    invoiceNo: id,
    supplierId: "S-ATL",
    supplierName: "Atlas Motors",
    poId: "PO-311",
    date: "2026-04-15",
    currency: "USD",
    lines,
    totalMinor: lines.reduce((a, l) => a + l.amountMinor, 0),
    sourceFile: "test",
    simulated: true,
    ...extra,
  };
}
const contract: Contract = {
  id: "C-12",
  supplierId: "S-ATL",
  partId: "P07",
  currency: "USD",
  incoterm: "FCA",
  leadTimeDays: 30,
  prices: [{ unitPriceE4: usd("11.00"), validFrom: "2026-01-01", validTo: "2026-12-31", clauseRef: "C-12 §4.2" }],
};

function match(partial: Partial<MatchInput> & Pick<MatchInput, "invoice">) {
  return threeWayMatch({ po: po(400, "11.00"), receipts: [receipt("R-1", 400)], packingSlips: [], priorInvoices: [], contracts: [contract], ...partial });
}
const kinds = (diffs: Diff[]) => diffs.map((d) => `${d.severity}:${d.kind}`);

describe("M1 clean match", () => {
  it("PO 400 @ $11.00, receipt 400, invoice 400 @ $11.00", () => {
    const r = match({ invoice: invoice("INV-1", [invLine(400, "11.00")]) });
    expect(r.status).toBe("match");
    expect(r.diffs).toEqual([]);
  });
});

describe("M2 price vs contract", () => {
  it("invoice @ $14.00 vs C-12 §4.2 $11.00 on 3,000 units → hold, $9,000.00", () => {
    const r = match({
      po: po(3000, "11.00"),
      receipts: [receipt("R-1", 3000)],
      invoice: invoice("INV-2041", [invLine(3000, "14.00")]),
    });
    expect(r.status).toBe("hold");
    expect(r.diffs).toHaveLength(1);
    const d = r.diffs[0];
    expect(d.kind).toBe("price_over_tolerance");
    expect(d.expected).toBe(110_000);
    expect(d.actual).toBe(140_000);
    expect(d.deltaMinor).toBe(900_000);
    expect(d.ruleRef).toBe("C-12 §4.2");
    expect(d.systemOfRecord).toContain("contract C-12");
  });
});

describe("M3 tolerance = larger of 1% or $0.05", () => {
  it("$11.00 expected: $11.11 matches, $11.12 holds", () => {
    expect(match({ invoice: invoice("I", [invLine(400, "11.11")]) }).status).toBe("match");
    expect(match({ invoice: invoice("I", [invLine(400, "11.12")]) }).status).toBe("hold");
  });
  it("$0.0350 screw: $0.0850 matches ($0.05 floor), $0.0851 holds", () => {
    const screws = { po: po(400, "0.035"), contracts: [] };
    expect(match({ ...screws, invoice: invoice("I", [invLine(400, "0.085")]) }).status).toBe("match");
    expect(match({ ...screws, invoice: invoice("I", [invLine(400, "0.0851")]) }).status).toBe("hold");
  });
  it("in a non-USD currency, $0.05 is converted at the invoice-date rate", () => {
    const fx: RateTable = { source: "t", sourceUrl: "t", retrievedAt: "t", from: "2026-04-01", to: "2026-04-30", days: { "2026-04-15": { USD: "1.00", JPY: "160" } } };
    // $0.05 → ¥8; expected ¥1,000 → 1% = ¥10; tolerance ¥10
    const jpyPo = po(10, "1000", { currency: "JPY" });
    const jpyInv = (price: string) => invoice("I", [{ partId: "P07", description: "m", qty: 10, unitPriceE4: usd(price), amountMinor: 10 * Number(price) }], { currency: "JPY" });
    const base = { po: jpyPo, receipts: [receipt("R-1", 10)], contracts: [], fx };
    expect(threeWayMatch({ ...base, packingSlips: [], priorInvoices: [], invoice: jpyInv("1010") }).status).toBe("match");
    expect(threeWayMatch({ ...base, packingSlips: [], priorInvoices: [], invoice: jpyInv("1011") }).status).toBe("hold");
  });
});

describe("M4 quantity disagreement", () => {
  it("receipt 480 vs packing slip 400 and invoice 400 → hold, receipt is the outlier", () => {
    const r = match({ receipts: [receipt("R-889", 480)], packingSlips: [slip(400)], invoice: invoice("INV-1", [invLine(400, "11.00")]) });
    expect(r.status).toBe("hold");
    expect(kinds(r.diffs)).toEqual(["hold:qty_mismatch"]);
    expect(r.diffs[0].suspect).toBe("receipt");
    expect(r.diffs[0].note).toContain("recount");
  });
  it("packing slip agrees with the receipt → the invoice is the outlier", () => {
    const r = match({ po: po(500, "11.00"), receipts: [receipt("R-1", 400)], packingSlips: [slip(400)], invoice: invoice("INV-1", [invLine(450, "11.00")]) });
    expect(r.diffs[0].suspect).toBe("invoice");
  });
});

describe("M5 partial receipts", () => {
  it("invoice for the received 600 of 1,000 matches; a second invoice before the next receipt holds", () => {
    const base = { po: po(1000, "11.00"), receipts: [receipt("R-1", 600)] };
    const first = invoice("INV-1", [invLine(600, "11.00")]);
    expect(match({ ...base, invoice: first }).status).toBe("match");
    const second = match({ ...base, priorInvoices: [first], invoice: invoice("INV-2", [invLine(400, "11.00")]) });
    expect(kinds(second.diffs)).toEqual(["hold:no_receipt"]);
  });
});

describe("M6 over-invoicing the PO", () => {
  it("600 already invoiced + 500 > 1,000 ordered → hold over_po", () => {
    const r = match({
      po: po(1000, "11.00"),
      receipts: [receipt("R-1", 600), receipt("R-2", 400)],
      priorInvoices: [invoice("INV-1", [invLine(600, "11.00")])],
      invoice: invoice("INV-2", [invLine(500, "11.00")]),
    });
    expect(kinds(r.diffs)).toEqual(["hold:over_po"]);
  });
});

describe("M7 structural mismatches", () => {
  it("line not on the PO", () => {
    const r = match({ invoice: invoice("I", [invLine(400, "11.00"), invLine(5, "3.00", { partId: "P99", description: "expedite fee" })]) });
    expect(kinds(r.diffs)).toEqual(["hold:unmatched_line"]);
  });
  it("lines don't sum to the total", () => {
    const r = match({ invoice: invoice("I", [invLine(400, "11.00")], { totalMinor: 440_100 }) });
    expect(kinds(r.diffs)).toEqual(["hold:total_mismatch"]);
    expect(r.diffs[0].deltaMinor).toBe(100);
  });
  it("line amount ≠ qty × price", () => {
    const r = match({ invoice: invoice("I", [invLine(400, "11.00", { amountMinor: 440_500 })]) });
    expect(kinds(r.diffs)).toContain("hold:line_amount_mismatch");
  });
  it("currency or supplier differs from the PO", () => {
    expect(kinds(match({ invoice: invoice("I", [invLine(400, "11.00")], { currency: "EUR" }) }).diffs)).toContain("hold:currency_mismatch");
    expect(kinds(match({ invoice: invoice("I", [invLine(400, "11.00")], { supplierId: "S-X" }) }).diffs)).toContain("hold:supplier_mismatch");
  });
});

describe("M8 mid-contract price change", () => {
  const amended: Contract = {
    ...contract,
    prices: [
      { unitPriceE4: usd("11.00"), validFrom: "2026-01-01", validTo: "2026-04-30", clauseRef: "C-12 §4.2" },
      { unitPriceE4: usd("11.50"), validFrom: "2026-05-01", validTo: "2026-12-31", clauseRef: "C-12 Amendment 1 §4.3" },
    ],
  };
  const base = { contracts: [amended] }; // PO placed in April at $11.00

  it("$11.50 dated 04-30 holds against the price then in force", () => {
    const r = match({ ...base, invoice: invoice("I", [invLine(400, "11.50")], { date: "2026-04-30" }) });
    expect(r.status).toBe("hold");
    expect(r.diffs[0].ruleRef).toBe("C-12 §4.2");
  });
  it("$11.50 dated 05-01 matches; stale PO price is info only", () => {
    const r = match({ ...base, invoice: invoice("I", [invLine(400, "11.50")], { date: "2026-05-01" }) });
    expect(r.status).toBe("match");
    expect(kinds(r.diffs)).toEqual(["info:po_price_differs_from_contract"]);
    expect(r.diffs[0].ruleRef).toBe("C-12 Amendment 1 §4.3");
  });
  it("no price window covering the invoice date holds", () => {
    const gap: Contract = { ...contract, prices: [{ ...contract.prices[0], validTo: "2026-03-31" }] };
    expect(kinds(match({ contracts: [gap], invoice: invoice("I", [invLine(400, "11.00")]) }).diffs)).toEqual(["hold:contract_price_missing"]);
  });
});

describe("M9 favorable price", () => {
  it("invoice below contract beyond tolerance → match with info", () => {
    const r = match({ invoice: invoice("I", [invLine(400, "10.00")]) });
    expect(r.status).toBe("match");
    expect(kinds(r.diffs)).toEqual(["info:favorable_price"]);
    expect(r.diffs[0].deltaMinor).toBe(-40_000);
  });
});

describe("M10 duplicate guard", () => {
  const paid = invoice("inv-a", [invLine(400, "11.00")], { invoiceNo: "INV-1041", supplierId: "S-NW" });
  const resend = invoice("inv-b", [invLine(400, "11.00")], { invoiceNo: "INV-1041-A", supplierId: "S-NW" });

  it("same supplier, same amount, suffixed number → duplicate", () => {
    expect(findDuplicates(resend, [paid]).map((i) => i.id)).toEqual(["inv-a"]);
  });
  it("different supplier or different amount → not a duplicate", () => {
    expect(findDuplicates({ ...resend, supplierId: "S-ATL" }, [paid])).toEqual([]);
    expect(findDuplicates({ ...resend, totalMinor: 440_001 }, [paid])).toEqual([]);
  });
  it("normalizes re-send markers but keeps real sequence numbers distinct", () => {
    expect(normalizeInvoiceNo("INV-1041-A")).toBe("INV-1041");
    expect(normalizeInvoiceNo("inv 1041r")).toBe("INV1041");
    expect(normalizeInvoiceNo("INV-1041-1")).toBe("INV-1041");
    expect(normalizeInvoiceNo("INV-1041")).toBe("INV-1041");
    expect(normalizeInvoiceNo("2026-04")).not.toBe(normalizeInvoiceNo("2026-05"));
  });
});
