import { describe, expect, it } from "vitest";
import type { JournalEntry, JournalLine, Request } from "@/lib/erp/types";
import {
  accountBalance,
  ACCOUNTS,
  createLedger,
  type Ledger,
  LedgerError,
  type LedgerErrorCode,
  loadChartOfAccounts,
  lockPeriod,
  openPeriod,
  post,
  reverse,
  trialBalance,
} from "./index";

const A = ACCOUNTS;

function approved(id: string, status: Request["status"] = "approved", kind: Request["kind"] = "journal_entry"): Request {
  return {
    id,
    kind,
    requestedBy: "inventory_accountant",
    requiredApprovers: ["controller"],
    approvals: status === "approved" ? [{ by: "controller", decision: "approve", reason: "ok", at: "2026-03-31" }] : [],
    payload: {},
    status,
  };
}

const dr = (account: string, cents: number): JournalLine => ({ account, debitCents: cents, creditCents: 0 });
const cr = (account: string, cents: number): JournalLine => ({ account, debitCents: 0, creditCents: cents });

function je(id: string, date: string, lines: JournalLine[], extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    period: date.slice(0, 7),
    date,
    memo: id,
    lines,
    sourceRefs: [],
    requestId: `REQ-${id}`,
    postedBy: "system",
    ...extra,
  };
}

function postOk(ledger: Ledger, entry: JournalEntry): Ledger {
  return post(ledger, entry, approved(entry.requestId));
}

function expectCode(fn: () => unknown, code: LedgerErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LedgerError);
    expect((e as LedgerError).code).toBe(code);
    return;
  }
  throw new Error(`expected LedgerError ${code}, nothing was thrown`);
}

function freshLedger(): Ledger {
  let l = createLedger(loadChartOfAccounts());
  for (const p of ["2026-03", "2026-04", "2026-05"]) l = openPeriod(l, p);
  return l;
}

describe("L1 balanced entry", () => {
  it("posts and the trial balance balances", () => {
    const l = postOk(freshLedger(), je("JE-1", "2026-03-10", [dr(A.inventory, 440_000), cr(A.apTrade, 440_000)]));
    const tb = trialBalance(l);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitCents).toBe(440_000);
    expect(accountBalance(l, A.apTrade)).toBe(-440_000);
  });

  it("is immutable: the old ledger is untouched and posted entries are frozen", () => {
    const before = freshLedger();
    const after = postOk(before, je("JE-1", "2026-03-10", [dr(A.inventory, 100), cr(A.apTrade, 100)]));
    expect(before.entries).toHaveLength(0);
    expect(Object.isFrozen(after.entries[0])).toBe(true);
    expect(Object.isFrozen(after.entries[0].lines[0])).toBe(true);
  });
});

describe("L2 invariants", () => {
  const l = freshLedger();
  it("rejects an entry unbalanced by 1¢", () => {
    expectCode(() => postOk(l, je("JE-1", "2026-03-10", [dr(A.inventory, 100), cr(A.apTrade, 99)])), "UNBALANCED");
  });
  it("rejects a single-line entry", () => {
    expectCode(() => postOk(l, je("JE-1", "2026-03-10", [dr(A.inventory, 100)])), "TOO_FEW_LINES");
  });
  it("rejects zero, negative, fractional, and two-sided lines", () => {
    expectCode(() => postOk(l, je("JE-1", "2026-03-10", [dr(A.inventory, 0), cr(A.apTrade, 0)])), "BAD_LINE");
    expectCode(() => postOk(l, je("JE-1", "2026-03-10", [dr(A.inventory, -5), cr(A.apTrade, -5)])), "BAD_LINE");
    expectCode(() => postOk(l, je("JE-1", "2026-03-10", [dr(A.inventory, 1.5), cr(A.apTrade, 1.5)])), "BAD_LINE");
    const both: JournalLine = { account: A.inventory, debitCents: 100, creditCents: 100 };
    expectCode(() => postOk(l, je("JE-1", "2026-03-10", [both, cr(A.apTrade, 0)])), "BAD_LINE");
  });
  it("rejects an unknown account", () => {
    expectCode(() => postOk(l, je("JE-1", "2026-03-10", [dr("9999", 100), cr(A.apTrade, 100)])), "UNKNOWN_ACCOUNT");
  });
  it("rejects a duplicate entry id", () => {
    const l2 = postOk(l, je("JE-1", "2026-03-10", [dr(A.inventory, 100), cr(A.apTrade, 100)]));
    expectCode(() => postOk(l2, je("JE-1", "2026-03-11", [dr(A.inventory, 100), cr(A.apTrade, 100)])), "DUPLICATE_ID");
  });
});

describe("L3 periods", () => {
  it("rejects posting to a locked period", () => {
    const l = lockPeriod(freshLedger(), "2026-03");
    expectCode(() => postOk(l, je("JE-1", "2026-03-31", [dr(A.inventory, 100), cr(A.apTrade, 100)])), "PERIOD_LOCKED");
  });
  it("rejects a date outside the entry's period and an unknown period", () => {
    const l = freshLedger();
    const wrongDate = je("JE-1", "2026-04-01", [dr(A.inventory, 100), cr(A.apTrade, 100)], { period: "2026-03" });
    expectCode(() => postOk(l, wrongDate), "DATE_OUTSIDE_PERIOD");
    expectCode(() => postOk(l, je("JE-2", "2026-09-01", [dr(A.inventory, 100), cr(A.apTrade, 100)])), "UNKNOWN_PERIOD");
  });
  it("never reopens a locked period", () => {
    expectCode(() => openPeriod(lockPeriod(freshLedger(), "2026-03"), "2026-03"), "PERIOD_LOCKED");
  });
});

describe("L4 authorization", () => {
  const entry = je("JE-1", "2026-03-10", [dr(A.inventory, 100), cr(A.apTrade, 100)]);
  it("rejects pending and rejected requests", () => {
    expectCode(() => post(freshLedger(), entry, approved(entry.requestId, "pending")), "NOT_AUTHORIZED");
    expectCode(() => post(freshLedger(), entry, approved(entry.requestId, "rejected")), "NOT_AUTHORIZED");
  });
  it("rejects a request of the wrong kind or for a different entry", () => {
    expectCode(() => post(freshLedger(), entry, approved(entry.requestId, "approved", "payment")), "NOT_AUTHORIZED");
    expectCode(() => post(freshLedger(), entry, approved("REQ-other")), "NOT_AUTHORIZED");
  });
});

describe("L5 reversal", () => {
  const base = postOk(freshLedger(), je("JE-1", "2026-03-10", [dr(A.inventory, 440_000), cr(A.apTrade, 440_000)]));
  const spec = { id: "JE-1R", period: "2026-03", date: "2026-03-12", requestId: "REQ-1R", postedBy: "system" as const, reason: "entered twice" };

  it("posts a linked mirror entry that nets the original to zero", () => {
    const l = reverse(base, "JE-1", spec, approved("REQ-1R"));
    const r = l.entries.find((e) => e.id === "JE-1R")!;
    expect(r.reversesId).toBe("JE-1");
    expect(l.reversedBy["JE-1"]).toBe("JE-1R");
    expect(r.lines).toEqual([
      { account: A.inventory, debitCents: 0, creditCents: 440_000, memo: undefined },
      { account: A.apTrade, debitCents: 440_000, creditCents: 0, memo: undefined },
    ]);
    expect(accountBalance(l, A.inventory)).toBe(0);
    expect(accountBalance(l, A.apTrade)).toBe(0);
  });

  it("refuses to reverse twice or to reverse a reversal", () => {
    const l = reverse(base, "JE-1", spec, approved("REQ-1R"));
    expectCode(() => reverse(l, "JE-1", { ...spec, id: "JE-1R2", requestId: "REQ-1R2" }, approved("REQ-1R2")), "ALREADY_REVERSED");
    expectCode(() => reverse(l, "JE-1R", { ...spec, id: "JE-1RR", requestId: "REQ-1RR" }, approved("REQ-1RR")), "CANNOT_REVERSE_REVERSAL");
    expectCode(() => reverse(l, "JE-nope", { ...spec, id: "X", requestId: "REQ-X" }, approved("REQ-X")), "UNKNOWN_ENTRY");
  });

  it("needs its own approved request", () => {
    expectCode(() => reverse(base, "JE-1", spec, approved("REQ-1R", "pending")), "NOT_AUTHORIZED");
  });
});

describe("L6 correcting a locked period", () => {
  it("posts the reversal in the current open period with a memo citing the original", () => {
    let l = postOk(freshLedger(), je("JE-1", "2026-03-20", [dr(A.inventory, 50_000), cr(A.apTrade, 50_000)]));
    l = lockPeriod(l, "2026-03");
    const inLocked = { id: "JE-1R", period: "2026-03", date: "2026-03-31", requestId: "REQ-1R", postedBy: "system" as const, reason: "wrong supplier" };
    expectCode(() => reverse(l, "JE-1", inLocked, approved("REQ-1R")), "PERIOD_LOCKED");

    l = reverse(l, "JE-1", { ...inLocked, period: "2026-04", date: "2026-04-03" }, approved("REQ-1R"));
    const r = l.entries.find((e) => e.id === "JE-1R")!;
    expect(r.period).toBe("2026-04");
    expect(r.memo).toContain("JE-1");
    expect(r.memo).toContain("2026-03");
    expect(accountBalance(l, A.apTrade, "2026-03")).toBe(-50_000);
    expect(accountBalance(l, A.apTrade, "2026-04")).toBe(0);
  });
});

describe("L7 GRNI accrual and reversal across a close", () => {
  it("accrues at March close, reverses April 1, books the actual with PPV", () => {
    let l = freshLedger();
    // Received late March, not invoiced: accrue at standard.
    l = postOk(l, je("JE-GRNI-03", "2026-03-31", [dr(A.inventory, 440_000), cr(A.grni, 440_000)], { sourceRefs: ["R-889"] }));
    const marchTb = trialBalance(l, "2026-03");
    expect(marchTb.balanced).toBe(true);
    expect(accountBalance(l, A.grni, "2026-03")).toBe(-440_000);
    l = lockPeriod(l, "2026-03");

    l = reverse(
      l,
      "JE-GRNI-03",
      { id: "JE-GRNI-03R", period: "2026-04", date: "2026-04-01", requestId: "REQ-GRNI-03R", postedBy: "system", reason: "auto-reverse accrual" },
      approved("REQ-GRNI-03R"),
    );
    // Invoice arrives at $4,440.00 vs $4,400.00 standard → $40.00 PPV.
    l = postOk(
      l,
      je("JE-INV-04", "2026-04-14", [dr(A.inventory, 440_000), dr(A.ppv, 4_000), cr(A.apTrade, 444_000)], { sourceRefs: ["INV-2041", "R-889"] }),
    );

    expect(accountBalance(l, A.grni, "2026-04")).toBe(0);
    expect(accountBalance(l, A.inventory, "2026-04")).toBe(440_000);
    expect(accountBalance(l, A.ppv, "2026-04")).toBe(4_000);
    expect(accountBalance(l, A.apTrade, "2026-04")).toBe(-444_000);
    expect(trialBalance(l, "2026-03")).toEqual(marchTb);
    expect(trialBalance(l, "2026-04").balanced).toBe(true);
  });
});
