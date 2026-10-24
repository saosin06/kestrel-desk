"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useState } from "react";
import { APPROVER_ROLES, useActingAs } from "@/app/providers";
import { api } from "@/convex/_generated/api";
import { date, roleLabel } from "@/lib/ui/format";

const NAV: { group: string; items: { href: string; label: string; badge?: "approvals" | "cases" }[] }[] = [
  { group: "Desk", items: [{ href: "/", label: "Overview" }, { href: "/approvals", label: "Approvals", badge: "approvals" }, { href: "/cases", label: "Cases", badge: "cases" }, { href: "/intake", label: "Live intake" }] },
  { group: "Operations", items: [{ href: "/payables", label: "Payables" }, { href: "/payroll", label: "Payroll" }] },
  { group: "Accounting", items: [{ href: "/ledger", label: "General ledger" }] },
  { group: "Controls", items: [{ href: "/rules", label: "Internal rules" }, { href: "/audit", label: "Audit log" }] },
  { group: "Reference", items: [{ href: "/sources", label: "Data sources" }] },
];

type Counts = { pendingApprovals?: number; openCases?: number } | undefined;

function NavList({ path, counts }: { path: string | null; counts: Counts }) {
  const active = (href: string) => path !== null && (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      {NAV.map((g) => (
        <div key={g.group} className="mb-3">
          <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted">{g.group}</div>
          {g.items.map((it) => {
            const n = it.badge === "approvals" ? counts?.pendingApprovals : it.badge === "cases" ? counts?.openCases : undefined;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center justify-between rounded-[3px] px-2 py-[5px] text-[13px] no-underline hover:no-underline ${active(it.href) ? "bg-[var(--neutral-bg)] font-semibold text-ink shadow-[inset_2px_0_0_var(--accent)]" : "text-ink-2 hover:bg-subtle"}`}
              >
                <span>{it.label}</span>
                {n ? <span className="num text-[11px] text-muted">{n}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function ResetButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      title="Reload the saved agent run (the state the demo starts from)"
      onClick={async () => {
        if (!window.confirm("Reset the desk to the saved agent run? Live intakes and decisions made since will be cleared.")) return;
        setBusy(true);
        try {
          await fetch("/api/reset", { method: "POST" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}

function ActiveNav({ counts }: { counts: Counts }) {
  return <NavList path={usePathname()} counts={counts} />;
}

export function Shell({ children }: { children: ReactNode }) {
  const overview = useQuery(api.desk.overview);
  const { role, setRole } = useActingAs();
  const period = overview?.simDate?.slice(0, 7);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[212px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <div className="text-[13px] font-semibold text-ink">Kestrel Aerial</div>
          <div className="text-[11.5px] text-muted">Disbursements desk</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <Suspense fallback={<NavList path={null} counts={overview} />}>
            <ActiveNav counts={overview} />
          </Suspense>
        </nav>
        <div className="border-t border-line px-4 py-2.5 text-[11px] leading-snug text-muted">
          Simulated company for demonstration. Reference data is real and cited.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-11 items-center justify-between gap-4 border-b border-line bg-panel px-5">
          <div className="flex items-center gap-3 text-[12.5px]">
            <span className="font-semibold text-ink">Kestrel Aerial, Inc.</span>
            <span className="rounded-[3px] border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[var(--warn-bg)] px-1.5 py-[1px] text-[10.5px] font-semibold tracking-[0.04em] text-[var(--warn)]">SIMULATED COMPANY</span>
            <span className="text-line-strong">|</span>
            <span className="text-ink-2">FY2026</span>
            <span className="text-ink-2">Period {period ? date(period) : "—"} · Open</span>
            <span className="text-ink-2">As of {date(overview?.simDate)}</span>
          </div>
          <div className="flex items-center gap-3">
          <ResetButton />
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            Acting as
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as (typeof APPROVER_ROLES)[number])}>
              {APPROVER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-5 py-4">{children}</main>
      </div>
    </div>
  );
}
