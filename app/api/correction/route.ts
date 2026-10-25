import { api } from "@/convex/_generated/api";
import { convex } from "@/lib/live/desk";
import { decisionFor, learnFromCorrection } from "@/lib/rules/correct";
import type { FindingFacts, HistoryException, InternalRule } from "@/lib/rules/types";
import { desk } from "@/lib/ui/world";

/** Convex values can't hold undefined; drop absent optional fields. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));

/**
 * After the controller decides a hold or debit memo, record her decision as precedent
 * and re-mine (deterministic; lib/rules/correct.ts). Called by the decision controls;
 * idempotent per request. Returns what the desk learned, in words.
 */
export async function POST(req: Request) {
  const { reqId } = (await req.json()) as { reqId?: string };
  if (!reqId) return Response.json({ error: "reqId is required" }, { status: 400 });
  const client = convex();
  const request = (await client.query(api.desk.requests, {})).find((r) => r.reqId === reqId);
  if (!request) return Response.json({ error: `no request ${reqId}` }, { status: 404 });
  if (request.status !== "approved" && request.status !== "rejected") return Response.json({ effects: [] });
  const decision = decisionFor(request.kind, request.status);
  if (!decision || !request.caseId) return Response.json({ effects: [] });

  const corrections = await client.query(api.learning.corrections, {});
  const done = corrections.find((c) => c.reqId === reqId);
  if (done) return Response.json({ effects: done.effects });

  const detail = await client.query(api.desk.caseDetail, { caseId: request.caseId });
  if (!detail) return Response.json({ effects: [] });
  const c = detail.case;
  const last = request.approvals[request.approvals.length - 1];
  const { world, findings } = desk();
  const key = c.findingKeys[0] ?? `${c.kind} ${c.objectIds[0]}`;
  const finding = (findings as FindingFacts[]).find((f) => `${f.kind} ${f.objectId}` === key);
  const corrId = `LC-${String(corrections.length + 1).padStart(6, "0")}`;
  const base = { corrId, at: last.at, reqId, caseId: c.caseId, by: last.by, decision, reason: last.reason };

  if (!finding) {
    const effects = ["Not recorded as precedent: this case came from a live document, not the company's records."];
    await client.mutation(api.learning.record, { correction: { ...base, precedent: null, effects }, changes: [], proposals: [] });
    return Response.json({ effects });
  }

  const rules: InternalRule[] = (await client.query(api.desk.rules, {})).map((r) => ({
    id: r.ruleId, statement: r.statement, scope: r.scope, action: r.action, status: r.status as InternalRule["status"], source: r.source as InternalRule["source"],
    support: r.support, counterexamples: r.counterexamples, confidence: r.confidence, evidence: r.evidence, approvedOn: r.approvedOn,
  }));
  const prior = corrections.map((x) => x.precedent as HistoryException | null).filter((x): x is HistoryException => x !== null);
  const learned = learnFromCorrection(world.history.exceptions, prior, {
    id: corrId, finding, summary: c.summary, raisedBy: c.openedBy as HistoryException["raisedBy"], by: last.by as HistoryException["resolution"]["decidedBy"],
    decision, reason: last.reason, at: last.at, caseRuleIds: c.ruleIds, caseDisposition: c.disposition,
  }, rules);

  await client.mutation(api.learning.record, {
    correction: { ...base, precedent: plain(learned.precedent), effects: learned.effects },
    changes: learned.changes.map((ch) => ({ ruleId: ch.ruleId, patch: plain(ch.patch), before: plain(ch.before), effect: ch.effect })),
    proposals: plain(learned.proposals),
  });
  return Response.json({ effects: learned.effects });
}
