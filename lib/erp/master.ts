// Loads company master data from data/*.json into typed objects.

import bomData from "@/data/bom.json";
import partsData from "@/data/parts.json";
import suppliersData from "@/data/suppliers.json";
import { isCurrency, parseUnitPrice } from "@/lib/money";
import type { BomLine, CustomerType, Part, Product, Supplier } from "./types";

export function loadParts(): Part[] {
  return partsData.parts.map((p) => ({
    id: p.id,
    name: p.name,
    hts: p.hts,
    htsBasis: "htsBasis" in p ? (p.htsBasis as string) : undefined,
    componentClass: p.componentClass,
    standardCostE4: parseUnitPrice(p.standardCost),
    approvedSuppliers: p.approvedSuppliers,
    criticality: p.criticality as Part["criticality"],
  }));
}

export function loadSuppliers(): Supplier[] {
  return suppliersData.suppliers.map((s) => {
    if (!isCurrency(s.currency)) throw new Error(`supplier ${s.id}: unsupported currency ${s.currency}`);
    return { id: s.id, name: s.name, country: s.country, currency: s.currency, remitToId: s.remitToId };
  });
}

export function loadProducts(): Product[] {
  return bomData.products.map((p) => ({ id: p.id, name: p.name, customerTypes: p.customerTypes as CustomerType[] }));
}

export function loadBom(): BomLine[] {
  return bomData.bom.map((b) => ({ ...b }));
}
