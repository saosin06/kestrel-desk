import { v } from "convex/values";
import { mutation } from "./_generated/server";

// Bulk load used by scripts/seed-desk.ts: the desk is replaced, never merged.
const TABLES = ["cases", "requests", "audit", "messages", "rules", "meta", "intakes"] as const;
const table = v.union(...TABLES.map((t) => v.literal(t)));

export const clear = mutation({
  args: { table },
  handler: async (ctx, { table }) => {
    const docs = await ctx.db.query(table).take(500);
    for (const d of docs) await ctx.db.delete(d._id);
    return { deleted: docs.length, more: docs.length === 500 };
  },
});

export const insert = mutation({
  args: { table, docs: v.array(v.any()) },
  handler: async (ctx, { table, docs }) => {
    for (const d of docs) await ctx.db.insert(table, d);
    return docs.length;
  },
});
