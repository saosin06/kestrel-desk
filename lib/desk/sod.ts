// Segregation of duties for approvals. Pure, no path aliases: imported by both
// lib/desk/controls.ts and the Convex `decide` mutation so the rule can't drift.

type Role = string;
type Approval = { by: Role; decision: "approve" | "reject"; reason: string; at: string };
type Decidable = { requestedBy: Role; requiredApprovers: Role[]; approvals: Approval[]; status: string };

/** Why `by` may not decide this request, or null if they may. */
export function sodViolation(r: Decidable, by: Role): string | null {
  if (r.status !== "pending") return `request is already ${r.status}`;
  if (by === r.requestedBy) return `segregation of duties: ${by} requested this and cannot decide it`;
  if (!r.requiredApprovers.includes(by)) return `${by} is not a required approver`;
  if (r.approvals.some((a) => a.by === by)) return `${by} has already decided`;
  return null;
}

/** The request's approvals and status after `by` decides. Call only when sodViolation is null. */
export function applyDecision<T extends Decidable>(r: T, by: Role, decision: "approve" | "reject", reason: string, at: string): Pick<T, "approvals" | "status"> {
  const approvals = [...r.approvals, { by, decision, reason, at }];
  const status =
    decision === "reject" ? "rejected" : r.requiredApprovers.every((role) => approvals.some((a) => a.by === role && a.decision === "approve")) ? "approved" : "pending";
  return { approvals, status } as Pick<T, "approvals" | "status">;
}
