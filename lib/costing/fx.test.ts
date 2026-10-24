import { describe, expect, it } from "vitest";
import { convert, FxError, rateOn, type RateTable, realizedFx, revalue } from "./fx";

// Synthetic ECB-style table (units per 1 EUR) so the hand math is clean.
// 2026-04-03 is a Friday; 04-04/05 are the weekend.
const table: RateTable = {
  source: "synthetic test rates",
  sourceUrl: "test://",
  retrievedAt: "2026-10-23",
  from: "2026-04-01",
  to: "2026-04-30",
  days: {
    "2026-04-01": { USD: "1.0800", JPY: "160" },
    "2026-04-02": { USD: "1.0700", JPY: "160" },
    "2026-04-03": { USD: "1.0900", JPY: "160" },
    "2026-04-06": { USD: "1.1000", JPY: "160" },
    "2026-04-20": { USD: "1.1000" },
    "2026-04-30": { USD: "1.1000" },
  },
};

describe("F1 convert on an ECB business day", () => {
  it("€10,000.00 at 1.0800 USD/EUR = $10,800.00", () => {
    const c = convert(table, 1_000_000, "EUR", "USD", "2026-04-01");
    expect(c.amountMinor).toBe(1_080_000);
    expect(c.rateDate).toBe("2026-04-01");
    expect(c.displayRate).toBe("1.080000");
    expect(c.step.inputs["ecb:USD/EUR"]).toBe("1.0800");
    expect(c.step.inputs["cross:USD/EUR"]).toBe("1.080000");
  });
  it("USD → EUR inverts exactly before rounding: $100.00 at 1.0800 = €92.59", () => {
    // 10000 / 1.08 = 9259.259… → 9259
    expect(convert(table, 10_000, "USD", "EUR", "2026-04-01").amountMinor).toBe(9_259);
  });
});

describe("F2 weekends, gaps, and the cache window", () => {
  it("Saturday uses Friday's rate", () => {
    const c = convert(table, 1_000_000, "EUR", "USD", "2026-04-04");
    expect(c.rateDate).toBe("2026-04-03");
    expect(c.amountMinor).toBe(1_090_000);
  });
  it("throws when the last published rate is more than 5 days back", () => {
    // 04-07..04-19 missing; 04-12 looks back to 04-07 at most.
    expect(() => rateOn(table, "USD", "2026-04-12")).toThrow(FxError);
  });
  it("throws outside the cached window instead of inventing a rate", () => {
    expect(() => rateOn(table, "USD", "2026-05-01")).toThrow(/outside cached window/);
    expect(() => rateOn(table, "USD", "2026-03-31")).toThrow(/outside cached window/);
  });
  it("throws when ECB published no rate for that currency that day", () => {
    expect(() => rateOn(table, "JPY", "2026-04-20")).toThrow(/no JPY rate/);
  });
});

describe("F3 realized FX on payment", () => {
  it("€10,000 booked at 1.0800, paid at 1.0700 → $100.00 gain", () => {
    const r = realizedFx(table, 1_000_000, "EUR", "2026-04-01", "2026-04-02");
    expect(r.bookedUSDCents).toBe(1_080_000);
    expect(r.paidUSDCents).toBe(1_070_000);
    expect(r.gainCents).toBe(10_000);
  });
});

describe("F4 unrealized FX at period end", () => {
  it("open €10,000 carried at $10,800.00, revalued at 1.0900 → $100.00 loss", () => {
    const r = revalue(table, 1_000_000, "EUR", 1_080_000, "2026-04-03");
    expect(r.revaluedUSDCents).toBe(1_090_000);
    expect(r.gainCents).toBe(-10_000);
  });
});

describe("F5 cross rates and zero-decimal currencies", () => {
  // JPY→USD = (USD/EUR) / (JPY/EUR) = 1.08 / 160 = $0.00675 per yen
  it("¥4 → 2.7¢ → 3¢; ¥1,000,000 → $6,750.00", () => {
    expect(convert(table, 4, "JPY", "USD", "2026-04-01").amountMinor).toBe(3);
    expect(convert(table, 1_000_000, "JPY", "USD", "2026-04-01").amountMinor).toBe(675_000);
  });
  it("rounds an exact half cent up: ¥2,000 at 1.0700/160 = $13.375 → $13.38", () => {
    expect(convert(table, 2_000, "JPY", "USD", "2026-04-02").amountMinor).toBe(1_338);
  });
  it("USD → JPY lands on whole yen: $1.00 at 1.08/160 = ¥148.148… → ¥148", () => {
    expect(convert(table, 100, "USD", "JPY", "2026-04-01").amountMinor).toBe(148);
  });
});
