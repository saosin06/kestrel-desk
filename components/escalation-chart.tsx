// Escalations reaching the controller per month: no learned rules vs. with
// Kestrel's learned internal rules. Paired columns, one axis, legend + labels.
import { monthLabel } from "@/lib/ui/format";

type Row = { period: string; cold: number; learned: number };

export function EscalationChart({ data }: { data: Row[] }) {
  const W = 640;
  const H = 210;
  const m = { top: 18, right: 8, bottom: 26, left: 30 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(2, ...data.flatMap((d) => [d.cold, d.learned]));
  const step = max <= 6 ? 1 : max <= 12 ? 2 : 5;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const band = iw / data.length;
  const bw = Math.min(22, (band - 18) / 2);
  const y = (v: number) => m.top + ih - (v / top) * ih;
  const bar = (x: number, v: number, fill: string, label: string) => {
    const h = (v / top) * ih;
    const yy = m.top + ih - h;
    const r = Math.min(4, h);
    const d = h <= 0 ? "" : `M${x},${m.top + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${m.top + ih} Z`;
    return (
      <g>
        <title>{label}</title>
        {d && <path d={d} fill={fill} />}
        <rect x={x - 2} y={m.top} width={bw + 4} height={ih} fill="transparent" />
      </g>
    );
  };
  const totalCold = data.reduce((a, d) => a + d.cold, 0);
  const totalLearned = data.reduce((a, d) => a + d.learned, 0);

  return (
    <figure className="m-0">
      <div className="mb-2 flex items-center gap-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--series-cold)" }} />No learned rules · {totalCold}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--series-learned)" }} />With learned rules · {totalLearned}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Escalations to the controller per month: ${totalCold} without learned rules, ${totalLearned} with them`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--border-strong)" : "var(--border)"} strokeWidth={1} />
            <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = m.left + band * i + band / 2;
          const x1 = cx - bw - 1;
          const x2 = cx + 1;
          return (
            <g key={d.period}>
              {bar(x1, d.cold, "var(--series-cold)", `${monthLabel(d.period)}: ${d.cold} without learned rules`)}
              {bar(x2, d.learned, "var(--series-learned)", `${monthLabel(d.period)}: ${d.learned} with learned rules`)}
              {d.cold > 0 && <text x={x1 + bw / 2} y={y(d.cold) - 4} textAnchor="middle" fontSize={10.5} fill="var(--ink-2)">{d.cold}</text>}
              {d.learned > 0 && <text x={x2 + bw / 2} y={y(d.learned) - 4} textAnchor="middle" fontSize={10.5} fill="var(--ink-2)">{d.learned}</text>}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{monthLabel(d.period)}</text>
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer text-muted">Table view</summary>
        <table className="tbl mt-1">
          <thead><tr><th>Month</th><th className="num">No learned rules</th><th className="num">With learned rules</th><th className="num">Difference</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.period}><td>{monthLabel(d.period)} 2026</td><td className="num">{d.cold}</td><td className="num">{d.learned}</td><td className="num">{d.learned - d.cold}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
