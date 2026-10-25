import { v } from "convex/values";
import { query } from "./_generated/server";

const meta = async (ctx: { db: any }, key: string) => (await ctx.db.query("meta").withIndex("by_key", (q: any) => q.eq("key", key)).unique())?.value ?? null;

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const cases = await ctx.db.query("cases").collect();
    const pending = await ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", "pending")).collect();
    const holds = pending.filter((r) => r.kind === "payment_hold" || r.kind === "payroll_line_hold");
    return {
      simDate: await meta(ctx, "simDate"),
      source: await meta(ctx, "source"),
      openCases: cases.filter((c) => c.status !== "resolved" && c.status !== "dismissed").length,
      totalCases: cases.length,
      pendingApprovals: pending.length,
      heldUSDCents: holds.reduce((a, r) => a + (r.amountUSDCents ?? 0), 0),
      byKind: Object.entries(
        cases.reduce<Record<string, { count: number; impact: number }>>((acc, c) => {
          const x = (acc[c.kind] ??= { count: 0, impact: 0 });
          x.count++;
          x.impact += c.impactUSDCents;
          return acc;
        }, {}),
      ).map(([kind, x]) => ({ kind, ...x })),
    };
  },
});

export const cases = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("cases").withIndex("by_openedOn").order("desc").collect()).map(({ evidence: _e, notes: _n, ...c }) => c),
});

export const caseDetail = query({
  args: { caseId: v.string() },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.query("cases").withIndex("by_caseId", (q) => q.eq("caseId", caseId)).unique();
    if (!c) return null;
    const requests = await ctx.db.query("requests").withIndex("by_caseId", (q) => q.eq("caseId", caseId)).collect();
    const messages = (await ctx.db.query("messages").collect()).filter((m) => m.refs.includes(caseId));
    const allAudit = await ctx.db.query("audit").withIndex("by_seq").collect();
    const audit = allAudit.filter((a) => a.refs.includes(caseId) || requests.some((r) => a.refs.includes(r.reqId)));
    // Tools the opening seat called on the day it opened the case (tool calls carry no case refs).
    const tools = allAudit.filter((a) => a.actor === c.openedBy && a.at === c.openedOn && a.action.startsWith("tool:")).map((a) => a.action.slice(5));
    const rules = await Promise.all(c.ruleIds.map((id) => ctx.db.query("rules").withIndex("by_ruleId", (q) => q.eq("ruleId", id)).unique()));
    const postings = await ctx.db.query("postings").withIndex("by_caseId", (q) => q.eq("caseId", caseId)).collect();
    return { case: c, requests, messages, audit, tools, postings, rules: rules.filter((r) => r !== null) };
  },
});

export const requests = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const rows = status ? await ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", status)).collect() : await ctx.db.query("requests").collect();
    return rows.sort((a, b) => a.requestedOn.localeCompare(b.requestedOn) || a.reqId.localeCompare(b.reqId));
  },
});

export const audit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => await ctx.db.query("audit").withIndex("by_seq").order("desc").take(limit ?? 200),
});

export const messages = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("messages").withIndex("by_at").order("desc").collect(),
});

export const rules = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("rules").collect(),
});

export const postings = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("postings").collect()).reverse(),
});
