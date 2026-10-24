import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The desk's working state. Company records (invoices, HRIS, registers) stay
// in the repo's data files; Convex holds what the desk does with them.
export default defineSchema({
  cases: defineTable({
    caseId: v.string(),
    kind: v.string(),
    openedOn: v.string(),
    openedBy: v.string(),
    status: v.string(),
    findingKeys: v.array(v.string()),
    objectIds: v.array(v.string()),
    impactUSDCents: v.number(),
    disposition: v.string(),
    ruleIds: v.array(v.string()),
    summary: v.string(),
    systemOfRecord: v.string(),
    author: v.string(),
    evidence: v.any(),
    notes: v.any(),
  })
    .index("by_caseId", ["caseId"])
    .index("by_openedOn", ["openedOn"]),
  requests: defineTable({
    reqId: v.string(),
    kind: v.string(),
    requestedBy: v.string(),
    requiredApprovers: v.array(v.string()),
    approvals: v.array(v.object({ by: v.string(), decision: v.union(v.literal("approve"), v.literal("reject")), reason: v.string(), at: v.string() })),
    amountUSDCents: v.optional(v.number()),
    caseId: v.optional(v.string()),
    payload: v.any(),
    status: v.string(),
    requestedOn: v.string(),
  })
    .index("by_reqId", ["reqId"])
    .index("by_status", ["status"])
    .index("by_caseId", ["caseId"]),
  audit: defineTable({
    seq: v.number(),
    at: v.string(),
    actor: v.string(),
    action: v.string(),
    refs: v.array(v.string()),
    detail: v.string(),
  }).index("by_seq", ["seq"]),
  messages: defineTable({
    at: v.string(),
    from: v.string(),
    to: v.string(),
    text: v.string(),
    refs: v.array(v.string()),
  }).index("by_at", ["at"]),
  rules: defineTable({
    ruleId: v.string(),
    statement: v.string(),
    scope: v.any(),
    action: v.any(),
    status: v.string(),
    source: v.string(),
    support: v.number(),
    counterexamples: v.array(v.string()),
    confidence: v.number(),
    evidence: v.array(v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.string()),
    decisionReason: v.optional(v.string()),
  }).index("by_ruleId", ["ruleId"]),
  meta: defineTable({ key: v.string(), value: v.string() }).index("by_key", ["key"]),
});
