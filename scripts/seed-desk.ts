// Replaces the desk in Convex with a full Mar–Sep run.
//   npm run seed                      # deterministic desk (rules engine, no API calls)
//   npm run seed -- --snapshot FILE   # a saved agent run (data/desk/*.json)

import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { deskView } from "../lib/agents/tools";
import { type DeskRule, runDeterministicDesk } from "../lib/desk/coordinator";
import { type DeskSnapshot, loadDesk } from "../lib/desk/seed";
import { mineRules } from "../lib/rules/mine";
import { DEFAULT_SEED, generate, SIM_WINDOW } from "../simulation/world";

function deterministic(): DeskSnapshot {
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
  const snap: DeskSnapshot = i >= 0 ? JSON.parse(readFileSync(process.argv[i + 1], "utf8")) : deterministic();
  await loadDesk(new ConvexHttpClient(url), snap, console.log);
  console.log(`desk loaded from ${snap.source}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
