// The scorecard page: the saved agent run graded row by row against the answer key
// (server-side only; the agents' tools never read the key, only this scorer does).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { score, scoreRows } from "@/lib/desk/score";
import type { DeskState } from "@/lib/desk/state";
import type { InternalRule } from "@/lib/rules/types";
import { sweep } from "@/simulation/sweep";
import { DEFAULT_SEED, generate, type World } from "@/simulation/world";
import { story } from "./story";

type Snapshot = DeskState & { rules: InternalRule[]; source: string; seed: number; runs?: { budgetExceeded: boolean }[] };

const keyOf = (kind: string, objectId: string) => `${kind} ${objectId}`;

/** The deterministic sweep finds exactly the key's problems, no more, no fewer (also a test, for both seeds). */
function baselineExact(w: World) {
  const expected = [
    ...w.answerKey.entries.flatMap((e) => [keyOf(e.kind, e.objectId), ...(e.secondary ?? []).map((x) => keyOf(x.kind, e.objectId))]),
    ...w.answerKey.payroll.filter((e) => e.detectedBy !== "agent").map((e) => keyOf(e.kind, e.objectId)),
  ].sort();
  const found = sweep(w).map((f) => keyOf(f.kind, f.objectId)).sort();
  return { exact: JSON.stringify(found) === JSON.stringify(expected), count: expected.length };
}

let memo: ReturnType<typeof build> | undefined;

function build() {
  const snap = JSON.parse(readFileSync(join(process.cwd(), "data/desk/agents-seed42.json"), "utf8")) as Snapshot;
  const w = generate(snap.seed ?? DEFAULT_SEED);
  const card = score(w, snap, snap.rules);
  const { rows, falseFindings } = scoreRows(w, snap, snap.rules);
  const ruleTitle = new Map(story().rules.map((r) => [r.id, r.title]));
  return {
    card,
    rows: rows.map((r) => ({ ...r, ruleTitle: r.ruleId ? ruleTitle.get(r.ruleId) ?? r.ruleId : null })),
    falseFindings,
    budgetOverruns: (snap.runs ?? []).filter((r) => r.budgetExceeded).length,
    seeds: [
      { seed: snap.seed ?? DEFAULT_SEED, ...baselineExact(w) },
      { seed: 11, ...baselineExact(generate(11)) },
    ],
    clean: w.answerKey.cleanSuppliers.map((id) => {
      const invoices = new Set(w.invoices.filter((i) => i.supplierId === id).map((i) => i.id));
      return { supplierId: id, invoices: invoices.size, cases: snap.cases.filter((c) => c.objectIds.some((o) => invoices.has(o))).length };
    }),
    deferred: w.answerKey.deferredProblems,
  };
}

export function scorecard() {
  memo ??= build();
  return memo;
}
