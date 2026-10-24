// Plain-language view of an internal rule, derived from its structured scope
// and the history records behind it (server-side; no model writes this text).

import partsData from "@/data/parts.json";
import suppliersData from "@/data/suppliers.json";
import type { HistoryException, InternalRule } from "@/lib/rules/types";
import { date, kindLabel } from "./format";

const SUPPLIER = Object.fromEntries(suppliersData.suppliers.map((s) => [s.id, s.name]));
const PART = Object.fromEntries(partsData.parts.map((p) => [p.id, p.name]));

export type RuleView = {
  id: string;
  title: string;
  appliesTo: string;
  does: string;
  exception: string | null;
  tightened: string | null;
  action: string;
  seen: number;
  agreed: number;
  confidence: number;
  period: string;
  explained: { date: string; text: string }[];
  counter: { date: string; text: string }[];
  effect: number;
};

function limitText(rule: InternalRule): string {
  const { attr, maxAttr, currency } = rule.scope;
  if (maxAttr === undefined) return "";
  if (attr === "qtyVarianceBp") return `${(maxAttr / 100).toFixed(2)}%`;
  if (attr === "hoursDiffE2") return `${(maxAttr / 100).toFixed(2)} h (${Math.round((maxAttr / 100) * 60)} minutes)`;
  if (attr === "lineDiffMinor") return currency === "JPY" ? `¥${maxAttr.toLocaleString("en-US")}` : `${maxAttr} minor units`;
  return String(maxAttr);
}

export function describeRule(rule: InternalRule, history: readonly HistoryException[], effect: number): RuleView {
  const s = rule.scope;
  const owner = s.supplierId ? SUPPLIER[s.supplierId] ?? s.supplierId : s.department ? `${s.department} (payroll)` : "All";
  const partName = s.partId ? PART[s.partId] ?? s.partId : null;
  const part = partName ? partName.charAt(0).toLowerCase() + partName.slice(1) : null;
  const poss = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
  const limit = limitText(rule);
  const events = history.filter((e) => rule.evidence.includes(e.id)).sort((a, b) => a.date.localeCompare(b.date));
  const agreed = events.filter((e) => (rule.action.type === "require_check" ? e.resolution.decision === "recount_corrected" : e.resolution.decision === "accepted")).length;
  const others = events.filter((e) => !(rule.action.type === "require_check" ? e.resolution.decision === "recount_corrected" : e.resolution.decision === "accepted"));
  const counterIds = new Set(rule.counterexamples);
  const line = (e: HistoryException) => ({ date: date(e.date), text: `${e.summary}. Dana: “${e.resolution.reason}”` });

  let title: string;
  let does: string;
  switch (s.diffKind ?? s.kind) {
    case "qty_mismatch":
      if (rule.action.type === "require_check") {
        title = `${owner} · quantity disagreements`;
        does = `When a ${owner} receipt disagrees with the packing slip, ask receiving to recount before anything goes to Dana — it has usually been a dock miscount.`;
      } else {
        title = `${owner} · ${part ? part.split(",")[0] + "s" : "items"} counted by weight`;
        does = `When the dock weighs ${poss(owner)} ${part ? part.split(",")[0] + "s" : "items"} and comes up ${limit} short or less, accept the invoice quantity and log it instead of escalating.`;
      }
      break;
    case "line_amount_mismatch":
      title = `${owner} · line-total rounding`;
      does = `When ${poss(owner)} line totals differ from quantity × price by ${limit} or less, it's their billing system rounding — log it and pay the invoiced amount.`;
      break;
    case "hours_mismatch":
      title = `${owner.replace(" (payroll)", "")} · late-punch corrections`;
      does = `When a ${s.department} employee's register shows up to ${limit} more than the approved timesheet, a supervisor fixed a late punch — log it and pay the corrected hours.`;
      break;
    default:
      title = `${owner} · ${s.kind.replaceAll("_", " ")}`;
      does = rule.statement;
  }

  return {
    id: rule.id,
    title,
    appliesTo: [owner, partName, s.diffKind === "line_amount_mismatch" ? "Line total ≠ quantity × price" : kindLabel(s.kind)].filter(Boolean).join(" · "),
    does,
    exception: s.unlessConsecutiveMonths ? `Doesn't apply on the ${s.unlessConsecutiveMonths === 3 ? "third" : `${s.unlessConsecutiveMonths}th`} short month in a row — that's a supplier problem, and it goes to Dana.` : null,
    tightened: s.effectiveFrom ? `Learned from decisions since ${date(s.effectiveFrom)}, when Dana tightened the limit; older, looser acceptances are ignored.` : null,
    action: rule.action.type === "info" ? "Log, don't escalate" : rule.action.type === "require_check" ? "Recount first" : `Route to ${rule.action.role}`,
    seen: events.length,
    agreed,
    confidence: rule.confidence,
    period: events.length ? `${date(events[0].date)} – ${date(events.at(-1)!.date)}` : "—",
    explained: others.filter((e) => !counterIds.has(e.id)).map(line),
    counter: others.filter((e) => counterIds.has(e.id)).map(line),
    effect,
  };
}
