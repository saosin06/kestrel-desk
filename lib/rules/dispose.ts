// Decides what happens to each finding: the baseline controls (CLAUDE.md §9),
// then any approved internal rules, inside guardrails no rule can cross.

import controls from "@/data/controls.json";
import type { CaseKind } from "@/lib/erp/types";
import type { Disposition, FindingFacts, InternalRule } from "./types";

export const MATERIALITY_USD_CENTS = controls.materialityUSDCents;
export const RECURRING_COUNT = controls.recurringCountForMateriality;

/** Variances: below materiality they are info unless they recur. */
const MATERIALITY_GATED: ReadonlySet<CaseKind> = new Set(["price_variance_vs_contract", "duty_overcharge", "fx_variance", "grni_accrual"]);

/** Kinds a loosening rule may touch. Compliance, bank/remittance, duplicates and unknown suppliers never. */
const LOOSENABLE: ReadonlySet<CaseKind> = new Set(["qty_mismatch", "price_variance_vs_contract", "duty_overcharge", "fx_variance", "source_disagreement", "hours_mismatch"]);
/** For source_disagreement, only arithmetic-only gaps are loosenable. */
const LOOSENABLE_DIFFS: ReadonlySet<string> = new Set(["line_amount_mismatch"]);

export type Decision = {
  kind: CaseKind;
  objectId: string;
  disposition: Disposition;
  baseline: Disposition;
  ruleId?: string;
  reason: string;
};

const monthIndex = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7));

function canLoosen(f: FindingFacts): boolean {
  if (!LOOSENABLE.has(f.kind)) return false;
  if (f.kind === "source_disagreement" && !LOOSENABLE_DIFFS.has(f.diffKind ?? "")) return false;
  return Math.abs(f.impactUSDCents ?? 0) < MATERIALITY_USD_CENTS;
}

function matches(rule: InternalRule, f: FindingFacts): boolean {
  const s = rule.scope;
  if (s.kind !== f.kind) return false;
  if (s.diffKind && s.diffKind !== f.diffKind) return false;
  if (s.supplierId && s.supplierId !== f.supplierId) return false;
  if (s.partId && s.partId !== f.partId) return false;
  if (s.department && s.department !== f.department) return false;
  if (s.currency && s.currency !== f.attrs.currency) return false;
  if (s.effectiveFrom && f.date < s.effectiveFrom) return false;
  if (s.attr) {
    const v = f.attrs[s.attr];
    if (v === undefined || (s.maxAttr !== undefined && v > s.maxAttr)) return false;
  }
  return true;
}

/** More specific rules win: part > supplier > any. */
const specificity = (r: InternalRule) => (r.scope.partId ? 4 : 0) + (r.scope.supplierId || r.scope.department ? 2 : 0) + (r.scope.diffKind ? 1 : 0);

export function dispose(findings: readonly FindingFacts[], rules: readonly InternalRule[] = []): Decision[] {
  const approved = rules.filter((r) => r.status === "approved").sort((a, b) => specificity(b) - specificity(a));
  const ordered = [...findings].sort((a, b) => a.date.localeCompare(b.date) || a.objectId.localeCompare(b.objectId));
  const occurrences = new Map<string, number>();
  const monthsSeen = new Map<string, Set<number>>();

  return ordered.map((f) => {
    const recurKey = `${f.supplierId ?? f.department}|${f.kind}|${f.partId ?? f.employeeId}`;
    const count = (occurrences.get(recurKey) ?? 0) + 1;
    occurrences.set(recurKey, count);
    const streakKey = `${recurKey}|${f.diffKind}`;
    const seen = monthsSeen.get(streakKey) ?? new Set<number>();
    seen.add(monthIndex(f.period));
    monthsSeen.set(streakKey, seen);
    let streak = 0;
    for (let m = monthIndex(f.period); seen.has(m); m--) streak++;

    let baseline: Disposition = "escalate";
    let reason = "escalate by default";
    if (MATERIALITY_GATED.has(f.kind)) {
      const material = Math.abs(f.impactUSDCents ?? Infinity) >= MATERIALITY_USD_CENTS;
      if (material) reason = "at or above materiality";
      else if (count >= RECURRING_COUNT) reason = `below materiality but recurring (${count} occurrences)`;
      else {
        baseline = "info";
        reason = "below materiality";
      }
    }
    const base = { kind: f.kind, objectId: f.objectId, baseline };

    const rule = approved.find((r) => matches(r, f));
    if (!rule || baseline !== "escalate") return { ...base, disposition: baseline, reason };

    switch (rule.action.type) {
      case "info": {
        if (!canLoosen(f)) return { ...base, disposition: baseline, ruleId: rule.id, reason: `${rule.id} cannot loosen this finding (guardrail)` };
        const limit = rule.scope.unlessConsecutiveMonths;
        if (limit !== undefined && streak >= limit) {
          return { ...base, disposition: baseline, ruleId: rule.id, reason: `${rule.id} exception: ${streak} consecutive months` };
        }
        return { ...base, disposition: "info", ruleId: rule.id, reason: rule.statement };
      }
      case "require_check":
        return { ...base, disposition: `check:${rule.action.check}`, ruleId: rule.id, reason: rule.statement };
      case "route_to":
        return { ...base, disposition: `route:${rule.action.role}`, ruleId: rule.id, reason: rule.statement };
    }
  });
}
