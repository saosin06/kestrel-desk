import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sweep } from "@/simulation/sweep";
import { DEFAULT_SEED, generate } from "@/simulation/world";
import { type CorrectionInput, decisionFor, learnFromCorrection } from "./correct";
import type { FindingFacts, HistoryException, InternalRule } from "./types";

const w = generate(DEFAULT_SEED);
const history = w.history.exceptions;
const findings = sweep(w) as FindingFacts[];
const snap = JSON.parse(readFileSync(join(import.meta.dirname, "../../data/desk/agents-seed42.json"), "utf8")) as { rules: InternalRule[] };
const rules = snap.rules;
const find = (kind: string, objectId: string) => findings.find((f) => f.kind === kind && f.objectId === objectId)!;

const input = (finding: FindingFacts, decision: CorrectionInput["decision"], extra: Partial<CorrectionInput> = {}): CorrectionInput => ({
  id: "LC-000001", finding, summary: "test", raisedBy: "ap_clerk", by: "controller", decision, reason: "test", at: "2026-09-30", caseRuleIds: [], caseDisposition: "escalate", ...extra,
});

describe("decisionFor", () => {
  it("rejecting a hold means the item was fine; approving it means it was a problem", () => {
    expect(decisionFor("payment_hold", "rejected")).toBe("accepted");
    expect(decisionFor("payroll_line_hold", "approved")).toBe("rejected");
    expect(decisionFor("debit_memo", "approved")).toBe("debit_memo");
    expect(decisionFor("payment", "approved")).toBeNull();
  });
});

describe("learnFromCorrection (every correction becomes precedent)", () => {
  it("Dana releases the March Hoshi rounding hold: the Hoshi rule gains a precedent and stays approved", () => {
    const l = learnFromCorrection(history, [], input(find("source_disagreement", "VI-2603-HOS"), "accepted"), rules);
    const ch = l.changes.find((c) => c.ruleId === "R-S-HOS-source_disagreement-lineDiffMinor")!;
    expect(ch.patch.support).toBe(15);
    expect(ch.patch.status).toBeUndefined();
    expect(ch.patch.evidence).toContain("LC-000001");
    expect(ch.patch.confidence!).toBeGreaterThan(rules.find((r) => r.id === ch.ruleId)!.confidence);
    expect(l.proposals).toEqual([]);
  });

  it("rules read back from Convex (keys sorted) still compare equal", () => {
    const sorted = rules.map((r) => ({ ...r, scope: Object.fromEntries(Object.entries(r.scope).sort(([a], [b]) => a.localeCompare(b))) as InternalRule["scope"] }));
    const l = learnFromCorrection(history, [], input(find("source_disagreement", "VI-2603-HOS"), "accepted"), sorted);
    expect(l.effects[0]).toMatch(/strengthened: support 14 → 15/);
  });

  it("Dana accepts the third-month Atlas shortage the rule escalated: the rule goes back to review", () => {
    const id = "R-S-ATL/P14-qty_mismatch-qtyVarianceBp";
    const l = learnFromCorrection(history, [], input(find("qty_mismatch", "VI-2609-ATL"), "accepted", { caseRuleIds: [id] }), rules);
    const ch = l.changes.find((c) => c.ruleId === id)!;
    expect(ch.patch.status).toBe("in_review");
    expect(ch.patch.counterexamples).toContain("LC-000001");
  });

  it("Dana upholds a hold a rule would have quieted: the rule no longer clears the thresholds and goes to review", () => {
    const l = learnFromCorrection(history, [], input(find("source_disagreement", "VI-2603-HOS"), "rejected"), rules);
    expect(l.changes.find((c) => c.ruleId === "R-S-HOS-source_disagreement-lineDiffMinor")?.patch.status).toBe("in_review");
    // Hoshi recurs every month: an unbroken run is not an "N months in a row" exception.
    expect(l.effects.join(" ")).not.toMatch(/months in a row/);
  });

  it("compliance, fraud and duplicates never become precedent", () => {
    for (const [kind, id] of [["noncompliant_substitution", "VI-2604-VIR"], ["duplicate_invoice", "VI-2606-RDG-2"]] as const) {
      const l = learnFromCorrection(history, [], input(find(kind, id), "accepted"), rules);
      expect(l.precedent).toBeNull();
      expect(l.changes).toEqual([]);
      expect(l.effects[0]).toMatch(/never become precedent/);
    }
  });

  it("a pattern that reaches the threshold with corrections becomes a proposed rule, not an approved one", () => {
    const past: HistoryException[] = [1, 2, 3, 4].map((i) => ({
      id: `HX-T${i}`, date: `2025-0${i}-10`, supplierId: "S-TST", kind: "qty_mismatch", diffKind: "qty_mismatch", impactUSDCents: 100,
      attrs: { qtyVarianceBp: 20 + i }, summary: "t", raisedBy: "ap_clerk", resolution: { decidedBy: "controller", decision: "accepted", reason: "fine", date: `2025-0${i}-12` },
    }));
    const finding: FindingFacts = { kind: "qty_mismatch", objectId: "VI-T", date: "2026-05-10", period: "2026-05", supplierId: "S-TST", diffKind: "qty_mismatch", attrs: { qtyVarianceBp: 30 } };
    const below = learnFromCorrection(past.slice(0, 3), [], input(finding, "accepted"), []);
    expect(below.proposals).toEqual([]);
    expect(below.effects[0]).toMatch(/now has 4 past .* \(a rule needs 5\)/);
    const at = learnFromCorrection(past, [], input(finding, "accepted"), []);
    expect(at.proposals).toHaveLength(1);
    expect(at.proposals[0].status).toBe("proposed");
    expect(at.proposals[0].source).toBe("correction");
    expect(at.proposals[0].evidence).toContain("LC-000001");
  });
});
