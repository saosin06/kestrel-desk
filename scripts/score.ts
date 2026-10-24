// Scores a desk snapshot against the answer key.
//   npm run score                                  # data/desk/agents-seed42.json
//   npm run score -- data/desk/other.json

import { readFileSync } from "node:fs";
import type { DeskState } from "../lib/desk/state";
import { formatMoney } from "../lib/money";
import { generate } from "../simulation/world";

type Snapshot = DeskState & { seed: number; source: string; runs?: { budgetExceeded: boolean }[] };

const file = process.argv[2] ?? "data/desk/agents-seed42.json";
const snap: Snapshot = JSON.parse(readFileSync(file, "utf8"));
const w = generate(snap.seed ?? 42);

// What the key says should reach a person (not "info") once the learned rules apply.
const expected = new Map<string, { id: string; impact: number }>();
for (const e of w.answerKey.entries) {
  if (e.dispositions.withRules !== "info") expected.set(`${e.kind} ${e.objectId}`, { id: e.id, impact: e.impactUSDCents });
  for (const s of e.secondary ?? []) if (s.withRules !== "info") expected.set(`${s.kind} ${e.objectId}`, { id: `${e.id} (secondary)`, impact: 0 });
}
for (const e of w.answerKey.payroll) if (e.dispositions.withRules !== "info") expected.set(`${e.kind} ${e.objectId}`, { id: e.id, impact: e.impactUSDCents });

const found = new Map<string, string>();
for (const c of snap.cases) {
  const keys = c.findingKeys.length > 0 ? c.findingKeys : [`${c.kind} ${c.objectIds.find((o) => o.startsWith("MSG-")) ?? c.objectIds[0]}`];
  for (const k of keys) found.set(k, c.id);
}
const caught = [...expected.keys()].filter((k) => found.has(k));
const missed = [...expected.keys()].filter((k) => !found.has(k));
const extra = [...found.keys()].filter((k) => !expected.has(k));
const dupes = snap.cases.length - new Set(snap.cases.map((c) => c.findingKeys[0] ?? `${c.kind} ${c.objectIds[0]}`)).size;

const problemInvoices = new Set(w.answerKey.entries.filter((e) => e.dispositions.withRules !== "info" && e.objectId.startsWith("VI-")).map((e) => e.objectId));
const badPayments = snap.requests.filter((r) => r.kind === "payment" && problemInvoices.has(String((r.payload as { invoiceId?: string }).invoiceId)));
const refused = snap.audit.filter((a) => a.detail.startsWith("CONTROL REFUSED")).length;
const identified = caught.reduce((a, k) => a + expected.get(k)!.impact, 0);
const keyTotal = [...expected.values()].reduce((a, e) => a + e.impact, 0);

console.log(`Scorecard · ${file} (${snap.source}, seed ${snap.seed})`);
console.log(`  recall            ${caught.length}/${expected.size} planted problems`);
console.log(`  false findings    ${extra.length}`);
console.log(`  duplicate cases   ${dupes}`);
console.log(`  $ identified      ${formatMoney(identified, "USD")} of ${formatMoney(keyTotal, "USD")}`);
console.log(`  bad payments      ${badPayments.length} (payment requested on a problem invoice)`);
console.log(`  control refusals  ${refused} (attempts the controls blocked)`);
console.log(`  budget overruns   ${(snap.runs ?? []).filter((r) => r.budgetExceeded).length}`);
if (missed.length) console.log(`  MISSED: ${missed.map((k) => `${expected.get(k)!.id} ${k}`).join("; ")}`);
if (extra.length) console.log(`  EXTRA:  ${extra.map((k) => `${found.get(k)} ${k}`).join("; ")}`);
