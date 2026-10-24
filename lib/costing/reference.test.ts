// Integration tests against the real cached reference data.
import { describe, expect, it } from "vitest";
import { loadParts, loadSuppliers } from "@/lib/erp/master";
import type { Invoice } from "@/lib/erp/types";
import { convert, rateOn } from "./fx";
import { landedCost } from "./landed";
import { loadAdditionalDuties, loadEcbRates, loadHtsTable } from "./reference";

const hts = loadHtsTable();
const fx = loadEcbRates();
const parts = Object.fromEntries(loadParts().map((p) => [p.id, p]));
const suppliers = loadSuppliers();

describe("F6 real ECB cache", () => {
  it("2026-03-02 USD per EUR = 1.1698, as published", () => {
    expect(rateOn(fx, "USD", "2026-03-02")).toEqual({ ccy: "USD", perEUR: "1.1698", rateDate: "2026-03-02" });
  });
  it("Sunday 2026-03-01 falls back to Friday 02-27, the first fixing in the cache", () => {
    expect(rateOn(fx, "USD", "2026-03-01").rateDate).toBe("2026-02-27");
  });
  it("covers every sim month and refuses dates after the fetch", () => {
    for (const m of ["03", "04", "05", "06", "07", "08", "09"]) {
      expect(Object.keys(fx.days).some((d) => d.startsWith(`2026-${m}`))).toBe(true);
    }
    expect(() => rateOn(fx, "USD", "2026-10-26")).toThrow(/outside cached window/);
  });
  it("converts JPY with a real cross rate", () => {
    const c = convert(fx, 1_000_000, "JPY", "USD", "2026-03-02");
    // ¥1,000,000 × 1.1698 / 184.19 = $6,351.0505… → $6,351.05
    expect(c.amountMinor).toBe(635_105);
  });
});

describe("LC6 every part has a sourced HTS entry", () => {
  it("parts.json codes are all in hts.json with source and retrieval date", () => {
    for (const p of Object.values(parts)) {
      const e = hts[p.hts];
      expect(e, `missing ${p.hts} for ${p.id}`).toBeDefined();
      expect(e.sourceUrl).toMatch(/^https:\/\/hts\.usitc\.gov\//);
      expect(e.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("LC1 landed cost with a real HTS rate", () => {
  it("8507.60.00 is 3.4% at USITC; 500 batteries @ $42.00 + $150 + $600 = $22,464.00", () => {
    expect(hts["8507.60.00"].general).toBe("3.4%");
    const supplier = { id: "S-KR", name: "test importer", country: "KR", currency: "USD" as const, remitToId: "x" };
    const invoice: Invoice = {
      id: "INV-LC1",
      invoiceNo: "LC1",
      supplierId: "S-KR",
      supplierName: "test importer",
      date: "2026-04-15",
      currency: "USD",
      lines: [{ partId: "P06", description: "battery", qty: 500, unitPriceE4: 420_000, amountMinor: 2_100_000 }],
      totalMinor: 2_100_000,
      sourceFile: "test",
      simulated: true,
    };
    const r = landedCost({
      invoice,
      supplier,
      parts,
      hts,
      additionalDuties: [],
      fx,
      freightUSDCents: 60_000,
      brokerFeeUSDCents: 15_000,
    });
    expect(r.lines[0].generalDutyCents).toBe(71_400);
    expect(r.landedCents).toBe(2_246_400);
    // No verified Chapter 99 entry for KR × 8507.60.00 → flagged, not assumed zero.
    expect(r.lines[0].unverifiedAdditionalDuty).toBe(true);
  });
});

describe("LC10 Chapter 99 coverage", () => {
  it("every imported (origin, HTS) pair has an additional-duties entry", () => {
    const entries = loadAdditionalDuties();
    const has = (o: string, h: string) => entries.some((e) => e.origin === o && e.hts === h);
    for (const s of suppliers.filter((s) => s.country !== "US")) {
      for (const p of Object.values(parts).filter((p) => p.approvedSuppliers.includes(s.id))) {
        expect(has(s.country, p.hts), `${s.country} × ${p.hts} (${p.id})`).toBe(true);
      }
    }
    // planted: the substitute flight controller with a CN certificate of origin
    expect(has("CN", parts.P04.hts)).toBe(true);
  });
  it("unverified entries never carry rates", () => {
    for (const e of loadAdditionalDuties().filter((e) => !e.verified)) expect(e.headings).toEqual([]);
  });
});
