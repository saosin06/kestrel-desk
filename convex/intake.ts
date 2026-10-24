import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

// Live documents a person hands the desk during a demo, and what the seats did with them.

export const list = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("intakes").collect()).sort((a, b) => b.intakeId.localeCompare(a.intakeId)),
});

export const get = query({
  args: { intakeId: v.string() },
  handler: async (ctx, { intakeId }) => await ctx.db.query("intakes").withIndex("by_intakeId", (q) => q.eq("intakeId", intakeId)).unique(),
});

export const nextId = query({
  args: {},
  handler: async (ctx) => {
    const n = (await ctx.db.query("intakes").collect()).length + 1;
    return String(n).padStart(4, "0");
  },
});

export const create = mutation({
  args: { intakeId: v.string(), kind: v.union(v.literal("invoice"), v.literal("email")), at: v.string(), title: v.string(), doc: v.any(), findings: v.any(), seat: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert("intakes", { ...a, status: "agent_running", caseIds: [] });
    await appendAudit(ctx, { at: a.at, actor: "system", action: `intake:${a.kind}`, refs: [a.intakeId], detail: a.title });
  },
});

export const fail = mutation({
  args: { intakeId: v.string(), error: v.string() },
  handler: async (ctx, { intakeId, error }) => {
    const row = await ctx.db.query("intakes").withIndex("by_intakeId", (q) => q.eq("intakeId", intakeId)).unique();
    if (row) await ctx.db.patch(row._id, { status: "error", error });
  },
});

async function appendAudit(ctx: MutationCtx, e: { at: string; actor: string; action: string; refs: string[]; detail: string }) {
  const last = await ctx.db.query("audit").withIndex("by_seq").order("desc").first();
  await ctx.db.insert("audit", { ...e, seq: (last?.seq ?? 0) + 1 });
}

const num = (id: string) => Number(id.replace(/\D+/g, "")) || 0;

/** Swaps a run's local CASE-/REQ- ids for desk-wide ones, everywhere they appear. */
function remap(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\b(CASE-\d{4}|REQ-\d{5})\b/g, (id) => map.get(id) ?? id);
  if (Array.isArray(value)) return value.map((x) => remap(x, map));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, remap(x, map)]));
  return value;
}

/** Adds a live seat run to the desk atomically, numbering its cases and requests after the existing ones. */
export const commit = mutation({
  args: {
    intakeId: v.string(),
    cases: v.array(v.any()),
    requests: v.array(v.any()),
    audit: v.array(v.any()),
    messages: v.array(v.any()),
    summary: v.string(),
    toolCalls: v.number(),
  },
  handler: async (ctx, a) => {
    const maxCase = Math.max(0, ...(await ctx.db.query("cases").collect()).map((c) => num(c.caseId)));
    const maxReq = Math.max(0, ...(await ctx.db.query("requests").collect()).map((r) => num(r.reqId)));
    const map = new Map<string, string>();
    a.cases.forEach((c, i) => map.set(c.id, `CASE-${String(maxCase + i + 1).padStart(4, "0")}`));
    a.requests.forEach((r, i) => map.set(r.id, `REQ-${String(maxReq + i + 1).padStart(5, "0")}`));
    const requestedOn = new Map<string, string>(a.audit.filter((e) => String(e.action).startsWith("request:")).map((e) => [e.refs[0], e.at]));

    for (const c of a.cases) {
      const { id, ...rest } = remap(c, map) as Record<string, unknown> & { id: string };
      await ctx.db.insert("cases", { ...(rest as Record<string, never>), caseId: id } as never);
    }
    for (const r of a.requests) {
      const { id, ...rest } = remap(r, map) as Record<string, unknown> & { id: string };
      await ctx.db.insert("requests", { ...(rest as Record<string, never>), reqId: id, requestedOn: requestedOn.get(r.id) ?? String(rest.requestedOn ?? "") } as never);
    }
    for (const m of a.messages) await ctx.db.insert("messages", remap(m, map) as never);
    for (const e of a.audit) {
      const { seq: _seq, ...rest } = remap(e, map) as Record<string, unknown>;
      await appendAudit(ctx, rest as never);
    }
    const row = await ctx.db.query("intakes").withIndex("by_intakeId", (q) => q.eq("intakeId", a.intakeId)).unique();
    if (row) await ctx.db.patch(row._id, { status: "done", agentSummary: remap(a.summary, map) as string, caseIds: a.cases.map((c) => map.get(c.id)!), toolCalls: a.toolCalls });
  },
});
