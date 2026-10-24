// Kestrel's 14 months of history before the sim (Jan 2025 – Feb 2026), at
// exception-log level: what the desk flagged, what Dana decided and why,
// incidents, dated policy memos, and monthly volumes. Amounts are USD as
// booked (no FX or customs math — the caches don't reach back that far).
//
// The history encodes internal rules nobody wrote down, plus things that
// should NOT become rules: decoys with too little support, a decoy with mixed
// outcomes, a counterexample, a threshold that drifts after a memo, and a
// near-miss where Dana approved an emailed bank change.

import type { ISODate } from "@/lib/erp/types";
import type { History, HistoryDecision, HistoryException, HistoryIncident, HistoryMemo, HistoryVolume, InternalRule } from "@/lib/rules/types";

export type { History, HistoryException } from "@/lib/rules/types";

export type HiddenRule = Omit<InternalRule, "status" | "support" | "counterexamples" | "confidence" | "evidence"> & {
  discoverableBy: "statistics" | "memo";
};

export type Decoy = { id: string; description: string; evidence: string[] };

const MONTHS = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"];

type Rng = { int: (min: number, max: number) => number; pick: <T>(xs: readonly T[]) => T };

export type HistoryParams = {
  /** weight-count tolerance for Atlas fasteners after the memo (bp) */
  p14ToleranceBp: number;
  p14MemoDate: ISODate;
  /** Hoshi rounds yen line totals down to this unit */
  hoshiRoundingYen: number;
  cascadeRecounts: number;
};

export function historyParams(rng: Rng): HistoryParams {
  return {
    p14ToleranceBp: rng.pick([40, 50, 60]),
    p14MemoDate: rng.pick(["2025-09-15", "2025-10-01"]),
    hoshiRoundingYen: rng.pick([100, 1000]),
    cascadeRecounts: rng.int(6, 8),
  };
}

export function generateHistory(rng: Rng, params: HistoryParams, monthlySpendUSDCents: Record<string, number>) {
  const exceptions: HistoryException[] = [];
  let seq = 1;
  const id = () => `HX-${String(seq++).padStart(4, "0")}`;
  const day = (m: string, lo = 4, hi = 24) => `${m}-${String(rng.int(lo, hi)).padStart(2, "0")}`;
  const plus = (date: ISODate, n: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const push = (e: Omit<HistoryException, "id">) => {
    const x = { id: id(), ...e };
    exceptions.push(x);
    return x;
  };

  // ---- HR1: Atlas M3 screws are counted by weight; small shortfalls are scale tolerance.
  // Runs of months: 0-1, 3-5 (third rejected), 7, 9 (post-memo, over the new limit), 11-12.
  const tol = params.p14ToleranceBp;
  const p14 = (m: number, bp: number, decision: HistoryDecision, reason: string, date?: ISODate) => {
    const d = date ?? day(MONTHS[m]);
    const qty = 36_000;
    const short = Math.round((qty * bp) / 10_000);
    return push({
      date: d,
      supplierId: "S-ATL",
      partId: "P14",
      kind: "qty_mismatch",
      diffKind: "qty_mismatch",
      impactUSDCents: Math.round(short * 3.5),
      attrs: { qtyVarianceBp: bp },
      summary: `Dock weighed ${qty - short} M3 screws vs ${qty} invoiced (${(bp / 100).toFixed(2)}% short)`,
      raisedBy: "ap_clerk",
      resolution: { decidedBy: "controller", decision, reason, date: plus(d, rng.int(1, 4)) },
    });
  };
  const weighAccept = (bp: number) => `Fasteners are counted by weight at the dock; ${(bp / 100).toFixed(2)}% is within scale tolerance. Accept the invoice quantity.`;
  for (const m of [0, 1, 3, 4]) {
    const bp = rng.int(15, 95);
    p14(m, bp, "accepted", weighAccept(bp));
  }
  p14(5, rng.int(20, 35), "rejected", "Third short delivery in a row from Atlas — that's a pattern, not the scale. Hold it and have Raj raise it with Atlas.");
  p14(7, 90, "accepted", weighAccept(90));
  p14(9, rng.int(tol + 15, 85), "rejected", `Over the new weight-count tolerance in my memo of ${params.p14MemoDate}. Hold for a recount.`, plus(params.p14MemoDate, rng.int(5, 15)));
  p14(11, rng.int(10, tol - 5), "accepted", "Within the weight-count tolerance — accept.");
  p14(12, tol, "accepted", "Right at the weight-count limit — accept.");

  // ---- HR2: Hoshi rounds yen line totals down; every month, always accepted.
  const unit = params.hoshiRoundingYen;
  const nearMax = rng.int(1, 12);
  MONTHS.forEach((m, i) => {
    const diff = i === nearMax ? unit - 1 : rng.int(1, unit - 1);
    push({
      date: day(m),
      supplierId: "S-HOS",
      partId: rng.pick(["P10", "P11"]),
      kind: "source_disagreement",
      diffKind: "line_amount_mismatch",
      impactUSDCents: Math.max(1, Math.round(diff / 1.5)),
      attrs: { lineDiffMinor: diff, currency: "JPY" },
      summary: `Hoshi line total is ¥${diff} below qty × unit price`,
      raisedBy: "ap_clerk",
      resolution: { decidedBy: "controller", decision: "accepted", reason: `Hoshi rounds line totals down to the nearest ¥${unit.toLocaleString("en-US")}. Immaterial — accept.`, date: day(m, 25, 28) },
    });
  });

  // ---- HR3: Cascade's bulky deliveries get miscounted at the dock; a recount fixes it.
  const cascadeMonths = [0, 2, 4, 6, 8, 10, 12, 1, 3].slice(0, params.cascadeRecounts + 1).map((i) => MONTHS[i]);
  cascadeMonths.forEach((m, i) => {
    const partId = rng.pick(["P01", "P02", "P03"]);
    const shortShip = i === 3;
    const d = day(m);
    push({
      date: d,
      supplierId: "S-CAS",
      partId,
      kind: "qty_mismatch",
      diffKind: "qty_mismatch",
      impactUSDCents: rng.int(2, 9) * 100_00,
      attrs: { qtyVarianceBp: rng.int(300, 1200) },
      summary: `Receipt quantity for ${partId} disagrees with Cascade's packing slip`,
      raisedBy: "ap_clerk",
      resolution: shortShip
        ? { decidedBy: "controller", decision: "debit_memo", reason: "Recount confirmed Cascade really did short-ship us. Debit memo for the difference.", date: plus(d, 3) }
        : { decidedBy: "receiving", decision: "recount_corrected", reason: "Luis recounted — matched the packing slip. Dock entry error, receipt corrected.", date: plus(d, 1) },
    });
  });

  // ---- Decoys
  const decoys: Decoy[] = [];
  {
    const ev = ["2025-05", "2025-12"].map((m) =>
      push({
        date: day(m),
        supplierId: "S-VIR",
        kind: "source_disagreement",
        diffKind: "unmatched_line",
        impactUSDCents: 35_000,
        attrs: {},
        summary: "Vireo added a late-payment fee line not on the PO",
        raisedBy: "ap_clerk",
        resolution: { decidedBy: "controller", decision: "accepted", reason: "We paid late that month. Waive the fight this once — pay the fee.", date: day(m, 25, 28) },
      }),
    );
    decoys.push({ id: "D1", description: "Vireo late fees accepted twice — too little support to be a rule", evidence: ev.map((e) => e.id) });
  }
  {
    const ev = ["2025-12-04", "2025-12-18"].map((d) =>
      push({
        date: d,
        supplierId: "S-RDG",
        partId: "P06",
        kind: "price_variance_vs_contract",
        diffKind: "price_over_tolerance",
        impactUSDCents: 410_000,
        attrs: {},
        summary: "Ridgeline battery price above contract",
        raisedBy: "ap_clerk",
        resolution: { decidedBy: "controller", decision: "accepted", reason: "Year-end expedite at a one-time price Raj agreed by email. One-off.", date: plus(d, 2) },
      }),
    );
    decoys.push({ id: "D2", description: "Ridgeline year-end price accepted twice — explicitly one-off", evidence: ev.map((e) => e.id) });
  }
  {
    const outcomes: HistoryDecision[] = ["accepted", "rejected", "rejected", "accepted", "rejected"];
    const ev = outcomes.map((decision, i) =>
      push({
        date: day(MONTHS[1 + i * 2]),
        supplierId: "S-NW",
        kind: "source_disagreement",
        diffKind: "unmatched_line",
        impactUSDCents: rng.int(180, 640) * 100,
        attrs: {},
        summary: "Northwind added a freight line not on the PO",
        raisedBy: "ap_clerk",
        resolution: {
          decidedBy: "controller",
          decision,
          reason: decision === "accepted" ? "We asked for expedited shipping that time — pay it." : "Our terms are delivered. Short-pay the freight line.",
          date: day(MONTHS[1 + i * 2], 25, 28),
        },
      }),
    );
    decoys.push({ id: "D3", description: "Northwind freight lines — mixed outcomes, depends on who asked for expediting", evidence: ev.map((e) => e.id) });
  }
  const trap = push({
    date: "2025-11-10",
    supplierId: "S-HOS",
    kind: "remittance_change_unverified",
    impactUSDCents: 0,
    attrs: {},
    summary: "Email from 'Hoshi accounts' asking to update remit-to bank details",
    raisedBy: "ap_clerk",
    resolution: { decidedBy: "controller", decision: "accepted", reason: "Looks legitimate — update the bank details.", date: "2025-11-11" },
  });
  decoys.push({ id: "D4", description: "Trap: Dana approved an emailed bank change once; it was a near-miss. Never a rule to approve bank changes.", evidence: [trap.id] });

  // ---- Noise: material price variances (always debit memo) and caught duplicates.
  for (const [m, s, p] of [["2025-02", "S-VIR", "P05"], ["2025-04", "S-ATL", "P07"], ["2025-08", "S-RDG", "P09"], ["2025-10", "S-VIR", "P04"]] as const) {
    push({
      date: day(m),
      supplierId: s,
      partId: p,
      kind: "price_variance_vs_contract",
      diffKind: "price_over_tolerance",
      impactUSDCents: rng.int(30, 180) * 100_000,
      attrs: {},
      summary: `Invoice price above contract for ${p}`,
      raisedBy: "ap_clerk",
      resolution: { decidedBy: "controller", decision: "debit_memo", reason: "Contract price governs. Debit memo for the difference.", date: day(m, 25, 28) },
    });
  }
  for (const [m, s] of [["2025-03", "S-RDG"], ["2025-09", "S-RDG"]] as const) {
    push({
      date: day(m),
      supplierId: s,
      kind: "duplicate_invoice",
      impactUSDCents: rng.int(80, 130) * 1_000_000,
      attrs: {},
      summary: "Ridgeline re-sent an unpaid invoice with a suffix",
      raisedBy: "ap_clerk",
      resolution: { decidedBy: "controller", decision: "rejected", reason: "Duplicate — paid once already. Block it.", date: day(m, 25, 28) },
    });
  }

  exceptions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const incidents: HistoryIncident[] = [
    {
      id: "INC-2025-11",
      date: "2025-11-14",
      title: "Near-miss: remit-to change from a spoofed Hoshi email",
      narrative:
        "On Nov 11 we updated Hoshi's bank details from an emailed request. Before the Nov 14 payment run, our bank flagged that the new account's name didn't match Hoshi Optics K.K. A call to Hoshi's AR contact (number on file) confirmed they had sent nothing. Payment of ¥31.6M stopped; vendor master restored.",
      refs: [trap.id],
    },
  ];
  const memos: HistoryMemo[] = [
    {
      id: "MEMO-2025-03",
      date: "2025-03-03",
      from: "controller",
      subject: "AP materiality",
      body: "Price and duty variances under $1,000 are logged, not escalated, unless the same thing keeps happening. Quantity problems always come to me until resolved.",
    },
    {
      id: "MEMO-P14",
      date: params.p14MemoDate,
      from: "controller",
      subject: "Weight-count tolerance for fasteners",
      body: `Effective today, when the dock counts fasteners by weight, we accept the invoice quantity if the shortfall is ${(params.p14ToleranceBp / 100).toFixed(2)}% or less (was 1%). Anything over that gets a recount. Three short deliveries in a row still come to me.`,
    },
    {
      id: "MEMO-2025-11",
      date: "2025-11-20",
      from: "controller",
      subject: "Bank detail changes — new rule after the Hoshi near-miss",
      body: "No remit-to change goes into the vendor master from an email, ever. AP calls the supplier on the number already on file, documents the call, and sends me a vendor-change request. I approve; AP never edits the vendor master.",
    },
  ];

  const volumes: HistoryVolume[] = MONTHS.flatMap((period) =>
    Object.entries(monthlySpendUSDCents).map(([supplierId, spend]) => ({
      period,
      supplierId,
      invoices: supplierId === "S-CAS" || supplierId === "S-NW" ? rng.int(1, 3) : 1,
      spendUSDCents: Math.round((spend * rng.int(88, 104)) / 100),
    })),
  );

  const hiddenRules: HiddenRule[] = [
    {
      id: "HR1",
      statement: `Atlas M3 screws are counted by weight: accept the invoice quantity when the dock is short by ${(tol / 100).toFixed(2)}% or less, unless it's the third short month in a row.`,
      scope: { kind: "qty_mismatch", diffKind: "qty_mismatch", supplierId: "S-ATL", partId: "P14", attr: "qtyVarianceBp", maxAttr: tol, unlessConsecutiveMonths: 3 },
      action: { type: "info" },
      source: "statistics",
      discoverableBy: "statistics",
    },
    {
      id: "HR2",
      statement: `Hoshi rounds yen line totals down to ¥${unit.toLocaleString("en-US")}: accept line differences under ¥${unit.toLocaleString("en-US")}.`,
      scope: { kind: "source_disagreement", diffKind: "line_amount_mismatch", supplierId: "S-HOS", currency: "JPY", attr: "lineDiffMinor", maxAttr: unit - 1 },
      action: { type: "info" },
      source: "statistics",
      discoverableBy: "statistics",
    },
    {
      id: "HR3",
      statement: "Cascade quantity disagreements are usually dock miscounts: ask receiving to recount before escalating.",
      scope: { kind: "qty_mismatch", diffKind: "qty_mismatch", supplierId: "S-CAS" },
      action: { type: "require_check", check: "recount" },
      source: "statistics",
      discoverableBy: "statistics",
    },
    {
      id: "HR4",
      statement: "Remit-to changes are verified by calling the supplier on the number on file, then a vendor-change request to the controller; never from email.",
      scope: { kind: "remittance_change_unverified" },
      action: { type: "route_to", role: "controller" },
      source: "memo",
      discoverableBy: "memo",
    },
  ];

  return { history: { window: { from: "2025-01-01", to: "2026-02-28" }, exceptions, incidents, memos, volumes } satisfies History, hiddenRules, decoys };
}
