import Link from "next/link";
import { PageHeader, Panel, Summary } from "@/components/ui";
import { roleLabel, usd, usdCompact } from "@/lib/ui/format";
import { scorecard } from "@/lib/ui/scorecard";

export const metadata = { title: "Scorecard" };

const SUPPLIER: Record<string, string> = { "S-NW": "Northwind" };

function handling({ id, disposition, ruleId, ruleTitle, reason }: { id: string; disposition: string; ruleId?: string; ruleTitle: string | null; reason: string }) {
  if (disposition === "escalate" && ruleId && reason.includes("exception:")) return <>Escalate to Dana<div className="text-[11.5px] text-[var(--good)]">Learned rule&apos;s own exception · {reason.split("exception: ")[1]}</div></>;
  if (disposition === "escalate" && id.startsWith("PAT-")) return <>Escalate to Dana<div className="text-[11.5px] text-muted">Before Dana approved the learned rule</div></>;
  if (disposition === "check:recount") return <>Recount first, then escalate<div className="text-[11.5px] text-[var(--good)]">Learned rule · {ruleTitle}</div></>;
  if (disposition.startsWith("route:")) return `Route to ${roleLabel(disposition.slice(6)).split(" · ")[0]}`;
  return "Escalate to Dana";
}

function Check({ ok }: { ok: boolean }) {
  return ok ? <span className="font-semibold text-[var(--good)]">✓</span> : <span className="font-semibold text-[var(--crit)]">✗</span>;
}

export default function Scorecard() {
  const s = scorecard();
  const loud = s.rows.filter((r) => r.shouldEscalate);
  const quiet = s.rows.filter((r) => !r.shouldEscalate);
  const violations = s.card.refusals + s.card.badPayments + s.budgetOverruns;
  const seeds = s.seeds.every((x) => x.exact);

  return (
    <>
      <PageHeader
        title="Scorecard"
        subtitle="The saved agent run (March–September 2026) graded row by row against the answer key planted in the simulated company. The agents never see the key; only this scorer reads it."
      />
      <Summary
        text={<><b>Catching too much counts against it too.</b> The desk has to raise every problem that should reach the controller and stay quiet on the ones that are immaterial or routine under a rule she approved.</>}
        figures={[
          { label: "planted problems caught", value: `${s.card.caught} / ${s.card.expected}`, tone: s.card.caught === s.card.expected ? "good" : "crit" },
          { label: "false findings", value: s.falseFindings.length, tone: s.falseFindings.length ? "crit" : "good" },
          { label: `dollars identified, of ${usdCompact(s.card.keyTotalUSDCents)}`, value: usdCompact(s.card.identifiedUSDCents), tone: s.card.identifiedUSDCents === s.card.keyTotalUSDCents ? "good" : "warn" },
          { label: "control violations", value: violations, tone: violations ? "crit" : "good" },
          { label: "deterministic checks, seed 11", value: seeds ? "Exact match" : "Mismatch", tone: seeds ? "good" : "crit" },
        ]}
      />

      <Panel title={`Should reach the controller · ${loud.filter((r) => r.ok).length} of ${loud.length}`} flush>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Planted problem</th><th>Seat</th><th>Expected handling</th><th className="num">Amount (USD)</th><th>Desk case</th><th className="w-[1%]">Result</th></tr></thead>
            <tbody>
              {loud.map((r) => (
                <tr key={r.id}>
                  <td className="min-w-[260px]">{r.title}<div className="id text-[11px]">{r.id} · {r.objectId}</div></td>
                  <td className="whitespace-nowrap text-ink-2">{roleLabel(r.seat).replace(" (agent)", "")}</td>
                  <td className="text-ink-2">{handling(r)}</td>
                  <td className="num">{r.impactUSDCents ? usd(r.impactUSDCents) : "—"}</td>
                  <td>{r.caseId ? <Link href={`/cases/${r.caseId}`} className="id">{r.caseId}</Link> : <span className="text-[var(--crit)]">Missed</span>}</td>
                  <td className="text-center"><Check ok={r.ok} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total identified</td><td className="num">{usd(s.card.identifiedUSDCents)}</td><td colSpan={2} className="text-ink-2">of {usd(s.card.keyTotalUSDCents)}</td></tr></tfoot>
          </table>
        </div>
      </Panel>

      <Panel title={`Should stay quiet · ${quiet.filter((r) => r.ok).length} of ${quiet.length}`} note="Quiet means no case and no escalation; the engines still compute the finding. A learned rule can never quiet compliance, bank changes, duplicates or unknown suppliers." flush>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Planted item</th><th>Why it shouldn&apos;t reach Dana</th><th className="num">Amount (USD)</th><th>Desk</th><th className="w-[1%]">Result</th></tr></thead>
            <tbody>
              {quiet.map((r) => (
                <tr key={r.id}>
                  <td className="min-w-[260px]">{r.title}<div className="id text-[11px]">{r.id} · {r.objectId}</div></td>
                  <td className="text-ink-2">{r.ruleId ? <><span className="text-[var(--good)]">Learned rule</span> · {r.ruleTitle}</> : r.reason.replace(/^./, (c) => c.toUpperCase())}</td>
                  <td className="num">{usd(r.impactUSDCents)}</td>
                  <td className="whitespace-nowrap text-ink-2">{r.caseId ? <Link href={`/cases/${r.caseId}`} className="id">{r.caseId}</Link> : "No case opened"}</td>
                  <td className="text-center"><Check ok={r.ok} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-5 [&>*]:min-w-0">
        <Panel title="Also checked">
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {s.seeds.map((x) => (
              <li key={x.seed} className="flex gap-2.5"><Check ok={x.exact} /><span>Seed {x.seed}: the deterministic checks find exactly the key&apos;s {x.count} planted findings, no more and no fewer. Recomputed when this page was built.</span></li>
            ))}
            {s.clean.map((c) => (
              <li key={c.supplierId} className="flex gap-2.5"><Check ok={c.cases === 0} /><span>Clean supplier {SUPPLIER[c.supplierId] ?? c.supplierId}: {c.invoices} invoices, {c.cases} cases.</span></li>
            ))}
            <li className="flex gap-2.5"><Check ok={s.card.duplicates === 0} /><span>{s.card.duplicates} duplicate cases; {s.card.badPayments} payments requested on a problem invoice.</span></li>
            <li className="flex gap-2.5"><Check ok={s.budgetOverruns === 0} /><span>{s.budgetOverruns} agent runs over their turn budget.</span></li>
          </ul>
        </Panel>
        <Panel title="Not in this score">
          <ul className="m-0 flex list-disc flex-col gap-2.5 pl-4 text-ink-2">
            <li><span className="text-ink">Supplier bank-change email (problem 3).</span> Shown live instead: <Link href="/intake">Try it live</Link> has the “Atlas asks to change bank details” email ready to send to the agent.</li>
            <li><span className="text-ink">Problems {s.deferred.filter((p) => p !== 3).join(", ")}</span> (GRNI accrual, defect credit, mid-contract price change, the remembered $640 rejection, the export restriction) belong to the staff accountant and buyer seats, which aren&apos;t agents yet.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
