import { EscalationChart } from "@/components/escalation-chart";
import { AwaitingMe, ExposureByKind, OverviewStats, RecentActivity } from "@/components/overview-live";
import { PageHeader, Panel } from "@/components/ui";
import { desk, escalationsByMonth } from "@/lib/ui/world";

export default function Overview() {
  const data = escalationsByMonth();
  const { rules, findings } = desk();
  const cold = data.reduce((a, d) => a + d.cold, 0);
  const learned = data.reduce((a, d) => a + d.learned, 0);
  return (
    <>
      <PageHeader title="Desk overview" subtitle="Procure-to-pay and payroll, March–September 2026" />
      <OverviewStats />
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4">
        <div>
          <Panel
            title="Escalations to the controller"
            note={`${findings.length} findings logged either way. ${rules.length} internal rules learned from Kestrel's history (Jan 2025–Feb 2026) route routine items to info or a recount; compliance, fraud and duplicates can never be learned away.`}
          >
            <div className="mb-1 text-[12.5px] text-ink-2">
              {cold} → {learned} escalations ({Math.round(((cold - learned) / cold) * 100)}% fewer) with every problem still caught.
            </div>
            <EscalationChart data={data} />
          </Panel>
          <AwaitingMe />
        </div>
        <div>
          <ExposureByKind />
          <RecentActivity />
        </div>
      </div>
    </>
  );
}
