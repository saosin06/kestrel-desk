import { describe, expect, it } from "vitest";
import { dispose } from "@/lib/rules/dispose";
import { mineRules } from "@/lib/rules/mine";
import type { Disposition, InternalRule } from "@/lib/rules/types";
import { sweep } from "./sweep";
import { DEFAULT_SEED, generate, type World } from "./world";

const approve = (rules: readonly Omit<InternalRule, "status" | "support" | "counterexamples" | "confidence" | "evidence">[]): InternalRule[] =>
  rules.map((r) => ({ ...r, status: "approved", support: 0, counterexamples: [], confidence: 1, evidence: [] }));

function expected(w: World, mode: "cold" | "withRules"): Record<string, Disposition> {
  const out: Record<string, Disposition> = {};
  for (const e of w.answerKey.entries) {
    out[`${e.kind} ${e.objectId}`] = e.dispositions[mode];
    for (const s of e.secondary ?? []) out[`${s.kind} ${e.objectId}`] = s[mode];
  }
  for (const e of w.answerKey.payroll.filter((e) => e.detectedBy !== "agent")) out[`${e.kind} ${e.objectId}`] = e.dispositions[mode];
  return out;
}
const actual = (decisions: ReturnType<typeof dispose>) => Object.fromEntries(decisions.map((d) => [`${d.kind} ${d.objectId}`, d.disposition]));
/** the parts of a rule that decide behavior */
const shape = (r: Pick<InternalRule, "scope" | "action">) => {
  const { effectiveFrom: _ignored, ...scope } = r.scope;
  return JSON.stringify({ scope: Object.fromEntries(Object.entries(scope).sort()), action: r.action });
};

describe.each([DEFAULT_SEED, 11])("learning from history, seed %i", (seed) => {
  const w = generate(seed);
  const findings = sweep(w);
  const hidden = w.answerKey.hiddenRules;
  const statistical = hidden.filter((r) => r.discoverableBy === "statistics");

  it("cold (no rules): every finding gets the baseline disposition in the key", () => {
    expect(actual(dispose(findings))).toEqual(expected(w, "cold"));
  });

  it("with the hidden rules approved: dispositions match the key exactly", () => {
    expect(actual(dispose(findings, approve(hidden)))).toEqual(expected(w, "withRules"));
  });

  it("the miner recovers exactly the statistical hidden rules — no decoys, nothing never-learnable", () => {
    const mined = mineRules(w.history.exceptions);
    expect(mined.map(shape).sort()).toEqual(statistical.map(shape).sort());
    const decoyEvidence = new Set(w.answerKey.decoys.flatMap((d) => d.evidence));
    for (const r of mined) expect(r.evidence.filter((id) => decoyEvidence.has(id))).toEqual([]);
  });

  it("mined rules, once approved, give the same dispositions as the hidden rules (end to end)", () => {
    const mined = mineRules(w.history.exceptions).map((r) => ({ ...r, status: "approved" as const }));
    expect(actual(dispose(findings, mined))).toEqual(expected(w, "withRules"));
  });

  it("learned drift and exceptions: the weight-count rule uses the post-memo limit and the 3-in-a-row exception", () => {
    const hr1 = mineRules(w.history.exceptions).find((r) => r.scope.partId === "P14")!;
    expect(hr1.scope.maxAttr).toBe(w.answerKey.historyParams.p14ToleranceBp);
    expect(hr1.scope.unlessConsecutiveMonths).toBe(3);
    expect(hr1.scope.effectiveFrom! > "2025-09-01").toBe(true);
  });

  it("improves: fewer escalations, same findings logged", () => {
    const cold = dispose(findings);
    const warm = dispose(findings, approve(hidden));
    expect(warm).toHaveLength(cold.length);
    const esc = (ds: typeof cold) => ds.filter((d) => d.disposition === "escalate").length;
    expect(esc(warm)).toBeLessThan(esc(cold));
  });

  it("guardrails: no approved rule can quiet compliance, duplicates, unknown suppliers, or material variances", () => {
    const hostile = approve(
      (["noncompliant_substitution", "duplicate_invoice", "unknown_supplier", "missing_document", "price_variance_vs_contract"] as const).map((kind) => ({
        id: `EVIL-${kind}`,
        statement: "accept everything",
        scope: { kind },
        action: { type: "info" as const },
        source: "statistics" as const,
      })),
    );
    const decisions = actual(dispose(findings, hostile));
    for (const e of w.answerKey.entries.filter((e) => [1, 2, 5, 13].includes(e.problem))) {
      expect(decisions[`${e.kind} ${e.objectId}`], e.id).toBe("escalate");
    }
  });
});

describe("hidden rules vary by seed", () => {
  it("seeds 42 and 11 hide different tolerance and rounding", () => {
    const [a, b] = [generate(42).answerKey.historyParams, generate(11).answerKey.historyParams];
    expect(a.p14ToleranceBp).not.toBe(b.p14ToleranceBp);
    expect(a.hoshiRoundingYen).not.toBe(b.hoshiRoundingYen);
  });
});

describe("learning over time (cold until the March close)", () => {
  it("before the rules are approved the desk escalates routine items; after, it follows them", () => {
    const w = generate(DEFAULT_SEED);
    const findings = sweep(w);
    const rules = approve(w.answerKey.hiddenRules).map((r) => ({ ...r, approvedOn: "2026-03-31" }));
    const decided = new Map(dispose(findings, rules).map((d) => [`${d.kind} ${d.objectId}`, d.disposition]));
    const hoshiMarch = w.answerKey.entries.find((e) => e.id === "PAT-HOS-2603")!;
    const hoshiApril = w.answerKey.entries.find((e) => e.id === "PAT-HOS-2604")!;
    expect(decided.get(`${hoshiMarch.kind} ${hoshiMarch.objectId}`)).toBe("escalate");
    expect(decided.get(`${hoshiApril.kind} ${hoshiApril.objectId}`)).toBe("info");
  });
});
