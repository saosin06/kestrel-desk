// Runs one seat live against Claude.
//   npm run agent -- --seat ap --from 2026-04-01 --to 2026-04-30
//   npm run agent -- --seat payroll --run RUN-2026-07-24 --today 2026-07-23
//   add --cold to run without learned rules

import Anthropic from "@anthropic-ai/sdk";
import { AP_CLERK_PROMPT, PAYROLL_SPECIALIST_PROMPT } from "../lib/agents/prompts";
import { runAgent } from "../lib/agents/run";
import { buildTools, deskView, seatTools } from "../lib/agents/tools";
import { createDeskState } from "../lib/desk/state";
import { formatMoney } from "../lib/money";
import { mineRules } from "../lib/rules/mine";
import { DEFAULT_SEED, generate } from "../simulation/world";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const seat = arg("seat", "ap") === "payroll" ? "payroll_specialist" : "ap_clerk";
const cold = process.argv.includes("--cold");

const world = generate(Number(arg("seed", String(DEFAULT_SEED))));
// Until the controller persona exists (Tier 2), mined rules are treated as approved for the demo run.
const rules = cold ? [] : mineRules(world.history.exceptions).map((r) => ({ ...r, status: "approved" as const }));
const tools = seatTools(buildTools(deskView(world), () => rules), seat);
const state = createDeskState();

let task: string;
let today: string;
if (seat === "ap_clerk") {
  const from = arg("from", "2026-04-01")!;
  const to = arg("to", "2026-04-30")!;
  today = arg("today", to)!;
  task = `Today is ${today}. Process every supplier invoice received ${from} to ${to}: check each one, then hold, escalate, or request payment as the controls require.`;
} else {
  const run = arg("run", "RUN-2026-07-24")!;
  today = arg("today", "2026-07-23")!;
  task = `Today is ${today}. Review payroll run ${run} before it's approved for tomorrow's pay date, and check the inbox for anything that affects it. Then request approval of the run, excluding any lines you hold.`;
}

const run = await runAgent({ client: new Anthropic(), role: seat, system: seat === "ap_clerk" ? AP_CLERK_PROMPT : PAYROLL_SPECIALIST_PROMPT, task, tools, ctx: { state, role: seat, today } });

console.log(`\n=== ${seat} · ${run.turns} turns · ${run.toolCalls.length} tool calls · stop: ${run.stopReason}${run.budgetExceeded ? " · BUDGET EXCEEDED" : ""} · rules: ${cold ? "none (cold)" : rules.length + " learned"}`);
for (const c of run.toolCalls) console.log(`${c.ok ? " ·" : " ✗"} ${c.name} ${JSON.stringify(c.input).slice(0, 110)}${c.ok ? "" : `\n     ${c.result.slice(0, 160)}`}`);
console.log("\n--- cases");
for (const c of state.cases) console.log(` ${c.id} ${c.kind} · ${formatMoney(c.impactUSDCents, "USD")} · ${c.disposition}${c.ruleIds.length ? " · rule " + c.ruleIds.join(",") : ""}\n   ${c.summary}`);
console.log("--- requests");
for (const r of state.requests) console.log(` ${r.id} ${r.kind} · ${r.status} · needs ${r.requiredApprovers.join(" + ") || "nobody"}${r.amountUSDCents !== undefined ? " · " + formatMoney(r.amountUSDCents, "USD") : ""}`);
console.log("--- escalations");
for (const m of state.messages) console.log(` → ${m.to}: ${m.text.slice(0, 300)}`);
console.log(`\n--- agent's summary\n${run.finalText}`);
