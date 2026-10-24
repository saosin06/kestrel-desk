// The desk's working state: cases, requests, and the append-only audit trail.
// Agents change it only through lib/desk/controls.ts.

import type { CaseKind, ISODate, Request, Role } from "@/lib/erp/types";
import type { Disposition } from "@/lib/rules/types";

export type DeskCase = {
  id: string;
  kind: CaseKind;
  openedOn: ISODate;
  openedBy: Role;
  status: "open" | "awaiting_approval" | "resolved" | "dismissed";
  /** engine findings the case is built on (`kind objectId`) */
  findingKeys: string[];
  objectIds: string[];
  /** copied from the engine, never written by a model */
  impactUSDCents: number;
  disposition: Disposition;
  ruleIds: string[];
  summary: string;
  systemOfRecord: string;
  notes: { at: ISODate; by: Role; text: string }[];
};

export type AuditEvent = {
  seq: number;
  at: ISODate;
  actor: Role;
  action: string;
  refs: string[];
  detail: string;
};

export type DeskMessage = { at: ISODate; from: Role; to: Role; text: string; refs: string[] };

export type DeskState = {
  cases: DeskCase[];
  requests: Request[];
  audit: AuditEvent[];
  messages: DeskMessage[];
};

export function createDeskState(): DeskState {
  return { cases: [], requests: [], audit: [], messages: [] };
}

export function audit(state: DeskState, e: Omit<AuditEvent, "seq">): AuditEvent {
  const event = Object.freeze({ ...e, seq: state.audit.length + 1, refs: [...e.refs] });
  state.audit.push(event);
  return event;
}
