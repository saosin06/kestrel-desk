// Replaces the desk in Convex with a full Mar–Sep run.
//   npm run seed                      # deterministic desk (rules engine, no API calls)
//   npm run seed -- --snapshot FILE   # a saved agent run (data/desk/*.json)

import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { deskView } from "../lib/agents/tools";
import { type DeskRule, runDeterministicDesk } from "../lib/desk/coordinator";
import type { DeskState } from "../lib/desk/state";
import { mineRules } from "../lib/rules/mine";
import { DEFAULT_SEED, generate, SIM_WINDOW } from "../simulation/world";

type Snapshot = DeskState & { rules: DeskRule[]; source: string };

function deterministic(): Snapshot {
  const world = generate(DEFAULT_SEED);
  // Dana reviewed the mined rules at the start of the sim; the in-sim review flow comes with her persona.
  const rules: DeskRule[] = mineRules(world.history.exceptions).map((r) => ({
    ...r,
    status: "approved",
    decidedBy: "controller",
    decidedAt: SIM_WINDOW.from,
    decisionReason: "Matches how we've handled these; evidence reviewed.",
  }));
  return { ...runDeterministicDesk(deskView(world), rules), source: "rules-engine" };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set (run `npx convex dev` once; it writes .env.local)");
  const i = process.argv.indexOf("--snapshot");
  const snap: Snapshot = i >= 0 ? JSON.parse(readFileSync(process.argv[i + 1], "utf8")) : deterministic();

  const client = new ConvexHttpClient(url);
  for (const table of ["cases", "requests", "audit", "messages", "rules", "meta"] as const) {
    let more = true;
    while (more) more = (await client.mutation(api.admin.clear, { table })).more;
  }

  const requestedOn = new Map<string, string>();
  for (const a of snap.audit) if (a.action.startsWith("request:")) requestedOn.set(a.refs[0], a.at);

  const batches: [Parameters<typeof client.mutation<typeof api.admin.insert>>[1]["table"], unknown[]][] = [
    ["cases", snap.cases.map(({ id, ...c }) => ({ caseId: id, ...c }))],
    ["requests", snap.requests.map(({ id, ...r }) => ({ reqId: id, ...r, requestedOn: requestedOn.get(id) ?? SIM_WINDOW.from }))],
    ["audit", snap.audit.map((a) => ({ ...a }))],
    ["messages", snap.messages],
    ["rules", snap.rules.map(({ id, ...r }) => ({ ruleId: id, ...r }))],
    ["meta", [{ key: "simDate", value: SIM_WINDOW.to }, { key: "source", value: snap.source }]],
  ];
  for (const [table, docs] of batches) {
    for (let k = 0; k < docs.length; k += 200) await client.mutation(api.admin.insert, { table, docs: docs.slice(k, k + 200) });
    console.log(`${table}: ${docs.length}`);
  }
  console.log(`desk loaded from ${snap.source}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
