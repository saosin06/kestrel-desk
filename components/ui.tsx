import Link from "next/link";
import type { ReactNode } from "react";
import { recordHref, type Tone } from "@/lib/ui/format";

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs && (
          <div className="mb-1.5 text-[13px] text-muted">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                <Link href={c.href} className="text-muted hover:text-ink">{c.label}</Link>
                {i < crumbs.length - 1 && <span className="px-1.5">/</span>}
              </span>
            ))}
            <span className="px-1.5">/</span>
          </div>
        )}
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</h1>
        {subtitle && <div className="mt-1.5 max-w-[900px] text-[14px] text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, flush, note }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; note?: ReactNode }) {
  return (
    <section className="card mb-5 overflow-hidden">
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "px-4 pb-4 pt-1"}>{children}</div>
      {note && <footer className="border-t border-line bg-subtle px-4 py-2 text-[12px] text-muted">{note}</footer>}
    </section>
  );
}

const TONE: Record<Tone, { fg: string; bg: string }> = {
  crit: { fg: "var(--crit)", bg: "var(--crit-bg)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-bg)" },
  good: { fg: "var(--good)", bg: "var(--good-bg)" },
  info: { fg: "var(--info)", bg: "var(--info-bg)" },
  neutral: { fg: "var(--neutral)", bg: "var(--neutral-bg)" },
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] text-[12px] font-medium" style={{ color: t.fg, background: t.bg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.fg }} />
      {children}
    </span>
  );
}

export function Rec({ id }: { id: string }) {
  const href = recordHref(id);
  return href ? <Link href={href} className="id">{id}</Link> : <span className="id">{id}</span>;
}

export function Kv({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(130px,auto)_1fr] gap-x-4 gap-y-2">
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
    <div className="card px-4 py-3.5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[12.5px] text-ink-2">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-muted">{children}</div>;
}

const FIG: Record<Tone, string> = { crit: "var(--crit)", warn: "var(--warn)", good: "var(--good)", info: "var(--info)", neutral: "var(--ink)" };

/** One-line explanation of a page plus its few numbers that matter. */
export function Summary({ text, figures }: { text: ReactNode; figures: { label: string; value: ReactNode; tone?: Tone }[] }) {
  return (
    <section className="mb-5">
      <p className="m-0 mb-3 max-w-[920px] text-[14px] leading-relaxed text-ink-2">{text}</p>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}>
        {figures.map((f) => (
          <div key={f.label} className="card px-4 py-3">
            <div className="text-[13px] text-muted">{f.label.replace(/^./, (c) => c.toUpperCase())}</div>
            <div className="mt-0.5 text-[24px] font-semibold leading-tight tracking-[-0.02em]" style={{ color: FIG[f.tone ?? "neutral"] }}>{f.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
