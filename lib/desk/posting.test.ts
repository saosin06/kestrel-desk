import { describe, expect, it } from "vitest";
import { assertBalanced, diff, postingsFor } from "./posting";

const total = (lines: { debitCents: number; creditCents: number }[] = []) => [lines.reduce((a, l) => a + l.debitCents, 0), lines.reduce((a, l) => a + l.creditCents, 0)];

describe("postingsFor (what the gateway writes once a request is approved)", () => {
  it("a payment writes a bank ACH and a balanced JE: Dr AP, Cr Cash", () => {
    const out = postingsFor({ reqId: "REQ-1", kind: "payment", amountUSDCents: 62440000, payload: { invoiceId: "VI-2603-VIR", remitTo: "VM-VIR" } });
    expect(out.map((p) => p.system)).toEqual(["Bank", "General ledger"]);
    expect(out[1].lines!.map((l) => [l.account, l.debitCents, l.creditCents])).toEqual([["2000", 62440000, 0], ["1000", 0, 62440000]]);
    expect(out[0].memo).toContain("VM-VIR");
  });

  it("a debit memo reduces AP against purchase price variance", () => {
    const [p] = postingsFor({ reqId: "REQ-2", kind: "debit_memo", amountUSDCents: 4200000, payload: { objectIds: ["VI-2604-ATL"] } });
    expect(p.lines!.map((l) => l.account)).toEqual(["2000", "5100"]);
    expect(total(p.lines)).toEqual([4200000, 4200000]);
  });

  it("a payroll run releases to the provider and books net pay", () => {
    const out = postingsFor({ reqId: "REQ-3", kind: "payroll_run_approval", amountUSDCents: 119987198, payload: { runId: "RUN-2026-03-06", excluded: [] } });
    expect(out.map((p) => p.system)).toEqual(["Payroll provider", "General ledger"]);
    expect(total(out[1].lines)).toEqual([119987198, 119987198]);
  });

  it("holds, substitutions and HRIS changes write their own system, with no money moving", () => {
    for (const kind of ["payment_hold", "payroll_line_hold", "substitution_approval", "hris_change"]) {
      const out = postingsFor({ reqId: "REQ-4", kind, amountUSDCents: 205066, payload: { objectIds: ["VI-2604-VIR"], runId: "RUN-2026-04-17", employeeId: "E-9107" } });
      expect(out).toHaveLength(1);
      expect(out[0].lines).toBeUndefined();
    }
  });

  it("zero-amount money requests and unknown kinds post nothing", () => {
    expect(postingsFor({ reqId: "REQ-5", kind: "payment", amountUSDCents: 0, payload: {} })).toEqual([]);
    expect(postingsFor({ reqId: "REQ-6", kind: "something_else", payload: {} })).toEqual([]);
  });

  it("rejects an unbalanced or one-sided entry", () => {
    expect(() => assertBalanced([{ account: "2000", name: "", debitCents: 100, creditCents: 0 }, { account: "1000", name: "", debitCents: 0, creditCents: 99 }])).toThrow(/unbalanced/);
    expect(() => assertBalanced([{ account: "2000", name: "", debitCents: 100, creditCents: 0 }])).toThrow(/unbalanced/);
  });
});

describe("diff (audit trail)", () => {
  it("lists only changed fields, with ∅ for absent values", () => {
    expect(diff({ status: "pending", "approved by": "" }, { status: "approved", "approved by": "controller" })).toEqual([
      { field: "status", before: "pending", after: "approved" },
      { field: "approved by", before: "", after: "controller" },
    ]);
    expect(diff({}, { posted: "JE-000001" })).toEqual([{ field: "posted", before: "∅", after: "JE-000001" }]);
    expect(diff({ a: "1" }, { a: "1" })).toEqual([]);
  });
});
