import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computePay, federalWithholding, fica, hourlyGross, k401Deferral, salaryGross } from "./compute";
import { loadPayrollReference } from "./reference";
import { type Employee, type W4, ZERO_YTD } from "./types";

const ref = loadPayrollReference();
const w4 = (filingStatus: W4["filingStatus"], extra: Partial<W4> = {}): W4 => ({ filingStatus, step3Cents: 0, step4aCents: 0, step4bCents: 0, step4cCents: 0, ...extra });

describe("reference data matches the cached IRS text", () => {
  it("every STANDARD schedule row equals Pub 15-T (2026) page 12", () => {
    const text = readFileSync(join(import.meta.dirname, "../../data/cache/irs/p15t-2026-pages-10-12.txt"), "utf8");
    const page = text.slice(text.indexOf("===== page 12 ====="));
    const money = (t: string) => Math.round(Number(t.replace(/[$,]/g, "")) * 100);
    const rows = page
      .split("\n")
      .map((l) => l.match(/\$[\d,]+(?:\.\d+)?|\d+%/g) ?? [])
      .filter((t) => t.length === 10 || t.length === 8)
      .map((t) =>
        t.length === 10
          ? { atLeastCents: money(t[0]), lessThanCents: money(t[1]), baseCents: money(t[2]), rateBp: Number(t[3].replace("%", "")) * 100 }
          : { atLeastCents: money(t[0]), lessThanCents: null, baseCents: money(t[1]), rateBp: Number(t[2].replace("%", "")) * 100 },
      );
    expect(rows).toHaveLength(24);
    expect([...ref.schedules.married_filing_jointly, ...ref.schedules.single_or_mfs, ...ref.schedules.head_of_household]).toEqual(rows);
  });

  it("FICA and limits are the 2026 figures", () => {
    expect(ref.ssRateBp).toBe(620);
    expect(ref.ssWageBaseCents).toBe(18_450_000);
    expect(ref.medicareRateBp).toBe(145);
    expect(ref.addlMedicareThresholdCents).toBe(20_000_000);
    expect(ref.k401LimitCents).toBe(2_450_000);
    expect(ref.line1gCents.married_filing_jointly).toBe(1_290_000);
  });
});

describe("federal withholding, Worksheet 1A (hand-computed)", () => {
  it("W1 single, biweekly $4,000.00 → $540.38", () => {
    // 4,000 × 26 = 104,000 − 8,600 = 95,400; 5,800 + 22% × (95,400 − 57,900) = 14,050; ÷ 26 = 540.3846
    expect(federalWithholding(400_000, w4("single_or_mfs"), ref).cents).toBe(54_038);
  });
  it("W2 married filing jointly, $2,730.00 income-tax wages → $159.91; with $2,000 Step 3 credits → $82.98", () => {
    // 2,730 × 26 = 70,980 − 12,900 = 58,080; 2,480 + 12% × 13,980 = 4,157.60; ÷ 26 = 159.9077; − 2,000/26 = 82.9846
    expect(federalWithholding(273_000, w4("married_filing_jointly"), ref).cents).toBe(15_991);
    expect(federalWithholding(273_000, w4("married_filing_jointly", { step3Cents: 200_000 }), ref).cents).toBe(8_298);
  });
  it("W3 below the 0% bracket → $0, and Step 4(c) extra still applies", () => {
    expect(federalWithholding(30_000, w4("single_or_mfs"), ref).cents).toBe(0);
    expect(federalWithholding(30_000, w4("single_or_mfs", { step4cCents: 2_500 }), ref).cents).toBe(2_500);
  });
  it("W4 head of household top bracket: $700,000 adjusted annual → $207,395.50 a year", () => {
    // periods = 1 so the wage is annual; +$8,600 offsets line 1g. 191,171 + 37% × (700,000 − 656,150) = 207,395.50
    expect(federalWithholding(70_000_000 + 860_000, w4("head_of_household"), ref, 1).cents).toBe(20_739_550);
  });
});

describe("FICA (hand-computed)", () => {
  it("F1 plain: $2,880.00 → SS $178.56, Medicare $41.76", () => {
    const f = fica(288_000, ZERO_YTD, ref);
    expect([f.ssCents, f.medicareCents, f.addlMedicareCents]).toEqual([17_856, 4_176, 0]);
  });
  it("F2 crossing the $184,500 wage base mid-run: only $1,500 of $7,500 taxed → $93.00", () => {
    expect(fica(750_000, { ssWagesCents: 18_300_000, medicareWagesCents: 18_300_000 }, ref).ssCents).toBe(9_300);
    expect(fica(750_000, { ssWagesCents: 18_450_000, medicareWagesCents: 18_450_000 }, ref).ssCents).toBe(0);
  });
  it("F3 Additional Medicare starts on the portion over $200,000: $3,500 × 0.9% = $31.50", () => {
    const f = fica(750_000, { ssWagesCents: 18_450_000, medicareWagesCents: 19_600_000 }, ref);
    expect(f.medicareCents).toBe(10_875);
    expect(f.addlMedicareCents).toBe(3_150);
    expect(f.employerMedicareCents).toBe(10_875); // no employer share of Additional Medicare
  });
});

describe("gross pay (hand-computed)", () => {
  it("G1 overtime is per workweek: 50 + 30 h at $30 = 70 × 30 + 10 × 45 = $2,550.00 (not $2,400)", () => {
    const g = hourlyGross(300_000, [{ weekStart: "2026-04-06", hoursE2: 5_000 }, { weekStart: "2026-04-13", hoursE2: 3_000 }], ref);
    expect([g.regularHoursE2, g.overtimeHoursE2, g.grossCents]).toEqual([7_000, 1_000, 255_000]);
  });
  it("G2 44 + 44 h → 8 h overtime; exempt employees get none", () => {
    const weeks = [{ weekStart: "2026-04-06", hoursE2: 4_400 }, { weekStart: "2026-04-13", hoursE2: 4_400 }];
    expect(hourlyGross(300_000, weeks, ref).overtimeHoursE2).toBe(800);
    expect(hourlyGross(300_000, weeks, ref, true).overtimeHoursE2).toBe(0);
  });
  it("G3 salary $130,000 ÷ 26 = $5,000.00", () => {
    expect(salaryGross(13_000_000, ref).grossCents).toBe(500_000);
  });
});

describe("401(k) limit and taxable bases", () => {
  it("K1 deferral capped at the $24,500 limit: 22% of $7,500 = $1,650 but only $700 of room", () => {
    expect(k401Deferral(750_000, 2_200, 2_380_000, ref).cents).toBe(70_000);
    expect(k401Deferral(750_000, 2_200, 2_450_000, ref).cents).toBe(0);
  });
  it("K2 401(k) cuts income-tax wages only; the health premium cuts both (Pub 15 p.51, p.47)", () => {
    const emp: Employee = {
      id: "E-T",
      name: "Test",
      department: "Operations",
      jobTitle: "Analyst",
      flsa: "exempt",
      compensation: [{ effectiveFrom: "2026-01-01", pay: { type: "salary", annualCents: 7_800_000 } }],
      workLocations: [{ effectiveFrom: "2026-01-01", state: "WA" }],
      w4: w4("married_filing_jointly"),
      hireDate: "2020-01-01",
      birthYear: 1990,
      k401Bp: 500,
      healthPremiumCents: 12_000,
      bank: { accountId: "BA-T", last4: "0000" },
    };
    const c = computePay(emp, { id: "PP", start: "2026-04-06", end: "2026-04-19", payDate: "2026-04-24" }, undefined, ZERO_YTD, ref);
    // gross 78,000 / 26 = 3,000.00; 401(k) 5% = 150.00; health 120.00
    expect(c.grossCents).toBe(300_000);
    expect(c.fitWagesCents).toBe(273_000);
    expect(c.ficaWagesCents).toBe(288_000);
    expect(c.fitCents).toBe(15_991);
    expect([c.ssCents, c.medicareCents]).toEqual([17_856, 4_176]);
    // net = 3,000 − 150 − 120 − 159.91 − 178.56 − 41.76 = 2,349.77
    expect(c.netCents).toBe(234_977);
  });
});
