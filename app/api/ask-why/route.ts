import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { api } from "@/convex/_generated/api";
import { AP_CLERK_PROMPT, PAYROLL_SPECIALIST_PROMPT } from "@/lib/agents/prompts";
import { runAgent } from "@/lib/agents/run";
import { buildTools } from "@/lib/agents/tools";
import { createDeskState } from "@/lib/desk/state";
import { baseWorld, convex, currentRules } from "@/lib/live/desk";

const READ_ONLY = {
  ap_clerk: ["list_invoices", "get_record", "check_invoice", "get_internal_rules", "search_history", "read_memos", "read_inbox"],
  payroll_specialist: ["list_payroll_runs", "check_payroll_run", "get_employee", "get_internal_rules", "search_history", "read_memos", "read_inbox"],
} as const;

/** Records the question, then the seat that made the request answers it with evidence (read-only tools). */
export async function POST(req: Request) {
  const { reqId, by, question } = (await req.json()) as { reqId: string; by: string; question: string };
  if (!reqId || !by || !question?.trim()) return Response.json({ error: "reqId, by and question are required" }, { status: 400 });
  const client = convex();
  await client.mutation(api.decisions.askWhy, { reqId, by, question });
  const request = (await client.query(api.desk.requests, {})).find((r) => r.reqId === reqId);
  if (!request) return Response.json({ error: `no request ${reqId}` }, { status: 404 });
  const seat = request.requestedBy === "payroll_specialist" ? "payroll_specialist" : "ap_clerk";
  const detail = request.caseId ? await client.query(api.desk.caseDetail, { caseId: request.caseId }) : null;

  after(async () => {
    try {
      const rules = await currentRules(client);
      const all = buildTools(baseWorld(), () => rules);
      const today = request.requestedOn;
      const context = JSON.stringify({ request: { id: request.reqId, kind: request.kind, amountUSDCents: request.amountUSDCents, payload: request.payload }, case: detail?.case ?? null, rules: detail?.rules?.map((r) => ({ id: r.ruleId, statement: r.statement })) ?? [] });
      const run = await runAgent({
        client: new Anthropic(),
        role: seat,
        system: seat === "ap_clerk" ? AP_CLERK_PROMPT : PAYROLL_SPECIALIST_PROMPT,
        task: `${by === "controller" ? "Dana (controller)" : by} asks about your request ${reqId}: "${question}"\n\nContext: ${context}\n\nAnswer her directly in a few sentences: what you found, the evidence path by record id, the rule or contract clause, the system of record, and what you recommend. Use tools only to confirm facts. You are answering, not acting.`,
        tools: READ_ONLY[seat].map((n) => all[n]),
        ctx: { state: createDeskState(), role: seat, today },
        maxTurns: 8,
      });
      await client.mutation(api.decisions.answer, { reqId, from: seat, to: by, text: run.finalText || "(no answer)" });
    } catch (e) {
      await client.mutation(api.decisions.answer, { reqId, from: seat, to: by, text: `Couldn't answer just now (${e instanceof Error ? e.message.slice(0, 120) : "error"}). The evidence is in the case's Why? panel.` });
    }
  });
  return Response.json({ ok: true, seat });
}
