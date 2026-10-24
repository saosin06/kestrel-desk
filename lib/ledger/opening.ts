import openingData from "@/data/opening-balances.json";
import type { JournalEntry, Request } from "@/lib/erp/types";
import { parseMoney } from "@/lib/money";
import { openPeriod } from "./periods";
import { post } from "./post";
import type { Ledger } from "./state";

export const OPENING_REQUEST_ID = "REQ-OPENING-2026-02";

/** The balance sheet at 2026-02-28 as a single entry in period 2026-02. */
export function openingEntry(): JournalEntry {
  return {
    id: "JE-OPENING-2026-02",
    period: openingData.period,
    date: openingData.asOf,
    memo: "Opening balances carried forward (summarized balance sheet)",
    lines: openingData.lines.map((l) => ({
      account: l.account,
      debitCents: "debit" in l ? parseMoney(l.debit as string, "USD") : 0,
      creditCents: "credit" in l ? parseMoney(l.credit as string, "USD") : 0,
    })),
    sourceRefs: ["data/opening-balances.json"],
    requestId: OPENING_REQUEST_ID,
    postedBy: "system",
  };
}

const openingApproval: Request = {
  id: OPENING_REQUEST_ID,
  kind: "journal_entry",
  requestedBy: "system",
  requiredApprovers: ["controller"],
  approvals: [{ by: "controller", decision: "approve", reason: "FY2026 opening balances", at: "2026-02-28" }],
  payload: {},
  status: "approved",
};

export function postOpeningBalances(ledger: Ledger): Ledger {
  return post(openPeriod(ledger, openingData.period), openingEntry(), openingApproval);
}
