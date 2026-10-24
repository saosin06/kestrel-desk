import { RulesBoard } from "@/components/rules-board";
import { PageHeader } from "@/components/ui";
import { describeRule } from "@/lib/ui/rules";
import { desk } from "@/lib/ui/world";

export const metadata = { title: "Internal rules" };

export default function RulesPage() {
  const { world, rules, cold, learned } = desk();
  const baseline = new Map(cold.map((d) => [`${d.kind} ${d.objectId}`, d.disposition]));
  const effect = (id: string) => learned.filter((d) => d.ruleId === id && d.disposition !== baseline.get(`${d.kind} ${d.objectId}`)).length;
  const views = rules.map((r) => describeRule(r, world.history.exceptions, effect(r.id)));
  const total = views.reduce((a, v) => a + v.effect, 0);
  return (
    <>
      <PageHeader
        title="Internal rules"
        subtitle="How Kestrel actually handles recurring exceptions — the unwritten rules in its own history. The desk applies a rule only after the controller approves it, and a rule can only make routine items quieter; it can never hide a compliance, fraud, duplicate or bank-detail problem."
      />
      <RulesBoard
        views={views}
        historyCount={world.history.exceptions.length}
        totalEffect={total}
      />
    </>
  );
}
