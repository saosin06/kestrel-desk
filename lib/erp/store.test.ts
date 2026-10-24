import { describe, expect, it } from "vitest";
import { createCompany, validateCompany } from "./store";
import type { Part, Supplier } from "./types";

const supplier: Supplier = { id: "S-NW", name: "Northwind", country: "US", currency: "USD", remitToId: "BANK-NW" };
const part: Part = {
  id: "P12",
  name: "Wiring harness",
  hts: "8544.42.90",
  componentClass: "harness",
  standardCostE4: 110_000,
  approvedSuppliers: ["S-NW"],
  criticality: "standard",
};

describe("E1 validateCompany", () => {
  it("passes a consistent graph", () => {
    const c = createCompany({
      suppliers: [supplier],
      parts: [part],
      pos: [{ id: "PO-1", supplierId: "S-NW", currency: "USD", date: "2026-03-02", status: "open", lines: [{ partId: "P12", qty: 400, unitPriceE4: 110_000 }] }],
      receipts: [{ id: "R-1", poId: "PO-1", date: "2026-03-20", enteredBy: "receiving", lines: [{ partId: "P12", qty: 400, lot: "L1" }] }],
    });
    expect(validateCompany(c)).toEqual([]);
  });

  it("lists every broken reference by object id", () => {
    const c = createCompany({
      suppliers: [supplier, { ...supplier, id: "S-ATL", name: "Atlas" }],
      parts: [part],
      contracts: [
        {
          id: "C-12",
          supplierId: "S-ATL",
          partId: "P12",
          currency: "USD",
          incoterm: "FCA",
          leadTimeDays: 30,
          prices: [{ unitPriceE4: 110_000, validFrom: "2026-01-01", validTo: "2026-12-31", clauseRef: "C-12 §4.2" }],
        },
      ],
      receipts: [{ id: "R-9", poId: "PO-missing", date: "2026-03-20", enteredBy: "receiving", lines: [{ partId: "P12", qty: 1, lot: "L1" }] }],
    });
    expect(validateCompany(c)).toEqual([
      { objectId: "C-12", message: "supplier S-ATL is not an approved supplier for P12" },
      { objectId: "R-9", message: "unknown PO PO-missing" },
    ]);
  });

  it("rejects duplicate ids at construction", () => {
    expect(() => createCompany({ parts: [part, part] })).toThrow(/duplicate part id P12/);
  });
});
