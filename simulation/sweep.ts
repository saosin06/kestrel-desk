// Runs every deterministic check over a world in invoice-date order: the
// findings a perfect desk would raise before any judgment is applied. Used to
// prove the generator plants exactly what the answer key says (and nothing
// else), and later as the baseline the agents are scored against.

import policyData from "@/data/compliance-policy.json";
import { checkCompliance } from "@/lib/compliance/check";
import { convert } from "@/lib/costing/fx";
import { compareToCustoms, landedCost } from "@/lib/costing/landed";
import { loadAdditionalDuties, loadEcbRates, loadHtsTable } from "@/lib/costing/reference";
import { loadBom, loadParts, loadProducts, loadSuppliers } from "@/lib/erp/master";
import { type DiffKind, findDuplicates, threeWayMatch } from "@/lib/erp/match";
import type { CaseKind, CompliancePolicy, Invoice } from "@/lib/erp/types";
import { lineAmount } from "@/lib/money";
import type { FindingFacts } from "@/lib/rules/types";
import { type PayrollFinding, payrollSweep } from "./payrollSweep";
import type { World } from "./world";

export type Finding =
  | (FindingFacts & {
      source: "integrity" | "duplicate" | "match" | "compliance" | "customs";
      detail: string;
    })
  | PayrollFinding;

const MATCH_HOLD_KIND: Record<DiffKind, CaseKind> = {
  price_over_tolerance: "price_variance_vs_contract",
  qty_mismatch: "qty_mismatch",
  no_receipt: "qty_mismatch",
  over_po: "qty_mismatch",
  supplier_mismatch: "source_disagreement",
  currency_mismatch: "source_disagreement",
  total_mismatch: "source_disagreement",
  line_amount_mismatch: "source_disagreement",
  unmatched_line: "source_disagreement",
  contract_price_missing: "source_disagreement",
  // info only; never mapped to a hold
  favorable_price: "price_variance_vs_contract",
  po_price_differs_from_contract: "price_variance_vs_contract",
};

export function sweep(world: World): Finding[] {
  const fx = loadEcbRates();
  const hts = loadHtsTable();
  const additionalDuties = loadAdditionalDuties();
  const policy = policyData as CompliancePolicy;
  const parts = Object.fromEntries(loadParts().map((p) => [p.id, p]));
  const suppliers = Object.fromEntries(loadSuppliers().map((s) => [s.id, s]));
  const bom = Object.fromEntries(loadBom().map((b) => [b.partId, b]));
  const product = loadProducts()[0];

  const findings: Finding[] = [];
  /** One finding per (kind, object); repeats merge (largest attribute, summed impact). */
  const add = (f: Omit<Finding, "attrs"> & { attrs?: Finding["attrs"] }) => {
    const full: Finding = { ...f, attrs: f.attrs ?? {} };
    const prev = findings.find((x) => x.kind === full.kind && x.objectId === full.objectId);
    if (!prev) return void findings.push(full);
    if (full.impactUSDCents !== undefined) prev.impactUSDCents = (prev.impactUSDCents ?? 0) + full.impactUSDCents;
    for (const k of ["qtyVarianceBp", "lineDiffMinor"] as const) {
      if (full.attrs[k] !== undefined) prev.attrs[k] = Math.max(prev.attrs[k] ?? 0, full.attrs[k]!);
    }
  };

  const seen: Invoice[] = [];
  const accepted = new Map<string, Invoice[]>();

  for (const inv of world.invoices) {
    const period = inv.date.slice(0, 7);
    const at = { date: inv.date, period, supplierId: inv.supplierId };
    const supplier = suppliers[inv.supplierId];
    if (!supplier) {
      add({ ...at, kind: "unknown_supplier", objectId: inv.id, source: "integrity", detail: `"${inv.supplierName}" is not in the vendor master` });
      continue;
    }
    const po = world.pos.find((p) => p.id === inv.poId);
    if (!po) {
      add({ ...at, kind: "source_disagreement", objectId: inv.id, source: "integrity", detail: `no PO ${inv.poId ?? "(none cited)"}` });
      continue;
    }

    const dups = findDuplicates(inv, seen);
    seen.push(inv);
    if (dups.length > 0) {
      add({ ...at, kind: "duplicate_invoice", objectId: inv.id, source: "duplicate", detail: `same bill as ${dups.map((d) => d.id).join(", ")}` });
    }

    const result = threeWayMatch({
      po,
      receipts: world.receipts.filter((r) => r.poId === po.id),
      packingSlips: world.packingSlips.filter((s) => s.poId === po.id),
      invoice: inv,
      priorInvoices: accepted.get(po.id) ?? [],
      contracts: world.contracts.filter((c) => c.supplierId === inv.supplierId),
      fx,
    });
    const usd = (minor: number) => convert(fx, minor, inv.currency, "USD", inv.date).amountMinor;
    for (const d of result.diffs.filter((d) => d.severity === "hold")) {
      const attrs: Finding["attrs"] = {};
      let impact = d.deltaMinor === undefined ? undefined : usd(d.deltaMinor);
      if (d.kind === "qty_mismatch" && typeof d.expected === "number" && typeof d.actual === "number") {
        const gap = Math.abs(d.expected - d.actual);
        attrs.qtyVarianceBp = Math.round((gap * 10_000) / d.actual);
        const price = po.lines.find((l) => l.partId === d.partId)!.unitPriceE4;
        impact = usd(lineAmount(gap, price, inv.currency));
      }
      if (d.kind === "line_amount_mismatch") {
        attrs.lineDiffMinor = Math.abs(d.deltaMinor ?? 0);
        attrs.currency = inv.currency;
        impact = Math.abs(impact ?? 0);
      }
      add({ ...at, kind: MATCH_HOLD_KIND[d.kind], objectId: inv.id, partId: d.partId, diffKind: d.kind, source: "match", impactUSDCents: impact, attrs, detail: `${d.kind}: ${d.note}` });
    }
    if (result.status === "match" && dups.length === 0) accepted.set(po.id, [...(accepted.get(po.id) ?? []), inv]);

    for (const line of inv.lines) {
      if (!line.partId || !bom[line.partId]) continue;
      const cert = world.certificates.find((c) => c.invoiceId === inv.id && c.partId === line.partId);
      const r = checkCompliance({
        part: parts[line.partId],
        bomLine: bom[line.partId],
        product,
        policy,
        facts: {
          countryOfOrigin: cert?.countryOfOrigin,
          certificateId: cert?.id,
          manufacturer: cert?.manufacturer,
          manufacturerPartNo: line.manufacturerPartNo,
        },
      });
      if (r.status === "fail") {
        add({ ...at, partId: line.partId, kind: "noncompliant_substitution", objectId: inv.id, source: "compliance", detail: r.reasons.join("; ") });
      } else if (r.status === "unknown") {
        add({ ...at, partId: line.partId, kind: "missing_document", objectId: inv.id, source: "compliance", detail: r.reasons.join("; ") });
      } else if (r.substitution) {
        add({ ...at, partId: line.partId, kind: "source_disagreement", objectId: inv.id, source: "compliance", detail: `unapproved substitution: ${r.reasons.join("; ")}` });
      }
    }

    const entry = world.customsEntries.find((c) => c.invoiceId === inv.id);
    if (entry) {
      const landed = landedCost({
        invoice: inv,
        supplier,
        parts,
        hts,
        additionalDuties,
        fx,
        freightUSDCents: 0,
        brokerFeeUSDCents: entry.brokerFeeUSDCents,
        certificates: world.certificates.filter((c) => c.invoiceId === inv.id),
      });
      const check = compareToCustoms(landed, entry, parts, hts, additionalDuties, inv.date);
      const ce = { date: entry.date, period: entry.date.slice(0, 7), supplierId: inv.supplierId, objectId: entry.id, source: "customs" as const };
      for (const l of check.lines) {
        if (l.kind === "duty_overcharge") {
          add({ ...ce, kind: "duty_overcharge", partId: l.partId, diffKind: "wrong_hts", impactUSDCents: l.deltaCents, detail: l.note });
        } else if (l.kind === "source_disagreement") {
          add({ ...ce, kind: "source_disagreement", partId: l.partId, diffKind: "customs_gap", detail: l.note });
        }
      }
    }
  }
  return [...findings, ...payrollSweep(world.payroll)];
}
