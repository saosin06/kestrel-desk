// Runs every seat across the whole sim, in parallel, and saves a replayable
// snapshot (no API calls needed to demo it afterwards).
//   npm run sim                 # → data/desk/agents-seed42.json
//   npm run seed -- --snapshot data/desk/agents-seed42.json

import { mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { AP_CLERK_PROMPT, PAYROLL_SPECIALIST_PROMPT } from "../lib/agents/prompts";
import { type AgentRun, runAgent } from "../lib/agents/run";
import { buildTools, deskView, seatTools } from "../lib/agents/tools";
import type { DeskRule } from "../lib/desk/coordinator";
import { createDeskState, type DeskState } from "../lib/desk/state";
import { mineRules } from "../lib/rules/mine";
import { DEFAULT_SEED, generate, MONTHS, SIM_WINDOW } from "../simulation/world";

const CONCURRENCY = 6;
const OUT = `data/desk/agents-seed${DEFAULT_SEED}.json`;

type Job = { label: string; seat: "ap_clerk" | "payroll_specialist"; today: string; task: string };
type Done = Job & { state: DeskState; run: AgentRun | null; error?: string };

const world = generate(DEFAULT_SEED);
const view = deskView(world);
const rules: DeskRule[] = mineRules(world.history.exceptions).map((r) => ({
  ...r,
  status: "approved",
  decidedBy: "controller",
  decidedAt: SIM_WINDOW.from,
  decisionReason: "Matches how we've handled these; evidence reviewed.",
}));

const lastDay = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

const jobs: Job[] = [
  ...MONTHS.map((m) => ({
    label: `AP ${m}`,
    seat: "ap_clerk" as const,
    today: lastDay(m),
    task: `Today is ${lastDay(m)}. Process every supplier invoice received ${m}-01 to ${lastDay(m)}: check each one, then hold, escalate, or request payment as the controls require.`,
  })),
  ...world.payroll.runs.map((r) => ({
    label: `Payroll ${r.id}`,
    seat: "payroll_specialist" as const,
    today: dayBefore(r.payDate),
    task: `Today is ${dayBefore(r.payDate)}. Review payroll run ${r.id} (${r.type === "regular" ? "regular" : "off-cycle"}) before it's approved for the ${r.payDate} pay date, and check the inbox for anything that affects it. Then request approval of the run, excluding any lines you hold.`,
  })),
];

async function runJob(client: Anthropic, job: Job, shared?: DeskState): Promise<Done> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const state = shared ?? createDeskState();
    try {
      const tools = seatTools(buildTools(view, () => rules), job.seat);
      const run = await runAgent({ client, role: job.seat, system: job.seat === "ap_clerk" ? AP_CLERK_PROMPT : PAYROLL_SPECIALIST_PROMPT, task: job.task, tools, ctx: { state, role: job.seat, today: job.today } });
      console.log(`✓ ${job.label.padEnd(26)} ${run.turns} turns · ${run.toolCalls.length} tools · ${state.cases.length} cases · ${state.requests.length} requests`);
      return { ...job, state, run };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${job.label} attempt ${attempt}: ${msg.slice(0, 160)}`);
      if (attempt === 3) return { ...job, state, run: null, error: msg };
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  throw new Error("unreachable");
}

/** Replaces each run's local CASE-/REQ- ids with desk-wide ids, everywhere they appear. */
function remap<T>(value: T, map: Map<string, string>): T {
  if (typeof value === "string") return value.replace(/\b(CASE-\d{4}|REQ-\d{5})\b/g, (id) => map.get(id) ?? id) as T;
  if (Array.isArray(value)) return value.map((v) => remap(v, map)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)])) as T;
  return value;
}

function merge(done: Done[]): DeskState {
  // Distinct states (the payroll chain shares one across many jobs).
  const states = [...new Set(done.map((d) => d.state))];
  const requestDate = (st: DeskState, id: string) => st.audit.find((a) => a.action.startsWith("request:") && a.refs[0] === id)?.at ?? "";
  const maps = new Map(states.map((st) => [st, new Map<string, string>()]));
  const cases = states.flatMap((st, k) => st.cases.map((c, i) => ({ st, c, k, i }))).sort((a, b) => a.c.openedOn.localeCompare(b.c.openedOn) || a.k - b.k || a.i - b.i);
  cases.forEach((x, n) => maps.get(x.st)!.set(x.c.id, `CASE-${String(n + 1).padStart(4, "0")}`));
  const reqs = states.flatMap((st, k) => st.requests.map((r, i) => ({ st, r, k, i, at: requestDate(st, r.id) }))).sort((a, b) => a.at.localeCompare(b.at) || a.k - b.k || a.i - b.i);
  reqs.forEach((x, n) => maps.get(x.st)!.set(x.r.id, `REQ-${String(n + 1).padStart(5, "0")}`));

  const merged = createDeskState();
  merged.cases = cases.map((x) => remap(x.c, maps.get(x.st)!));
  merged.requests = reqs.map((x) => remap(x.r, maps.get(x.st)!));
  merged.messages = states.flatMap((st) => remap(st.messages, maps.get(st)!)).sort((a, b) => a.at.localeCompare(b.at));
  const audit = states.flatMap((st, k) => remap(st.audit, maps.get(st)!).map((a) => ({ ...a, k })));
  audit.sort((a, b) => a.at.localeCompare(b.at) || a.k - b.k || a.seq - b.seq);
  merged.audit = audit.map(({ k: _k, ...a }, i) => ({ ...a, seq: i + 1 }));
  return merged;
}

async function main() {
  const client = new Anthropic();
  const started = Date.now();
  // AP months are independent: run them in parallel. Payroll reviews share one
  // desk in date order, so a later review sees cases an earlier one opened.
  const queue = jobs.filter((j) => j.seat === "ap_clerk");
  const done: Done[] = [];
  const payrollState = createDeskState();
  const payrollChain = (async () => {
    for (const job of jobs.filter((j) => j.seat === "payroll_specialist").sort((a, b) => a.today.localeCompare(b.today))) {
      done.push(await runJob(client, job, payrollState));
    }
  })();
  await Promise.all([
    payrollChain,
    ...Array.from({ length: CONCURRENCY - 1 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) done.push(await runJob(client, job));
    }),
  ]);
  const failed = done.filter((d) => d.error);
  const desk = merge(done.filter((d) => !d.error));
  const snapshot = {
    ...desk,
    rules,
    source: "agents",
    seed: DEFAULT_SEED,
    runs: done
      .sort((a, b) => a.today.localeCompare(b.today) || a.label.localeCompare(b.label))
      .map((d) => ({ label: d.label, seat: d.seat, today: d.today, error: d.error ?? null, turns: d.run?.turns ?? 0, toolCalls: d.run?.toolCalls.length ?? 0, stopReason: d.run?.stopReason ?? null, budgetExceeded: d.run?.budgetExceeded ?? false, summary: d.run?.finalText ?? "" })),
  };
  mkdirSync("data/desk", { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`\n${done.length - failed.length}/${done.length} runs ok in ${Math.round((Date.now() - started) / 1000)}s · ${desk.cases.length} cases · ${desk.requests.length} requests · ${desk.audit.length} audit events → ${OUT}`);
  if (failed.length) console.log(`FAILED: ${failed.map((f) => f.label).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
