// Scores a desk (agent or rules-engine run) against the answer key: each
// planted item judged by the rules in force on its date.

import type { InternalRule } from "@/lib/rules/types";
import { dispose } from "@/lib/rules/dispose";
import { sweep } from "@/simulation/sweep";
import type { World } from "@/simulation/world";
import type { DeskState } from "./state";

export type Scorecard = {
  expected: number;
  caught: number;
  missed: string[];
  falseFindings: string[];
  duplicates: number;
  identifiedUSDCents: number;
  keyTotalUSDCents: number;
  badPayments: number;
  refusals: number;
};

export function score(w: World, desk: DeskState, rules: InternalRule[]): Scorecard {
  const decided = new Map(dispose(sweep(w), rules).map((d) => [`${d.kind} ${d.objectId}`, d.disposition]));
  const escalates = (kind: string, objectId: string) => decided.get(`${kind} ${objectId}`) !== "info";
  const expected = new Map<string, { id: string; impact: number }>();
  for (const e of w.answerKey.entries) {
    if (escalates(e.kind, e.objectId)) expected.set(`${e.kind} ${e.objectId}`, { id: e.id, impact: e.impactUSDCents });
    for (const s of e.secondary ?? []) if (escalates(s.kind, e.objectId)) expected.set(`${s.kind} ${e.objectId}`, { id: `${e.id} (secondary)`, impact: 0 });
  }
  for (const e of w.answerKey.payroll) {
    if (e.detectedBy === "agent" || escalates(e.kind, e.objectId)) expected.set(`${e.kind} ${e.objectId}`, { id: e.id, impact: e.impactUSDCents });
  }
  const found = new Map<string, string>();
  for (const c of desk.cases) {
    const keys = c.findingKeys.length > 0 ? c.findingKeys : [`${c.kind} ${c.objectIds.find((o) => o.startsWith("MSG-")) ?? c.objectIds[0]}`];
    for (const k of keys) found.set(k, c.id);
  }
  const caught = [...expected.keys()].filter((k) => found.has(k));
  const problemInvoices = new Set(w.answerKey.entries.filter((e) => escalates(e.kind, e.objectId) && e.objectId.startsWith("VI-")).map((e) => e.objectId));
  return {
    expected: expected.size,
    caught: caught.length,
    missed: [...expected.keys()].filter((k) => !found.has(k)).map((k) => `${expected.get(k)!.id} ${k}`),
    falseFindings: [...found.keys()].filter((k) => !expected.has(k)).map((k) => `${found.get(k)} ${k}`),
    duplicates: desk.cases.length - new Set(desk.cases.map((c) => c.findingKeys[0] ?? `${c.kind} ${c.objectIds[0]}`)).size,
    identifiedUSDCents: caught.reduce((a, k) => a + expected.get(k)!.impact, 0),
    keyTotalUSDCents: [...expected.values()].reduce((a, e) => a + e.impact, 0),
    badPayments: desk.requests.filter((r) => r.kind === "payment" && problemInvoices.has(String((r.payload as { invoiceId?: string }).invoiceId))).length,
    refusals: desk.audit.filter((a) => a.detail.startsWith("CONTROL REFUSED")).length,
  };
}

export type ScoreRow = {
  id: string;
  title: string;
  kind: string;
  objectId: string;
  impactUSDCents: number;
  seat: "ap_clerk" | "payroll_specialist";
  /** What the key says should happen under the rules in force on its date. */
  shouldEscalate: boolean;
  disposition: string;
  ruleId?: string;
  reason: string;
  /** The desk case that covers it, if any. */
  caseId: string | null;
  ok: boolean;
};

/** One row per answer-key item: what should have happened and what the desk did. Same matching as score(). */
export function scoreRows(w: World, desk: DeskState, rules: InternalRule[]): { rows: ScoreRow[]; falseFindings: string[] } {
  const decided = new Map(dispose(sweep(w), rules).map((d) => [`${d.kind} ${d.objectId}`, d]));
  const found = new Map<string, string>();
  for (const c of desk.cases) {
    const keys = c.findingKeys.length > 0 ? c.findingKeys : [`${c.kind} ${c.objectIds.find((o) => o.startsWith("MSG-")) ?? c.objectIds[0]}`];
    for (const k of keys) found.set(k, c.id);
  }
  const rows: ScoreRow[] = [];
  const add = (id: string, title: string, kind: string, objectId: string, impact: number, seat: ScoreRow["seat"], agentOnly = false) => {
    const k = `${kind} ${objectId}`;
    const d = decided.get(k);
    const shouldEscalate = agentOnly || d?.disposition !== "info";
    const caseId = found.get(k) ?? null;
    rows.push({
      id, title, kind, objectId, impactUSDCents: impact, seat, shouldEscalate,
      disposition: agentOnly ? "escalate" : (d?.disposition ?? "escalate"),
      ruleId: d?.ruleId,
      reason: agentOnly ? "Found by the agent reading the inbox" : (d?.reason ?? ""),
      caseId,
      ok: shouldEscalate ? caseId !== null : caseId === null,
    });
  };
  for (const e of w.answerKey.entries) {
    add(e.id, e.title, e.kind, e.objectId, e.impactUSDCents, "ap_clerk");
    for (const s of e.secondary ?? []) add(`${e.id} (secondary)`, `${e.title}: also ${s.kind.replaceAll("_", " ")}`, s.kind, e.objectId, 0, "ap_clerk");
  }
  for (const e of w.answerKey.payroll) add(e.id, e.title, e.kind, e.objectId, e.impactUSDCents, "payroll_specialist", e.detectedBy === "agent");
  const keyed = new Set(rows.map((r) => `${r.kind} ${r.objectId}`));
  const falseFindings = [...found.keys()].filter((k) => !keyed.has(k) || !rows.find((r) => `${r.kind} ${r.objectId}` === k)!.shouldEscalate).map((k) => `${found.get(k)} ${k}`);
  return { rows, falseFindings };
}
