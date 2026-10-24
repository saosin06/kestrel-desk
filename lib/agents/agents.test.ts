// Agent loop and desk controls with a scripted (mocked) Claude client.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ControlViolation, decide } from "@/lib/desk/controls";
import { createDeskState } from "@/lib/desk/state";
import { mineRules } from "@/lib/rules/mine";
import { generate } from "@/simulation/world";
import { AP_CLERK_PROMPT, PAYROLL_SPECIALIST_PROMPT } from "./prompts";
import { type MessagesClient, runAgent } from "./run";
import { buildTools, deskView, seatTools } from "./tools";

type Step = { tool: string; input: Record<string, unknown> } | { text: string };

/** A fake client that replays a script: each turn is a list of tool calls, or final text. */
function scripted(turns: Step[][]): MessagesClient & { requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  return {
    requests,
    beta: {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const steps = turns[i++] ?? [{ text: "done" }];
          const content = steps.map((s, n) =>
            "tool" in s ? { type: "tool_use", id: `tu_${i}_${n}`, name: s.tool, input: s.input, caller: { type: "direct" } } : { type: "text", text: s.text, citations: null },
          );
          return {
            id: `msg_${i}`,
            type: "message",
            role: "assistant",
            model: params.model,
            content,
            stop_reason: steps.some((s) => "tool" in s) ? "tool_use" : "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          } as unknown as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
}

const world = generate(42);
const view = deskView(world);
const approvedRules = mineRules(world.history.exceptions).map((r) => ({ ...r, status: "approved" as const }));

describe("agent tools", () => {
  it("never expose the answer key", () => {
    expect("answerKey" in view).toBe(false);
    const tools = buildTools(view, () => approvedRules);
    const out = JSON.stringify(tools.get_record.run({ id: "VI-2604-VIR" }, { state: createDeskState(), role: "ap_clerk", today: "2026-04-20" }));
    expect(out).not.toContain("AK-01");
  });

  it("each seat gets only its own tools", () => {
    const tools = buildTools(view, () => []);
    const ap = seatTools(tools, "ap_clerk").map((t) => t.name);
    const pay = seatTools(tools, "payroll_specialist").map((t) => t.name);
    expect(ap).toContain("request_payment");
    expect(ap).not.toContain("request_payroll_run_approval");
    expect(pay).not.toContain("request_payment");
    expect(pay).toContain("check_payroll_run");
  });

  it("check_invoice returns the headline substitution with an escalate disposition", () => {
    const tools = buildTools(view, () => approvedRules);
    const out = tools.check_invoice.run({ invoice_id: "VI-2604-VIR" }, { state: createDeskState(), role: "ap_clerk", today: "2026-04-20" }) as { kind: string; disposition: string }[];
    expect(out.map((f) => [f.kind, f.disposition])).toEqual([["noncompliant_substitution", "escalate"]]);
  });

  it("learned rules change what the agent is told: Cascade's miscount becomes check:recount", () => {
    const cold = buildTools(view, () => []).check_invoice.run({ invoice_id: "VI-2604-CAS" }, { state: createDeskState(), role: "ap_clerk", today: "2026-04-20" }) as { disposition: string }[];
    const warm = buildTools(view, () => approvedRules).check_invoice.run({ invoice_id: "VI-2604-CAS" }, { state: createDeskState(), role: "ap_clerk", today: "2026-04-20" }) as { disposition: string }[];
    expect(cold[0].disposition).toBe("escalate");
    expect(warm[0].disposition).toBe("check:recount");
  });
});

describe("AP clerk loop (scripted)", () => {
  it("opens a case on the substitution, requests hold + engineering approval, escalates; controls refuse paying it", async () => {
    const state = createDeskState();
    const client = scripted([
      [{ tool: "check_invoice", input: { invoice_id: "VI-2604-VIR" } }],
      [{ tool: "open_case", input: { finding_keys: ["noncompliant_substitution VI-2604-VIR"], summary: "FC-2 Lite substitute, CoO shows CN", system_of_record: "certificate of origin COO-2604-VIR-P04" } }],
      [
        { tool: "request_payment_hold", input: { case_id: "CASE-0001", reason: "restricted origin" } },
        { tool: "request_substitution_approval", input: { case_id: "CASE-0001", reason: "VFC-2-LC ≠ VFC-2" } },
        { tool: "request_payment", input: { invoice_id: "VI-2604-VIR" } },
      ],
      [{ tool: "escalate", input: { case_id: "CASE-0001", to: "controller", explanation: "VI-2604-VIR line 1 → P04 → COO-2604-VIR-P04 (CN) → KESTREL-UAS-1 §CP-1" } }],
      [{ text: "Held VI-2604-VIR; waiting on Mei and Dana." }],
    ]);
    const run = await runAgent({ client, role: "ap_clerk", system: AP_CLERK_PROMPT, task: "Process VI-2604-VIR.", tools: seatTools(buildTools(view, () => approvedRules), "ap_clerk"), ctx: { state, role: "ap_clerk", today: "2026-04-20" } });

    expect(run.stopReason).toBe("end_turn");
    const c = state.cases[0];
    expect(c.kind).toBe("noncompliant_substitution");
    expect(c.impactUSDCents).toBe(world.answerKey.entries.find((e) => e.id === "AK-01")!.impactUSDCents); // from the engine, not the model
    const hold = state.requests.find((r) => r.kind === "payment_hold")!;
    expect(hold.requiredApprovers).toEqual(["engineering", "controller"]);
    expect(state.requests.find((r) => r.kind === "substitution_approval")!.requiredApprovers).toEqual(["engineering", "controller"]);
    const pay = run.toolCalls.find((t) => t.name === "request_payment")!;
    expect(pay.ok).toBe(false);
    expect(pay.result).toContain("CONTROL REFUSED");
    expect(state.requests.some((r) => r.kind === "payment")).toBe(false);
    expect(state.audit.some((a) => a.action === "escalate")).toBe(true);
  });

  it("sends the configured model, adaptive defaults, fallbacks, and a cached system prompt", async () => {
    const client = scripted([[{ text: "nothing to do" }]]);
    await runAgent({ client, role: "ap_clerk", system: AP_CLERK_PROMPT, task: "x", tools: seatTools(buildTools(view, () => []), "ap_clerk"), ctx: { state: createDeskState(), role: "ap_clerk", today: "2026-04-20" } });
    const req = client.requests[0];
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect("thinking" in req).toBe(false);
    expect("tool_choice" in req).toBe(false);
  });

  it("stops at the turn budget and records an escalation", async () => {
    const state = createDeskState();
    const loop = Array.from({ length: 5 }, () => [{ tool: "list_invoices", input: { from: "2026-04-01", to: "2026-04-30" } }]);
    const run = await runAgent({ client: scripted(loop), role: "ap_clerk", system: AP_CLERK_PROMPT, task: "x", tools: seatTools(buildTools(view, () => []), "ap_clerk"), ctx: { state, role: "ap_clerk", today: "2026-04-20" }, maxTurns: 3 });
    expect(run.budgetExceeded).toBe(true);
    expect(state.audit.some((a) => a.action === "escalate:budget")).toBe(true);
  });
});

describe("payroll specialist loop (scripted)", () => {
  it("opens the direct-deposit fraud case from the email and asks HR to verify; can't use AP tools", async () => {
    const state = createDeskState();
    const client = scripted([
      [{ tool: "read_inbox", input: { until: "2026-07-23" } }],
      [{ tool: "open_case", input: { kind: "direct_deposit_change_unverified", object_ids: ["MSG-2026-07-23-DD", world.payroll.inbox[0].refs[0]], summary: "bank change by email from kestrel-aerial.co", system_of_record: "HRIS direct-deposit account on file" } }],
      [
        { tool: "request_hris_change", input: { employee_id: world.payroll.inbox[0].refs[0], change: "verify direct deposit via HRIS self-service", reason: "email request, lookalike domain" } },
        { tool: "request_payment", input: { invoice_id: "VI-2604-NW" } },
      ],
      [{ text: "Held the change; paying to the account on file." }],
    ]);
    const run = await runAgent({ client, role: "payroll_specialist", system: PAYROLL_SPECIALIST_PROMPT, task: "Prepare RUN-2026-07-24.", tools: seatTools(buildTools(view, () => approvedRules), "payroll_specialist"), ctx: { state, role: "payroll_specialist", today: "2026-07-23" } });

    const c = state.cases[0];
    expect(c.kind).toBe("direct_deposit_change_unverified");
    expect(c.impactUSDCents).toBe(world.answerKey.payroll.find((e) => e.id === "PR-07")!.impactUSDCents);
    expect(state.requests.find((r) => r.kind === "hris_change")!.requiredApprovers).toEqual(["hr"]);
    expect(run.toolCalls.find((t) => t.name === "request_payment")!.result).toContain("unknown tool");
  });
});

describe("case memory", () => {
  it("open_case never duplicates an open issue; it notes it on the existing case", () => {
    const state = createDeskState();
    const tools = buildTools(view, () => approvedRules);
    const emp = world.payroll.inbox[0].refs[0];
    const args = { kind: "direct_deposit_change_unverified", object_ids: ["MSG-2026-07-23-DD", emp], summary: "email bank change", system_of_record: "HRIS" };
    const first = tools.open_case.run(args, { state, role: "payroll_specialist", today: "2026-07-23" }) as { case_id: string };
    const again = tools.open_case.run(args, { state, role: "payroll_specialist", today: "2026-08-06" }) as { case_id: string; already_open: boolean };
    expect(again).toMatchObject({ case_id: first.case_id, already_open: true });
    expect(state.cases).toHaveLength(1);
    expect(state.cases[0].notes.at(-1)!.text).toContain("seen again");
    expect((tools.list_open_cases.run({}, { state, role: "payroll_specialist", today: "2026-08-06" }) as unknown[]).length).toBe(1);
  });
});

describe("controls", () => {
  it("segregation of duties: a requester can't approve its own request; only required approvers decide", () => {
    const state = createDeskState();
    const tools = buildTools(view, () => approvedRules);
    const ctx = { state, role: "ap_clerk" as const, today: "2026-04-20" };
    tools.open_case.run({ finding_keys: ["price_variance_vs_contract VI-2604-ATL"], summary: "$132 vs $118", system_of_record: "contract C-12" }, ctx);
    const memo = tools.request_debit_memo.run({ case_id: "CASE-0001", reason: "C-12 §4.2" }, ctx) as { id: string; amountUSDCents: number };
    expect(memo.amountUSDCents).toBe(4_200_000);
    expect(() => decide(state, "2026-04-21", memo.id, "ap_clerk", "approve", "self")).toThrow(ControlViolation);
    expect(() => decide(state, "2026-04-21", memo.id, "buyer", "approve", "not mine")).toThrow(ControlViolation);
    expect(decide(state, "2026-04-21", memo.id, "controller", "approve", "per §4.2").status).toBe("approved");
  });

  it("a clean invoice under $25,000 needs no approval; one over it needs the controller", () => {
    const state = createDeskState();
    const tools = buildTools(view, () => []);
    const ctx = { state, role: "ap_clerk" as const, today: "2026-05-20" };
    const nw = tools.request_payment.run({ invoice_id: "VI-2605-NW" }, ctx) as { requiredApprovers: string[]; amountUSDCents: number };
    expect(nw.amountUSDCents).toBeGreaterThan(2_500_000);
    expect(nw.requiredApprovers).toEqual(["controller"]);
  });
});
