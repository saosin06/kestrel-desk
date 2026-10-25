import { v } from "convex/values";
import { applyDecision, sodViolation } from "../lib/desk/sod";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";

async function appendAudit(ctx: MutationCtx, e: { at: string; actor: string; action: string; refs: string[]; detail: string }) {
  const last = await ctx.db.query("audit").withIndex("by_seq").order("desc").first();
  const seq = (last?.seq ?? 0) + 1;
  await ctx.db.insert("audit", { ...e, seq });
  return seq;
}

async function simDate(ctx: MutationCtx) {
  return (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", "simDate")).unique())?.value ?? "2026-09-30";
}

/** Approve or reject a request. Segregation of duties is enforced here, server-side: this is the
 *  only door. A refused attempt is not an exception: it is recorded in the audit trail and returned. */
export const decide = mutation({
  args: { reqId: v.string(), by: v.string(), decision: v.union(v.literal("approve"), v.literal("reject")), reason: v.string() },
  handler: async (ctx, { reqId, by, decision, reason }) => {
    if (reason.trim().length === 0) throw new Error("a reason is required");
    const r = await ctx.db.query("requests").withIndex("by_reqId", (q) => q.eq("reqId", reqId)).unique();
    if (!r) throw new Error(`no request ${reqId}`);
    const at = await simDate(ctx);
    const problem = sodViolation(r, by);
    if (problem) {
      const seq = await appendAudit(ctx, { at, actor: by, action: `denied:${decision}`, refs: [reqId, ...(r.caseId ? [r.caseId] : [])], detail: `REFUSED by the gateway: ${problem}` });
      return { ok: false as const, reason: problem, seq };
    }
    const next = applyDecision(r, by, decision, reason, at);
    await ctx.db.patch(r._id, next);
    await appendAudit(ctx, { at, actor: by, action: `decision:${decision}`, refs: [reqId, ...(r.caseId ? [r.caseId] : [])], detail: reason });
    if (r.caseId) {
      const c = await ctx.db.query("cases").withIndex("by_caseId", (q) => q.eq("caseId", r.caseId!)).unique();
      const siblings = await ctx.db.query("requests").withIndex("by_caseId", (q) => q.eq("caseId", r.caseId!)).collect();
      const allDecided = siblings.every((s) => (s._id === r._id ? next.status : s.status) !== "pending");
      if (c && allDecided) await ctx.db.patch(c._id, { status: "resolved", notes: [...c.notes, { at, by, text: `all requests decided (${decision}: ${reason})` }] });
    }
    return { ok: true as const, status: next.status };
  },
});

/** Ask the requesting seat why — recorded on the case for the seat to answer. */
export const askWhy = mutation({
  args: { reqId: v.string(), by: v.string(), question: v.string() },
  handler: async (ctx, { reqId, by, question }) => {
    const r = await ctx.db.query("requests").withIndex("by_reqId", (q) => q.eq("reqId", reqId)).unique();
    if (!r) throw new Error(`no request ${reqId}`);
    const at = await simDate(ctx);
    await ctx.db.insert("messages", { at, from: by, to: r.requestedBy, text: question, refs: [reqId, ...(r.caseId ? [r.caseId] : [])] });
    await appendAudit(ctx, { at, actor: by, action: "ask_why", refs: [reqId], detail: question });
  },
});

/** Only the controller approves or rejects internal rules (a loosening rule changes what reaches her). */
export const setRuleStatus = mutation({
  args: { ruleId: v.string(), by: v.string(), status: v.union(v.literal("approved"), v.literal("rejected"), v.literal("in_review"), v.literal("retired")), reason: v.string() },
  handler: async (ctx, { ruleId, by, status, reason }) => {
    if (by !== "controller") throw new Error("only the controller decides internal rules");
    if (reason.trim().length === 0) throw new Error("a reason is required");
    const rule = await ctx.db.query("rules").withIndex("by_ruleId", (q) => q.eq("ruleId", ruleId)).unique();
    if (!rule) throw new Error(`no rule ${ruleId}`);
    const at = await simDate(ctx);
    await ctx.db.patch(rule._id, { status, decidedBy: by, decidedAt: at, decisionReason: reason });
    await appendAudit(ctx, { at, actor: by, action: `rule:${status}`, refs: [ruleId], detail: reason });
  },
});

/** A seat's answer to "Ask why", posted into the case thread. */
export const answer = mutation({
  args: { reqId: v.string(), from: v.string(), to: v.string(), text: v.string() },
  handler: async (ctx, { reqId, from, to, text }) => {
    const r = await ctx.db.query("requests").withIndex("by_reqId", (q) => q.eq("reqId", reqId)).unique();
    const at = await simDate(ctx);
    await ctx.db.insert("messages", { at, from, to, text, refs: [reqId, ...(r?.caseId ? [r.caseId] : [])] });
    await appendAudit(ctx, { at, actor: from, action: "answer_why", refs: [reqId, ...(r?.caseId ? [r.caseId] : [])], detail: text.slice(0, 200) });
  },
});
