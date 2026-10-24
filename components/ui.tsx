import Link from "next/link";
import type { ReactNode } from "react";
import { recordHref, type Tone } from "@/lib/ui/format";

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
      <div>
        {crumbs && (
          <div className="mb-1 text-[12px] text-muted">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                <Link href={c.href} className="text-muted">{c.label}</Link>
                {i < crumbs.length - 1 && <span className="px-1.5">/</span>}
              </span>
            ))}
          </div>
        )}
        <h1 className="text-[18px] font-semibold leading-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-1 text-[12.5px] text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, flush, note }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; note?: ReactNode }) {
  return (
    <section className="mb-4 rounded-[4px] border border-line bg-panel">
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-3"}>{children}</div>
      {note && <footer className="border-t border-line px-3 py-1.5 text-[11.5px] text-muted">{note}</footer>}
    </section>
  );
}

const TONE: Record<Tone, string> = {
  crit: "text-[var(--crit)] bg-[var(--crit-bg)] border-[color-mix(in_srgb,var(--crit)_25%,transparent)]",
  warn: "text-[var(--warn)] bg-[var(--warn-bg)] border-[color-mix(in_srgb,var(--warn)_25%,transparent)]",
  good: "text-[var(--good)] bg-[var(--good-bg)] border-[color-mix(in_srgb,var(--good)_25%,transparent)]",
  info: "text-[var(--info)] bg-[var(--info-bg)] border-[color-mix(in_srgb,var(--info)_25%,transparent)]",
  neutral: "text-[var(--neutral)] bg-[var(--neutral-bg)] border-line",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-[3px] border px-1.5 py-[1px] text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}

export function Rec({ id }: { id: string }) {
  const href = recordHref(id);
  return href ? (
    <Link href={href} className="id">{id}</Link>
  ) : (
    <span className="id text-ink-2">{id}</span>
  );
}

export function Kv({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(130px,auto)_1fr] gap-x-4 gap-y-1.5">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-[4px] border border-line bg-panel px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.02em] text-muted">{label}</div>
      <div className="mt-1 text-[20px] font-semibold leading-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-ink-2">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-muted">{children}</div>;
}
