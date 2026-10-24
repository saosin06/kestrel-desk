import { describe, expect, it } from "vitest";
import {
  allocate,
  divRound,
  formatBp,
  formatMoney,
  formatUnitPrice,
  lineAmount,
  MoneyError,
  parseMoney,
  parsePercentToBp,
  parseUnitPrice,
  pctOf,
} from "./money";

describe("parsing", () => {
  it("parses money in minor units per currency exponent", () => {
    expect(parseMoney("14.00", "USD")).toBe(1400);
    expect(parseMoney("4,400.00", "USD")).toBe(440000);
    expect(parseMoney("1234", "JPY")).toBe(1234);
    expect(parseMoney("-0.5", "EUR")).toBe(-50);
  });

  it("rejects more decimals than the currency allows instead of rounding", () => {
    expect(() => parseMoney("1.005", "USD")).toThrow(MoneyError);
    expect(() => parseMoney("12.5", "JPY")).toThrow(MoneyError);
    expect(() => parseMoney("12,a", "USD")).toThrow(MoneyError);
  });

  it("parses unit prices to ten-thousandths and percents to basis points", () => {
    expect(parseUnitPrice("11")).toBe(110000);
    expect(parseUnitPrice("0.035")).toBe(350);
    expect(() => parseUnitPrice("0.00001")).toThrow(MoneyError);
    expect(parsePercentToBp("3.4%")).toBe(340);
    expect(parsePercentToBp("25%")).toBe(2500);
  });
});

describe("ML1 lineAmount", () => {
  it("3,000 × $11.0000 = $33,000.00", () => {
    expect(lineAmount(3000, 110000, "USD")).toBe(3_300_000);
  });
  it("400 × $0.0350 = $14.00", () => {
    expect(lineAmount(400, 350, "USD")).toBe(1400);
  });
  it("10 × ¥1,234 = ¥12,340 (zero-decimal currency)", () => {
    expect(lineAmount(10, 12_340_000, "JPY")).toBe(12_340);
  });
});

describe("ML2 rounding", () => {
  it("3 × $0.0050 = 1.5¢ rounds half-up to 2¢", () => {
    expect(lineAmount(3, 50, "USD")).toBe(2);
  });
  it("1 × $0.0049 = 0.49¢ rounds to 0¢", () => {
    expect(lineAmount(1, 49, "USD")).toBe(0);
  });
  it("negative halves round away from zero", () => {
    expect(divRound(-15n, 10n)).toBe(-2n);
    expect(divRound(15n, 10n)).toBe(2n);
  });
});

describe("ML3 allocate", () => {
  it("splits 1000¢ three ways as 334/333/333", () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });
  it("gives the remainder to the largest fractional share", () => {
    // 100 by 1:2 → 33.33 / 66.67 → 33 / 67
    expect(allocate(100, [1, 2])).toEqual([33, 67]);
  });
  it("always sums exactly", () => {
    const parts = allocate(75_001, [2_100_000, 480_000, 13_333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(75_001);
  });
  it("rejects zero or negative weights", () => {
    expect(() => allocate(100, [0, 0])).toThrow(MoneyError);
    expect(() => allocate(100, [1, -1])).toThrow(MoneyError);
  });
});

describe("ML4 pctOf", () => {
  it("3.4% of $21,000.00 = $714.00", () => {
    expect(pctOf(2_100_000, 340)).toBe(71_400);
  });
});

describe("formatting", () => {
  it("formats amounts, unit prices, and rates", () => {
    expect(formatMoney(900_000, "USD")).toBe("USD 9,000.00");
    expect(formatMoney(-5, "USD")).toBe("USD -0.05");
    expect(formatMoney(12_340, "JPY")).toBe("JPY 12,340");
    expect(formatUnitPrice(350)).toBe("0.0350");
    expect(formatBp(340)).toBe("3.40%");
  });
});
