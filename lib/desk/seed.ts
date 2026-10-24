// Loads a desk snapshot into Convex, replacing whatever is there.
// Used by scripts/seed-desk.ts and the in-app "Reset desk" action.

import type { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { SIM_WINDOW } from "@/simulation/world";
import type { DeskRule } from "./coordinator";
import type { DeskState } from "./state";

export type DeskSnapshot = DeskState & { rules: DeskRule[]; source: string };

const TABLES = ["cases", "requests", "audit", "messages", "rules", "meta", "intakes"] as const;

export async function loadDesk(client: ConvexHttpClient, snap: DeskSnapshot, log: (s: string) => void = () => {}) {
  for (const table of TABLES) {
    let more = true;
    while (more) more = (await client.mutation(api.admin.clear, { table })).more;
  }
  const requestedOn = new Map<string, string>();
  for (const a of snap.audit) if (a.action.startsWith("request:")) requestedOn.set(a.refs[0], a.at);
  const batches: [Exclude<(typeof TABLES)[number], "intakes">, unknown[]][] = [
    ["cases", snap.cases.map(({ id, ...c }) => ({ caseId: id, ...c }))],
    ["requests", snap.requests.map(({ id, ...r }) => ({ reqId: id, ...r, requestedOn: requestedOn.get(id) ?? SIM_WINDOW.from }))],
    ["audit", snap.audit.map((a) => ({ ...a }))],
    ["messages", snap.messages],
    ["rules", snap.rules.map(({ id, ...r }) => ({ ruleId: id, ...r }))],
    ["meta", [{ key: "simDate", value: SIM_WINDOW.to }, { key: "source", value: snap.source }]],
  ];
  for (const [table, docs] of batches) {
    for (let k = 0; k < docs.length; k += 200) await client.mutation(api.admin.insert, { table, docs: docs.slice(k, k + 200) });
    log(`${table}: ${docs.length}`);
  }
}
