import Link from "next/link";
import { EscalationChart } from "@/components/escalation-chart";
import { usdCompact } from "@/lib/ui/format";
import { story } from "@/lib/ui/story";

function Num({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[26px] font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1.5 text-[12.5px] text-ink-2">{label}</div>
    </div>
  );
}

function H({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-[17px] font-semibold text-ink">{children}</h2>
      {sub && <p className="m-0 mt-1 max-w-[880px] text-[13px] text-ink-2">{sub}</p>}
    </div>
  );
}

export default function Story() {
  const s = story();
  const cold = s.timeline.reduce((a, d) => a + d.cold, 0);
  const learned = s.timeline.reduce((a, d) => a + d.learned, 0);
  const after = s.timeline.filter((d) => d.period > "2026-03");
  const coldAfter = after.reduce((a, d) => a + d.cold, 0);
  const learnedAfter = after.reduce((a, d) => a + d.learned, 0);
  const pct = Math.round(((coldAfter - learnedAfter) / coldAfter) * 100);
  const learnedRules = s.rules;
  const refused = s.refused;

  return (
    <div className="max-w-[1180px]">
      {/* Hero */}
      <section className="mb-6 border-b border-line pb-6">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Kestrel Aerial · simulated $137M drone maker · Mar–Sep 2026</div>
        <h1 className="m-0 max-w-[900px] text-[28px] font-semibold leading-tight text-ink">An AI finance team that learns how the company actually works — and can&apos;t move a dollar on its own.</h1>
        <p className="m-0 mt-3 max-w-[860px] text-[14px] leading-relaxed text-ink-2">
          Four Claude agents fill the seats on Kestrel&apos;s disbursements desk — buyer, AP clerk, payroll specialist and staff accountant. They check every supplier invoice and every paycheck, hold what&apos;s wrong, explain it with evidence, and learn the company&apos;s unwritten rules from its own history. They can request; only people approve.
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/intake" className="btn btn-primary no-underline hover:no-underline">Try it live — hand it an invoice or email</Link>
          <Link href="/desk" className="btn no-underline hover:no-underline">Open the desk</Link>
        </div>
        <div className="mt-5 grid grid-cols-4 divide-x divide-line rounded-[4px] border border-line bg-panel">
          <Num value={`${s.card.caught}/${s.card.expected}`} label="planted problems caught (supplier + payroll)" />
          <Num value={String(s.card.falseFindings.length)} label="false alarms" />
          <Num value={usdCompact(s.card.identifiedUSDCents)} label="held or recovered before money moved" />
          <Num value={`${pct}% fewer`} label="escalations to the controller after it learned" />
        </div>
      </section>

      {/* Learning */}
      <section className="mb-6">
        <H sub={`Before it started, the desk read ${s.historyCount} decisions Kestrel's controller made over 14 months and worked out how she actually handles routine exceptions. It proposed what it found; she approved it at the March close. From April on, routine items stop reaching her — and every real problem still does.`}>
          It learned Kestrel&apos;s unwritten rules
        </H>
        <div className="grid grid-cols-[1.1fr_1fr] items-start gap-4">
          <div className="flex flex-col gap-3">
            <div className="rounded-[4px] border border-line bg-panel p-3">
              <div className="mb-1 text-[13px] font-semibold text-ink">Escalations to the controller, per month</div>
              <div className="mb-2 text-[12.5px] text-ink-2">
                Without learning: {cold}. With learning: {learned} — the same in March (it hadn&apos;t learned yet), then {coldAfter} → {learnedAfter} from April.
              </div>
              <EscalationChart data={s.timeline} marker={{ after: "2026-03", label: "Rules approved" }} labels={["Without learning", "With learning"]} />
            </div>
            <div className="rounded-[4px] border border-line bg-panel p-3">
              <div className="mb-2 text-[13px] font-semibold text-ink">What it refused to learn</div>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {refused.map((n, i) => (
                  <li key={i} className="text-[12.5px] text-ink-2">
                    <span className="text-ink">{n.example}</span> — {n.reason}
                    {n.kind === "remittance_change_unverified" && <span className="text-[var(--crit)]"> (that approval was a near-miss fraud)</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="rounded-[4px] border border-line bg-panel p-3">
            <div className="mb-2 text-[13px] font-semibold text-ink">What it learned</div>
            <ul className="m-0 list-none space-y-3 p-0">
              {learnedRules.map((r) => (
                <li key={r.id}>
                  <div className="text-[13px] font-medium text-ink">{r.title}</div>
                  <div className="text-[12.5px] text-ink-2">{r.does}</div>
                  {r.exception && <div className="text-[12px] text-ink-2"><i>Except:</i> {r.exception}</div>}
                  <div className="mt-0.5 text-[11.5px] text-muted">Controller agreed {r.agreed} of {r.seen} times · kept {r.effect} {r.effect === 1 ? "item" : "items"} off her desk</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-2 text-[12px] text-muted">
          Every number here is computed — counts, limits and confidence come from the records, not from a model. <Link href="/rules">See each rule&apos;s evidence →</Link>
        </div>
      </section>

      {/* Caught */}
      <section className="mb-6">
        <H sub="Click any to see the evidence trail the agent left: the records, the rule, and which source it trusted.">What it caught</H>
        <div className="grid grid-cols-3 gap-3">
          {[
            { c: s.cases.substitution, amount: "$426,000 held", title: "China-made parts slipped in", text: "Vireo swapped in a cheaper flight controller. The certificate of origin says China — which breaks the rules for selling to federal agencies. Price match passed; the compliance check didn't." },
            { c: s.cases.scam, amount: "Payment protected", title: "Scam email the day before payday", text: "“Marcus” asked payroll to send his pay to a new account — from kestrel-aerial.co. The agent refused, citing Kestrel's own policy written after a 2025 near-miss." },
            { c: s.cases.ghost, amount: "Paycheck held", title: "A ghost employee on payroll", text: "The payroll provider's register paid “Jordan Vale”, who isn't in HR — into a real employee's bank account. Recomputing every line caught it." },
          ].map((x) => (
            <Link key={x.title} href={x.c ? `/cases/${x.c.id}` : "/cases"} className="block rounded-[4px] border border-line bg-panel p-3 text-ink no-underline hover:border-line-strong hover:no-underline">
              <div className="text-[12px] font-semibold text-[var(--crit)]">{x.amount}</div>
              <div className="mt-0.5 text-[14px] font-semibold">{x.title}</div>
              <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink-2">{x.text}</p>
              <div className="mt-2 text-[12px] text-link">See the evidence →</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="mb-6">
        <H>Why a controller could trust it</H>
        <div className="grid grid-cols-2 gap-3 text-[13px] text-ink-2">
          {[
            ["It can't approve or pay.", "Agents only request. Approvers come from dollar thresholds, and a requester can never approve its own request — enforced on the server, tested."],
            ["It never does the math.", "Every amount comes from tested code using real 2026 IRS tax tables, US tariff rates and ECB exchange rates — cited and cached."],
            ["Every decision has a trail.", "Each case shows the path through the records, the rule applied, which source it trusted, and an append-only audit log."],
            ["Learning can't make it blind.", "A learned rule can only quiet routine items. Fraud, compliance, duplicates and bank changes always reach a person."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-[4px] border border-line bg-panel p-3"><span className="font-semibold text-ink">{t}</span> {d}</div>
          ))}
        </div>
      </section>

      <section className="rounded-[4px] border border-line bg-subtle p-3 text-[12.5px] text-ink-2">
        <span className="font-semibold text-ink">Scored against a hidden answer key</span> of problems planted in the simulated company: {s.card.caught}/{s.card.expected} caught, {s.card.falseFindings.length} false alarms, {s.card.duplicates} duplicate cases, {s.card.badPayments} payments requested on a problem invoice. Kestrel is simulated; the tax tables, tariff rates and exchange rates are real. <Link href="/sources">Data sources →</Link>
      </section>
    </div>
  );
}
