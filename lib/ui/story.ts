// Everything the story page shows, computed from the saved agent run and the
// engines (server-side only; the answer key is used for scoring, never shown).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { score } from "@/lib/desk/score";
import type { DeskState } from "@/lib/desk/state";
import { mineRules, notLearned } from "@/lib/rules/mine";
import type { InternalRule } from "@/lib/rules/types";
import { DEFAULT_SEED, generate, ONBOARDING_REVIEW } from "@/simulation/world";
import { describeRule } from "./rules";
import { desk, escalationsByMonth } from "./world";

type Snapshot = DeskState & { rules: InternalRule[]; source: string };

let memo: ReturnType<typeof build> | undefined;

function build() {
  const snap = JSON.parse(readFileSync(join(process.cwd(), "data/desk/agents-seed42.json"), "utf8")) as Snapshot;
  const full = generate(DEFAULT_SEED);
  const card = score(full, snap, snap.rules);
  const { world, learned, cold } = desk();
  const baseline = new Map(cold.map((d) => [`${d.kind} ${d.objectId}`, d.disposition]));
  const effect = (id: string) => learned.filter((d) => d.ruleId === id && d.disposition !== baseline.get(`${d.kind} ${d.objectId}`)).length;
  const rules = mineRules(world.history.exceptions).map((r) => describeRule(r, world.history.exceptions, effect(r.id)));
  const refused = notLearned(world.history.exceptions);
  const timeline = escalationsByMonth();
  const caseOf = (kind: string) => snap.cases.find((c) => c.kind === kind);
  return {
    card,
    rules,
    refused,
    timeline,
    historyCount: world.history.exceptions.length,
    review: ONBOARDING_REVIEW,
    cases: {
      substitution: caseOf("noncompliant_substitution"),
      scam: caseOf("direct_deposit_change_unverified"),
      ghost: caseOf("ghost_employee"),
    },
  };
}

export function story() {
  memo ??= build();
  return memo;
}
