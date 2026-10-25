import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

// Corrections: the controller's live decisions, recorded as precedent. The rule
// arithmetic happens in lib/rules/correct.ts (server route); this applies its result.

async function appendAudit(ctx: MutationCtx, e: { at: string; actor: string; action: string; refs: string[]; detail: string; diff?: { field: string; before: string; after: string }[] }) {
  const last = await ctx.db.query("audit").withIndex("by_seq").order("desc").first();
  await ctx.db.insert("audit", { ...e, seq: (last?.seq ?? 0) + 1 });
}

const show = (x: unknown) => (x === undefined ? "∅" : typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toFixed(2)) : Array.isArray(x) ? `${x.length} items` : typeof x === "object" ? JSON.stringify(x) : String(x));

export const record = mutation({
  args: {
    correction: v.object({ corrId: v.string(), at: v.string(), reqId: v.string(), caseId: v.optional(v.string()), by: v.string(), decision: v.string(), reason: v.string(), precedent: v.any(), effects: v.array(v.string()) }),
    changes: v.array(v.object({ ruleId: v.string(), patch: v.any(), before: v.any(), effect: v.string() })),
    proposals: v.array(v.any()),
  },
  handler: async (ctx, { correction, changes, proposals }) => {
    const dup = await ctx.db.query("corrections").withIndex("by_reqId", (q) => q.eq("reqId", correction.reqId)).first();
    if (dup) return { recorded: false };
    await ctx.db.insert("corrections", correction);
    const refs = [correction.corrId, correction.reqId, ...(correction.caseId ? [correction.caseId] : [])];
    await appendAudit(ctx, { at: correction.at, actor: "system", action: "learn:precedent", refs, detail: correction.effects[0] ?? "", diff: correction.precedent ? [{ field: "precedents", before: "∅", after: correction.corrId }] : undefined });
    for (const ch of changes) {
      const rule = await ctx.db.query("rules").withIndex("by_ruleId", (q) => q.eq("ruleId", ch.ruleId)).unique();
      if (!rule) continue;
      const patch = { ...(ch.patch as Record<string, unknown>) };
      // A status change from a correction is attributed to the correction, not the rule's original approval.
      if (patch.status && patch.status !== rule.status) Object.assign(patch, { decidedBy: correction.by, decidedAt: correction.at, decisionReason: `correction ${correction.corrId}: ${correction.reason}` });
      await ctx.db.patch(rule._id, patch);
      const diff = Object.keys(patch)
        .filter((k) => ["status", "support", "confidence"].includes(k))
        .map((k) => ({ field: k, before: show((rule as Record<string, unknown>)[k]), after: show(patch[k]) }))
        .filter((d) => d.before !== d.after);
      await appendAudit(ctx, { at: correction.at, actor: "system", action: "learn:rule", refs: [ch.ruleId, ...refs], detail: ch.effect, diff });
    }
    for (const p of proposals) {
      const { id, ...rest } = p as { id: string } & Record<string, unknown>;
      if (await ctx.db.query("rules").withIndex("by_ruleId", (q) => q.eq("ruleId", id)).unique()) continue;
      const r = rest as { statement: string; scope: unknown; action: unknown; status: string; source: string; support: number; counterexamples: string[]; confidence: number; evidence: string[] };
      await ctx.db.insert("rules", { ruleId: id, statement: r.statement, scope: r.scope, action: r.action, status: r.status, source: r.source, support: r.support, counterexamples: r.counterexamples, confidence: r.confidence, evidence: r.evidence });
      await appendAudit(ctx, { at: correction.at, actor: "system", action: "learn:proposed", refs: [id, ...refs], detail: String(rest.statement ?? ""), diff: [{ field: "rules", before: "∅", after: `${id} (proposed)` }] });
    }
    return { recorded: true };
  },
});

export const corrections = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("corrections").collect()).reverse(),
});
