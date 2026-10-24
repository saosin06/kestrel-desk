// One agent seat, one task: a manual tool-use loop so the desk controls every
// step (role-scoped tools, a turn budget, an audit entry per call). The client
// is injected so tests can script it.

import type Anthropic from "@anthropic-ai/sdk";
import type { ISODate, Role } from "@/lib/erp/types";
import { ControlViolation } from "@/lib/desk/controls";
import { audit, type DeskState } from "@/lib/desk/state";

/** CLAUDE.md §4 names the agents' model explicitly. */
export const AGENT_MODEL = "claude-sonnet-5-5";

export type MessagesClient = {
  beta: { messages: { create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage> } };
};

export type ToolContext = { state: DeskState; role: Role; today: ISODate };

export type AgentTool = {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool.InputSchema;
  run: (input: Record<string, unknown>, ctx: ToolContext) => unknown;
};

export class ToolInputError extends Error {}

export type ToolCall = { name: string; input: unknown; ok: boolean; result: string };

export type AgentRun = {
  role: Role;
  stopReason: string | null;
  turns: number;
  toolCalls: ToolCall[];
  finalText: string;
  budgetExceeded: boolean;
};

export async function runAgent(opts: {
  client: MessagesClient;
  role: Role;
  system: string;
  task: string;
  tools: AgentTool[];
  ctx: ToolContext;
  maxTurns?: number;
  model?: string;
}): Promise<AgentRun> {
  const { client, role, system, task, tools, ctx } = opts;
  const maxTurns = opts.maxTurns ?? 24;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: task }];
  const toolCalls: ToolCall[] = [];
  let turns = 0;
  let finalText = "";
  let stopReason: string | null = null;

  while (turns < maxTurns) {
    turns++;
    const response = await client.beta.messages.create({
      model: opts.model ?? AGENT_MODEL,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
      messages,
    });
    stopReason = response.stop_reason;
    messages.push({ role: "assistant", content: response.content });
    finalText = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") break;
    if (response.stop_reason === "pause_turn") continue;
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const tool = byName.get(use.name);
      let ok = true;
      let text: string;
      try {
        if (!tool) throw new ToolInputError(`unknown tool ${use.name}`);
        text = JSON.stringify(tool.run((use.input ?? {}) as Record<string, unknown>, ctx));
      } catch (e) {
        if (!(e instanceof ControlViolation || e instanceof ToolInputError)) throw e;
        ok = false;
        text = `${e instanceof ControlViolation ? "CONTROL REFUSED" : "INVALID INPUT"}: ${e.message}`;
      }
      toolCalls.push({ name: use.name, input: use.input, ok, result: text });
      audit(ctx.state, { at: ctx.today, actor: role, action: `tool:${use.name}`, refs: [], detail: ok ? "ok" : text });
      results.push({ type: "tool_result", tool_use_id: use.id, content: text, ...(ok ? {} : { is_error: true }) });
    }
    messages.push({ role: "user", content: results });
  }

  const budgetExceeded = turns >= maxTurns && stopReason === "tool_use";
  if (budgetExceeded) {
    audit(ctx.state, { at: ctx.today, actor: role, action: "escalate:budget", refs: [], detail: `run budget of ${maxTurns} turns exceeded` });
  }
  return { role, stopReason, turns, toolCalls, finalText, budgetExceeded };
}
