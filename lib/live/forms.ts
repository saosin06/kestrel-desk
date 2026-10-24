// Shapes the intake forms send to the server (safe to import from client code).

export type InvoiceForm = {
  supplierId: string; // vendor-master id, or "UNREGISTERED"
  supplierName: string;
  poId: string; // "" when none
  invoiceNo: string;
  date: string;
  currency: "USD" | "JPY" | "EUR";
  mode: "replace" | "additional";
  lines: {
    partId: string; // "" when the line isn't a known part
    description: string;
    qty: string;
    unitPrice: string;
    manufacturerPartNo: string;
    countryOfOrigin: string;
    /** country on the certificate of origin that came with the shipment ("" = none) */
    certificateOrigin: string;
  }[];
};

export type EmailForm = { from: string; to: string; subject: string; body: string; date: string };

export type LiveFinding = {
  kind: string;
  objectId: string;
  detail: string;
  impactUSDCents: number | null;
  disposition: string;
  ruleId: string | null;
};
