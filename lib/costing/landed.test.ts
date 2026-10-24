import { describe, expect, it } from "vitest";
import type { CustomsEntry, Invoice, InvoiceLine, Part, Supplier } from "@/lib/erp/types";
import type { RateTable } from "./fx";
import { compareToCustoms, landedCost, type LandedCostInput, landedPerUnitE4 } from "./landed";
import { type AdditionalDutyEntry, type HtsEntry, parseGeneralRate, resolveAdditionalDuties, TariffError } from "./tariff";

// Synthetic reference data (real values are checked in landed.real.test.ts).
const fx: RateTable = {
  source: "synthetic test rates",
  sourceUrl: "test://",
  retrievedAt: "2026-10-23",
  from: "2026-04-01",
  to: "2026-04-30",
  days: { "2026-04-01": { USD: "1.1000", JPY: "165" } },
};

function hts(htsno: string, general: string): HtsEntry {
  return { htsno, description: `test ${htsno}`, general, generalRateBp: parseGeneralRate(general), footnotes: [], sourceUrl: "test://", retrievedAt: "2026-10-23" };
}
const HTS = {
  "8507.60.00": hts("8507.60.00", "3.4%"),
  "8544.42.90": hts("8544.42.90", "2.6%"),
  "8537.10.91": hts("8537.10.91", "2.7%"),
  "7318.15.60": hts("7318.15.60", "6.2%"),
  "7318.15.80": hts("7318.15.80", "8.5%"),
  "8807.30.00": hts("8807.30.00", "Free"),
};

function part(id: string, htsno: string, extra: Partial<Part> = {}): Part {
  return { id, name: id, hts: htsno, componentClass: "x", standardCostE4: 0, approvedSuppliers: [], criticality: "standard", ...extra };
}
const PARTS: Record<string, Part> = {
  P01: part("P01", "8807.30.00"),
  P04: part("P04", "8537.10.91"),
  P06: part("P06", "8507.60.00"),
  P12: part("P12", "8544.42.90"),
  P14: part("P14", "7318.15.60", { htsBasis: "M3 thread (3 mm) < 6 mm → 7318.15.60" }),
};

const TW: Supplier = { id: "S-VIR", name: "Vireo", country: "TW", currency: "USD", remitToId: "B1" };
const JP: Supplier = { id: "S-HOS", name: "Hoshi", country: "JP", currency: "JPY", remitToId: "B2" };
const US: Supplier = { id: "S-NW", name: "Northwind", country: "US", currency: "USD", remitToId: "B3" };

const verifiedNone = (origin: string, htsno: string): AdditionalDutyEntry => ({
  origin,
  hts: htsno,
  coverage: { from: "2026-03-01", to: "2026-09-30" },
  headings: [],
  none: true,
  verified: true,
});

function line(partId: string, qty: number, amountMinor: number, extra: Partial<InvoiceLine> = {}): InvoiceLine {
  return { partId, description: partId, qty, unitPriceE4: 0, amountMinor, ...extra };
}
function invoice(supplier: Supplier, lines: InvoiceLine[]): Invoice {
  return {
    id: "INV-T",
    invoiceNo: "T-1",
    supplierId: supplier.id,
    date: "2026-04-01",
    currency: supplier.currency,
    lines,
    totalMinor: lines.reduce((a, l) => a + l.amountMinor, 0),
    sourceFile: "test",
    simulated: true,
  };
}
function input(supplier: Supplier, lines: InvoiceLine[], extra: Partial<LandedCostInput> = {}): LandedCostInput {
  return {
    invoice: invoice(supplier, lines),
    supplier,
    parts: PARTS,
    hts: HTS,
    additionalDuties: [],
    fx,
    freightUSDCents: 0,
    brokerFeeUSDCents: 0,
    ...extra,
  };
}

describe("LC1 single line, ad valorem duty", () => {
  it("500 batteries @ $42.00 at 3.4% + $150 broker + $600 freight = $22,464.00", () => {
    const r = landedCost(
      input(TW, [line("P06", 500, 2_100_000)], {
        additionalDuties: [verifiedNone("TW", "8507.60.00")],
        freightUSDCents: 60_000,
        brokerFeeUSDCents: 15_000,
      }),
    );
    const l = r.lines[0];
    expect(l.generalDutyCents).toBe(71_400);
    expect(l.dutyCents).toBe(71_400);
    expect(l.landedCents).toBe(2_246_400);
    expect(landedPerUnitE4(l)).toBe(449_280); // $44.9280
    expect(l.unverifiedAdditionalDuty).toBe(false);
    expect(r.landedCents).toBe(2_246_400);
  });
});

describe("LC2 allocation by value", () => {
  it("splits $10.00 freight 1:2:3 as 167/333/500 and sums exactly", () => {
    const r = landedCost(
      input(TW, [line("P01", 1, 100_000), line("P01", 1, 200_000), line("P01", 1, 300_000)], {
        additionalDuties: [verifiedNone("TW", "8807.30.00")],
        freightUSDCents: 1_000,
      }),
    );
    expect(r.lines.map((l) => l.freightCents)).toEqual([167, 333, 500]);
    expect(r.landedCents).toBe(600_000 + 1_000);
  });
});

describe("LC3 foreign-currency invoice", () => {
  it("¥1,000,000 at 1.1000/165 → $6,666.67; 2.6% duty → $173.33", () => {
    const r = landedCost(input(JP, [line("P12", 100, 1_000_000)], { additionalDuties: [verifiedNone("JP", "8544.42.90")] }));
    expect(r.lines[0].goodsUSDCents).toBe(666_667);
    expect(r.lines[0].generalDutyCents).toBe(17_333);
    expect(r.lines[0].steps[0].inputs["ecb:JPY/EUR"]).toBe("165");
  });
  it("domestic origin pays no duty", () => {
    const r = landedCost(input(US, [line("P06", 10, 42_000)]));
    expect(r.dutyCents).toBe(0);
    expect(r.lines[0].additionalDutyNote).toBe("domestic origin");
  });
});

describe("LC4 duty overcharge from a wrong HTS band", () => {
  it("P14 entered as 7318.15.80 (8.5%) when documents say M3 → overcharge $46.00", () => {
    const inp = input(TW, [line("P14", 20_000, 200_000)], { additionalDuties: [verifiedNone("TW", "7318.15.60")] });
    const landed = landedCost(inp);
    const entry: CustomsEntry = {
      id: "CE-7",
      invoiceId: "INV-T",
      lines: [{ invoiceLineIndex: 0, hts: "7318.15.80", valueUSDCents: 200_000, dutyRateBp: 850, dutyUSDCents: 17_000 }],
      brokerFeeUSDCents: 15_000,
      totalUSDCents: 32_000,
    };
    const check = compareToCustoms(landed, entry, PARTS, HTS, inp.additionalDuties, "2026-04-01");
    expect(check.lines[0].kind).toBe("duty_overcharge");
    expect(check.lines[0].expectedDutyCents).toBe(12_400);
    expect(check.lines[0].deltaCents).toBe(4_600);
    expect(check.overchargeCents).toBe(4_600);
    expect(check.needsEscalation).toBe(false);
    const classification = check.lines[0].steps.at(-1)!;
    expect(classification.inputs.basis).toContain("M3 thread");
  });
});

describe("LC5 unsupported rate formats", () => {
  it("parses Free and ad valorem, throws on specific/compound rates", () => {
    expect(parseGeneralRate("Free")).toBe(0);
    expect(parseGeneralRate("3.4%")).toBe(340);
    expect(parseGeneralRate("4%")).toBe(400);
    expect(() => parseGeneralRate("2.5% + 10¢/kg")).toThrow(TariffError);
    expect(() => parseGeneralRate("5.1¢/kg")).toThrow(TariffError);
  });
});

const cnFlightController: AdditionalDutyEntry = {
  origin: "CN",
  hts: "8537.10.91",
  coverage: { from: "2026-03-01", to: "2026-09-30" },
  verified: true,
  headings: [
    { heading: "9903.T1", rateBp: 2_500, effectiveFrom: "2018-07-06", effectiveTo: null, usNoteRef: "test note 1", htsRevision: "test", sourceUrl: "test://", retrievedAt: "2026-10-23" },
    { heading: "9903.T2", rateBp: 1_000, effectiveFrom: "2026-01-01", effectiveTo: null, usNoteRef: "test note 2", htsRevision: "test", sourceUrl: "test://", retrievedAt: "2026-10-23" },
    { heading: "9903.T3", rateBp: 9_999, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", usNoteRef: "expired", htsRevision: "test", sourceUrl: "test://", retrievedAt: "2026-10-23" },
  ],
};

describe("LC7 stacked Chapter 99 duties", () => {
  it("2.7% + 25% + 10% on $10,000.00 = $3,770.00, one step per heading, expired heading skipped", () => {
    const r = landedCost(input(TW, [line("P04", 100, 1_000_000, { countryOfOrigin: "CN" })], { additionalDuties: [cnFlightController] }));
    const l = r.lines[0];
    expect(l.origin).toBe("CN");
    expect(l.originSource).toBe("invoice_line");
    expect(l.generalDutyCents).toBe(27_000);
    expect(l.additionalDutyCents).toBe(350_000);
    expect(l.dutyCents).toBe(377_000);
    const headingSteps = l.steps.filter((s) => s.label.startsWith("Chapter 99"));
    expect(headingSteps.map((s) => s.inputs.heading)).toEqual(["9903.T1", "9903.T2"]);
  });
});

describe("LC8 unverified or out-of-window entries are not applied", () => {
  it("flags an unverified entry", () => {
    const r = resolveAdditionalDuties([{ ...cnFlightController, verified: false }], "CN", "8537.10.91", "2026-04-01");
    expect(r.applied).toEqual([]);
    expect(r.unverified).toBe(true);
  });
  it("flags a date outside the researched window", () => {
    const r = resolveAdditionalDuties([cnFlightController], "CN", "8537.10.91", "2026-10-15");
    expect(r.applied).toEqual([]);
    expect(r.unverified).toBe(true);
  });
  it("flags an import pair with no entry at all", () => {
    const r = landedCost(input(TW, [line("P06", 1, 4_200)]));
    expect(r.lines[0].unverifiedAdditionalDuty).toBe(true);
    expect(r.anyUnverifiedAdditionalDuty).toBe(true);
    expect(r.lines[0].additionalDutyCents).toBe(0);
  });
});

describe("LC9 unexplained duty gap", () => {
  it("same HTS but more duty than column 1 + verified Chapter 99 → source_disagreement", () => {
    const inp = input(TW, [line("P04", 100, 1_000_000, { countryOfOrigin: "CN" })], {
      additionalDuties: [{ ...cnFlightController, verified: false }],
    });
    const landed = landedCost(inp);
    const entry: CustomsEntry = {
      id: "CE-9",
      invoiceId: "INV-T",
      lines: [{ invoiceLineIndex: 0, hts: "8537.10.91", valueUSDCents: 1_000_000, dutyRateBp: 2_770, dutyUSDCents: 277_000 }],
      brokerFeeUSDCents: 0,
      totalUSDCents: 277_000,
    };
    const check = compareToCustoms(landed, entry, PARTS, HTS, inp.additionalDuties, "2026-04-01");
    expect(check.lines[0].kind).toBe("source_disagreement");
    expect(check.lines[0].deltaCents).toBe(250_000);
    expect(check.lines[0].note).toContain("not verified");
    expect(check.needsEscalation).toBe(true);
  });
  it("matching duty within 1¢ rounding is ok", () => {
    const inp = input(TW, [line("P06", 500, 2_100_000)], { additionalDuties: [verifiedNone("TW", "8507.60.00")] });
    const entry: CustomsEntry = {
      id: "CE-1",
      invoiceId: "INV-T",
      lines: [{ invoiceLineIndex: 0, hts: "8507.60.00", valueUSDCents: 2_100_000, dutyRateBp: 340, dutyUSDCents: 71_401 }],
      brokerFeeUSDCents: 0,
      totalUSDCents: 71_401,
    };
    expect(compareToCustoms(landedCost(inp), entry, PARTS, HTS, inp.additionalDuties, "2026-04-01").lines[0].kind).toBe("ok");
  });
});
