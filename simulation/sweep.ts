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
import type { CaseKind, CompliancePolicy, Invoice, PeriodId } from "@/lib/erp/types";
import type { World } from "./world";

export type Finding = {
  kind: CaseKind;
  objectId: string;
  period: PeriodId;
  source: "integrity" | "duplicate" | "match" | "compliance" | "customs";
  impactUSDCents?: number;
  detail: string;
};

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
  const add = (f: Finding) => {
    if (!findings.some((x) => x.kind === f.kind && x.objectId === f.objectId)) findings.push(f);
  };

  const seen: Invoice[] = [];
  const accepted = new Map<string, Invoice[]>();

  for (const inv of world.invoices) {
    const period = inv.date.slice(0, 7);
    const supplier = suppliers[inv.supplierId];
    if (!supplier) {
      add({ kind: "unknown_supplier", objectId: inv.id, period, source: "integrity", detail: `"${inv.supplierName}" is not in the vendor master` });
      continue;
    }
    const po = world.pos.find((p) => p.id === inv.poId);
    if (!po) {
      add({ kind: "source_disagreement", objectId: inv.id, period, source: "integrity", detail: `no PO ${inv.poId ?? "(none cited)"}` });
      continue;
    }

    const dups = findDuplicates(inv, seen);
    seen.push(inv);
    if (dups.length > 0) {
      add({ kind: "duplicate_invoice", objectId: inv.id, period, source: "duplicate", detail: `same bill as ${dups.map((d) => d.id).join(", ")}` });
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
    for (const d of result.diffs.filter((d) => d.severity === "hold")) {
      const impact = d.deltaMinor === undefined ? undefined : convert(fx, d.deltaMinor, inv.currency, "USD", inv.date).amountMinor;
      add({ kind: MATCH_HOLD_KIND[d.kind], objectId: inv.id, period, source: "match", impactUSDCents: impact, detail: `${d.kind}: ${d.note}` });
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
        add({ kind: "noncompliant_substitution", objectId: inv.id, period, source: "compliance", detail: r.reasons.join("; ") });
      } else if (r.status === "unknown") {
        add({ kind: "missing_document", objectId: inv.id, period, source: "compliance", detail: r.reasons.join("; ") });
      } else if (r.substitution) {
        add({ kind: "source_disagreement", objectId: inv.id, period, source: "compliance", detail: `unapproved substitution: ${r.reasons.join("; ")}` });
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
      const entryPeriod = entry.date.slice(0, 7);
      for (const l of check.lines) {
        if (l.kind === "duty_overcharge") {
          add({ kind: "duty_overcharge", objectId: entry.id, period: entryPeriod, source: "customs", impactUSDCents: l.deltaCents, detail: l.note });
        } else if (l.kind === "source_disagreement") {
          add({ kind: "source_disagreement", objectId: entry.id, period: entryPeriod, source: "customs", detail: l.note });
        }
      }
    }
  }
  return findings;
}
