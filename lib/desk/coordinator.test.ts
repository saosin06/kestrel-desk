import { describe, expect, it } from "vitest";
import { deskView } from "@/lib/agents/tools";
import { mineRules } from "@/lib/rules/mine";
import { generate } from "@/simulation/world";
import { BLOCKING_KINDS } from "./controls";
import { runDeterministicDesk } from "./coordinator";

const world = generate(42);
const rules = mineRules(world.history.exceptions).map((r) => ({ ...r, status: "approved" as const, decidedBy: "controller" as const, decidedAt: "2026-03-01" }));
const desk = runDeterministicDesk(deskView(world), rules);

describe("deterministic desk (Mar–Sep)", () => {
  it("opens a case for every finding the key expects to escalate or route, and none for info", () => {
    const expected = [
      ...world.answerKey.entries.filter((e) => e.dispositions.withRules !== "info").map((e) => `${e.kind} ${e.objectId}`),
      ...world.answerKey.entries.flatMap((e) => (e.secondary ?? []).filter((s) => s.withRules !== "info").map((s) => `${s.kind} ${e.objectId}`)),
      ...world.answerKey.payroll.filter((e) => e.detectedBy !== "agent" && e.dispositions.withRules !== "info").map((e) => `${e.kind} ${e.objectId}`),
    ].sort();
    expect(desk.cases.flatMap((c) => c.findingKeys).sort()).toEqual(expected);
  });

  it("never requests payment for an invoice with a blocking case", () => {
    for (const r of desk.requests.filter((r) => r.kind === "payment")) {
      const id = (r.payload as { invoiceId: string }).invoiceId;
      expect(desk.cases.some((c) => c.objectIds.includes(id) && BLOCKING_KINDS.has(c.kind)), id).toBe(false);
    }
  });

  it("request ids are unique and every case has an evidence path", () => {
    expect(new Set(desk.requests.map((r) => r.id)).size).toBe(desk.requests.length);
    for (const c of desk.cases) expect(c.evidence[0].path.length, c.id).toBeGreaterThan(1);
  });

  it("the substitution needs engineering + controller; held payroll lines are excluded from their run's approval", () => {
    const sub = desk.cases.find((c) => c.kind === "noncompliant_substitution")!;
    expect(desk.requests.filter((r) => r.caseId === sub.id).map((r) => [r.kind, r.requiredApprovers])).toEqual([
      ["payment_hold", ["engineering", "controller"]],
      ["substitution_approval", ["engineering", "controller"]],
    ]);
    const ghost = desk.cases.find((c) => c.kind === "ghost_employee")!;
    const [runId, emp] = ghost.objectIds[0].split("/");
    const approval = desk.requests.find((r) => r.kind === "payroll_run_approval" && (r.payload as { runId: string }).runId === runId)!;
    expect((approval.payload as { excluded: string[] }).excluded).toContain(emp);
  });

  it("the audit trail is append-only and in date order", () => {
    expect(desk.audit.map((a) => a.seq)).toEqual(desk.audit.map((_, i) => i + 1));
    for (let i = 1; i < desk.audit.length; i++) expect(desk.audit[i].at >= desk.audit[i - 1].at).toBe(true);
    expect(Object.isFrozen(desk.audit[0])).toBe(true);
  });
});
