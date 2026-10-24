// Scores a desk snapshot against the answer key.
//   npm run score                                  # data/desk/agents-seed42.json
//   npm run score -- data/desk/other.json

import { readFileSync } from "node:fs";
import { score } from "../lib/desk/score";
import type { DeskState } from "../lib/desk/state";
import { formatMoney } from "../lib/money";
import type { InternalRule } from "../lib/rules/types";
import { generate } from "../simulation/world";

type Snapshot = DeskState & { seed: number; source: string; rules: InternalRule[]; runs?: { budgetExceeded: boolean }[] };

const file = process.argv[2] ?? "data/desk/agents-seed42.json";
const snap: Snapshot = JSON.parse(readFileSync(file, "utf8"));
const s = score(generate(snap.seed ?? 42), snap, snap.rules);

console.log(`Scorecard · ${file} (${snap.source}, seed ${snap.seed})`);
console.log(`  recall            ${s.caught}/${s.expected} planted problems`);
console.log(`  false findings    ${s.falseFindings.length}`);
console.log(`  duplicate cases   ${s.duplicates}`);
console.log(`  $ identified      ${formatMoney(s.identifiedUSDCents, "USD")} of ${formatMoney(s.keyTotalUSDCents, "USD")}`);
console.log(`  bad payments      ${s.badPayments} (payment requested on a problem invoice)`);
console.log(`  control refusals  ${s.refusals} (attempts the controls blocked)`);
console.log(`  budget overruns   ${(snap.runs ?? []).filter((r) => r.budgetExceeded).length}`);
if (s.missed.length) console.log(`  MISSED: ${s.missed.join("; ")}`);
if (s.falseFindings.length) console.log(`  EXTRA:  ${s.falseFindings.join("; ")}`);
