// Server-side access to the company records and engine results for pages.
// Never imported by client components (registers and HRIS stay on the server).

import { deskView } from "@/lib/agents/tools";
import { convert } from "@/lib/costing/fx";
import { loadEcbRates } from "@/lib/costing/reference";
import { dispose } from "@/lib/rules/dispose";
import { mineRules } from "@/lib/rules/mine";
import { type Finding, sweep } from "@/simulation/sweep";
import { DEFAULT_SEED, generate, MONTHS, ONBOARDING_REVIEW } from "@/simulation/world";

let memo: ReturnType<typeof build> | undefined;

function build() {
  const world = deskView(generate(DEFAULT_SEED));
  const findings = sweep(world as Parameters<typeof sweep>[0]);
  // The sim's timeline: cold until Dana approves the proposed rules at the March close.
  const rules = mineRules(world.history.exceptions).map((r) => ({ ...r, status: "approved" as const, approvedOn: ONBOARDING_REVIEW }));
  const cold = dispose(findings);
  const learned = dispose(findings, rules);
  const key = (f: { kind: string; objectId: string }) => `${f.kind} ${f.objectId}`;
  const decision = new Map(learned.map((d) => [key(d), d]));
  const fx = loadEcbRates();
  const usd = (minor: number, ccy: Parameters<typeof convert>[2], on: string) => convert(fx, minor, ccy, "USD", on).amountMinor;
  return { world, findings, rules, cold, learned, decision, key, usd };
}

export function desk() {
  memo ??= build();
  return memo;
}

/** Escalations to the controller per month, without and with the learned rules. */
export function escalationsByMonth() {
  const { findings, cold, learned, key } = desk();
  const period = new Map(findings.map((f) => [key(f), f.period]));
  const count = (ds: typeof cold, m: string) => ds.filter((d) => d.disposition === "escalate" && period.get(key(d)) === m).length;
  return MONTHS.map((m) => ({ period: m, cold: count(cold, m), learned: count(learned, m) }));
}

export function findingsFor(objectIds: string[]): (Finding & { disposition: string; ruleId?: string; reason: string })[] {
  const { findings, decision, key } = desk();
  return findings
    .filter((f) => objectIds.includes(f.objectId) || objectIds.some((id) => f.objectId.startsWith(`${id}/`)))
    .map((f) => {
      const d = decision.get(key(f))!;
      return { ...f, disposition: d.disposition, ruleId: d.ruleId, reason: d.reason };
    });
}
