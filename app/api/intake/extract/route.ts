import Anthropic from "@anthropic-ai/sdk";
import { AGENT_MODEL } from "@/lib/agents/run";
import { baseWorld } from "@/lib/live/desk";

const str = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supplierName", "supplierId", "poId", "invoiceNo", "date", "currency", "lines", "lowConfidence"],
  properties: {
    supplierName: str,
    supplierId: { ...str, description: "vendor-master id if the supplier matches one, else UNREGISTERED" },
    poId: { ...str, description: "PO id if stated or clearly implied, else empty" },
    invoiceNo: str,
    date: { ...str, description: "YYYY-MM-DD" },
    currency: { type: "string", enum: ["USD", "JPY", "EUR"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["partId", "description", "qty", "unitPrice", "manufacturerPartNo", "countryOfOrigin", "certificateOrigin"],
        properties: {
          partId: { ...str, description: "Kestrel part id (P01–P15) if the line matches one, else empty" },
          description: str,
          qty: { ...str, description: "whole number as written" },
          unitPrice: { ...str, description: "decimal as written, no currency symbol or commas" },
          manufacturerPartNo: str,
          countryOfOrigin: { ...str, description: "ISO 2-letter code if stated, else empty" },
          certificateOrigin: { ...str, description: "country on an attached certificate of origin if mentioned, else empty" },
        },
      },
    },
    lowConfidence: { type: "array", items: str, description: "field names you are unsure about" },
  },
};

/** Turns pasted invoice text into the intake form. Extraction only — the server recomputes every amount. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) return Response.json({ error: "paste some invoice text" }, { status: 400 });
  const w = baseWorld();
  const context = {
    suppliers: w.vendors.map((v) => ({ id: v.supplierId, name: v.legalName })),
    parts: w.contracts.map((c) => ({ partId: c.partId, supplierId: c.supplierId })),
    pos: w.pos.map((p) => ({ id: p.id, supplierId: p.supplierId, date: p.date })),
  };
  const client = new Anthropic();
  const response = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: 4_000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Extract this supplier invoice into the schema. Copy numbers exactly as written; don't calculate anything. Kestrel's suppliers, parts and POs for matching:\n${JSON.stringify(context)}\n\nInvoice text:\n${text}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") return Response.json({ error: "extraction declined" }, { status: 422 });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return Response.json({ error: "no extraction returned" }, { status: 502 });
  return Response.json(JSON.parse(block.text));
}
