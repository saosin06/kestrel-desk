import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEcbRates } from "@/lib/costing/reference";
import { loadBom, loadParts, loadProducts, loadSuppliers } from "@/lib/erp/master";
import { createCompany, validateCompany } from "@/lib/erp/store";
import { sweep } from "./sweep";
import { DEFAULT_SEED, generate, serializeWorld, SIM_WINDOW, type World } from "./world";

const SEEDS = [DEFAULT_SEED, 7];
const ROOT = join(import.meta.dirname, "..");

const keyOf = (kind: string, objectId: string) => `${kind} ${objectId}`;

function expectedFindings(w: World): string[] {
  return w.answerKey.entries
    .flatMap((e) => [keyOf(e.kind, e.objectId), ...(e.secondaryKinds ?? []).map((k) => keyOf(k, e.objectId))])
    .sort();
}

function company(w: World) {
  return createCompany({
    products: loadProducts(),
    bom: loadBom(),
    parts: loadParts(),
    suppliers: loadSuppliers(),
    contracts: w.contracts,
    pos: w.pos,
    receipts: w.receipts,
    packingSlips: w.packingSlips,
    invoices: w.invoices,
    certificates: w.certificates,
    customsEntries: w.customsEntries,
  });
}

describe.each(SEEDS)("generated world, seed %i", (seed) => {
  const w = generate(seed);
  const findings = sweep(w);

  it("is deterministic for a seed", () => {
    expect(JSON.stringify(generate(seed))).toBe(JSON.stringify(w));
  });

  it("deterministic checks find exactly the planted problems — no more, no fewer", () => {
    expect(findings.map((f) => keyOf(f.kind, f.objectId)).sort()).toEqual(expectedFindings(w));
  });

  it("engine impacts agree with the answer key where an engine computes them", () => {
    for (const e of w.answerKey.entries.filter((e) => e.kind === "price_variance_vs_contract" || e.kind === "duty_overcharge")) {
      const f = findings.find((f) => f.kind === e.kind && f.objectId === e.objectId)!;
      expect(f.impactUSDCents, e.id).toBe(e.impactUSDCents);
    }
  });

  it("the clean supplier (Northwind) raises nothing", () => {
    const nwDocs = new Set([...w.invoices.filter((i) => i.supplierId === "S-NW").map((i) => i.id)]);
    expect(nwDocs.size).toBeGreaterThan(0);
    expect(findings.filter((f) => nwDocs.has(f.objectId))).toEqual([]);
  });

  it("the headline substitution passes three-way match and fails only on compliance", () => {
    const sub = w.answerKey.entries.find((e) => e.problem === 1)!;
    expect(findings.filter((f) => f.objectId === sub.objectId).map((f) => f.source)).toEqual(["compliance"]);
  });

  it("referential integrity fails only on the unregistered-supplier invoice", () => {
    const errors = validateCompany(company(w));
    expect(errors.map((e) => e.objectId)).toEqual(["VI-2607-UNREG"]);
  });

  it("every date is inside the sim window and the FX cache; invoices never predate their PO", () => {
    const fx = loadEcbRates();
    const dated = [...w.pos, ...w.receipts, ...w.packingSlips, ...w.invoices, ...w.customsEntries];
    for (const d of dated) {
      expect(d.date >= SIM_WINDOW.from && d.date <= SIM_WINDOW.to, d.id).toBe(true);
      expect(d.date >= fx.from && d.date <= fx.to, d.id).toBe(true);
    }
    for (const inv of w.invoices.filter((i) => i.poId)) {
      expect(inv.date >= w.pos.find((p) => p.id === inv.poId)!.date, inv.id).toBe(true);
    }
  });

  it("every covered-class line has a certificate of origin except the planted gap", () => {
    const covered = new Set(["flight_controller", "radio_datalink", "camera", "gimbal"]);
    const parts = Object.fromEntries(loadParts().map((p) => [p.id, p]));
    const missing = w.invoices.flatMap((inv) =>
      inv.lines
        .filter((l) => l.partId && covered.has(parts[l.partId].componentClass))
        .filter((l) => !w.certificates.some((c) => c.invoiceId === inv.id && c.partId === l.partId))
        .map((l) => `${inv.id}/${l.partId}`),
    );
    expect(missing).toEqual(["VI-2607-HOS/P10"]);
  });
});

describe("committed data files", () => {
  it("match generate(DEFAULT_SEED) byte for byte (run `npm run generate` after changing the generator)", () => {
    for (const [path, content] of Object.entries(serializeWorld(generate(DEFAULT_SEED)))) {
      expect(readFileSync(join(ROOT, path), "utf8"), path).toBe(content);
    }
  });
});
