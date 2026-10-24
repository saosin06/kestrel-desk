// Live seat runs for the demo: a judge's document goes into a scratch copy of
// the company (never the committed data), the deterministic checks answer
// immediately, and the seat agent's cases and requests are committed to Convex.

import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { AP_CLERK_PROMPT, PAYROLL_SPECIALIST_PROMPT } from "@/lib/agents/prompts";
import { runAgent } from "@/lib/agents/run";
import { buildTools, type DeskWorld, deskView, seatTools } from "@/lib/agents/tools";
import { createDeskState } from "@/lib/desk/state";
import type { CertificateOfOrigin, InboxMessage, Invoice } from "@/lib/erp/types";
import { dispose } from "@/lib/rules/dispose";
import type { InternalRule } from "@/lib/rules/types";
import { sweep } from "@/simulation/sweep";
import { DEFAULT_SEED, generate, type World } from "@/simulation/world";

let base: DeskWorld | undefined;
export const baseWorld = () => (base ??= deskView(generate(DEFAULT_SEED)));

export function convex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

/** Approved rules as they stand in Convex right now (the controller may have changed them). */
export async function currentRules(client: ConvexHttpClient): Promise<InternalRule[]> {
  const rows = await client.query(api.desk.rules, {});
  return rows.map((r) => ({
    id: r.ruleId,
    statement: r.statement,
    scope: r.scope,
    action: r.action,
    status: r.status as InternalRule["status"],
    source: r.source as InternalRule["source"],
    support: r.support,
    counterexamples: r.counterexamples,
    confidence: r.confidence,
    evidence: r.evidence,
  }));
}

/**
 * The company plus a judge's document. "replace" treats the new invoice as
 * the one that arrived for its PO (the original, its certificates and customs
 * entry are set aside); "additional" keeps the original (to test duplicates).
 */
export function overlay(add: { invoice?: Invoice; certificates?: CertificateOfOrigin[]; email?: InboxMessage; mode?: "replace" | "additional" }): DeskWorld {
  const w = baseWorld();
  let invoices = w.invoices;
  let certificates = w.certificates;
  let customsEntries = w.customsEntries;
  if (add.invoice) {
    if (add.mode !== "additional" && add.invoice.poId) {
      const replaced = new Set(w.invoices.filter((i) => i.poId === add.invoice!.poId).map((i) => i.id));
      invoices = invoices.filter((i) => !replaced.has(i.id));
      certificates = certificates.filter((c) => !replaced.has(c.invoiceId));
      customsEntries = customsEntries.filter((c) => !replaced.has(c.invoiceId));
    }
    invoices = [...invoices, add.invoice].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    certificates = [...certificates, ...(add.certificates ?? [])];
  }
  const inbox = add.email ? [...w.inbox, add.email] : w.inbox;
  return { ...w, invoices, certificates, customsEntries, inbox };
}

/** Deterministic findings for one record in a world, dispositioned by the given rules. Instant, no API. */
export function checkNow(world: DeskWorld, objectId: string, rules: InternalRule[]) {
  const findings = sweep(world as World);
  const decided = new Map(dispose(findings, rules).map((d) => [`${d.kind} ${d.objectId}`, d]));
  return findings
    .filter((f) => f.objectId === objectId)
    .map((f) => {
      const d = decided.get(`${f.kind} ${f.objectId}`)!;
      return { kind: f.kind, objectId: f.objectId, detail: f.detail, impactUSDCents: f.impactUSDCents ?? null, disposition: d.disposition, ruleId: d.ruleId ?? null, evidence: f.evidence ?? null };
    });
}

/** Runs one seat on a task against a world and commits what it did to Convex under the intake. */
export async function runSeatAndCommit(opts: { intakeId: string; seat: "ap_clerk" | "payroll_specialist"; world: DeskWorld; today: string; task: string; rules: InternalRule[] }) {
  const client = convex();
  try {
    const state = createDeskState();
    const tools = seatTools(buildTools(opts.world, () => opts.rules), opts.seat);
    const run = await runAgent({
      client: new Anthropic(),
      role: opts.seat,
      system: opts.seat === "ap_clerk" ? AP_CLERK_PROMPT : PAYROLL_SPECIALIST_PROMPT,
      task: opts.task,
      tools,
      ctx: { state, role: opts.seat, today: opts.today },
      maxTurns: 16,
    });
    await client.mutation(api.intake.commit, {
      intakeId: opts.intakeId,
      cases: state.cases,
      requests: state.requests,
      audit: state.audit,
      messages: state.messages,
      summary: run.finalText || "(no summary)",
      toolCalls: run.toolCalls.length,
    });
  } catch (e) {
    await client.mutation(api.intake.fail, { intakeId: opts.intakeId, error: e instanceof Error ? e.message.slice(0, 500) : String(e) });
  }
}
