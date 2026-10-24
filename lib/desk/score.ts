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
