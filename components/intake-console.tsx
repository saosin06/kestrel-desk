"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Empty, Panel, Pill, Rec } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { EmailForm, InvoiceForm, LiveFinding } from "@/lib/live/forms";
import { date, dispositionLabel, dispositionTone, kindLabel, roleLabel, usd } from "@/lib/ui/format";

export type IntakeOptions = {
  suppliers: { id: string; name: string; currency: "USD" | "JPY" | "EUR"; country: string }[];
  pos: { id: string; supplierId: string; date: string; lines: { partId: string; description: string; qty: string; unitPrice: string; mpn: string; covered: boolean }[] }[];
};

type Line = InvoiceForm["lines"][number];

function fromPo(o: IntakeOptions, poId: string): Line[] {
  const po = o.pos.find((p) => p.id === poId);
  const sup = o.suppliers.find((s) => s.id === po?.supplierId);
  return (po?.lines ?? []).map((l) => ({ partId: l.partId, description: l.description, qty: l.qty, unitPrice: l.unitPrice, manufacturerPartNo: l.mpn, countryOfOrigin: sup?.country ?? "", certificateOrigin: l.covered ? (sup?.country ?? "") : "" }));
}

function invoiceFor(o: IntakeOptions, supplierId: string, poId: string, invoiceNo: string, d: string, mode: InvoiceForm["mode"] = "replace"): InvoiceForm {
  const sup = o.suppliers.find((s) => s.id === supplierId)!;
  return { supplierId, supplierName: sup.name, poId, invoiceNo, date: d, currency: sup.currency, mode, lines: fromPo(o, poId) };
}

type Preset = { label: string; build: (o: IntakeOptions) => InvoiceForm };
const PRESETS: Preset[] = [
  {
    label: "Atlas bills $140 per motor (contract $118)",
    build: (o) => {
      const f = invoiceFor(o, "S-ATL", "PO-2607-ATL", "INV-9101", "2026-07-22");
      f.lines = f.lines.map((l) => (l.partId === "P07" ? { ...l, unitPrice: "140.00" } : l));
      return f;
    },
  },
  {
    label: "Vireo ships flight controllers made in China",
    build: (o) => {
      const f = invoiceFor(o, "S-VIR", "PO-2607-VIR", "VA26-9102", "2026-07-20");
      f.lines = f.lines.map((l) => (l.partId === "P04" ? { ...l, unitPrice: "1420.00", manufacturerPartNo: "VFC-2-LC", description: "Flight controller FC-2 Lite (functional equivalent)", certificateOrigin: "CN" } : l));
      return f;
    },
  },
  { label: "Ridgeline re-sends June's invoice", build: (o) => invoiceFor(o, "S-RDG", "PO-2606-RDG", "RDG-5513-B", "2026-07-02", "additional") },
  {
    label: "Invoice from a supplier we've never used",
    build: () => ({ supplierId: "UNREGISTERED", supplierName: "Skyward Parts Trading Ltd", poId: "", invoiceNo: "SPT-0442", date: "2026-07-21", currency: "USD", mode: "replace", lines: [{ partId: "", description: "Rush airframe arms, expedite", qty: "40", unitPrice: "145.00", manufacturerPartNo: "", countryOfOrigin: "", certificateOrigin: "" }] }),
  },
  { label: "A clean Northwind invoice", build: (o) => invoiceFor(o, "S-NW", "PO-2607-NW", "NW-9105", "2026-07-21") },
];

const EMAILS: { label: string; form: EmailForm }[] = [
  { label: "\"Atlas\" asks to change bank details", form: { from: "accounts@atlas-motors-mx.com", to: "ap@kestrelaerial.com", subject: "Updated remittance details — urgent", date: "2026-07-23", body: "Hello Kestrel AP,\n\nDue to an audit at our bank, please send all payments from today to our new account at Banco Continental, account ending 8812. Tomorrow's payment for the corrected April invoice should go there.\n\nRegards,\nAtlas Motors Accounts Receivable" } },
  { label: "Employee asks to change direct deposit", form: { from: "z.jensen.personal@gmail.com", to: "payroll@kestrelaerial.com", subject: "New bank for my paycheck", date: "2026-08-06", body: "Hi, it's Zoe Jensen in Field Service. I closed my old account — can you send this Friday's pay to my new one, routing 0260 0959 3, account ending 3391? Thanks!" } },
  { label: "Routine: shipping update", form: { from: "logistics@vireo-avionics.com.tw", to: "ap@kestrelaerial.com", subject: "September shipment tracking", date: "2026-09-02", body: "Dear Kestrel team, the September flight controller and ESC shipment left Taoyuan today, tracking 7781-2290. Expected at your dock around Sep 15. Best regards, Vireo Logistics" } },
];

export function IntakeConsole({ options }: { options: IntakeOptions }) {
  const [tab, setTab] = useState<"invoice" | "email">("invoice");
  const [form, setForm] = useState<InvoiceForm>(() => PRESETS[0].build(options));
  const [email, setEmail] = useState<EmailForm>(EMAILS[0].form);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState<null | "submit" | "extract">(null);
  const [error, setError] = useState<string | null>(null);
  const [instant, setInstant] = useState<{ intakeId: string; findings: LiveFinding[] } | null>(null);
  const intakes = useQuery(api.intake.list);

  const setLine = (i: number, patch: Partial<Line>) => setForm((f) => ({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const pos = options.pos.filter((p) => p.supplierId === form.supplierId);

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  };
  const submitInvoice = async () => {
    setBusy("submit");
    setError(null);
    try {
      setInstant(await post("/api/intake/invoice", form));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const submitEmail = async () => {
    setBusy("submit");
    setError(null);
    try {
      const r = await post("/api/intake/email", email);
      setInstant({ intakeId: r.intakeId, findings: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const extract = async () => {
    setBusy("extract");
    setError(null);
    try {
      const x = await post("/api/intake/extract", { text: paste });
      setForm({ supplierId: x.supplierId, supplierName: x.supplierName, poId: x.poId, invoiceNo: x.invoiceNo, date: x.date, currency: x.currency, mode: "replace", lines: x.lines });
      if (x.lowConfidence?.length) setError(`Check these fields — the extraction wasn't sure: ${x.lowConfidence.join(", ")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const latest = instant && intakes?.find((x) => x.intakeId === instant.intakeId);

  return (
    <div className="grid grid-cols-[1.25fr_1fr] gap-4">
      <div>
        <div className="mb-3 flex gap-1.5">
          <button className={`btn ${tab === "invoice" ? "btn-primary" : ""}`} onClick={() => setTab("invoice")}>Supplier invoice</button>
          <button className={`btn ${tab === "email" ? "btn-primary" : ""}`} onClick={() => setTab("email")}>Email to the desk</button>
        </div>

        {tab === "invoice" ? (
          <>
            <Panel title="Start from a scenario">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => <button key={p.label} className="btn" onClick={() => { setForm(p.build(options)); setInstant(null); setError(null); }}>{p.label}</button>)}
              </div>
            </Panel>
            <Panel title="Supplier invoice" note="Amounts are recomputed on the server from quantity × unit price; the browser never supplies a total.">
              <div className="mb-3 grid grid-cols-4 gap-2">
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">Supplier
                  <select className="select" value={form.supplierId} onChange={(e) => {
                    const id = e.target.value;
                    const s = options.suppliers.find((x) => x.id === id);
                    setForm((f) => ({ ...f, supplierId: id, supplierName: s?.name ?? "", currency: s?.currency ?? "USD", poId: "", lines: id === "UNREGISTERED" ? f.lines : [] }));
                  }}>
                    {options.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="UNREGISTERED">Other (not in vendor master)</option>
                  </select>
                </label>
                {form.supplierId === "UNREGISTERED" ? (
                  <label className="flex flex-col gap-1 text-[11.5px] text-muted">Supplier name as printed<input className="input" value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} /></label>
                ) : (
                  <label className="flex flex-col gap-1 text-[11.5px] text-muted">Purchase order
                    <select className="select" value={form.poId} onChange={(e) => setForm((f) => ({ ...f, poId: e.target.value, lines: fromPo(options, e.target.value) }))}>
                      <option value="">None</option>
                      {pos.map((p) => <option key={p.id} value={p.id}>{p.id} · {date(p.date)}</option>)}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">Invoice no.<input className="input" value={form.invoiceNo} onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))} /></label>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">Invoice date<input className="input" type="date" min="2026-03-01" max="2026-09-30" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></label>
              </div>
              <table className="tbl mb-2 border border-line">
                <thead><tr><th>Part</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price ({form.currency})</th><th>MPN</th><th>Origin on invoice</th><th>Certificate of origin</th><th /></tr></thead>
                <tbody>
                  {form.lines.map((l, i) => (
                    <tr key={i}>
                      <td><input className="input w-[56px]" value={l.partId} onChange={(e) => setLine(i, { partId: e.target.value })} /></td>
                      <td><input className="input w-full min-w-[190px]" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                      <td><input className="input w-[84px] text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                      <td><input className="input w-[96px] text-right" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                      <td><input className="input w-[92px]" value={l.manufacturerPartNo} onChange={(e) => setLine(i, { manufacturerPartNo: e.target.value })} /></td>
                      <td><input className="input w-[48px]" value={l.countryOfOrigin} onChange={(e) => setLine(i, { countryOfOrigin: e.target.value })} /></td>
                      <td><input className="input w-[48px]" placeholder="—" value={l.certificateOrigin} onChange={(e) => setLine(i, { certificateOrigin: e.target.value })} /></td>
                      <td><button className="btn" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, k) => k !== i) }))}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[12px] text-ink-2">
                  <button className="btn" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { partId: "", description: "", qty: "1", unitPrice: "0.00", manufacturerPartNo: "", countryOfOrigin: "", certificateOrigin: "" }] }))}>Add line</button>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.mode === "additional"} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.checked ? "additional" : "replace" }))} />Keep the PO's existing invoice (send as an additional one)</label>
                </div>
                <button className="btn btn-primary" disabled={busy !== null} onClick={submitInvoice}>{busy === "submit" ? "Submitting…" : "Send to the desk"}</button>
              </div>
            </Panel>
            <Panel title="Or paste invoice text">
              <textarea className="input h-[96px] w-full py-1.5" placeholder="Paste the text of an invoice; Claude fills the form above (amounts are still recomputed)." value={paste} onChange={(e) => setPaste(e.target.value)} />
              <div className="mt-2 flex justify-end"><button className="btn" disabled={!paste.trim() || busy !== null} onClick={extract}>{busy === "extract" ? "Reading…" : "Fill the form"}</button></div>
            </Panel>
          </>
        ) : (
          <>
            <Panel title="Start from a scenario">
              <div className="flex flex-wrap gap-1.5">{EMAILS.map((e) => <button key={e.label} className="btn" onClick={() => { setEmail(e.form); setInstant(null); }}>{e.label}</button>)}</div>
            </Panel>
            <Panel title="Email to the desk" note="Sent to ap@ → the AP clerk reads it; payroll@ → the payroll specialist.">
              <div className="mb-2 grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">From<input className="input" value={email.from} onChange={(e) => setEmail({ ...email, from: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">To
                  <select className="select" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })}><option>ap@kestrelaerial.com</option><option>payroll@kestrelaerial.com</option></select>
                </label>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">Date<input className="input" type="date" min="2026-03-01" max="2026-09-30" value={email.date} onChange={(e) => setEmail({ ...email, date: e.target.value })} /></label>
              </div>
              <label className="mb-2 flex flex-col gap-1 text-[11.5px] text-muted">Subject<input className="input" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} /></label>
              <textarea className="input h-[140px] w-full py-1.5" value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} />
              <div className="mt-2 flex justify-end"><button className="btn btn-primary" disabled={busy !== null} onClick={submitEmail}>{busy === "submit" ? "Sending…" : "Send"}</button></div>
            </Panel>
          </>
        )}
        {error && <div className="mb-3 rounded-[4px] border border-[var(--warn)] bg-[var(--warn-bg)] px-3 py-2 text-[var(--warn)]">{error}</div>}
      </div>

      <div>
        <Panel title="Result">
          {!instant ? <div className="text-muted">Send a document to see what the desk does with it.</div> : (
            <>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">Rules engine · instant</div>
              {tab === "email" && instant.findings.length === 0 ? <div className="mb-3 text-ink-2">Emails need reading — no deterministic check applies. The seat decides.</div> : instant.findings.length === 0 ? <div className="mb-3"><Pill tone="good">Matched</Pill> <span className="text-ink-2">No findings.</span></div> : (
                <table className="tbl mb-3 border border-line">
                  <tbody>{instant.findings.map((f, i) => <tr key={i}><td className="whitespace-nowrap">{kindLabel(f.kind)}</td><td className="text-ink-2">{f.detail}</td><td className="num">{usd(f.impactUSDCents)}</td><td><Pill tone={dispositionTone(f.disposition)}>{dispositionLabel(f.disposition)}</Pill></td></tr>)}</tbody>
                </table>
              )}
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">{latest ? roleLabel(latest.seat) : "Agent"} · live</div>
              {!latest || latest.status === "agent_running" ? <div className="text-ink-2">Working on it… (usually 20–60 seconds)</div> : latest.status === "error" ? <div className="text-[var(--crit)]">{latest.error}</div> : (
                <>
                  <div className="mb-2 flex flex-wrap gap-1.5">{latest.caseIds.length ? latest.caseIds.map((c) => <Link key={c} href={`/cases/${c}`} className="id">{c}</Link>) : <span className="text-ink-2">No case opened.</span>}</div>
                  <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">{latest.agentSummary}</div>
                </>
              )}
            </>
          )}
        </Panel>
        <Panel title="Intake log" flush>
          {intakes === undefined ? <Empty>Loading…</Empty> : intakes.length === 0 ? <Empty>Nothing handed to the desk yet.</Empty> : (
            <table className="tbl">
              <tbody>
                {intakes.map((x) => (
                  <tr key={x.intakeId} id={x.intakeId}>
                    <td className="id text-ink-2">{x.intakeId}</td>
                    <td>{x.title}<div className="text-[11.5px] text-muted">{date(x.at)} · {roleLabel(x.seat)}</div></td>
                    <td>{x.caseIds.map((c) => <Rec key={c} id={c} />)}</td>
                    <td><Pill tone={x.status === "done" ? "good" : x.status === "error" ? "crit" : "warn"}>{x.status === "agent_running" ? "Working" : x.status === "done" ? "Done" : "Error"}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
