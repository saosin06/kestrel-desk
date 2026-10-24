import type {
  BomLine,
  CertificateOfOrigin,
  Contract,
  CustomsEntry,
  Invoice,
  PackingSlip,
  Part,
  PO,
  Product,
  Receipt,
  Supplier,
} from "./types";

/** The company graph: every business object, keyed by id. Plain data, no behavior. */
export type Company = {
  readonly products: Readonly<Record<string, Product>>;
  readonly bom: readonly BomLine[];
  readonly parts: Readonly<Record<string, Part>>;
  readonly suppliers: Readonly<Record<string, Supplier>>;
  readonly contracts: Readonly<Record<string, Contract>>;
  readonly pos: Readonly<Record<string, PO>>;
  readonly receipts: Readonly<Record<string, Receipt>>;
  readonly packingSlips: Readonly<Record<string, PackingSlip>>;
  readonly invoices: Readonly<Record<string, Invoice>>;
  readonly certificates: Readonly<Record<string, CertificateOfOrigin>>;
  readonly customsEntries: Readonly<Record<string, CustomsEntry>>;
};

export type CompanyInput = {
  products?: Product[];
  bom?: BomLine[];
  parts?: Part[];
  suppliers?: Supplier[];
  contracts?: Contract[];
  pos?: PO[];
  receipts?: Receipt[];
  packingSlips?: PackingSlip[];
  invoices?: Invoice[];
  certificates?: CertificateOfOrigin[];
  customsEntries?: CustomsEntry[];
};

function byId<T extends { id: string }>(kind: string, items: T[] = []): Readonly<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const item of items) {
    if (out[item.id]) throw new Error(`duplicate ${kind} id ${item.id}`);
    out[item.id] = item;
  }
  return Object.freeze(out);
}

export function createCompany(input: CompanyInput): Company {
  return Object.freeze({
    products: byId("product", input.products),
    bom: Object.freeze([...(input.bom ?? [])]),
    parts: byId("part", input.parts),
    suppliers: byId("supplier", input.suppliers),
    contracts: byId("contract", input.contracts),
    pos: byId("PO", input.pos),
    receipts: byId("receipt", input.receipts),
    packingSlips: byId("packing slip", input.packingSlips),
    invoices: byId("invoice", input.invoices),
    certificates: byId("certificate", input.certificates),
    customsEntries: byId("customs entry", input.customsEntries),
  });
}

export type IntegrityError = { objectId: string; message: string };

/** Referential integrity across the company graph. Empty array = consistent. */
export function validateCompany(c: Company): IntegrityError[] {
  const errors: IntegrityError[] = [];
  const err = (objectId: string, message: string) => errors.push({ objectId, message });

  for (const line of c.bom) {
    if (!c.products[line.productId]) err(`BOM:${line.productId}/${line.partId}`, `unknown product ${line.productId}`);
    if (!c.parts[line.partId]) err(`BOM:${line.productId}/${line.partId}`, `unknown part ${line.partId}`);
  }
  for (const p of Object.values(c.parts)) {
    for (const s of p.approvedSuppliers) if (!c.suppliers[s]) err(p.id, `approved supplier ${s} does not exist`);
  }
  for (const k of Object.values(c.contracts)) {
    if (!c.suppliers[k.supplierId]) err(k.id, `unknown supplier ${k.supplierId}`);
    const part = c.parts[k.partId];
    if (!part) err(k.id, `unknown part ${k.partId}`);
    else if (!part.approvedSuppliers.includes(k.supplierId)) {
      err(k.id, `supplier ${k.supplierId} is not an approved supplier for ${k.partId}`);
    }
    if (k.prices.length === 0) err(k.id, "contract has no price schedule");
  }
  for (const po of Object.values(c.pos)) {
    if (!c.suppliers[po.supplierId]) err(po.id, `unknown supplier ${po.supplierId}`);
    for (const l of po.lines) if (!c.parts[l.partId]) err(po.id, `unknown part ${l.partId}`);
  }
  for (const r of Object.values(c.receipts)) {
    const po = c.pos[r.poId];
    if (!po) err(r.id, `unknown PO ${r.poId}`);
    for (const l of r.lines) {
      if (po && !po.lines.some((pl) => pl.partId === l.partId)) err(r.id, `part ${l.partId} is not on ${r.poId}`);
    }
  }
  for (const s of Object.values(c.packingSlips)) {
    if (!c.pos[s.poId]) err(s.id, `unknown PO ${s.poId}`);
  }
  for (const inv of Object.values(c.invoices)) {
    if (!c.suppliers[inv.supplierId]) err(inv.id, `unknown supplier ${inv.supplierId}`);
    if (inv.poId) {
      const po = c.pos[inv.poId];
      if (!po) err(inv.id, `unknown PO ${inv.poId}`);
      else if (po.supplierId !== inv.supplierId) err(inv.id, `PO ${po.id} belongs to ${po.supplierId}`);
    }
  }
  for (const coo of Object.values(c.certificates)) {
    if (!c.invoices[coo.invoiceId]) err(coo.id, `unknown invoice ${coo.invoiceId}`);
    if (!c.parts[coo.partId]) err(coo.id, `unknown part ${coo.partId}`);
  }
  for (const ce of Object.values(c.customsEntries)) {
    if (!c.invoices[ce.invoiceId]) err(ce.id, `unknown invoice ${ce.invoiceId}`);
  }
  return errors;
}
