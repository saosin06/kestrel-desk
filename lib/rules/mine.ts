// Mines candidate internal rules from the exception history. All statistics
// are deterministic: support, agreement, thresholds, drift, and exceptions.
// (An LLM later drafts the wording and reads memos; it never sets numbers.)

import type { CaseKind, ISODate } from "@/lib/erp/types";
import type { HistoryException, InternalRule, RuleAttr, RuleScope } from "./types";

export const MIN_SUPPORT = 5;
export const MIN_CONFIDENCE = 0.75;

/** Never mined, whatever the history says (CLAUDE.md §7a guardrails). */
const NEVER_LEARNABLE: ReadonlySet<CaseKind> = new Set([
  "noncompliant_substitution",
  "missing_document",
  "remittance_change_unverified",
  "duplicate_invoice",
  "unknown_supplier",
]);

const ATTR_FOR: Partial<Record<string, RuleAttr>> = { qty_mismatch: "qtyVarianceBp", line_amount_mismatch: "lineDiffMinor" };

const monthIndex = (date: ISODate) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

/** For each event, how many months in a row (ending at its month) the group had an event. */
function streaks(events: HistoryException[]): Map<string, number> {
  const months = new Set(events.map((e) => monthIndex(e.date)));
  return new Map(
    events.map((e) => {
      let n = 0;
      for (let m = monthIndex(e.date); months.has(m); m--) n++;
      return [e.id, n];
    }),
  );
}

type Group = { key: string; scope: Omit<RuleScope, "attr" | "maxAttr">; events: HistoryException[] };

function groups(history: readonly HistoryException[]): Group[] {
  const out = new Map<string, Group>();
  const add = (key: string, scope: Group["scope"], e: HistoryException) => {
    const g = out.get(key) ?? { key, scope, events: [] };
    g.events.push(e);
    out.set(key, g);
  };
  for (const e of history) {
    if (NEVER_LEARNABLE.has(e.kind)) continue;
    const base = { kind: e.kind, diffKind: e.diffKind, supplierId: e.supplierId, ...(e.attrs.currency ? { currency: e.attrs.currency } : {}) };
    add(`${e.supplierId}|${e.kind}|${e.diffKind}|*`, base, e);
    if (e.partId) add(`${e.supplierId}|${e.kind}|${e.diffKind}|${e.partId}`, { ...base, partId: e.partId }, e);
  }
  return [...out.values()];
}

function candidate(g: Group): InternalRule | null {
  const events = [...g.events].sort((a, b) => a.date.localeCompare(b.date));
  if (events.length < MIN_SUPPORT) return null;
  const count = (d: string) => events.filter((e) => e.resolution.decision === d).length;
  const accepted = count("accepted");
  const recounts = count("recount_corrected");
  const ids = events.map((e) => e.id);
  const scopeKey = `${g.scope.supplierId}${g.scope.partId ? "/" + g.scope.partId : ""}`;

  // Tightening: most of these were dock errors fixed by a recount.
  if (recounts > accepted) {
    const confidence = (recounts + 1) / (events.length + 2);
    if (confidence < MIN_CONFIDENCE) return null;
    return {
      id: `R-${scopeKey}-${g.scope.kind}-recount`,
      statement: `${g.scope.supplierId} ${g.scope.kind} findings were dock miscounts ${recounts} of ${events.length} times: request a recount before escalating.`,
      scope: g.scope,
      action: { type: "require_check", check: "recount" },
      status: "proposed",
      source: "statistics",
      support: events.length,
      counterexamples: events.filter((e) => e.resolution.decision !== "recount_corrected").map((e) => e.id),
      confidence,
      evidence: ids,
    };
  }

  // Loosening: the controller keeps accepting these. Learn the bound, its drift, and its exceptions.
  const attr = ATTR_FOR[g.scope.diffKind ?? ""];
  if (!attr) return null;
  const value = (e: HistoryException) => e.attrs[attr];
  if (events.some((e) => value(e) === undefined)) return null;

  const streak = streaks(events);
  const rejects = events.filter((e) => e.resolution.decision !== "accepted");
  // A reject explained by a streak of 3+ months is an exception to the rule, not evidence against it.
  const streakRejects = rejects.filter((e) => streak.get(e.id)! >= 3);
  // A reject inside the range accepted before it marks a tighter regime (drift): learn from after it.
  let regimeStart: ISODate | undefined;
  for (const r of rejects.filter((e) => !streakRejects.includes(e))) {
    const priorMax = Math.max(...events.filter((e) => e.date < r.date && e.resolution.decision === "accepted").map((e) => value(e)!), -Infinity);
    if (value(r)! <= priorMax) regimeStart = r.date;
  }
  const regime = events.filter((e) => !regimeStart || e.date >= regimeStart);
  const regimeAccepted = regime.filter((e) => e.resolution.decision === "accepted");
  if (regimeAccepted.length === 0) return null;
  const maxAttr = Math.max(...regimeAccepted.map((e) => value(e)!));

  const explained = new Set([...streakRejects.map((e) => e.id), ...(regimeStart ? rejects.filter((e) => e.date === regimeStart).map((e) => e.id) : [])]);
  const unexplained = rejects.filter((e) => !explained.has(e.id));
  const confidence = (accepted + 1) / (accepted + unexplained.length + 2);
  if (confidence < MIN_CONFIDENCE) return null;

  const unlessConsecutiveMonths = streakRejects.length > 0 ? Math.min(...streakRejects.map((e) => streak.get(e.id)!)) : undefined;
  return {
    id: `R-${scopeKey}-${g.scope.kind}-${attr}`,
    statement:
      `Controller accepted ${accepted} of ${events.length} ${g.scope.supplierId} ${g.scope.diffKind} findings with ${attr} ≤ ${maxAttr}` +
      (regimeStart ? ` (since ${regimeStart})` : "") +
      (unlessConsecutiveMonths ? `, except after ${unlessConsecutiveMonths} months in a row` : "") +
      ".",
    scope: { ...g.scope, attr, maxAttr, ...(regimeStart ? { effectiveFrom: regimeStart } : {}), ...(unlessConsecutiveMonths ? { unlessConsecutiveMonths } : {}) },
    action: { type: "info" },
    status: "proposed",
    source: "statistics",
    support: events.length,
    counterexamples: unexplained.map((e) => e.id),
    confidence,
    evidence: ids,
  };
}

/**
 * Candidate rules from history. When a part-level group and its supplier-level
 * group cover the same events, keep the narrower one.
 */
export function mineRules(history: readonly HistoryException[]): InternalRule[] {
  const all = groups(history)
    .map((g) => ({ g, rule: candidate(g) }))
    .filter((x): x is { g: Group; rule: InternalRule } => x.rule !== null);
  const family = (x: { g: Group; rule: InternalRule }) => `${x.g.scope.supplierId}|${x.rule.scope.kind}|${x.rule.scope.diffKind}|${x.rule.action.type}`;
  const sameEvents = (a: Group, b: Group) => a.events.length === b.events.length && a.events.every((e) => b.events.includes(e));
  return all
    .filter((x) => {
      const broad = all.find((o) => !o.g.scope.partId && family(o) === family(x));
      if (x.g.scope.partId) {
        // A part-level rule survives only when it IS the whole pattern (same events as the supplier level).
        return !broad || sameEvents(broad.g, x.g);
      }
      // A supplier-level rule yields to a part-level rule covering exactly the same events.
      return !all.some((o) => o.g.scope.partId && family(o) === family(x) && sameEvents(o.g, x.g));
    })
    .map(({ rule }) => rule)
    .sort((a, b) => a.id.localeCompare(b.id));
}
