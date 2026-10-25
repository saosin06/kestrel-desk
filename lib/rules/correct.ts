// Every correction becomes precedent. A controller decision on a learnable case is
// recorded exactly like a history exception, and the miner re-runs over history plus
// corrections with the same thresholds and guardrails. Deterministic: no model involved.

import type { CaseKind } from "@/lib/erp/types";
import { MIN_SUPPORT, mineRules, NEVER_LEARNABLE } from "./mine";
import type { FindingFacts, HistoryDecision, HistoryException, InternalRule } from "./types";

export type CorrectionInput = {
  /** LC-000001, … */
  id: string;
  finding: FindingFacts;
  summary: string;
  raisedBy: HistoryException["raisedBy"];
  by: HistoryException["resolution"]["decidedBy"];
  decision: HistoryDecision;
  reason: string;
  at: string;
  /** the case's learned-rule ids and disposition when the desk raised it */
  caseRuleIds: string[];
  caseDisposition: string;
};

export type RuleChange = { ruleId: string; patch: Partial<InternalRule>; before: Partial<InternalRule>; effect: string };
export type Learning = { precedent: HistoryException | null; changes: RuleChange[]; proposals: InternalRule[]; effects: string[] };

/** What a decision on a hold or debit memo says about the finding. */
export function decisionFor(requestKind: string, status: "approved" | "rejected"): HistoryDecision | null {
  if (requestKind === "payment_hold" || requestKind === "payroll_line_hold") return status === "approved" ? "rejected" : "accepted";
  if (requestKind === "debit_memo") return status === "approved" ? "debit_memo" : "accepted";
  return null;
}

export const isLearnable = (kind: CaseKind) => !NEVER_LEARNABLE.has(kind);

export function precedentFrom(c: CorrectionInput): HistoryException {
  const f = c.finding;
  return {
    id: c.id,
    date: f.date,
    supplierId: f.supplierId,
    partId: f.partId,
    department: f.department,
    employeeId: f.employeeId,
    kind: f.kind,
    diffKind: f.diffKind,
    impactUSDCents: f.impactUSDCents ?? 0,
    attrs: f.attrs,
    summary: c.summary,
    raisedBy: c.raisedBy,
    resolution: { decidedBy: c.by, decision: c.decision, reason: c.reason, date: c.at },
  };
}

/** Deep equality that ignores key order (Convex returns object keys sorted). */
const canon = (x: unknown): unknown => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canon(v)])) : x);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const pct = (x: number) => x.toFixed(3);

/**
 * Re-mines with the new precedent and says what changed. Strengthening an approved rule
 * (same scope, more support) applies at once; anything that changes a rule's limit, or a
 * correction that overrules what a rule did, sends the rule back to the controller.
 */
export function learnFromCorrection(history: readonly HistoryException[], prior: readonly HistoryException[], c: CorrectionInput, current: readonly InternalRule[]): Learning {
  if (!isLearnable(c.finding.kind)) {
    return { precedent: null, changes: [], proposals: [], effects: [`Not learnable: ${c.finding.kind.replaceAll("_", " ")} findings never become precedent, whatever the decision.`] };
  }
  const precedent = precedentFrom(c);
  const mined = mineRules([...history, ...prior, precedent]);
  const touched = mined.filter((r) => r.evidence.includes(precedent.id));
  const changes: RuleChange[] = [];
  const proposals: InternalRule[] = [];
  const effects: string[] = [];

  for (const m of touched) {
    const cur = current.find((r) => r.id === m.id);
    if (!cur) {
      proposals.push({ ...m, status: "proposed", source: "correction" });
      effects.push(`New rule proposed for Dana's approval: ${m.statement}`);
      continue;
    }
    const overruled = c.caseRuleIds.includes(m.id) && c.caseDisposition === "escalate" && c.decision === "accepted";
    if (overruled) {
      changes.push({
        ruleId: m.id,
        before: { status: cur.status, support: cur.support },
        patch: { status: "in_review", support: m.support, confidence: m.confidence, evidence: m.evidence, counterexamples: [...new Set([...cur.counterexamples, precedent.id])] },
        effect: `${m.id}: Dana accepted an item the rule escalated, so the rule goes back to her for review (counterexample ${precedent.id}).`,
      });
    } else if (same(cur.scope, m.scope) && same(cur.action, m.action)) {
      changes.push({
        ruleId: m.id,
        before: { support: cur.support, confidence: cur.confidence },
        patch: { support: m.support, confidence: m.confidence, evidence: m.evidence, counterexamples: m.counterexamples, statement: m.statement },
        effect: `${m.id} strengthened: support ${cur.support} → ${m.support}, confidence ${pct(cur.confidence)} → ${pct(m.confidence)}.`,
      });
    } else {
      changes.push({
        ruleId: m.id,
        before: { status: cur.status, statement: cur.statement },
        patch: { status: "in_review", scope: m.scope, statement: m.statement, support: m.support, confidence: m.confidence, evidence: m.evidence, counterexamples: m.counterexamples },
        effect: `${m.id}: the correction changes the rule's limit (${m.statement}), so it goes back to Dana for review.`,
      });
    }
  }

  // An approved rule this correction falls under that no longer clears the thresholds.
  for (const cur of current.filter((r) => r.status === "approved" && r.scope.kind === precedent.kind && (r.scope.supplierId ?? r.scope.department) === (precedent.supplierId ?? precedent.department))) {
    if (!mined.some((m) => m.id === cur.id) && !changes.some((ch) => ch.ruleId === cur.id)) {
      changes.push({ ruleId: cur.id, before: { status: cur.status }, patch: { status: "in_review" }, effect: `${cur.id} no longer meets the thresholds with this correction, so it goes back to Dana for review.` });
    }
  }

  if (effects.length === 0 && changes.length === 0) {
    const owner = precedent.supplierId ?? precedent.department;
    const n = [...history, ...prior, precedent].filter((e) => (e.supplierId ?? e.department) === owner && e.kind === precedent.kind && e.diffKind === precedent.diffKind).length;
    effects.push(`Recorded as precedent ${precedent.id}. ${owner} now has ${n} past ${precedent.kind.replaceAll("_", " ")} decision${n === 1 ? "" : "s"}${n < MIN_SUPPORT ? ` (a rule needs ${MIN_SUPPORT})` : ", but they don't agree enough to make a rule"}.`);
  }
  return { precedent, changes, proposals, effects: [...effects, ...changes.map((ch) => ch.effect)] };
}
